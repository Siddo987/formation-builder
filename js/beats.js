"use strict";

/* ---------- Schläge im Lied (#2041) ----------
   "Schläge erkennen" in the Marker dialog runs Essentia's beat tracker (js/beats-worker.js) over the
   song, one Abschnitt at a time with the tempo range of its dance (read from the Abschnitt's name),
   and keeps the beats in state.beats. "Jetzt" and a Bild added at the pause point then land on the
   nearest beat; "Alle Marken auf Schläge rücken" does the same for the marks already set. Bars ("die
   1") are not detected. Everything runs in this browser; the song never leaves it. */

  var beatDetectBtn = document.getElementById('beatDetectBtn');
  var beatSnapAllBtn = document.getElementById('beatSnapAllBtn');
  var beatClearBtn = document.getElementById('beatClearBtn');
  var beatSnapToggle = document.getElementById('beatSnapToggle');
  var beatClickToggle = document.getElementById('beatClickToggle');
  var beatStatusEl = document.getElementById('beatStatus');
  var beatSummaryEl = document.getElementById('beatSummary');
  var beatCanvas = document.getElementById('markerTimelineBeats');
  var BEATS_WORKER_URL = document.currentScript.src.replace('beats.js', 'beats-worker.js'); // same ?v=
  var BEAT_SNAP_KEY = 'aufstellung-beat-snap', BEAT_CLICK_KEY = 'aufstellung-beat-click';
  var BEAT_SNAP_MAX = 0.3; // s — further from any beat (a pause in the music) a time stays as it is

  // Tournament tempi (WDSF) in beats per minute, beats per bar; matched by a word in the name.
  var BEAT_DANCES = [
    ['langsam', 'Langsamer Walzer', 84, 90, 3], ['wiener', 'Wiener Walzer', 174, 180, 3], ['tango', 'Tango', 124, 132, 4],
    ['slow', 'Slowfox', 112, 120, 4], ['quick', 'Quickstep', 200, 208, 4], ['samba', 'Samba', 100, 104, 2],
    ['cha', 'Cha-Cha-Cha', 120, 128, 4], ['rumba', 'Rumba', 100, 108, 4], ['paso', 'Paso Doble', 120, 124, 2], ['jive', 'Jive', 168, 176, 4]
  ].map(function(d){ return {word: d[0], name: d[1], lo: d[2], hi: d[3], per: d[4]}; });
  function danceOfName(name){
    var n = (name || '').toLowerCase();
    return BEAT_DANCES.filter(function(d){ return n.indexOf(d.word) !== -1; })[0] || null;
  }

  try{
    beatSnapToggle.checked = localStorage.getItem(BEAT_SNAP_KEY) !== '0';
    beatClickToggle.checked = localStorage.getItem(BEAT_CLICK_KEY) === '1';
  }catch(e){}
  [[beatSnapToggle, BEAT_SNAP_KEY], [beatClickToggle, BEAT_CLICK_KEY]].forEach(function(t){
    t[0].addEventListener('change', function(){ try{ localStorage.setItem(t[1], t[0].checked ? '1' : '0'); }catch(e){} });
  });

  // The beat nearest to t (s) within maxDist, or null.
  function nearestBeat(t, maxDist){
    var b = state.beats;
    if(!b || !b.length) return null;
    var lo = 0, hi = b.length - 1;
    while(lo < hi){ var mid = (lo + hi) >> 1; if(b[mid] < t) lo = mid + 1; else hi = mid; }
    var best = (lo > 0 && Math.abs(b[lo - 1] - t) < Math.abs(b[lo] - t)) ? b[lo - 1] : b[lo];
    return Math.abs(best - t) <= maxDist ? best : null;
  }
  // A time set from the play position ("Jetzt", a Bild added while paused) on the nearest beat.
  function beatSnap(t){
    if(!beatSnapToggle.checked) return t;
    var b = nearestBeat(t, BEAT_SNAP_MAX);
    return b === null ? t : b;
  }

  // The song cut where playback reaches each Abschnitt start (marked or spread out): [{start, end, name}].
  function beatSections(dur){
    var cuts = [], times = syncTimes(dur); // js/stage.js
    state.formations.forEach(function(f, idx){
      var t = times[idx];
      if(f.category && typeof t === 'number' && t < dur - 1) cuts.push({t: Math.max(0, t), name: f.category});
    });
    cuts.sort(function(a, b){ return a.t - b.t; });
    var secs = [], start = 0, name = '';
    cuts.forEach(function(c){
      if(c.t - start >= 1){ secs.push({start: start, end: c.t, name: name}); start = c.t; }
      name = c.name;
    });
    secs.push({start: start, end: dur, name: name});
    return secs;
  }

  function songMono(blob){
    return blob.arrayBuffer().then(function(buf){
      return new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf);
    }).then(function(audio){
      var off = new OfflineAudioContext(1, Math.ceil(audio.duration * 44100), 44100);
      var src = off.createBufferSource();
      src.buffer = audio; src.connect(off.destination); src.start();
      return off.startRendering();
    }).then(function(r){ return r.getChannelData(0); });
  }

  var beatJob = null;
  function detectBeats(){
    if(beatJob || !state.song || !state.song.blob) return;
    var song = state.song, worker = null;
    beatJob = {};
    beatDetectBtn.disabled = true;
    beatStatusEl.textContent = 'Lied wird vorbereitet …';
    songMono(song.blob).then(function(mono){
      var secs = beatSections(mono.length / 44100), all = [];
      worker = new Worker(BEATS_WORKER_URL);
      return secs.reduce(function(chain, sec, i){
        return chain.then(function(){
          beatStatusEl.textContent = 'Erkenne Schläge … Abschnitt ' + (i + 1) + ' von ' + secs.length;
          var d = danceOfName(sec.name), samples = mono.slice(Math.floor(sec.start * 44100), Math.floor(sec.end * 44100));
          return new Promise(function(resolve, reject){
            worker.onmessage = function(e){ if(e.data.error) reject(new Error(e.data.error)); else resolve(e.data); };
            worker.onerror = function(e){ reject(new Error(e.message || 'Worker')); };
            worker.postMessage({id: i, samples: samples, minTempo: d ? Math.round(d.lo * 0.9) : 40, maxTempo: d ? Math.round(d.hi * 1.1) : 208}, [samples.buffer]);
          }).then(function(r){ r.ticks.forEach(function(t){ all.push(t + sec.start); }); });
        });
      }, Promise.resolve()).then(function(){
        if(state.song !== song) return; // song swapped meanwhile — these beats belong to the old one
        all.sort(function(a, b){ return a - b; });
        state.beats = sanitizeBeats(all.filter(function(t, i){ return !i || t - all[i - 1] > 0.08; }));
        saveState();
        beatStatusEl.textContent = (state.beats ? state.beats.length : 0) + ' Schläge erkannt.';
      });
    }).catch(function(err){
      console.error('Schläge erkennen fehlgeschlagen', err);
      beatStatusEl.textContent = 'Erkennen hat nicht geklappt: ' + (err && err.message || err);
    }).then(function(){
      if(worker) worker.terminate();
      beatJob = null;
      beatDetectBtn.disabled = false;
      renderBeats();
    });
  }

  // Summary per Abschnitt (median beat distance, folded onto the dance's tempo), buttons, ticks.
  function renderBeats(){
    var beats = state.beats, dur = songAudioEl.duration;
    beatSnapAllBtn.hidden = beatClearBtn.hidden = !beats;
    beatDetectBtn.textContent = beats ? 'Neu erkennen' : 'Schläge erkennen';
    beatSummaryEl.innerHTML = '';
    if(beats && isFinite(dur) && dur > 0) beatSections(dur).forEach(function(sec){
      var gaps = [];
      beats.forEach(function(t, i){ if(i && t >= sec.start && t < sec.end && beats[i - 1] >= sec.start) gaps.push(t - beats[i - 1]); });
      if(gaps.length < 4) return;
      gaps.sort(function(a, b){ return a - b; });
      var bpm = 60 / gaps[gaps.length >> 1], d = danceOfName(sec.name), row = document.createElement('div');
      row.className = 'beat-summary-row';
      var text = (sec.name || 'Anfang') + ' (' + formatTime(sec.start) + '): ';
      if(d){
        // Half/double tempo (and ⅔ / ³⁄₂ around the waltzes) is the usual miss — fold onto the dance.
        var c = (d.lo + d.hi) / 2, f = [0.5, 2/3, 1, 1.5, 2].map(function(k){ return bpm * k; })
          .reduce(function(a, b){ return Math.abs(b - c) < Math.abs(a - c) ? b : a; });
        var bars = f / d.per, off = bars < d.lo / d.per - 1 || bars > d.hi / d.per + 1;
        text += bars.toFixed(1).replace('.', ',') + ' Takte/min' + (off ? ' — außerhalb von ' + d.lo / d.per + '–' + d.hi / d.per + ', bitte anhören' : '');
        row.classList.toggle('beat-summary-row--warn', off);
      }else{
        text += Math.round(bpm) + ' Schläge/min';
      }
      row.textContent = text;
      beatSummaryEl.appendChild(row);
    });
    drawBeatTicks();
  }

  function drawBeatTicks(){
    var w = beatCanvas.clientWidth, h = beatCanvas.clientHeight, dpr = window.devicePixelRatio || 1;
    beatCanvas.width = Math.round(w * dpr); beatCanvas.height = Math.round(h * dpr);
    var g = beatCanvas.getContext('2d'), dur = songAudioEl.duration;
    g.clearRect(0, 0, beatCanvas.width, beatCanvas.height);
    if(!state.beats || !isFinite(dur) || dur <= 0) return;
    g.fillStyle = getComputedStyle(beatCanvas).color;
    state.beats.forEach(function(t){ g.fillRect(Math.round(t / dur * beatCanvas.width), 0, Math.max(1, dpr), beatCanvas.height); });
  }

  // Moves every Bild mark onto its nearest beat (marks in a pause of the music stay).
  function snapAllMarks(){
    var moved = 0;
    state.formations.forEach(function(f){
      var t = formationTime(f), b = t === null ? null : nearestBeat(t, BEAT_SNAP_MAX);
      if(b !== null && Math.abs(b - t) > 0.006){ f.time = snapTime(b); moved++; } // snapTime() keeps 0.01 s
    });
    if(moved){ saveState(); renderMarkerList(); renderMarkerTimeline(); }
    beatStatusEl.textContent = moved ? moved + (moved === 1 ? ' Marke' : ' Marken') + ' auf den Schlag gerückt.' : 'Alle Marken liegen schon auf Schlägen.';
  }

  /* While the Marker dialog plays the song, a short click on every beat — to hear whether they sit. */
  var clickCtx = null, clickTimer = null, clickedUntil = 0;
  function clickTick(){
    var now = songAudioEl.currentTime, until = now + 0.12, rate = songAudioEl.playbackRate || 1;
    if(!state.beats) return;
    state.beats.forEach(function(t){
      if(t <= clickedUntil || t < now || t > until) return;
      var at = clickCtx.currentTime + (t - now) / rate, o = clickCtx.createOscillator(), g = clickCtx.createGain();
      o.frequency.value = 1500;
      g.gain.setValueAtTime(0.4, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
      o.connect(g); g.connect(clickCtx.destination); o.start(at); o.stop(at + 0.05);
    });
    clickedUntil = until;
  }
  songAudioEl.addEventListener('play', function(){
    if(!beatClickToggle.checked || markerBackdrop.hidden || !state.beats) return;
    clickCtx = clickCtx || new (window.AudioContext || window.webkitAudioContext)();
    clickCtx.resume();
    clickedUntil = songAudioEl.currentTime - 0.01;
    clearInterval(clickTimer);
    clickTimer = setInterval(clickTick, 40);
  });
  songAudioEl.addEventListener('seeking', function(){ clickedUntil = songAudioEl.currentTime - 0.01; });
  ['pause', 'ended'].forEach(function(t){ songAudioEl.addEventListener(t, function(){ clearInterval(clickTimer); clickTimer = null; }); });

  beatDetectBtn.addEventListener('click', detectBeats);
  beatSnapAllBtn.addEventListener('click', snapAllMarks);
  beatClearBtn.addEventListener('click', function(){
    confirmDelete('Erkannte Schläge entfernen?', function(){
      state.beats = null;
      saveState();
      beatStatusEl.textContent = '';
      renderBeats();
    }, beatClearBtn, 'Entfernen');
  });
  window.addEventListener('resize', function(){ if(!markerBackdrop.hidden) drawBeatTicks(); });
