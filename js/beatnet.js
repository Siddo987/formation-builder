// #2155: the app's own beat AI (models/beatnet.onnx), trained on the Ballroom dataset (Gouyon et al.,
// beat and bar annotations by Krebs et al.) with the dance as a second input. It hears the same log-mel
// spectrogram as Beat This (js/beatthis.js) and gives each frame (50 per second) how likely a beat and
// a bar start is. Training code: /opt/docker/_data/rwkreator_train on the server (train.py).
import {SR, FPS, logMel} from './beatthis.js';
export {SR, FPS, logMel};

const N_MELS = 128;
// The model's dance input (prep.py DANCES); slowfox and paso doble weren't in its training music,
// so they go in as "unknown" (0) and only the tempo search below knows them.
const DANCE_IDS = {langsam: 1, wiener: 2, tango: 3, quick: 5, samba: 6, cha: 7, rumba: 8, jive: 10};
export function danceId(key){ return DANCE_IDS[key] || 0; }

// Beat and bar start activations (0…1) for the whole song, with the given dance id.
export async function activations(ort, session, spect, dance){
  const T = spect.length / N_MELS;
  const r = await session.run({
    spect: new ort.Tensor('float32', spect, [1, T, N_MELS]),
    dance: new ort.Tensor('int64', BigInt64Array.of(BigInt(dance)), [1])
  });
  const L = r.logits.data, beat = new Float32Array(T), down = new Float32Array(T);
  for(let t = 0; t < T; t++){ beat[t] = 1 / (1 + Math.exp(-L[2 * t])); down[t] = 1 / (1 + Math.exp(-L[2 * t + 1])); }
  return {beat, down};
}

// Local maxima over 0.4 within ±7 frames, in seconds: the beats where the tempo isn't known.
export function peaks(act){
  const out = [], n = act.length;
  for(let t = 0; t < n; t++){
    if(act[t] < 0.4) continue;
    let max = true;
    for(let k = Math.max(0, t - 7); k <= Math.min(n - 1, t + 7) && max; k++) if(act[k] > act[t]) max = false;
    if(max) out.push(t / FPS);
  }
  return out;
}

// Ellis-style dynamic programming: beats that sit on strong activations and keep a steady period,
// the period found by autocorrelation within loBpm…hiBpm. Seconds from the start of act.
export function dpBeats(act, loBpm, hiBpm){
  const n = act.length, TIGHT = 20;
  if(n < 10) return [];
  const lmin = Math.floor(60 * FPS / hiBpm), lmax = Math.min(Math.ceil(60 * FPS / loBpm), n - 1);
  let mean = 0, P = lmin, best = -Infinity;
  for(let i = 0; i < n; i++) mean += act[i] / n;
  for(let L = lmin; L <= lmax; L++){
    let s = 0;
    for(let i = 0; i + L < n; i++) s += (act[i] - mean) * (act[i + L] - mean);
    if(s / (n - L) > best){ best = s / (n - L); P = L; }
  }
  const score = Float64Array.from(act), back = new Int32Array(n).fill(-1);
  for(let t = 0; t < n; t++){
    let bk = -1, bv = 0;
    for(let p = Math.max(0, t - Math.floor(1.5 * P)); p < t - Math.floor(0.6 * P); p++){
      const l = Math.log((t - p) / P), v = score[p] - TIGHT * l * l;
      if(v > bv){ bv = v; bk = p; }
    }
    if(bk >= 0){ score[t] += bv; back[t] = bk; }
  }
  let t = 0;
  for(let i = Math.max(0, n - P); i < n; i++) if(score[i] > score[t] || t < n - P) t = i;
  const out = [];
  for(; t >= 0; t = back[t]) out.push(t / FPS);
  return out.reverse();
}

// Which of the first per beats is the 1: the place in the bar whose beats the bar start activation
// (its maximum within ±2 frames) favours on average. beats in seconds from the start of down.
export function barPhase(beats, down, per){
  if(!beats.length) return null;
  const sum = new Float64Array(per), cnt = new Float64Array(per);
  beats.forEach((b, i) => {
    const f = Math.round(b * FPS);
    let v = 0;
    for(let k = -2; k <= 2; k++) v = Math.max(v, down[Math.min(down.length - 1, Math.max(0, f + k))]);
    sum[i % per] += v; cnt[i % per]++;
  });
  let ph = 0;
  for(let p = 1; p < per; p++) if(cnt[p] && sum[p] / cnt[p] > sum[ph] / cnt[ph]) ph = p;
  return ph;
}
