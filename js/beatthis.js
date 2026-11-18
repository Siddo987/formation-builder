// #2103: Beat This! (CPJKU, MIT — Code und Gewichte) im Browser. Nachbau von beat_this.inference
// (LogMelSpect, split_predict_aggregate) und Postprocessor(type="minimal"); das Modell small0 ist
// nach ONNX exportiert (models/beat_this_small0.onnx) und läuft mit onnxruntime-web.
// Eingabe: Mono-Signal mit 22 050 Hz. Ausgabe: Schläge und Taktanfänge in Sekunden.

export const SR = 22050, FPS = 50;
const N_FFT = 1024, HOP = 441, N_MELS = 128, N_FREQS = N_FFT / 2 + 1;
const CHUNK = 1500, BORDER = 6;

// Mel-Filterbank wie torchaudio (slaney, f_min 30, f_max 11000, ohne Norm), als Bandbereiche,
// weil jedes Band nur wenige Frequenzen berührt.
function melBank(){
  const hz2mel = f => f < 1000 ? 3 * f / 200 : 15 + 27 * Math.log(f / 1000) / Math.log(6.4);
  const mel2hz = m => m < 15 ? 200 * m / 3 : 1000 * Math.exp(Math.log(6.4) * (m - 15) / 27);
  const lo = hz2mel(30), hi = hz2mel(11000), pts = [];
  for(let i = 0; i < N_MELS + 2; i++) pts.push(mel2hz(lo + (hi - lo) * i / (N_MELS + 1)));
  const bands = [];
  for(let m = 0; m < N_MELS; m++){
    const w = new Float32Array(N_FREQS);
    let first = -1, last = -1;
    for(let k = 0; k < N_FREQS; k++){
      const f = k * SR / N_FFT;
      const v = Math.max(0, Math.min((f - pts[m]) / (pts[m + 1] - pts[m]), (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1])));
      if(v > 0){ w[k] = v; if(first < 0) first = k; last = k; }
    }
    bands.push({first, w: w.subarray(Math.max(first, 0), last + 1)});
  }
  return bands;
}

// In-place radix-2 FFT (re/im, Länge N_FFT).
const BITREV = new Uint16Array(N_FFT), COS = new Float64Array(N_FFT / 2), SIN = new Float64Array(N_FFT / 2);
for(let i = 0, j = 0; i < N_FFT; i++){
  BITREV[i] = j;
  let bit = N_FFT >> 1;
  while(j & bit){ j ^= bit; bit >>= 1; }
  j |= bit;
}
for(let i = 0; i < N_FFT / 2; i++){ COS[i] = Math.cos(2 * Math.PI * i / N_FFT); SIN[i] = -Math.sin(2 * Math.PI * i / N_FFT); }
function fft(re, im){
  for(let i = 0; i < N_FFT; i++){ const j = BITREV[i]; if(j > i){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for(let size = 2; size <= N_FFT; size <<= 1){
    const half = size >> 1, step = N_FFT / size;
    for(let s = 0; s < N_FFT; s += size){
      for(let k = 0; k < half; k++){
        const c = COS[k * step], sn = SIN[k * step], a = s + k, b = a + half;
        const tr = re[b] * c - im[b] * sn, ti = re[b] * sn + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

// torchaudio MelSpectrogram(center=True, reflect, periodisches Hann, normalized="frame_length",
// power=1), dann log1p(1000·x). Ergebnis: Float32Array T×128 (zeilenweise je Frame).
export function logMel(signal){
  const bands = melBank(), pad = N_FFT / 2, n = signal.length;
  const at = i => signal[i < 0 ? -i : i >= n ? 2 * (n - 1) - i : i]; // reflect padding
  const T = 1 + Math.floor(n / HOP), out = new Float32Array(T * N_MELS);
  const win = new Float64Array(N_FFT), re = new Float64Array(N_FFT), im = new Float64Array(N_FFT), mag = new Float64Array(N_FREQS);
  for(let i = 0; i < N_FFT; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N_FFT);
  for(let t = 0; t < T; t++){
    const s = t * HOP - pad;
    for(let i = 0; i < N_FFT; i++){ re[i] = at(s + i) * win[i]; im[i] = 0; }
    fft(re, im);
    for(let k = 0; k < N_FREQS; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / 32; // ÷ √N_FFT
    for(let m = 0; m < N_MELS; m++){
      const b = bands[m];
      let v = 0;
      for(let k = 0; k < b.w.length; k++) v += b.w[k] * mag[b.first + k];
      out[t * N_MELS + m] = Math.log1p(1000 * v);
    }
  }
  return out;
}

// split_piece + aggregate_prediction(keep_first): 1500er-Stücke, die sich um 6 Frames überlappen.
export async function predict(ort, session, spect, onProgress){
  const T = spect.length / N_MELS;
  const starts = [];
  for(let s = -BORDER; s < T - BORDER; s += CHUNK - 2 * BORDER) starts.push(s);
  if(T > CHUNK - 2 * BORDER) starts[starts.length - 1] = T - (CHUNK - BORDER);
  const beat = new Float32Array(T).fill(-1000), down = new Float32Array(T).fill(-1000);
  const preds = [];
  for(let c = 0; c < starts.length; c++){
    const s = starts[c], from = Math.max(s, 0), to = Math.min(s + CHUNK, T);
    const left = Math.max(0, -s), right = Math.max(0, Math.min(BORDER, s + CHUNK - T)), len = left + (to - from) + right;
    const x = new Float32Array(len * N_MELS);
    x.set(spect.subarray(from * N_MELS, to * N_MELS), left * N_MELS);
    const r = await session.run({spect: new ort.Tensor('float32', x, [1, len, N_MELS])});
    preds.push({s, b: r.beat.data, d: r.downbeat.data, len});
    if(onProgress) onProgress((c + 1) / starts.length);
    await new Promise(r => setTimeout(r, 0)); // let the page repaint between chunks
  }
  for(let c = preds.length - 1; c >= 0; c--){ // keep_first: earlier chunks win in the overlap
    const p = preds[c];
    for(let i = BORDER; i < p.len - BORDER; i++){
      const t = p.s + i;
      if(t >= 0 && t < T && t < p.s + CHUNK - BORDER){ beat[t] = p.b[i]; down[t] = p.d[i]; }
    }
  }
  return {beat, down};
}

// Postprocessor "minimal": lokale Maxima (±3 Frames) über 0,5 Wahrscheinlichkeit, benachbarte
// zusammengefasst, Taktanfänge auf den nächsten Schlag gezogen.
function peaks(logits){
  const out = [], T = logits.length;
  for(let t = 0; t < T; t++){
    const v = logits[t];
    if(v <= 0) continue;
    let max = true;
    for(let k = Math.max(0, t - 3); k <= Math.min(T - 1, t + 3); k++) if(logits[k] > v){ max = false; break; }
    if(max) out.push(t);
  }
  const res = [];
  let p = null, c = 0;
  out.forEach(q => {
    if(p !== null && q - p <= 1){ c++; p += (q - p) / c; }
    else{ if(p !== null) res.push(p); p = q; c = 1; }
  });
  if(p !== null) res.push(p);
  return res.map(f => f / FPS);
}
export function beatsFromLogits(beat, down){
  const beats = peaks(beat);
  let downs = peaks(down);
  if(beats.length){
    downs = downs.map(d => beats.reduce((a, b) => Math.abs(b - d) < Math.abs(a - d) ? b : a));
    downs = Array.from(new Set(downs)).sort((a, b) => a - b);
  }
  return {beats, downbeats: downs};
}
