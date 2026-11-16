"use strict";

/* ---------- Schläge im Lied (#2041) ----------
   "Schläge erkennen" in the Marker dialog runs Essentia's beat tracker (js/beats-worker.js) over the
   song, one Abschnitt at a time with the tempo range of its dance (read from the Abschnitt's name),
   and keeps the beats in state.beats. "Jetzt" and a Bild added at the pause point then land on the
   nearest beat; "Alle Marken auf Schläge rücken" does the same for the marks already set. Bars ("die
   1") are not detected: they are set by hand (state.bars, #2096) — tapped in, toggled on a tick, or
   filled in every Nth beat from one 1. Everything runs in this browser; the song never leaves it. */

  var beatDetectBtn = document.getElementById('beatDetectBtn');
  var beatSnapAllBtn = document.getElementById('beatSnapAllBtn');
  var beatClearBtn = document.getElementById('beatClearBtn');
  var beatSnapToggle = document.getElementById('beatSnapToggle');
  var beatClickBtn = document.getElementById('beatClickBtn');
  var beatStatusEl = document.getElementById('beatStatus');
  var beatSummaryEl = document.getElementById('beatSummary');
  var beatCanvas = document.getElementById('markerTimelineBeats');
  var beatToolBtns = Array.prototype.slice.call(document.getElementById('beatToolRow').querySelectorAll('button'));
  var beatToolHint = document.getElementById('beatToolHint');
  var beatTapBtns = document.getElementById('beatTapBtns');
  var beatTapBtn = document.getElementById('beatTapBtn');
  var barTapBtn = document.getElementById('barTapBtn');
  var beatFillRow = document.getElementById('beatFillRow');
  var beatFillText = document.getElementById('beatFillText');
  var beatFillPer = document.getElementById('beatFillPer');
  var beatFillBtn = document.getElementById('beatFillBtn');
  var BEATS_WORKER_URL = document.currentScript.src.replace('beats.js', 'beats-worker.js'); // same ?v=
  var BEAT_SNAP_KEY = 'aufstellung-beat-snap', BEAT_CLICK_KEY = 'aufstellung-beat-click';
  var BEAT_SNAP_MAX = 0.3; // s — further from any beat (a pause in the music) a time stays as it is
  var BAR_SLACK = 0.05; // s — a 1 this close before an Abschnitt's cut already counts to the next one

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

  var beatClickOn = false; // "Klicks" in the Vorhören row (#2146), kept under BEAT_CLICK_KEY
  try{
    beatSnapToggle.checked = localStorage.getItem(BEAT_SNAP_KEY) !== '0';
    beatClickOn = localStorage.getItem(BEAT_CLICK_KEY) === '1';
  }catch(e){}
  beatSnapToggle.addEventListener('change', function(){ try{ localStorage.setItem(BEAT_SNAP_KEY, beatSnapToggle.checked ? '1' : '0'); }catch(e){} });

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
  // The Abschnitt time t belongs to.
  function beatSectionAt(t){
    return beatSections(songDur()).filter(function(s){ return s.start <= t + BAR_SLACK; }).pop();
  }
  // The Abschnitte with their bar starts, counted from 1 in each: [{start, end, name, bars: [{t, n, bar}]}].
  function barSections(){
    var secs = beatSections(songDur()), bars = state.bars || [], k = 0;
    secs.forEach(function(sec, i){
      sec.bars = [];
      for(; k < bars.length && (i === secs.length - 1 || bars[k].t + BAR_SLACK < sec.end); k++) sec.bars.push({t: bars[k].t, n: sec.bars.length + 1, bar: bars[k]});
    });
    return secs;
  }
  function isBarStart(t){ return (state.bars || []).some(function(b){ return b.t === t; }); }

  // Every change to beats or bars ends here: bars only stay on a beat (sanitizeBars, js/state.js).
  function setBeats(beats, bars){
    state.beats = sanitizeBeats(beats);
    state.bars = sanitizeBars(bars, state.beats);
    saveState();
    renderBeats();
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
  var BAR_KEEP = 0.15; // s — on "Neu erkennen" a 1 moves to the new beat this close, else it is gone
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
        var oldBars = state.bars || [];
        state.beats = sanitizeBeats(all.filter(function(t, i){ return !i || t - all[i - 1] > 0.08; }));
        // The 1s set by hand go to the new beat nearest them.
        state.bars = sanitizeBars(oldBars.map(function(b){
          var t = nearestBeat(b.t, BAR_KEEP);
          return t === null ? null : Object.assign({}, b, {t: t});
        }), state.beats);
        saveState();
        var kept = state.bars ? state.bars.length : 0;
        beatStatusEl.textContent = (state.beats ? state.beats.length : 0) + ' Schläge erkannt.'
          + (oldBars.length ? ' ' + kept + ' von ' + oldBars.length + ' Taktanfängen übernommen.' : '');
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

  /* "Schläge bearbeiten" under the timeline (#2147, #2096): one tool at a time decides what a click,
     tap or drag on the timeline does. "Aus" (the default) leaves it as it always was: click seeks. */
  var beatTool = '';
  var BEAT_TOOL_NEEDS_BEATS = {del: true, bar: true, one: true, section: true};
  var BEAT_TICK_HINT = ' Neben einem Strich springt ein Klick an die Stelle; liegen sie dicht, erst hineinzoomen.';
  var BEAT_TOOL_HINTS = {
    tap: 'Beim Vorhören mittippen: S oder „Schlag“ bei jedem Schlag, 1 oder „Die 1“ beim ersten Schlag eines Takts. Nochmal getippt ersetzt die Schläge der Stelle.',
    add: 'Klick in die Zeitleiste setzt dort einen Schlag.',
    del: 'Klick auf einen Strich löscht diesen Schlag.' + BEAT_TICK_HINT,
    bar: 'Klick auf einen Strich macht ihn zur 1 oder wieder zum normalen Schlag.' + BEAT_TICK_HINT,
    one: 'Einen Strich ziehen rückt diesen Schlag.' + BEAT_TICK_HINT,
    section: 'Einen Strich ziehen rückt alle Schläge seines Abschnitts.' + BEAT_TICK_HINT
  };

  // Summary per Abschnitt (median beat distance, folded onto the dance's tempo), buttons, ticks.
  function renderBeats(){
    var beats = state.beats, dur = songAudioEl.duration;
    beatSnapAllBtn.hidden = beatClearBtn.hidden = !beats;
    beatDetectBtn.textContent = beats ? 'Neu erkennen' : 'Schläge erkennen';
    beatClickBtn.disabled = !beats;
    beatClickBtn.setAttribute('aria-pressed', beatClickOn ? 'true' : 'false');
    beatClickBtn.title = beats ? 'Beim Vorhören jeden Schlag mitklicken, die 1 höher' : 'Erst Schläge erkennen oder eintippen';
    syncBeatClicks(); // beats found or removed while the song plays
    if(!beats && BEAT_TOOL_NEEDS_BEATS[beatTool]) beatTool = '';
    beatToolBtns.forEach(function(b){
      b.setAttribute('aria-pressed', b.dataset.tool === beatTool ? 'true' : 'false');
      b.disabled = !beats && !!BEAT_TOOL_NEEDS_BEATS[b.dataset.tool];
    });
    beatToolHint.hidden = !beatTool;
    beatToolHint.textContent = BEAT_TOOL_HINTS[beatTool] || '';
    beatTapBtns.hidden = beatTool !== 'tap';
    markerTimelineEl.classList.toggle('marker-timeline--beat-move', !!beatTool);
    renderBarFill();
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

  // Beats as thin ticks, bar starts as thick ones in another colour, numbered where there is room.
  function drawBeatTicks(){
    var w = beatCanvas.clientWidth, h = beatCanvas.clientHeight, dpr = window.devicePixelRatio || 1;
    beatCanvas.width = Math.round(w * dpr); beatCanvas.height = Math.round(h * dpr);
    var g = beatCanvas.getContext('2d'), v = markerView(), W = beatCanvas.width, H = beatCanvas.height; // markerView(): js/marker.js — the zoomed part (#2091)
    g.clearRect(0, 0, W, H);
    if(!state.beats || v.t1 <= v.t0) return;
    function x(t){ return Math.round((t - v.t0) / (v.t1 - v.t0) * W); }
    var cs = getComputedStyle(beatCanvas);
    g.fillStyle = cs.color;
    g.globalAlpha = beatTool ? 0.9 : 0.35;
    state.beats.forEach(function(t){
      if(t >= v.t0 && t <= v.t1) g.fillRect(x(t), 0, Math.max(1, dpr), H);
    });
    if(!state.bars) return;
    g.globalAlpha = 1;
    g.fillStyle = cs.getPropertyValue('--pair').trim() || cs.color;
    g.font = '700 ' + Math.round(9 * dpr) + 'px ' + cs.fontFamily;
    g.textBaseline = 'bottom';
    var lastLabel = -Infinity;
    barSections().forEach(function(sec){
      sec.bars.forEach(function(b){
        if(b.t < v.t0 || b.t > v.t1) return;
        var bx = x(b.t);
        g.fillRect(bx - Math.round(dpr), 0, Math.round(3 * dpr), H);
        if(bx - lastLabel < 24 * dpr) return;
        g.fillText(String(b.n), bx + Math.round(3 * dpr), H - Math.round(2 * dpr));
        lastLabel = bx;
      });
    });
  }

  /* Moving beats that detection got wrong (#2147). With "Verschieben" or "Abschnitt verschieben",
     dragging a tick moves that beat or every beat of its Abschnitt, never past the beats beside them;
     bar starts on them move along. A tap or a click beside the ticks still seeks. */
  var beatDrag = null, beatDragged = false, beatPointerType = 'mouse';
  var BEAT_GAP = 0.08; // s — the closest two beats get, as detection keeps them
  // The index of the beat under clientX (a finger reaches further than the mouse), or -1.
  function beatIndexAt(clientX, pointerType){
    var v = markerView(), reach = (pointerType === 'mouse' ? 6 : 16) / markerTimelineEl.clientWidth * (v.t1 - v.t0);
    var t = nearestBeat(markerTimeAt(clientX), reach); // markerTimeAt(): js/marker.js
    return t === null ? -1 : state.beats.indexOf(t);
  }
  markerTimelineEl.addEventListener('pointerdown', function(e){
    beatDragged = false;
    beatPointerType = e.pointerType || 'mouse';
    if((beatTool !== 'one' && beatTool !== 'section') || !state.beats || e.button !== 0 || beatDrag) return;
    var i = beatIndexAt(e.clientX, e.pointerType);
    if(i < 0) return;
    var b = state.beats, dur = songDur(), lo = i, hi = i, sec = null, v = markerView();
    if(beatTool === 'section'){
      sec = beatSections(dur).filter(function(s){ return s.start <= b[i]; }).pop();
      while(lo > 0 && b[lo - 1] >= sec.start) lo--;
      while(hi < b.length - 1 && b[hi + 1] < sec.end) hi++;
    }
    beatDrag = {id: e.pointerId, x: e.clientX, orig: b, origBars: state.bars, lo: lo, hi: hi, sec: sec, shift: 0,
      perPx: (v.t1 - v.t0) / markerTimelineEl.clientWidth,
      min: Math.min(0, (lo > 0 ? b[lo - 1] + BEAT_GAP : 0) - b[lo]),
      max: Math.max(0, (hi < b.length - 1 ? b[hi + 1] - BEAT_GAP : dur) - b[hi])};
    markerTimelineEl.setPointerCapture(e.pointerId);
    e.preventDefault(); // no text selection; the click after a tap still comes
  });
  markerTimelineEl.addEventListener('pointermove', function(e){
    var d = beatDrag;
    if(!d){ // the mouse shows what a click does
      if(e.pointerType === 'mouse') markerTimelineEl.style.cursor = beatTool === 'add' ? 'copy'
        : BEAT_TOOL_NEEDS_BEATS[beatTool] && state.beats && beatIndexAt(e.clientX, 'mouse') >= 0 ? (beatTool === 'one' || beatTool === 'section' ? 'ew-resize' : 'pointer') : '';
      return;
    }
    if(e.pointerId !== d.id || (!beatDragged && Math.abs(e.clientX - d.x) < 4)) return; // a shaky tap stays a tap
    beatDragged = true;
    d.shift = Math.min(d.max, Math.max(d.min, (e.clientX - d.x) * d.perPx));
    var t0 = d.orig[d.lo], t1 = d.orig[d.hi];
    state.beats = d.orig.map(function(t, k){ return k >= d.lo && k <= d.hi ? t + d.shift : t; });
    // Same arithmetic as the beats, so a bar start stays exactly on its beat.
    state.bars = d.origBars && d.origBars.map(function(b){ return b.t >= t0 && b.t <= t1 ? Object.assign({}, b, {t: b.t + d.shift}) : b; });
    drawBeatTicks();
  });
  function endBeatDrag(e){
    var d = beatDrag;
    if(!d || e.pointerId !== d.id) return;
    beatDrag = null;
    if(!beatDragged || e.type === 'pointercancel'){ beatDragged = false; state.beats = d.orig; state.bars = d.origBars; drawBeatTicks(); return; }
    setBeats(state.beats, state.bars);
    var n = d.hi - d.lo + 1;
    beatStatusEl.textContent = (d.sec ? n + (n === 1 ? ' Schlag' : ' Schläge') + ' von „' + (d.sec.name || 'Anfang') + '“' : 'Schlag bei ' + formatTime(d.orig[d.lo], 2))
      + ' um ' + (d.shift < 0 ? '−' : '+') + Math.abs(d.shift).toFixed(2).replace('.', ',') + ' s verschoben.';
  }
  markerTimelineEl.addEventListener('pointerup', endBeatDrag);
  markerTimelineEl.addEventListener('pointercancel', endBeatDrag);
  // A finished drag is no click into the timeline (js/marker.js seeks on click); neither is a click
  // that sets, deletes or toggles a beat.
  markerTimelineEl.addEventListener('click', function(e){
    if(beatDragged){ beatDragged = false; e.stopImmediatePropagation(); return; }
    if(beatTool === 'add'){
      e.stopImmediatePropagation();
      if(songDur()) addBeatAt(markerTimeAt(e.clientX));
      return;
    }
    if((beatTool !== 'del' && beatTool !== 'bar') || !state.beats) return;
    var i = beatIndexAt(e.clientX, beatPointerType);
    if(i < 0) return; // beside the ticks: seek as usual
    e.stopImmediatePropagation();
    var t = state.beats[i];
    if(beatTool === 'del'){
      setBeats(state.beats.filter(function(b, k){ return k !== i; }), (state.bars || []).filter(function(b){ return b.t !== t; }));
      beatStatusEl.textContent = 'Schlag bei ' + formatTime(t, 2) + ' gelöscht.';
    }else if(isBarStart(t)){
      setBeats(state.beats, state.bars.filter(function(b){ return b.t !== t; }));
      beatStatusEl.textContent = 'Schlag bei ' + formatTime(t, 2) + ' ist keine 1 mehr.';
    }else{
      setBeats(state.beats, (state.bars || []).concat([{t: t}]));
      offerBarFill(t);
      beatStatusEl.textContent = 'Schlag bei ' + formatTime(t, 2) + ' ist jetzt eine 1.';
    }
  }, true);
  function addBeatAt(t){
    t = Math.round(t * 1000) / 1000;
    var near = nearestBeat(t, BEAT_GAP);
    if(near !== null){ beatStatusEl.textContent = 'Bei ' + formatTime(near, 2) + ' liegt schon ein Schlag.'; return; }
    setBeats((state.beats || []).concat([t]), state.bars);
    beatStatusEl.textContent = 'Schlag bei ' + formatTime(t, 2) + ' gesetzt.';
  }
  beatToolBtns.forEach(function(btn){
    btn.addEventListener('click', function(){ endTapRun(); beatTool = btn.dataset.tool; renderBeats(); });
  });

  /* Tapping beats in while the song plays ("Tippen"). A tap goes where it was heard — the position
     minus the Bluetooth delay, like "Jetzt" (heardSongTime, js/playback.js). Taps less than
     TAP_RUN_GAP apart form a run; the beats a run passes over make way for its taps, so a passage
     is redone by tapping it again. A run is saved (one undo step) once it ends. */
  var TAP_RUN_GAP = 2, TAP_EDGE = 0.2; // s
  var tapRun = null;
  function tapBeat(asBar, eventTime, btn){
    if(!songDur()) return;
    // The event waited a moment in the queue: count from when it happened.
    var lag = songAudioEl.paused ? 0 : Math.min(0.1, Math.max(0, (performance.now() - eventTime) / 1000)) * (songAudioEl.playbackRate || 1);
    var t = Math.round(Math.max(0, heardSongTime() - lag) * 1000) / 1000;
    var run = tapRun;
    if(run && (t < run.last || t - run.last > TAP_RUN_GAP)){ endTapRun(); run = null; }
    if(run && t - run.last < BEAT_GAP) return; // a bounce, or tapped again while paused
    var from = run ? run.last : t - TAP_EDGE, to = t + TAP_EDGE;
    var gone = function(b){ return run ? b > from && b <= to : b >= from && b <= to; };
    var beats = state.beats || [], removed = beats.filter(gone);
    var bars = (state.bars || []).filter(function(b){ return !gone(b.t); });
    beats = beats.filter(function(b){ return !gone(b); }).concat([t]).sort(function(a, b){ return a - b; });
    if(asBar) bars = bars.concat([{t: t}]).sort(function(a, b){ return a.t - b.t; });
    if(!run) run = tapRun = {first: t, n: 0, bars: 0, replaced: 0, lastBar: null};
    run.last = t; run.n++; run.replaced += removed.length;
    if(asBar){ run.bars++; run.lastBar = t; }
    state.beats = beats; // saved when the run ends
    state.bars = bars.length ? bars : null;
    clearTimeout(run.timer);
    run.timer = setTimeout(endTapRun, TAP_RUN_GAP * 1000);
    drawBeatTicks();
    if(btn){ btn.classList.add('beat-tap-btn--hit'); setTimeout(function(){ btn.classList.remove('beat-tap-btn--hit'); }, 90); }
  }
  function endTapRun(){
    var run = tapRun;
    if(!run) return;
    tapRun = null;
    clearTimeout(run.timer);
    setBeats(state.beats, state.bars);
    if(run.lastBar !== null) offerBarFill(run.lastBar);
    beatStatusEl.textContent = run.n + (run.n === 1 ? ' Schlag' : ' Schläge') + ' getippt (' + formatTime(run.first) + '–' + formatTime(run.last) + ')'
      + (run.bars ? ', davon ' + run.bars + (run.bars === 1 ? ' Taktanfang' : ' Taktanfänge') : '')
      + (run.replaced ? '; ' + run.replaced + ' alte ersetzt' : '') + '.';
  }
  ['pause', 'seeking'].forEach(function(t){ songAudioEl.addEventListener(t, endTapRun); });
  window.addEventListener('pagehide', endTapRun);
  [[beatTapBtn, false], [barTapBtn, true]].forEach(function(p){
    // On press, not on release: a click comes a good bit after the finger lands.
    p[0].addEventListener('pointerdown', function(e){ if(e.button === 0){ e.preventDefault(); tapBeat(p[1], e.timeStamp, p[0]); } });
    p[0].addEventListener('click', function(e){ if(e.detail === 0) tapBeat(p[1], e.timeStamp, p[0]); }); // Enter/Space on the focused button
  });
  document.addEventListener('keydown', function(e){
    if(beatTool !== 'tap' || markerBackdrop.hidden || !confirmBackdrop.hidden || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    var asBar = e.key === '1';
    if(!asBar && e.key !== 's' && e.key !== 'S') return;
    var ae = document.activeElement;
    if(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return;
    e.preventDefault();
    tapBeat(asBar, e.timeStamp, asBar ? barTapBtn : beatTapBtn);
  });

  /* "Auffüllen": from one 1 on, every Nth beat becomes a 1 up to the end of its Abschnitt or the next
     1 already set. N is the dance's beats per bar, changeable here (remembered per Abschnitt name
     while the page is open). Filling again from the same 1 first takes back what it filled before,
     so a wrong N is just corrected. */
  var barFill = null, barFillPer = {};
  function offerBarFill(t){
    var sec = beatSectionAt(t), d = danceOfName(sec.name);
    barFill = {t: t, made: []};
    beatFillPer.value = barFillPer[sec.name] || (d ? d.per : 4);
    renderBarFill();
  }
  function renderBarFill(){
    var f = barFill, show = !!f && (beatTool === 'bar' || beatTool === 'tap') && songDur() > 0 && isBarStart(f.t);
    beatFillRow.hidden = !show;
    if(!show) return;
    var sec = beatSectionAt(f.t);
    beatFillText.textContent = 'Takte ab der 1 bei ' + formatTime(f.t, 2) + ' bis zum Ende von „' + (sec.name || 'Anfang') + '“:';
  }
  function fillBars(){
    var f = barFill, beats = state.beats || [], i0 = f ? beats.indexOf(f.t) : -1;
    if(i0 < 0 || !isBarStart(f.t)){ renderBarFill(); return; }
    var per = Math.min(12, Math.max(1, Math.round(+beatFillPer.value) || 4)), sec = beatSectionAt(f.t);
    beatFillPer.value = barFillPer[sec.name] = per;
    var made = new Set(f.made), bars = (state.bars || []).filter(function(b){ return !made.has(b.t); });
    var taken = new Set(bars.map(function(b){ return b.t; })), added = [];
    for(var i = i0 + 1; i < beats.length && beats[i] + BAR_SLACK < sec.end; i++){
      if(taken.has(beats[i])) break; // the next 1 set by hand
      if((i - i0) % per === 0) added.push({t: beats[i]});
    }
    f.made = added.map(function(b){ return b.t; });
    setBeats(beats, bars.concat(added));
    beatStatusEl.textContent = added.length + (added.length === 1 ? ' Taktanfang' : ' Taktanfänge') + ' gesetzt, jeder ' + per + '. Schlag ab ' + formatTime(f.t, 2) + '.';
  }
  beatFillBtn.addEventListener('click', fillBars);
  beatFillPer.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); fillBars(); } });

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
    var bars = new Set((state.bars || []).map(function(b){ return b.t; }));
    state.beats.forEach(function(t){
      if(t <= clickedUntil || t < now || t > until) return;
      var at = clickCtx.currentTime + (t - now) / rate, o = clickCtx.createOscillator(), g = clickCtx.createGain();
      o.frequency.value = bars.has(t) ? 2500 : 1500; // the 1 higher
      g.gain.setValueAtTime(0.4, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
      o.connect(g); g.connect(clickCtx.destination); o.start(at); o.stop(at + 0.05);
    });
    clickedUntil = until;
  }
  // Starts or stops the clicks to match the toggle, the beats and playback — also mid-song.
  function syncBeatClicks(){
    var run = beatClickOn && !!state.beats && !markerBackdrop.hidden && !songAudioEl.paused;
    if(run === !!clickTimer) return;
    clearInterval(clickTimer);
    clickTimer = null;
    if(!run) return;
    clickCtx = clickCtx || new (window.AudioContext || window.webkitAudioContext)();
    clickCtx.resume();
    clickedUntil = songAudioEl.currentTime - 0.01;
    clickTimer = setInterval(clickTick, 40);
  }
  ['play', 'pause', 'ended'].forEach(function(t){ songAudioEl.addEventListener(t, syncBeatClicks); });
  songAudioEl.addEventListener('seeking', function(){ clickedUntil = songAudioEl.currentTime - 0.01; });
  beatClickBtn.addEventListener('click', function(){
    beatClickOn = !beatClickOn;
    try{ localStorage.setItem(BEAT_CLICK_KEY, beatClickOn ? '1' : '0'); }catch(e){}
    beatClickBtn.setAttribute('aria-pressed', beatClickOn ? 'true' : 'false');
    syncBeatClicks();
  });

  beatDetectBtn.addEventListener('click', detectBeats);
  beatSnapAllBtn.addEventListener('click', snapAllMarks);
  beatClearBtn.addEventListener('click', function(){
    confirmDelete(state.bars ? 'Schläge und Taktanfänge entfernen?' : 'Schläge entfernen?', function(){
      state.beats = null;
      state.bars = null;
      saveState();
      beatStatusEl.textContent = '';
      renderBeats();
    }, beatClearBtn, 'Entfernen');
  });
  window.addEventListener('resize', function(){ if(!markerBackdrop.hidden) drawBeatTicks(); });
