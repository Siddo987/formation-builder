"use strict";

/* ---------- Musik & Takte (#2041, #2096, #2081) ----------
   The beats are the source (state.beats; js/state.js has the shape of state.music): Essentia finds
   them per section of the song in its dance's tempo (js/beats-worker.js), the user corrects them.
   Each section has its dance and beats per bar; the user marks a 1 once, and from it every per-th
   beat starts a bar — back to the section's start and on to the next 1 or the section's end.
   "Klicks", "Jetzt", "Alle Marken auf Schläge rücken", the bar in the playbar and the Phrasierung on
   the Schritte sheets use them. The full-screen view "Musik & Takte" (opened from the Marker dialog)
   leads through it step by step. Everything runs in this browser; the song never leaves it. */

  var beatSnapAllBtn = document.getElementById('beatSnapAllBtn');
  var beatSnapToggle = document.getElementById('beatSnapToggle');
  var beatClickBtn = document.getElementById('beatClickBtn');
  var beatStatusEl = document.getElementById('beatStatus');
  var beatCanvas = document.getElementById('markerTimelineBeats');
  var musikStatusEl = document.getElementById('musikStatus');
  var BEATS_WORKER_URL = document.currentScript.src.replace('beats.js', 'beats-worker.js'); // same ?v=
  var BEAT_SNAP_KEY = 'aufstellung-beat-snap', BEAT_CLICK_KEY = 'aufstellung-beat-click';
  var BEAT_SNAP_MAX = 0.3; // s — further from any beat (a pause in the music) a time stays as it is
  var BAR_SLACK = 0.05; // s — a bar this close before a Bild's mark already counts to the next Bild

  var beatClickOn = false; // "Klicks" (#2146) in the Marker dialog and the view, kept under BEAT_CLICK_KEY
  try{
    beatSnapToggle.checked = localStorage.getItem(BEAT_SNAP_KEY) !== '0';
    beatClickOn = localStorage.getItem(BEAT_CLICK_KEY) === '1';
  }catch(e){}
  beatSnapToggle.addEventListener('change', function(){ try{ localStorage.setItem(BEAT_SNAP_KEY, beatSnapToggle.checked ? '1' : '0'); }catch(e){} });

  function roundMs(t){ return Math.round(t * 1000) / 1000; }
  function byNum(a, b){ return a - b; }
  function median(a){ a = a.slice().sort(byNum); return a.length ? a[a.length >> 1] : 0; }
  function inRange(t, a, b){ return t >= a && t < b; }
  // The index of the first value in sorted arr not below t.
  function lowerBound(arr, t){
    var lo = 0, hi = arr.length;
    while(lo < hi){ var mid = (lo + hi) >> 1; if(arr[mid] < t) lo = mid + 1; else hi = mid; }
    return lo;
  }
  // The value in a sorted array nearest to t, or null.
  function nearestIn(arr, t){
    if(!arr || !arr.length) return null;
    var i = Math.min(lowerBound(arr, t), arr.length - 1);
    return i > 0 && Math.abs(arr[i - 1] - t) <= Math.abs(arr[i] - t) ? arr[i - 1] : arr[i];
  }

  /* ---------- the sections and their bars ---------- */

  // What follows from state.beats and state.music, worked out again when one of them or the song's
  // length changes: {secs, bars, starts}. secs: [{k, start, end, key, dance, per, beats, ones, bars}];
  // bars: every bar in song order, {t (its 1), n (counted from 1 in its section), end, i (its beat's
  // index in sec.beats), p (Phrasierung), sec}; starts: the times of the bars' 1s.
  var musicMemo = {};
  function music(){
    var dur = songDur(), c = musicMemo;
    if(c.beats === state.beats && c.music === state.music && c.dur === dur) return c;
    var m = state.music, phrases = m ? m.phrases : {};
    var list = (m ? m.sections : [{t: 0}]).filter(function(s, k){ return !k || !dur || s.t < dur - 0.5; });
    var all = beatsWithCuts(state.beats || [], list); // js/state.js: each cut is a beat
    c = musicMemo = {beats: state.beats, music: state.music, dur: dur, all: all, bars: [], starts: new Set()};
    c.secs = list.map(function(s, k){
      var start = k ? s.t : 0, end = k + 1 < list.length ? list[k + 1].t : (dur || Infinity), d = danceByKey(s.dance);
      var sec = {k: k, start: start, end: end, key: s.dance || '', dance: d, per: s.per || (d ? d.per : 4), beats: all.slice(lowerBound(all, start), lowerBound(all, end))};
      var b = sec.beats, per = sec.per, at = [];
      sec.ones = (m ? m.ones : []).filter(function(t){ return inRange(t, start, end); });
      var idx = sec.ones.map(function(t){ return b.indexOf(t); }).filter(function(i){ return i >= 0; });
      if(idx.length) for(var i = idx[0] - per; i >= 0; i -= per) at.unshift(i);
      idx.forEach(function(o, j){ for(var i = o; i < (j + 1 < idx.length ? idx[j + 1] : b.length); i += per) at.push(i); });
      // The last bar ends a beat after the section's last beat (or at its end, if that comes first).
      var tail = b.length > 1 ? Math.min(end, b[b.length - 1] + (b[b.length - 1] - b[0]) / (b.length - 1)) : end;
      sec.bars = at.map(function(i, n){
        return {t: b[i], n: n + 1, i: i, p: phrases[b[i]] || '', sec: sec, end: n + 1 < at.length ? b[at[n + 1]] : i + per < b.length ? b[i + per] : tail};
      });
      sec.bars.forEach(function(bar){ c.bars.push(bar); c.starts.add(bar.t); });
      return sec;
    });
    return c;
  }
  // Every beat, the cuts included — what is drawn, clicked and counted.
  function allBeats(){ return music().all; }
  function isCut(t){ return music().secs.some(function(s){ return s.k && s.start === t; }); }
  function secAt(t){
    var secs = music().secs;
    for(var k = secs.length - 1; k > 0; k--) if(t >= secs[k].start) return secs[k];
    return secs[0];
  }
  // The bar playing at song time t, or null (before a section's first bar, in one without a 1).
  function barAt(t){
    var bars = music().bars, lo = 0, hi = bars.length;
    while(lo < hi){ var mid = (lo + hi) >> 1; if(bars[mid].t <= t + 0.02) lo = mid + 1; else hi = mid; }
    var b = bars[lo - 1];
    return b && t < b.end ? b : null;
  }
  function barOf(t){ return music().bars.filter(function(b){ return b.t === t; })[0] || null; }
  function danceLabel(sec){ return sec.dance ? sec.dance.name : sec.key === DANCE_OTHER ? 'anderer Tanz' : ''; }
  function secTitle(sec){ var d = danceLabel(sec); return 'Abschnitt ' + (sec.k + 1) + (d ? ' (' + d + ')' : ''); }
  function secTitles(list){ return list.map(secTitle).join(', '); }
  // A section's tempo from its beats: {text, off}; off: outside its dance's tempo — detection heard
  // half or double time, or the dance is another one. null with fewer than 5 beats.
  function sectionTempo(sec){
    var g = sec.beats;
    if(g.length < 5) return null;
    var bpm = 60 / median(g.slice(1).map(function(t, i){ return t - g[i]; })), d = sec.dance;
    var off = !!d && (bpm < d.lo * 0.94 || bpm > d.hi * 1.06);
    return {off: off, text: (bpm / sec.per).toFixed(1).replace('.', ',') + ' Takte/min' + (off ? ', erwartet ' + Math.round(d.lo / sec.per) + '–' + Math.round(d.hi / sec.per) : '')};
  }

  /* ---------- changes ---------- */

  // A copy of m (state.music by default) to change.
  function musicCopy(m){
    if(m === undefined) m = state.music;
    return {sections: m ? m.sections.map(function(s){ return Object.assign({}, s); }) : [{t: 0}], ones: m ? m.ones.slice() : [], phrases: m ? Object.assign({}, m.phrases) : {}};
  }
  // Every change ends here. live: true during a drag (saved when it ends), 'soon' while typing.
  function setMusic(beats, m, live){
    var mu = sanitizeMusic({beats: beats, music: m}); // 1s and Phrasierung only where a beat is
    state.beats = mu.beats;
    state.music = mu.music;
    if(live === 'soon') saveStateDebounced(); else if(!live) saveState();
    renderBeats();
  }
  // m with the 1 and Phrasierung at time a moved to b (dropped for b null).
  function carryMarks(m, a, b){
    if(m.ones.indexOf(a) !== -1){ m.ones = m.ones.filter(function(t){ return t !== a; }); if(b !== null) m.ones.push(b); }
    if(m.phrases[a]){ if(b !== null && !m.phrases[b]) m.phrases[b] = m.phrases[a]; delete m.phrases[a]; }
    return m;
  }
  // m without the 1s and Phrasierung from a to b (their beats are about to go).
  function musicWithout(m, a, b){
    m.ones = m.ones.filter(function(t){ return !inRange(t, a, b); });
    Object.keys(m.phrases).forEach(function(key){ if(inRange(+key, a, b)) delete m.phrases[key]; });
    return m;
  }
  // Section k's beats, 1s and Phrasierung d s later (earlier for d < 0), from base ({beats, music}
  // as before a drag): {beats, music, d}. d stops short of the neighbours' beats; a cut the beats
  // cross gives way. null without beats.
  function shiftedSection(base, k, d){
    var beats = base.beats || [], m = musicCopy(base.music), secs = m.sections;
    var start = k ? secs[k].t : 0, end = k + 1 < secs.length ? secs[k + 1].t : Infinity, i0 = lowerBound(beats, start), i1 = lowerBound(beats, end);
    if(i0 === i1) return null;
    var first = k ? start : beats[i0]; // a cut is its section's first beat (beatsWithCuts)
    var lo = Math.min(0, (i0 ? beats[i0 - 1] + 0.05 : 0) - first), hi = Math.max(0, Math.min(i1 < beats.length ? beats[i1] : Infinity, end) - 0.05 - beats[i1 - 1]);
    d = Math.min(hi, Math.max(lo, d));
    function mv(t){ return inRange(t, start, end) ? roundMs(t + d) : t; }
    var out = beats.map(mv), ph = {};
    if(k) secs[k].t = roundMs(start + d);
    if(k && secs[k].t < secs[k - 1].t + 0.5) return null; // would swallow the section before
    m.ones = m.ones.map(mv);
    Object.keys(m.phrases).forEach(function(key){ ph[mv(+key)] = m.phrases[key]; });
    m.phrases = ph;
    return {beats: out, music: m, d: d};
  }

  /* ---------- detection (Essentia, js/beats-worker.js) ---------- */

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
  // Finds the beats of the given sections (from music().secs), one after the other, each in its
  // dance's tempo. Each section's beats replace only its own (its 1s and Phrasierung go with them),
  // and each is saved as soon as it is done.
  var detectJob = null;
  function detectSections(list){
    if(detectJob || !state.song || !state.song.blob || !list.length) return;
    var song = state.song, worker = null, found = 0, todo = list.map(function(s){ return {k: s.k, start: s.start, end: s.end, dance: s.dance}; });
    detectJob = {i: 0, n: todo.length, k: todo[0].k};
    mtSay('');
    renderMusikView();
    songMono(song.blob).then(function(mono){
      var dur = mono.length / 44100;
      worker = new Worker(BEATS_WORKER_URL);
      return todo.reduce(function(chain, r, i){
        return chain.then(function(){
          if(state.song !== song) return; // song swapped meanwhile
          detectJob.i = i; detectJob.k = r.k;
          renderMusikView();
          var from = r.k ? Math.max(0, r.start - 1) : 0; // a beat before the cut, to hear the beat it should sit on
          var d = r.dance, samples = mono.slice(Math.floor(from * 44100), Math.floor(Math.min(r.end, dur) * 44100));
          return new Promise(function(resolve, reject){
            worker.onmessage = function(e){ if(e.data.error) reject(new Error(e.data.error)); else resolve(e.data); };
            worker.onerror = function(e){ reject(new Error(e.message || 'Worker')); };
            worker.postMessage({id: i, samples: samples, minTempo: d ? Math.round(d.lo * 0.9) : 40, maxTempo: d ? Math.round(d.hi * 1.1) : 208}, [samples.buffer]);
          }).then(function(res){
            if(state.song !== song) return;
            var ticks = res.ticks.map(function(t){ return roundMs(t + from); }), m = musicWithout(musicCopy(), r.start, r.end), start = r.start;
            var near = r.k ? nearestIn(ticks, r.start) : null, half = ticks.length > 1 ? (ticks[ticks.length - 1] - ticks[0]) / (ticks.length - 1) / 2 : 0;
            if(near !== null && Math.abs(near - r.start) < Math.max(CUT_BEAT_GAP, half) && m.sections[r.k]){ start = near; m.sections[r.k].t = near; } // the cut onto the beat heard there, as it is the section's first
            ticks = ticks.filter(function(t){ return inRange(t, start, r.end); });
            var beats = (state.beats || []).filter(function(t){ return !inRange(t, Math.min(start, r.start), r.end); }).concat(ticks).sort(byNum);
            found += ticks.length;
            setMusic(beats.filter(function(t, x){ return !x || t - beats[x - 1] > 0.08; }), m);
          });
        });
      }, Promise.resolve());
    }).then(function(){
      var off = music().secs.filter(function(s){ return (sectionTempo(s) || {}).off; });
      mtSay(found + ' Schläge gefunden. ' + (off.length ? 'Achtung: In ' + secTitles(off) + ' passt das Tempo nicht zum Tanz – Tanz prüfen, dann dort „Neu erkennen“.' : 'Weiter mit Schritt 3.'));
    }).catch(function(err){
      console.error('Schläge erkennen fehlgeschlagen', err);
      mtSay('Erkennen hat nicht geklappt: ' + (err && err.message || err));
    }).then(function(){
      if(worker) worker.terminate();
      detectJob = null;
      renderBeats();
    });
  }

  /* ---------- in the Marker dialog: status, ticks, Klicks, "Jetzt" ---------- */

  function musicStatusLine(){
    if(!songDur()) return '';
    var mm = music(), open = mm.secs.filter(function(s){ return !s.bars.length; });
    if(!state.beats) return 'Noch keine Schläge: dort Grenzen setzen, Schläge erkennen und die 1 festlegen.';
    if(open.length) return state.beats.length + ' Schläge, ' + mm.bars.length + ' Takte – die 1 fehlt noch in ' + secTitles(open) + '.';
    return mm.secs.length + (mm.secs.length === 1 ? ' Abschnitt' : ' Abschnitte') + ', ' + mm.bars.length + ' Takte ✓';
  }
  function renderBeats(){
    var has = !!state.beats;
    beatSnapAllBtn.hidden = !has;
    [beatClickBtn, mtClickBtn].forEach(function(btn){
      btn.disabled = !has;
      btn.setAttribute('aria-pressed', beatClickOn ? 'true' : 'false');
      btn.title = has ? 'Beim Abspielen jeden Schlag mitklicken, die 1 höher' : 'Erst Schläge erkennen (Musik & Takte)';
    });
    syncBeatClicks(); // beats set or removed while the song plays
    updatePlaybarBar();
    musikStatusEl.textContent = musicStatusLine();
    drawBeatTicks();
    renderMusikView();
  }
  // Beats as thin ticks over the Marker dialog's waveform, bar starts as thick ones.
  function drawBeatTicks(){
    var w = beatCanvas.clientWidth, h = beatCanvas.clientHeight, dpr = window.devicePixelRatio || 1;
    beatCanvas.width = Math.round(w * dpr); beatCanvas.height = Math.round(h * dpr);
    var g = beatCanvas.getContext('2d'), v = markerView(), W = beatCanvas.width, H = beatCanvas.height; // markerView(): js/marker.js — the zoomed part (#2091)
    g.clearRect(0, 0, W, H);
    if(v.t1 <= v.t0 || !state.beats) return;
    function x(t){ return Math.round((t - v.t0) / (v.t1 - v.t0) * W); }
    var cs = getComputedStyle(beatCanvas), starts = music().starts, pair = cs.getPropertyValue('--pair').trim() || cs.color;
    allBeats().forEach(function(t){
      if(t < v.t0 || t > v.t1) return;
      var bar = starts.has(t);
      g.fillStyle = bar ? pair : cs.color;
      g.globalAlpha = bar ? 1 : 0.45;
      if(bar) g.fillRect(x(t) - Math.round(dpr), 0, Math.round(2 * dpr), H); else g.fillRect(x(t), 0, Math.max(1, dpr), H);
    });
    g.globalAlpha = 1;
  }
  // A time set from the play position ("Jetzt", a Bild added while paused) on the nearest beat.
  function nearestBeat(t, maxDist){
    var b = nearestIn(allBeats(), t);
    return b !== null && Math.abs(b - t) <= maxDist ? b : null;
  }
  function beatSnap(t){
    if(!beatSnapToggle.checked) return t;
    var b = nearestBeat(t, BEAT_SNAP_MAX);
    return b === null ? t : b;
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
  beatSnapAllBtn.addEventListener('click', snapAllMarks);

  /* While the Marker dialog or the view plays the song, a short click on every beat — the 1 higher. */
  var clickCtx = null, clickTimer = null, clickedUntil = 0;
  function clickTick(){
    var now = songAudioEl.currentTime, until = now + 0.12, rate = songAudioEl.playbackRate || 1, starts = music().starts;
    allBeats().forEach(function(t){
      if(t <= clickedUntil || t < now || t > until) return;
      var at = clickCtx.currentTime + (t - now) / rate, o = clickCtx.createOscillator(), g = clickCtx.createGain();
      o.frequency.value = starts.has(t) ? 2500 : 1500;
      g.gain.setValueAtTime(0.4, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
      o.connect(g); g.connect(clickCtx.destination); o.start(at); o.stop(at + 0.05);
    });
    clickedUntil = until;
  }
  // Starts or stops the clicks to match the toggle, the beats and playback — also mid-song.
  function syncBeatClicks(){
    var run = beatClickOn && !!state.beats && (!markerBackdrop.hidden || !mtBackdrop.hidden) && !songAudioEl.paused;
    if(run === !!clickTimer) return;
    clearInterval(clickTimer);
    clickTimer = null;
    if(!run) return;
    clickCtx = clickCtx || new (window.AudioContext || window.webkitAudioContext)();
    clickCtx.resume();
    clickedUntil = songAudioEl.currentTime - 0.01;
    clickTimer = setInterval(clickTick, 40);
    clickTick(); // a beat right at the start is not past yet when the first interval fires
  }
  ['play', 'pause', 'ended'].forEach(function(t){ songAudioEl.addEventListener(t, syncBeatClicks); });
  songAudioEl.addEventListener('seeking', function(){ clickedUntil = songAudioEl.currentTime - 0.01; });
  function toggleClicks(){
    beatClickOn = !beatClickOn;
    try{ localStorage.setItem(BEAT_CLICK_KEY, beatClickOn ? '1' : '0'); }catch(e){}
    renderBeats();
  }
  beatClickBtn.addEventListener('click', toggleClicks);

  /* ---------- the bar in the playbar, the Phrasierung on the Schritte sheets ---------- */

  /* The bar being heard in the main playbar: its number in the section and its Phrasierung — while
     anything plays the song, paused, and at the selected Bild. playback.js calls this with every
     timeline update; while the song plays a frame loop keeps it current ("Nur Musik" too). */
  var playbarBarEl = document.getElementById('playbarBar'), playbarBarShown = null;
  function updatePlaybarBar(){
    var b = null;
    if(state.music && songDur()) b = barAt(!songAudioEl.paused ? heardSongTime() : pausedAt ? pausedAt.songTime : playbackStartTime()); // js/playback.js
    var label = b ? 'Takt ' + b.n : '', phrase = b ? b.p : '';
    if(playbarBarShown === label + '|' + phrase) return;
    playbarBarShown = label + '|' + phrase;
    playbarBarEl.hidden = !label;
    playbarBarEl.textContent = label + (phrase ? ' ' : '');
    playbarBarEl.title = label + (phrase ? ': ' + phrase : '');
    if(!phrase) return;
    var p = document.createElement('b');
    p.textContent = phrase;
    playbarBarEl.appendChild(p);
  }
  function barPlayFrame(){
    updatePlaybarBar();
    if(!songAudioEl.paused) requestAnimationFrame(barPlayFrame);
  }
  songAudioEl.addEventListener('play', function(){ requestAnimationFrame(barPlayFrame); });
  ['pause', 'seeked', 'durationchange'].forEach(function(t){ songAudioEl.addEventListener(t, barPlayFrame); });

  // For the Schritte sheets (js/steps.js): the bars from song time t0 to t1 with their Phrasierung,
  // runs of the same one folded ("Takt 5–12: 4× QQS+ · SQQ · 3× QQS+"); '' without any Phrasierung.
  function barPhrasingLine(t0, t1){
    if(!state.music || !songDur() || t0 === null || t1 === null || !(t1 > t0)) return '';
    var bars = music().bars.filter(function(b){ return b.t + BAR_SLACK >= t0 && b.t + BAR_SLACK < t1; });
    if(!bars.some(function(b){ return b.p; })) return '';
    var runs = [];
    bars.forEach(function(b){
      var p = b.p || '–', last = runs[runs.length - 1];
      if(last && last.p === p) last.n++; else runs.push({p: p, n: 1});
    });
    var first = bars[0].n, lastN = bars[bars.length - 1].n;
    return (bars.length === 1 ? 'Takt ' + first : 'Takt ' + first + '–' + lastN) + ': '
      + runs.map(function(r){ return (r.n > 1 ? r.n + '× ' : '') + r.p; }).join(' · ');
  }

  /* ---------- the view "Musik & Takte" ----------
     Five steps, each a button on top (any can be chosen any time): 1 Grenzen, 2 Schläge, 3 Takt & 1,
     4 Korrigieren, 5 Phrasierung. Above the song a box says what to do now and which step comes
     next. The overview shows the whole song (a press goes there), the Lupe a few seconds around what
     is heard, scrolling along while it plays. In the Lupe a tap goes there; a tap on a beat (step 1: a
     cut, step 5: a bar) also selects it, and the step's buttons below act on that. Setting a beat
     happens where the play position is ("Schlag hier setzen"), so a tap never has two meanings.
     Dragging scrubs, except a cut (step 1) or the selected beat (step 4: the whole section moves). */
  var mtBackdrop = document.getElementById('mtBackdrop');
  var mtStepBtns = Array.prototype.slice.call(mtBackdrop.querySelectorAll('.mt-step'));
  var mtPanels = Array.prototype.slice.call(mtBackdrop.querySelectorAll('.mt-panel'));
  var mtGuideEl = document.getElementById('mtGuide'), mtNoteEl = document.getElementById('mtNote'), mtNextBtn = document.getElementById('mtNextBtn');
  var mtOverview = document.getElementById('mtOverview'), mtLupe = document.getElementById('mtLupe');
  var mtPlayBtn = document.getElementById('mtPlayBtn'), mtIconPlay = document.getElementById('mtIconPlay'), mtIconPause = document.getElementById('mtIconPause');
  var mtTimeEl = document.getElementById('mtTime'), mtClickBtn = document.getElementById('mtClickBtn');
  var mtCutBtn = document.getElementById('mtCutBtn'), mtCutInfo = document.getElementById('mtCutInfo'), mtCutDelBtn = document.getElementById('mtCutDelBtn');
  var mtDetectBtn = document.getElementById('mtDetectBtn'), mtProgress = document.getElementById('mtProgress');
  var mtOneBtn = document.getElementById('mtOneBtn'), mtOneInfo = document.getElementById('mtOneInfo');
  var mtShiftInfo = document.getElementById('mtShiftInfo'), mtShiftBtns = Array.prototype.slice.call(mtBackdrop.querySelectorAll('[data-shift]'));
  var mtBeatInfo = document.getElementById('mtBeatInfo'), mtBeatAddBtn = document.getElementById('mtBeatAddBtn');
  var mtBeatDelBtn = document.getElementById('mtBeatDelBtn'), mtBeatOneBtn = document.getElementById('mtBeatOneBtn');
  var mtPhraseLabel = document.getElementById('mtPhraseLabel'), mtPhrase = document.getElementById('mtPhrase'), mtFillBtn = document.getElementById('mtFillBtn');
  var mtKeysEl = document.getElementById('mtKeys'), mtSecsEl = document.getElementById('mtSecs');
  var STEP_NEXT = ['', 'Weiter zu 2: Schläge erkennen', 'Weiter zu 3: Takt & 1', 'Weiter zu 4: Korrigieren', 'Weiter zu 5: Phrasierung', '']; // step 5: "Fertig" below
  var STEP_KEYS = ['', 'Leertaste spielt und hält an · G setzt eine Grenze · Grenze in der Lupe ziehen verschiebt sie · Rechtsklick oder Entf entfernt sie',
    'Leertaste spielt und hält an · ← → springen von Schlag zu Schlag',
    'Leertaste spielt und hält an · Taste 1 beim Hören der 1 · ← → wählen einen Schlag',
    'Leertaste · ← → wählen einen Schlag · Entf löscht ihn · 1 macht ihn zur 1 · S setzt einen an der Abspielposition · Umschalt + ← → rückt den Abschnitt um 10 ms',
    'Leertaste · ← → wählen einen Takt · Enter oder Tab: nächster Takt · Strg + Enter: auch für die leeren danach'];
  var SEC_COLORS = [['--accent', '--accent-wash'], ['--pair', '--pair-wash'], ['--split', '--split-wash']];
  var mtStep = 1, mtSel = null, mtCut = -1, mtBar = null, mtNote = '', mtSeen = {}, mtRaf = 0;

  function mtSay(text){ mtNote = text; mtNoteEl.textContent = text; }
  function seek(t){
    var dur = songDur();
    if(!dur) return;
    songAudioEl.currentTime = Math.max(0, Math.min(dur - 0.05, t));
    mtSeen.drawn = null;
  }
  // Where an action from the play position lands: paused, the play position; playing, what is heard
  // (minus the Bluetooth delay, js/playback.js, and the moment the press waited in the queue).
  function timeNow(eventTime){
    if(songAudioEl.paused) return songAudioEl.currentTime;
    var lag = eventTime ? Math.min(0.1, Math.max(0, (performance.now() - eventTime) / 1000)) * (songAudioEl.playbackRate || 1) : 0;
    return Math.max(0, heardSongTime() - lag);
  }
  // The beat an action on "the 1" means: paused, the selected one, else the one at the play position;
  // playing, the one heard.
  function beatNow(eventTime){ return songAudioEl.paused && mtSel !== null ? mtSel : nearestIn(allBeats(), timeNow(eventTime)); }
  function stepsDone(mm){
    return {1: mm.secs.every(function(s){ return s.key; }), 2: mm.secs.every(function(s){ return s.beats.length; }),
      3: mm.secs.every(function(s){ return s.bars.length; }), 4: false, 5: mm.bars.length > 0 && mm.bars.every(function(b){ return b.p; })};
  }

  function guideText(mm){
    var secs = mm.secs, noDance = secs.filter(function(s){ return !s.key; }), noOne = secs.filter(function(s){ return s.beats.length && !s.bars.length; });
    if(mtStep === 1) return 'Wo wechselt der Tanz? Lied abspielen und an jedem Wechsel „Grenze hier“ drücken. Dann unten in der Liste je Abschnitt den Tanz wählen.'
      + (secs.length === 1 ? ' Nur ein Tanz im Lied? Dann keine Grenze setzen, nur den Tanz wählen.' : noDance.length ? ' Noch ohne Tanz: ' + secTitles(noDance) + '.' : '');
    if(mtStep === 2){
      if(detectJob) return 'Die App hört sich ' + secTitle(secs[detectJob.k] || secs[0]) + ' an (' + (detectJob.i + 1) + ' von ' + detectJob.n + ') – einen Moment.';
      if(!state.beats) return '„Schläge erkennen“ sucht die Schläge, je Abschnitt im Tempo seines Tanzes. Das Lied bleibt dabei auf diesem Gerät.';
      var noBeats = secs.filter(function(s){ return !s.beats.length; });
      if(noBeats.length) return 'In ' + secTitles(noBeats) + ' fehlen noch Schläge.';
      return 'Die Schläge sind da. Mit „Klicks“ anhören, ob sie sitzen – einzelne Fehler richtest du in Schritt 4.';
    }
    if(mtStep === 3){
      if(!state.beats) return 'Erst in Schritt 2 die Schläge erkennen.';
      return 'Je Abschnitt einmal die 1 festlegen: Lied abspielen und bei der 1 „Das ist die 1“ drücken – oder einen Schlag in der Lupe antippen und dann den Knopf. Ab dieser 1 zählt die App die Takte. Wie viele Schläge ein Takt hat, steht unten in der Liste.'
        + (noOne.length ? ' Noch ohne 1: ' + secTitles(noOne) + '.' : ' Alle Abschnitte haben ihre 1 – mit „Klicks“ anhören: die 1 klickt höher.');
    }
    if(mtStep === 4){
      if(!state.beats) return 'Erst in Schritt 2 die Schläge erkennen.';
      return 'Mit „Klicks“ anhören. Klickt ein ganzer Abschnitt zu früh oder zu spät: alle seine Schläge zusammen verschieben. Ein Schlag zu viel: antippen und löschen. Einer fehlt: dorthin tippen und „Schlag hier setzen“. Zählt ein Takt falsch: den Schlag antippen und „Zur 1 machen“.';
    }
    if(!mm.bars.length) return 'Erst in Schritt 3 die 1 festlegen – dann gibt es Takte.';
    return 'Freiwillig: je Takt die Schrittfolge eintragen, z. B. QQS+. Takt in der Lupe antippen, Enter springt zum nächsten. Sie steht dann in der Abspielleiste und auf den Schritte-Blättern.';
  }

  function renderMusikView(){
    if(mtBackdrop.hidden) return;
    var mm = music(), done = stepsDone(mm);
    mtSeen.state = state; mtSeen.beats = state.beats; mtSeen.music = state.music; mtSeen.drawn = null;
    if(mtSel !== null && allBeats().indexOf(mtSel) === -1) mtSel = null;
    if(mtCut >= mm.secs.length) mtCut = -1;
    if(mtBar !== null && !barOf(mtBar)) mtBar = null;
    mtStepBtns.forEach(function(btn){
      var n = +btn.dataset.step;
      if(n === mtStep) btn.setAttribute('aria-current', 'step'); else btn.removeAttribute('aria-current');
      btn.classList.toggle('is-done', !!done[n]);
      btn.title = done[n] ? 'erledigt' : '';
    });
    mtGuideEl.textContent = guideText(mm);
    mtNoteEl.textContent = mtNote;
    mtNextBtn.textContent = STEP_NEXT[mtStep];
    mtNextBtn.hidden = mtStep === 5;
    mtNextBtn.classList.toggle('btn-accent', !!done[mtStep] || (mtStep === 4 && done[3]));
    mtKeysEl.textContent = STEP_KEYS[mtStep];
    renderSecList(mm);
    updatePanels();
  }

  // The step's buttons, for what is selected and where the play position is.
  function updatePanels(){
    var mm = music(), playing = !songAudioEl.paused;
    mtPanels.forEach(function(p){ p.hidden = +p.dataset.step !== mtStep; });
    mtSeen.cur = secAt(heardSongTime()).k;
    mtSeen.playing = playing;
    if(mtStep === 1){
      var cut = mtCut > 0 ? mm.secs[mtCut] : null;
      mtCutInfo.textContent = cut ? 'Gewählt: die Grenze vor Abschnitt ' + (mtCut + 1) + ' bei ' + formatTime(cut.start, 2) + ' – in der Lupe ziehen verschiebt sie.' : '';
      mtCutDelBtn.hidden = !cut;
    }else if(mtStep === 2){
      var missing = mm.secs.filter(function(s){ return !s.beats.length; });
      mtDetectBtn.disabled = !!detectJob;
      mtDetectBtn.textContent = detectJob ? 'Erkenne …' : !state.beats ? 'Schläge erkennen' : missing.length ? 'Fehlende Schläge erkennen' : 'Alle neu erkennen';
      mtDetectBtn.classList.toggle('btn-accent', !!detectJob || missing.length > 0);
      mtProgress.hidden = !detectJob;
      if(detectJob){ mtProgress.max = detectJob.n; mtProgress.value = detectJob.i + 0.5; }
    }else if(mtStep === 3){
      mtOneBtn.disabled = !state.beats;
      mtOneInfo.textContent = !state.beats ? '' : playing ? 'beim Schlag, den du gerade hörst' : mtSel !== null ? 'für den gewählten Schlag bei ' + formatTime(mtSel, 2) : 'für den Schlag an der Abspielposition';
    }else if(mtStep === 4){
      var sec = shiftSec(), sel = mtSel, bar = sel !== null ? barOf(sel) : null, mine = sel !== null && sec.ones.indexOf(sel) !== -1;
      mtShiftInfo.textContent = 'Alle Schläge in ' + secTitle(sec) + ':';
      mtShiftBtns.forEach(function(b){ b.disabled = !sec.beats.length; });
      mtBeatInfo.textContent = sel !== null ? 'Gewählt: Schlag bei ' + formatTime(sel, 2) + (bar ? ', die 1 von Takt ' + bar.n : '') + (mine ? ' (von dir gesetzt)' : '') + '.'
        : 'Einen Schlag antippen, um ihn zu löschen oder zur 1 zu machen. Ziehen am gewählten Schlag verschiebt den Abschnitt.';
      mtBeatAddBtn.hidden = sel !== null;
      mtBeatAddBtn.disabled = !songDur();
      mtBeatDelBtn.hidden = mtBeatOneBtn.hidden = sel === null;
      mtBeatOneBtn.innerHTML = '';
      mtBeatOneBtn.append(mine ? 'Keine feste 1 mehr ' : 'Zur 1 machen ');
      mtBeatOneBtn.appendChild(document.createElement('kbd')).textContent = '1';
    }else{
      var b = mtBar !== null ? barOf(mtBar) : null;
      mtPhraseLabel.textContent = b ? 'Takt ' + b.n + ' in ' + secTitle(b.sec) : mm.bars.length ? 'Einen Takt in der Lupe antippen:' : 'Noch keine Takte.';
      mtPhrase.disabled = mtFillBtn.disabled = !b;
      if(document.activeElement !== mtPhrase) mtPhrase.value = b ? b.p : '';
    }
  }

  // The list of sections, one row each: where it is (a press goes there), its dance, from step 3 its
  // beats per bar, and what it still needs.
  function secStatus(sec){
    if(detectJob && detectJob.k === sec.k) return ['erkenne …', ''];
    if(mtStep === 1) return sec.key ? ['✓', 'ok'] : ['Tanz fehlt', 'warn'];
    if(!sec.beats.length) return ['noch keine Schläge', mtStep === 2 ? 'warn' : ''];
    var tempo = sectionTempo(sec);
    if(mtStep === 2) return tempo ? [(tempo.off ? '⚠ ' : '✓ ') + tempo.text, tempo.off ? 'warn' : 'ok'] : [sec.beats.length + ' Schläge', ''];
    if(!sec.bars.length) return ['1 fehlt', 'warn'];
    if(mtStep === 5){
      var n = sec.bars.filter(function(b){ return b.p; }).length;
      return [n + ' von ' + sec.bars.length + ' Takten mit Phrasierung', n === sec.bars.length ? 'ok' : ''];
    }
    return ['✓ ' + sec.bars.length + ' Takte', 'ok'];
  }
  function renderSecList(mm){
    var ae = document.activeElement, row0 = ae && mtSecsEl.contains(ae) ? ae.closest('.mt-sec') : null;
    var focus = row0 ? {k: row0.dataset.k, cls: ae.className.split(' ').filter(function(c){ return c.indexOf('mt-sec-') === 0; })[0]} : null;
    mtSecsEl.innerHTML = '';
    var cs = getComputedStyle(mtBackdrop), dur = songDur();
    mm.secs.forEach(function(sec){
      var row = document.createElement('div'), n = sec.k + 1, end = Math.min(sec.end, dur || sec.end);
      row.className = 'mt-sec' + (sec.k === mtSeen.cur ? ' is-cur' : '');
      row.setAttribute('role', 'listitem');
      row.dataset.k = sec.k;
      var go = row.appendChild(document.createElement('button'));
      go.type = 'button';
      go.className = 'mt-sec-go';
      go.setAttribute('aria-label', 'Abschnitt ' + n + ', ' + formatTime(sec.start) + ' bis ' + formatTime(end) + ' – dorthin springen');
      var dot = go.appendChild(document.createElement('i'));
      dot.className = 'mt-dot';
      dot.style.background = cs.getPropertyValue(SEC_COLORS[sec.k % 3][0]);
      go.appendChild(document.createTextNode(n));
      var time = go.appendChild(document.createElement('span'));
      time.className = 'mt-sec-time';
      time.textContent = formatTime(sec.start) + '–' + formatTime(end);
      go.addEventListener('click', function(){
        mtSel = null; mtCut = mtStep === 1 && sec.k ? sec.k : -1;
        var first = sec.bars[0];
        if(mtStep === 5 && first) mtBar = first.t;
        seek(mtStep === 5 && first ? first.t : sec.start);
        renderMusikView();
      });
      var sel = row.appendChild(document.createElement('select'));
      sel.className = 'mt-sec-dance';
      sel.setAttribute('aria-label', 'Tanz in Abschnitt ' + n);
      if(!sec.key) sel.add(new Option('Tanz wählen …', ''));
      BEAT_DANCES.forEach(function(d){ sel.add(new Option(d.name, d.key)); });
      sel.add(new Option('anderer Tanz', DANCE_OTHER));
      sel.value = sec.key;
      sel.addEventListener('change', function(){ setDance(sec.k, sel.value); });
      if(mtStep >= 3){
        var per = row.appendChild(document.createElement('label'));
        per.className = 'mt-sec-per';
        var inp = per.appendChild(document.createElement('input'));
        inp.type = 'number'; inp.min = 1; inp.max = 12; inp.step = 1; inp.inputMode = 'numeric';
        inp.className = 'coord-input mt-sec-perin';
        inp.value = sec.per;
        inp.setAttribute('aria-label', 'Schläge je Takt in Abschnitt ' + n);
        per.appendChild(document.createTextNode('Schläge je Takt'));
        inp.addEventListener('change', function(){ setPer(sec.k, inp.value); });
        inp.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); inp.blur(); } });
      }
      var st = secStatus(sec), status = row.appendChild(document.createElement('span'));
      status.className = 'mt-sec-status' + (st[1] ? ' is-' + st[1] : '');
      status.textContent = st[0];
      var act = null;
      if(mtStep === 1 && sec.k){
        act = document.createElement('button');
        act.textContent = 'Grenze davor entfernen';
        act.addEventListener('click', function(){ removeCut(sec.k); });
      }else if(mtStep === 2){
        act = document.createElement('button');
        act.textContent = sec.beats.length ? 'Neu erkennen' : 'Erkennen';
        act.disabled = !!detectJob;
        act.addEventListener('click', function(){ detectAsk([sec], act); });
      }
      if(act){
        act.type = 'button';
        act.className = 'btn-ghost mt-sec-act' + (mtStep === 1 ? ' danger' : '');
        row.appendChild(act);
      }
      mtSecsEl.appendChild(row);
    });
    if(focus){
      var again = mtSecsEl.querySelector('.mt-sec[data-k="' + focus.k + '"] .' + (focus.cls || 'mt-sec-go'));
      (again || mtLupe).focus({preventScroll: true}); // its row is gone (a cut removed): back to the Lupe
    }
  }

  /* ---------- the view's actions ---------- */

  function addCutHere(eventTime){
    var t = roundMs(timeNow(eventTime)), dur = songDur(), m = musicCopy(), near = nearestIn(state.beats, t);
    if(near !== null && Math.abs(near - t) < CUT_BEAT_GAP) t = near; // a beat right there: the cut is that beat
    if(t < 1 || t > dur - 1){ mtSay('So nah am Anfang oder Ende des Lieds braucht es keine Grenze.'); return; }
    if(m.sections.some(function(s){ return Math.abs(s.t - t) < 1; })){ mtSay('Hier ist schon eine Grenze.'); return; }
    m.sections.push({t: t});
    m.sections.sort(function(a, b){ return a.t - b.t; });
    mtSay('');
    setMusic(state.beats, m);
    mtCut = secAt(t).k;
    mtSay('Grenze bei ' + formatTime(t, 1) + ' gesetzt. Abschnitt ' + (mtCut + 1) + ' braucht noch seinen Tanz (Liste unten).');
    renderMusikView();
  }
  function removeCut(k){
    var m = musicCopy();
    if(!(k > 0 && k < m.sections.length)) return;
    var at = m.sections[k].t, back = nearestIn(state.beats, at);
    m.sections.splice(k, 1);
    carryMarks(m, at, back !== null && Math.abs(back - at) < CUT_BEAT_GAP ? back : null);
    mtCut = -1;
    mtSay('Grenze entfernt – Abschnitt ' + (k + 1) + ' gehört jetzt zu Abschnitt ' + k + '.');
    setMusic(state.beats, m);
  }
  // The cut before section k at t, kept half a second from its neighbours; live: during a drag.
  function moveCut(k, t, base, live){
    var b = base || {beats: state.beats, music: state.music}, m = musicCopy(b.music), s = m.sections, lo = s[k - 1].t + 0.5, hi = (k + 1 < s.length ? s[k + 1].t : songDur()) - 0.5, at = s[k].t;
    s[k].t = roundMs(Math.min(hi, Math.max(lo, t)));
    setMusic(b.beats, carryMarks(m, at, s[k].t), live);
  }
  function setDance(k, key){
    var m = musicCopy(), s = m.sections[k], had = music().secs[k].beats.length;
    if(!s) return;
    if(key) s.dance = key; else delete s.dance;
    delete s.per; // the new dance's beats per bar
    mtSay(had ? 'Tanz geändert. Die Schläge hier wurden im Tempo des alten gesucht – passen sie nicht, in Schritt 2 „Neu erkennen“.' : '');
    setMusic(state.beats, m);
  }
  function setPer(k, value){
    var m = musicCopy(), s = m.sections[k], per = Math.round(+value), d = danceByKey(s && s.dance);
    if(!s || !(per >= 1 && per <= 12)){ renderMusikView(); return; }
    if(per === (d ? d.per : 4)) delete s.per; else s.per = per;
    setMusic(state.beats, m);
    var sec = music().secs[k];
    mtSay(secTitle(sec) + ': ' + per + ' Schläge je Takt' + (sec.bars.length ? ' – ' + sec.bars.length + ' Takte.' : '.'));
  }
  function detectAsk(list, btn){
    if(!list.some(function(s){ return s.beats.length; })){ detectSections(list); return; }
    confirmDelete((list.length === 1 ? 'Schläge in ' + secTitle(list[0]) : 'Alle Schläge') + ' neu erkennen? Deine Korrekturen, die 1 und die Phrasierung dort gehen dabei verloren.',
      function(){ detectSections(list); }, btn, 'Neu erkennen');
  }
  // t becomes a 1. restart: one more 1, the count starts again there (step 4); else the 1 that
  // counts at t moves there (step 3: "where is the 1?" — set once, moved when it was wrong).
  function makeOne(t, restart){
    if(t === null){ mtSay('Erst in Schritt 2 die Schläge erkennen.'); return; }
    var sec = secAt(t), m = musicCopy(), own = sec.ones;
    if(!restart && own.length){
      var counting = own.filter(function(x){ return x <= t; }).pop();
      if(counting === undefined) counting = own[0];
      m.ones = m.ones.filter(function(x){ return x !== counting; });
    }
    if(m.ones.indexOf(t) === -1) m.ones.push(t);
    mtSel = t;
    setMusic(state.beats, m);
    var n = secAt(t).bars.length;
    mtSay((restart ? 'Ab ' + formatTime(t, 2) + ' zählt die App neu. ' : 'Die 1 sitzt bei ' + formatTime(t, 2) + ' – ') + secTitle(sec) + ' hat jetzt ' + n + ' Takte. '
      + (beatClickOn ? 'Hör mit, ob die hohen Klicks auf der 1 liegen.' : 'Schalte „Klicks“ ein: die 1 klickt höher.'));
  }
  function removeOne(t){
    var m = musicCopy(), sec = secAt(t);
    m.ones = m.ones.filter(function(x){ return x !== t; });
    setMusic(state.beats, m);
    mtSay(sec.ones.length > 1 ? 'Keine feste 1 mehr bei ' + formatTime(t, 2) + ' – die Takte zählen von der 1 davor weiter.' : secTitle(sec) + ' hat jetzt keine 1 mehr – in Schritt 3 eine festlegen.');
  }
  function deleteBeat(t){
    if(isCut(t)){ mtSay('Das ist eine Grenze – sie zählt als Schlag. Entfernen: Rechtsklick auf die Grenze (oder in Schritt 1 „Grenze davor entfernen“).'); return; }
    var counted = secAt(t).bars.length > 0;
    mtSel = null;
    setMusic((state.beats || []).filter(function(x){ return x !== t; }), musicCopy());
    mtSay('Schlag bei ' + formatTime(t, 2) + ' gelöscht.' + (counted ? ' Die Takte dahinter zählen neu.' : ''));
  }
  function addBeatHere(eventTime){
    var t = roundMs(timeNow(eventTime)), near = nearestIn(allBeats(), t);
    if(!songDur()) return;
    if(near !== null && Math.abs(near - t) < 0.06){ mtSel = near; mtSay('Dort ist schon ein Schlag – er ist jetzt gewählt.'); renderMusikView(); return; }
    setMusic((state.beats || []).concat([t]), musicCopy());
    mtSel = t;
    mtSay('Schlag bei ' + formatTime(t, 2) + ' gesetzt.' + (secAt(t).bars.length ? ' Die Takte dahinter zählen neu.' : ''));
    renderMusikView();
  }
  // The section the shift buttons act on: while playing the one heard, else the selected beat's.
  function shiftSec(){ return secAt(songAudioEl.paused && mtSel !== null ? mtSel : heardSongTime()); }
  function shiftBy(d){
    var sec = shiftSec(), r =shiftedSection({beats: state.beats, music: state.music}, sec.k, d);
    if(!r) return;
    if(mtSel !== null && inRange(mtSel, sec.start, sec.end)) mtSel = roundMs(mtSel + r.d);
    setMusic(r.beats, r.music);
    var ms = Math.round(Math.abs(r.d) * 1000);
    mtSay(ms ? 'Alle Schläge in ' + secTitle(sec) + ' ' + ms + ' ms ' + (r.d < 0 ? 'früher' : 'später') + '.' : 'Weiter geht es nicht – sonst rücken die Schläge in den Nachbarabschnitt.');
  }
  function selectBar(b, focus){
    if(!b) return;
    mtBar = b.t;
    seek(b.t);
    renderMusikView();
    if(!focus) return;
    mtPhrase.value = b.p; // the field keeps what is typed only while it stays on one bar
    mtPhrase.focus();
    mtPhrase.select();
  }
  function setPhrase(text){
    var b = mtBar !== null ? barOf(mtBar) : null;
    if(!b) return;
    var m = musicCopy();
    text = text.trim().slice(0, BAR_PHRASE_MAX);
    if(text) m.phrases[b.t] = text; else delete m.phrases[b.t];
    setMusic(state.beats, m, 'soon');
  }
  // The selected bar's Phrasierung for every later bar of its section that has none yet.
  function fillEmptyBars(){
    var b = mtBar !== null ? barOf(mtBar) : null, text = mtPhrase.value.trim(), n = 0, m = musicCopy();
    if(!b) return;
    if(!text){ mtSay('Erst eine Phrasierung eintragen.'); return; }
    b.sec.bars.forEach(function(x){ if(x.n > b.n && !x.p){ m.phrases[x.t] = text; n++; } });
    m.phrases[b.t] = text;
    setMusic(state.beats, m);
    mtSay(n ? '„' + text + '“ für ' + n + (n === 1 ? ' leeren Takt' : ' leere Takte') + ' danach übernommen.' : 'Danach ist kein Takt des Abschnitts mehr leer.');
  }
  // The previous or next beat (dir -1 / 1) from the selected one or the play position, selected.
  function stepBeat(dir){
    var beats = allBeats(), from = mtSel !== null ? mtSel : songAudioEl.currentTime, i = lowerBound(beats, from);
    var t = dir > 0 ? beats[mtSel !== null ? i + 1 : (beats[i] - from < 0.01 ? i + 1 : i)] : beats[i - 1];
    if(t === undefined){ if(!beats.length) seek(from + dir); return; }
    mtSel = t;
    seek(t);
    renderMusikView();
  }
  function stepBarSel(dir){
    var bars = music().bars, cur = mtBar !== null ? barOf(mtBar) : barAt(songAudioEl.currentTime), i = cur ? bars.indexOf(cur) : -1;
    selectBar(bars[i < 0 ? 0 : i + dir], false);
  }
  function setStep(n){
    mtStep = n;
    mtCut = -1;
    mtSel = null;
    mtSay('');
    if(n === 5 && mtBar === null){ var b = barAt(heardSongTime()) || music().bars[0]; mtBar = b ? b.t : null; }
    renderMusikView();
  }

  // The cuts from the Abschnitte that have a mark, with the dances their names give — once, while
  // the song has no sections yet.
  function prefillSections(){
    var dur = songDur();
    if(state.music || !dur) return false;
    var secs = [];
    abschnittSections(state.formations).forEach(function(s, k){
      var d = danceOfName(s.name), last = secs[secs.length - 1];
      if(k && (s.t >= dur - 1 || (d && last.d === d))) return; // the same dance goes on: no cut there
      secs.push({t: s.t, name: s.name, d: d});
    });
    if(secs.length < 2 && !secs[0].d) return false;
    setMusic(state.beats, {sections: secs.map(function(s){ var out = {t: s.t}; if(s.d) out.dance = s.d.key; return out; }), ones: [], phrases: {}});
    mtSay('Grenzen und Tänze sind aus deinen Abschnitten übernommen (' + secs.map(function(s){ return s.name || 'Anfang'; }).join(', ') + ') – beim Anhören prüfen.');
    return true;
  }

  function openMusikView(){
    if(!state.song || !state.song.url) return;
    markerBackdrop.hidden = true;
    mtBackdrop.hidden = false;
    loadWavePeaks(); // js/marker.js
    mtSel = null; mtCut = -1; mtBar = null; mtNote = '';
    var filled = prefillSections(), done = stepsDone(music());
    mtStep = filled || !done[1] ? 1 : !done[2] ? 2 : !done[3] ? 3 : 4;
    renderBeats();
    syncPlayIcon();
    if(!mtRaf) mtRaf = requestAnimationFrame(mtFrame);
    requestAnimationFrame(function(){ mtLupe.focus({preventScroll: true}); });
  }
  function closeMusikView(){
    if(mtBackdrop.hidden) return;
    mtLupePtr = null;
    songAudioEl.pause();
    saveStateDebounced.flush();
    mtBackdrop.hidden = true;
    markerBackdrop.hidden = false;
    openMarkerModal(); // js/marker.js — back where it was opened from
    document.getElementById('musikOpenBtn').focus();
  }
  document.getElementById('musikOpenBtn').addEventListener('click', openMusikView);
  document.getElementById('mtCloseBtn').addEventListener('click', closeMusikView);
  document.getElementById('mtDoneBtn').addEventListener('click', closeMusikView);
  document.getElementById('mtUndoBtn').addEventListener('click', function(){ historyUndo(); });
  document.getElementById('mtRedoBtn').addEventListener('click', function(){ historyRedo(); });
  document.getElementById('mtResetBtn').addEventListener('click', function(){
    confirmDelete('Grenzen, Schläge, die 1 und die Phrasierung dieses Lieds löschen?', function(){
      mtSel = null; mtCut = -1; mtBar = null;
      setMusic(null, null);
      if(!prefillSections()) mtSay('Alles zurückgesetzt.');
      setStep(1);
    }, document.getElementById('mtResetBtn'), 'Zurücksetzen');
  });
  var mtBackdropDown = false; // a drag that ends outside the dialog is not a click on the backdrop
  mtBackdrop.addEventListener('pointerdown', function(e){ mtBackdropDown = e.target === mtBackdrop; });
  mtBackdrop.addEventListener('click', function(e){ if(e.target === mtBackdrop && mtBackdropDown) closeMusikView(); });
  mtStepBtns.forEach(function(btn){ btn.addEventListener('click', function(){ setStep(+btn.dataset.step); }); });
  mtNextBtn.addEventListener('click', function(){ setStep(mtStep + 1); });
  function togglePlay(){
    if(!state.song || !state.song.url) return;
    if(songAudioEl.paused) songAudioEl.play().catch(function(){}); else holdSong();
  }
  // Pause where the song is heard (Bluetooth delay, js/playback.js), so the picture doesn't jump
  // ahead and play carries on from there.
  function holdSong(){
    var h = heardSongTime();
    songAudioEl.pause();
    songAudioEl.currentTime = h;
  }
  // What the view shows: while playing, what is heard — but not before where play started, until
  // the sound arrives there.
  var mtPlayFrom = 0;
  ['play', 'seeking'].forEach(function(t){ songAudioEl.addEventListener(t, function(){ mtPlayFrom = songAudioEl.currentTime; }); });
  function viewTime(){ return songAudioEl.paused ? songAudioEl.currentTime : Math.max(mtPlayFrom, heardSongTime()); }
  function syncPlayIcon(){
    var paused = songAudioEl.paused;
    mtIconPlay.hidden = !paused; mtIconPause.hidden = paused;
    mtPlayBtn.setAttribute('aria-label', paused ? 'Abspielen' : 'Anhalten');
  }
  ['play', 'pause'].forEach(function(t){ songAudioEl.addEventListener(t, function(){ if(!mtBackdrop.hidden){ syncPlayIcon(); updatePanels(); } }); });
  songAudioEl.addEventListener('durationchange', function(){ if(!mtBackdrop.hidden && prefillSections()) setStep(1); });
  mtPlayBtn.addEventListener('click', togglePlay);
  mtClickBtn.addEventListener('click', toggleClicks);
  mtCutBtn.addEventListener('pointerdown', function(e){ if(e.button === 0){ e.preventDefault(); mtCutBtn.dataset.at = e.timeStamp; addCutHere(e.timeStamp); } });
  mtOneBtn.addEventListener('pointerdown', function(e){ if(e.button === 0){ e.preventDefault(); mtOneBtn.dataset.at = e.timeStamp; makeOne(beatNow(e.timeStamp), false); } });
  // On press, not on release: a click comes a good bit after the finger lands. The click that
  // follows a press is no second one; Enter on the focused button still counts.
  [[mtCutBtn, addCutHere], [mtOneBtn, function(at){ makeOne(beatNow(at), false); }]].forEach(function(x){
    x[0].addEventListener('click', function(e){ if(e.timeStamp - (+x[0].dataset.at || -Infinity) > 1000) x[1](e.timeStamp); });
  });
  mtCutDelBtn.addEventListener('click', function(){ removeCut(mtCut); });
  mtDetectBtn.addEventListener('click', function(){
    var secs = music().secs, missing = secs.filter(function(s){ return !s.beats.length; });
    detectAsk(missing.length ? missing : secs, mtDetectBtn);
  });
  mtShiftBtns.forEach(function(btn){ btn.addEventListener('click', function(){ shiftBy(+btn.dataset.shift); }); });
  mtBeatAddBtn.addEventListener('click', function(e){ addBeatHere(e.timeStamp); });
  mtBeatDelBtn.addEventListener('click', function(){ if(mtSel !== null) deleteBeat(mtSel); });
  mtBeatOneBtn.addEventListener('click', function(){
    if(mtSel === null) return;
    if(secAt(mtSel).ones.indexOf(mtSel) !== -1) removeOne(mtSel); else makeOne(mtSel, true);
  });
  mtPhrase.addEventListener('input', function(){ setPhrase(mtPhrase.value); });
  mtPhrase.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); fillEmptyBars(); return; }
    if((e.key !== 'Enter' && e.key !== 'Tab') || e.altKey || e.ctrlKey || e.metaKey) return;
    var bars = music().bars, cur = barOf(mtBar), next = cur ? bars[bars.indexOf(cur) + (e.shiftKey ? -1 : 1)] : null;
    if(!next){ if(e.key === 'Enter') e.preventDefault(); return; }
    e.preventDefault();
    saveStateDebounced.flush(); // each bar its own undo step
    selectBar(next, true);
  });
  mtFillBtn.addEventListener('click', fillEmptyBars);

  // Keys while the view is open (not while typing; the confirm popup goes first).
  document.addEventListener('keydown', function(e){
    if(mtBackdrop.hidden || !confirmBackdrop.hidden) return;
    var ae = document.activeElement, typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable);
    if(e.key === 'Escape'){
      e.stopImmediatePropagation(); // not also the Marker dialog this returns to (js/main.js)
      if(ae === mtPhrase) mtLupe.focus(); else closeMusikView();
      return;
    }
    if(typing || e.ctrlKey || e.metaKey || e.altKey || e.repeat && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var k = e.key, done = true;
    if(k === ' ') togglePlay(); // also on a focused button: the one just pressed shouldn't fire again
    else if((k === 'g' || k === 'G') && mtStep === 1) addCutHere(e.timeStamp);
    else if(k === '1' && mtStep === 3) makeOne(beatNow(e.timeStamp), false);
    else if(k === '1' && mtStep === 4){ var t = beatNow(e.timeStamp); if(t !== null && mtSel === t && secAt(t).ones.indexOf(t) !== -1) removeOne(t); else makeOne(t, true); }
    else if((k === 's' || k === 'S') && mtStep === 4) addBeatHere(e.timeStamp);
    else if((k === 'Delete' || k === 'Backspace') && mtStep === 4 && mtSel !== null) deleteBeat(mtSel);
    else if((k === 'Delete' || k === 'Backspace') && mtStep === 1 && mtCut > 0) removeCut(mtCut);
    else if((k === 'ArrowLeft' || k === 'ArrowRight') && (ae === mtLupe || ae === document.body || !ae || ae.tagName === 'BUTTON' || ae === mtOverview)){
      var dir = k === 'ArrowRight' ? 1 : -1;
      if(e.shiftKey && mtStep === 4) shiftBy(dir * 0.01);
      else if(e.shiftKey && mtStep === 1 && mtCut > 0) moveCut(mtCut, music().secs[mtCut].start + dir * 0.1);
      else if(mtStep === 5) stepBarSel(dir);
      else if(mtStep >= 2 && state.beats) stepBeat(dir);
      else seek(songAudioEl.currentTime + dir);
    }else done = false;
    if(done){ e.preventDefault(); e.stopImmediatePropagation(); }
  });

  /* ---------- drawing ---------- */

  function fitCanvas(c){
    var dpr = window.devicePixelRatio || 1, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if(c.width !== w || c.height !== h){ c.width = w; c.height = h; }
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.clientWidth, c.clientHeight);
    return g;
  }
  function mtColors(){
    var cs = getComputedStyle(mtBackdrop);
    function v(n){ return cs.getPropertyValue(n).trim(); }
    return {ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), panel: v('--panel'), panel3: v('--panel-3'), accent: v('--accent'), accentWash: v('--accent-wash'),
      pair: v('--pair'), split: v('--split'), font: cs.fontFamily,
      sec: SEC_COLORS.map(function(c){ return v(c[0]); }), wash: SEC_COLORS.map(function(c){ return v(c[1]); })};
  }
  // The loudest moment per pixel of the song from t0 to t1 (wavePeaks from js/marker.js), as bars.
  function drawWave(g, t0, t1, W, top, h){
    if(!wavePeaks) return;
    var d = wavePeaks.data, per = (t1 - t0) / W * WAVE_RATE;
    for(var x = 0; x < W; x++){
      var k0 = Math.floor(t0 * WAVE_RATE + x * per), k1 = Math.max(k0 + 1, Math.floor(t0 * WAVE_RATE + (x + 1) * per)), m = 0;
      for(var k = Math.max(0, k0); k < k1 && k < d.length; k++) if(d[k] > m) m = d[k];
      var bar = m / wavePeaks.max * h;
      if(bar > 0.5) g.fillRect(x, top + (h - bar) / 2, 1, bar);
    }
  }
  // The Lupe: a few seconds around what is heard — 8 on a wide screen, about 4 on a phone, so the
  // beats stay a finger apart.
  function lupeView(){
    var W = mtLupe.clientWidth || 1, span = Math.min(8, Math.max(4, W / 90)), c = viewTime();
    return {c: c, t0: c - span / 2, t1: c + span / 2, W: W, pps: W / span};
  }
  function drawOverview(col){
    var g = fitCanvas(mtOverview), W = mtOverview.clientWidth, H = mtOverview.clientHeight, dur = songDur();
    if(!W || !dur) return;
    var X = function(t){ return t / dur * W; }, v = lupeView();
    g.font = '700 10px ' + col.font;
    music().secs.forEach(function(sec){
      var a = X(sec.start), b = X(Math.min(sec.end, dur));
      g.fillStyle = col.wash[sec.k % 3]; g.fillRect(a, 0, b - a, H);
      if(sec.k){ g.fillStyle = col.split; g.fillRect(a - 1, 0, 2, H); }
      g.fillStyle = col.sec[sec.k % 3];
      if(b - a > 14) g.fillText(String(sec.k + 1) + (b - a > 90 && danceLabel(sec) ? ' ' + danceLabel(sec) : ''), a + 4, 11);
    });
    g.fillStyle = col.ink3; g.globalAlpha = 0.7;
    drawWave(g, 0, dur, W, 14, H - 16);
    g.globalAlpha = 1;
    g.strokeStyle = col.accent; g.lineWidth = 1.5;
    g.strokeRect(Math.max(1, X(v.t0)), 1, Math.max(3, X(v.t1) - X(v.t0)), H - 2);
    g.fillStyle = col.ink; g.fillRect(X(v.c) - 1, 0, 2, H);
  }
  function drawLupe(col){
    var g = fitCanvas(mtLupe), W = mtLupe.clientWidth, H = mtLupe.clientHeight, dur = songDur(), v = lupeView();
    if(!W || !dur) return;
    var X = function(t){ return (t - v.t0) * v.pps; }, mm = music(), top = 18, foot = 18, phraseY = H - foot - 6;
    mm.secs.forEach(function(sec){
      var a = Math.max(0, X(sec.start)), b = Math.min(W, X(Math.min(sec.end, dur)));
      if(b > a){ g.fillStyle = col.wash[sec.k % 3]; g.fillRect(a, 0, b - a, H); }
    });
    g.fillStyle = col.panel3; // before and after the song
    if(X(0) > 0) g.fillRect(0, 0, X(0), H);
    if(X(dur) < W) g.fillRect(X(dur), 0, W - X(dur), H);
    var selBar = mtStep === 5 && mtBar !== null ? barOf(mtBar) : null;
    if(selBar){ g.fillStyle = col.accentWash; g.fillRect(X(selBar.t), 0, X(selBar.end) - X(selBar.t), H); }
    g.fillStyle = col.ink3; g.globalAlpha = 0.55;
    drawWave(g, v.t0, v.t1, W, top + 4, H - top - foot - 30);
    g.globalAlpha = 1;
    // Beats as thin lines, the bars' 1s as thick ones with the bar's number; a triangle on a 1 the user set.
    var beats = allBeats(), ones = new Set(state.music ? state.music.ones : []);
    for(var i = lowerBound(beats, v.t0 - 0.2); i < beats.length && beats[i] <= v.t1 + 0.2; i++){
      var t = beats[i], x = X(t), bar = mm.starts.has(t);
      g.fillStyle = bar ? col.pair : col.ink2;
      g.globalAlpha = bar ? 1 : 0.6;
      g.fillRect(x - (bar ? 1.5 : 0.5), top, bar ? 3 : 1, H - top - foot);
      g.globalAlpha = 1;
      if(ones.has(t)){ g.beginPath(); g.moveTo(x - 6, top - 7); g.lineTo(x + 6, top - 7); g.lineTo(x, top + 2); g.closePath(); g.fill(); }
    }
    g.textBaseline = 'alphabetic';
    mm.bars.forEach(function(b){
      if(b.end < v.t0 || b.t > v.t1) return;
      var x = X(b.t), w = X(b.end) - x - 6;
      g.fillStyle = col.pair; g.font = '800 11px ' + col.font;
      g.fillText(String(b.n), x + (ones.has(b.t) ? 8 : 4), 12);
      if(b.p && w > 10){
        g.save(); g.beginPath(); g.rect(x + 3, phraseY - 13, w, 17); g.clip();
        g.fillStyle = col.ink; g.font = '600 12px ' + col.font; g.fillText(b.p, x + 5, phraseY);
        g.restore();
      }
    });
    // The cuts, and each section's name at the bottom of the part of it in view.
    mm.secs.forEach(function(sec){
      var a = X(sec.start), b = X(Math.min(sec.end, dur));
      if(b < 0 || a > W) return;
      if(sec.k){
        var on = mtStep === 1 && sec.k === mtCut;
        g.fillStyle = on ? col.accent : col.split;
        g.fillRect(a - (on ? 2.5 : 1.5), 0, on ? 5 : 3, H);
      }
      g.fillStyle = col.sec[sec.k % 3]; g.font = '700 11px ' + col.font;
      var label = (sec.k + 1) + (danceLabel(sec) ? ' ' + danceLabel(sec) : ''), lx = Math.max(a, 0) + 6;
      if(b - lx > g.measureText(label).width + 4) g.fillText(label, lx, H - 5);
    });
    if(mtSel !== null && mtSel >= v.t0 - 0.1 && mtSel <= v.t1 + 0.1){
      var sx = X(mtSel);
      g.strokeStyle = col.accent; g.lineWidth = 2;
      g.strokeRect(sx - 7, top - 1, 14, H - top - foot + 2);
    }
    g.fillStyle = col.ink; g.fillRect(X(v.c) - 1, 0, 2, H);
    g.beginPath(); g.moveTo(X(v.c) - 5, 0); g.lineTo(X(v.c) + 5, 0); g.lineTo(X(v.c), 6); g.closePath(); g.fill();
  }
  // While the view is open: drawn again whenever what it shows changed; a state swapped from outside
  // (Rückgängig, a share update) builds the panels again.
  function mtFrame(){
    mtRaf = 0;
    if(mtBackdrop.hidden) return;
    mtRaf = requestAnimationFrame(mtFrame);
    if(mtSeen.state !== state || mtSeen.beats !== state.beats || mtSeen.music !== state.music) renderMusikView();
    var t = viewTime(), key = [t, mtLupe.clientWidth, mtOverview.clientWidth, !!wavePeaks, mtSel, mtCut, mtBar, mtStep].join('|');
    if(key !== mtSeen.drawn){
      mtSeen.drawn = key;
      var col = mtColors();
      drawOverview(col);
      drawLupe(col);
      mtTimeEl.textContent = formatTime(t) + ' / ' + formatTime(songDur());
    }
    var cur = secAt(t).k;
    if(cur !== mtSeen.cur || mtSeen.playing !== !songAudioEl.paused){
      Array.prototype.forEach.call(mtSecsEl.children, function(row){ row.classList.toggle('is-cur', +row.dataset.k === cur); });
      updatePanels();
    }
  }

  /* ---------- pressing and dragging in the overview and the Lupe ---------- */

  var mtLupePtr = null, mtLastTouch = false;
  mtOverview.addEventListener('pointerdown', function(e){
    if(e.button !== 0 || !songDur()) return;
    var rect = mtOverview.getBoundingClientRect(), at = function(x){ return (x - rect.left) / rect.width * songDur(); };
    mtOverview.setPointerCapture(e.pointerId);
    mtSel = null;
    seek(at(e.clientX));
    var move = function(ev){ seek(at(ev.clientX)); }, up = function(){ mtOverview.removeEventListener('pointermove', move); mtOverview.removeEventListener('pointerup', up); mtOverview.removeEventListener('pointercancel', up); renderMusikView(); };
    mtOverview.addEventListener('pointermove', move);
    mtOverview.addEventListener('pointerup', up);
    mtOverview.addEventListener('pointercancel', up);
  });
  // The cut (its section's k) within reach px of clientX in the Lupe or the overview, or -1.
  function cutNear(canvas, clientX, reach){
    var rect = canvas.getBoundingClientRect(), v = lupeView(), dur = songDur(), best = -1, dist = Infinity;
    var pps = canvas === mtLupe ? v.pps : rect.width / (dur || 1), t = canvas === mtLupe ? v.t0 + (clientX - rect.left) / pps : (clientX - rect.left) / pps;
    music().secs.forEach(function(s){ var dd = Math.abs(s.start - t) * pps; if(s.k && dd <= reach && dd < dist){ best = s.k; dist = dd; } });
    return best;
  }
  // Holding the Lupe stops the song where it is heard, so what is grabbed stays under the pointer;
  // letting go plays on from where it was let go.
  mtLupe.addEventListener('pointerdown', function(e){
    mtLastTouch = e.pointerType !== 'mouse';
    if(e.button !== 0 || !songDur() || mtLupePtr) return;
    var resume = !songAudioEl.paused;
    if(resume) holdSong();
    var v = lupeView(), rect = mtLupe.getBoundingClientRect(), t = v.t0 + (e.clientX - rect.left) / v.pps, reach = e.pointerType === 'mouse' ? 8 : 18;
    var p = mtLupePtr = {id: e.pointerId, x: e.clientX, v: v, t: t, from: songAudioEl.currentTime, moved: false, cut: cutNear(mtLupe, e.clientX, reach), beat: null, resume: resume};
    if(p.cut < 0 && mtStep >= 2){ var b = nearestIn(allBeats(), t); if(b !== null && Math.abs(b - t) * v.pps <= reach) p.beat = b; }
    if(p.cut > 0) p.base = {beats: state.beats, music: state.music};
    if(mtStep === 4 && p.beat !== null && p.beat === mtSel) p.base = {beats: state.beats, music: state.music, k: secAt(p.beat).k};
    mtLupe.setPointerCapture(e.pointerId);
    mtLupe.focus({preventScroll: true});
    e.preventDefault();
  });
  mtLupe.addEventListener('pointermove', function(e){
    var p = mtLupePtr;
    if(!p){ // the mouse shows what can be dragged
      if(e.pointerType === 'mouse') mtLupe.style.cursor = cutNear(mtLupe, e.clientX, 8) > 0 ? 'col-resize'
        : mtStep === 4 && mtSel !== null && Math.abs(lupeView().t0 + (e.clientX - mtLupe.getBoundingClientRect().left) / lupeView().pps - mtSel) * lupeView().pps <= 8 ? 'ew-resize' : '';
      return;
    }
    if(e.pointerId !== p.id) return;
    var dx = e.clientX - p.x;
    if(!p.moved && Math.abs(dx) < 5) return; // a shaky tap stays a tap
    p.moved = true;
    if(p.cut > 0){
      // A cut dropped near a beat lands on it.
      var t = p.base.music.sections[p.cut].t + dx / p.v.pps, b = nearestIn(p.base.beats, t);
      moveCut(p.cut, b !== null && Math.abs(b - t) * p.v.pps <= 6 ? b : t, p.base, true);
    }else if(p.base){
      var r = shiftedSection(p.base, p.base.k, dx / p.v.pps);
      if(r){ mtSel = roundMs(p.beat + r.d); setMusic(r.beats, r.music, true); }
    }else seek(p.from - dx / p.v.pps); // scrub
  });
  function endLupePtr(e){
    var p = mtLupePtr;
    if(!p || e.pointerId !== p.id) return;
    mtLupePtr = null;
    if(e.type === 'pointercancel'){
      if(p.moved && p.base){ state.beats = p.base.beats; state.music = p.base.music; renderBeats(); }
    }else if(p.moved){
      if(p.cut > 0){ mtCut = p.cut; setMusic(state.beats, state.music); mtSay('Grenze verschoben auf ' + formatTime(music().secs[p.cut].start, 2) + '.'); }
      else if(p.base){ setMusic(state.beats, state.music); var ms = Math.round((mtSel - p.beat) * 1000); mtSay('Alle Schläge in ' + secTitle(secAt(mtSel)) + ' ' + Math.abs(ms) + ' ms ' + (ms < 0 ? 'früher' : 'später') + '.'); }
    }else{
      // A tap: go there; on a cut or a beat also select it (a cut is a beat too), in step 5 the bar.
      var t = p.cut > 0 ? music().secs[p.cut].start : p.beat !== null ? p.beat : p.t, b = mtStep === 5 ? barAt(t) : null;
      mtCut = p.cut;
      if(b) selectBar(b, true);
      else{ mtSel = mtStep >= 2 && (p.cut > 0 || p.beat !== null) ? t : null; seek(t); renderMusikView(); }
    }
    if(p.resume) songAudioEl.play().catch(function(){});
  }
  mtLupe.addEventListener('pointerup', endLupePtr);
  mtLupe.addEventListener('pointercancel', endLupePtr);
  // Right-click on a cut removes it (with a finger the long press only selects: no menu there).
  [mtLupe, mtOverview].forEach(function(c){
    c.addEventListener('contextmenu', function(e){
      var k = cutNear(c, e.clientX, c === mtLupe ? 10 : 6);
      if(k < 0) return;
      e.preventDefault();
      if(!mtLastTouch) removeCut(k);
    });
  });
  mtOverview.addEventListener('pointerdown', function(e){ mtLastTouch = e.pointerType !== 'mouse'; }, true);
  window.addEventListener('resize', function(){ mtSeen.drawn = null; if(!markerBackdrop.hidden) drawBeatTicks(); });
