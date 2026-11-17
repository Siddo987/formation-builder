"use strict";

/* ---------- Takte im Lied (#2041, #2096) ----------
   The user works with bars only (state.bars, sanitizeBars in js/state.js). While the song plays he
   taps the 1; from two taps in an Abschnitt the app knows the bar length and fills the Abschnitt.
   Tapped and dragged bar lines are anchors. The bars the app filled in are spread evenly between two
   anchors, and before the first and after the last one they go on at the bar length to the
   Abschnitt's edges. The beats follow from the bars, each bar divided evenly into its beats (the
   dance's, read from the Abschnitt's name, or set in the header line): "Klicks", "Jetzt" and "Alle
   Marken auf Schläge rücken" use them. "Automatisch vorschlagen" runs Essentia's beat tracker
   (js/beats-worker.js) per Abschnitt and keeps the beats in state.beats: it doesn't know where the 1
   is, but filled-in bar lines snap onto those beats (following the tempo better than even spreading)
   and they give the bar length, so one tap on the 1 fills an Abschnitt. Everything runs in this
   browser; the song never leaves it. */

  var beatDetectBtn = document.getElementById('beatDetectBtn');
  var beatSnapAllBtn = document.getElementById('beatSnapAllBtn');
  var beatClearBtn = document.getElementById('beatClearBtn');
  var beatSnapToggle = document.getElementById('beatSnapToggle');
  var beatClickBtn = document.getElementById('beatClickBtn');
  var beatStatusEl = document.getElementById('beatStatus');
  var beatSummaryEl = document.getElementById('beatSummary');
  var beatCanvas = document.getElementById('markerTimelineBeats');
  var barTapBtn = document.getElementById('barTapBtn');
  var barHeadEl = document.getElementById('barHead');
  var barHeadText = document.getElementById('barHeadText');
  var barPerLabel = document.getElementById('barPerLabel');
  var barPerInput = document.getElementById('barPerInput');
  var barStripEl = document.getElementById('barStrip');
  var barHintEl = document.getElementById('barHint');
  var barStatusEl = document.getElementById('barStatus');
  var barEditorEl = document.getElementById('barEditor');
  var barEditorTitle = document.getElementById('barEditorTitle');
  var barPhraseInput = document.getElementById('barPhraseInput');
  var barFillBtn = document.getElementById('barFillBtn');
  var barReleaseBtn = document.getElementById('barReleaseBtn');
  var barInsertBtn = document.getElementById('barInsertBtn');
  var barRemoveBtn = document.getElementById('barRemoveBtn');
  var BEATS_WORKER_URL = document.currentScript.src.replace('beats.js', 'beats-worker.js'); // same ?v=
  var BEAT_SNAP_KEY = 'aufstellung-beat-snap', BEAT_CLICK_KEY = 'aufstellung-beat-click';
  var BEAT_SNAP_MAX = 0.3; // s — further from any beat (a pause in the music) a time stays as it is
  var BAR_SLACK = 0.05; // s — a bar this close before a Bild's mark already counts to the next Bild
  var BAR_CUT_SHARE = 0.25; // a bar starting less than this share of a bar before an Abschnitt's cut is the next one's
  var BAR_MIN = 0.25; // s — the shortest bar a drag squeezes the ones beside it to
  var GRID_SNAP = 0.3; // share of a beat: a filled-in bar line snaps onto a detected beat this close

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
  function dancePer(name){ var d = danceOfName(name); return d ? d.per : 4; }

  var beatClickOn = false; // "Klicks" in the Vorhören row (#2146), kept under BEAT_CLICK_KEY
  try{
    beatSnapToggle.checked = localStorage.getItem(BEAT_SNAP_KEY) !== '0';
    beatClickOn = localStorage.getItem(BEAT_CLICK_KEY) === '1';
  }catch(e){}
  beatSnapToggle.addEventListener('change', function(){ try{ localStorage.setItem(BEAT_SNAP_KEY, beatSnapToggle.checked ? '1' : '0'); }catch(e){} });

  function byT(a, b){ return a.t - b.t; }
  function roundMs(t){ return Math.round(t * 1000) / 1000; }
  function median(a){ a = a.slice().sort(function(x, y){ return x - y; }); return a.length ? a[a.length >> 1] : 0; }
  // The typical bar length of bars in order ({t}), 0 with fewer than two.
  function barsLen(list){ return median(list.slice(1).map(function(b, i){ return b.t - list[i].t; })); }
  // The value in a sorted array nearest to t, or null.
  function nearestIn(arr, t){
    if(!arr || !arr.length) return null;
    var lo = 0, hi = arr.length - 1;
    while(lo < hi){ var mid = (lo + hi) >> 1; if(arr[mid] < t) lo = mid + 1; else hi = mid; }
    return (lo > 0 && Math.abs(arr[lo - 1] - t) < Math.abs(arr[lo] - t)) ? arr[lo - 1] : arr[lo];
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
  // The Abschnitt time t belongs to; len (a bar length) lets a 1 a little before the cut count to the next.
  function beatSectionAt(t, len){
    return beatSections(songDur()).filter(function(s){ return s.start <= t + BAR_CUT_SHARE * (len || 0); }).pop();
  }
  function sectionName(sec, secs){ return sec.name || (secs.length > 1 ? 'Anfang' : 'Lied'); }
  // A bar's length: to the next bar, the last one as long as the one before.
  function barLenAt(bars, k){ return k + 1 < bars.length ? bars[k + 1].t - bars[k].t : k > 0 ? bars[k].t - bars[k - 1].t : 0; }
  // The Abschnitte with their bars, counted from 1 in each: [{start, end, name, bars: [{t, n, bar, i}]}]
  // (bar: the one in `bars`, i its index there).
  function barSections(bars){
    bars = bars || state.bars || [];
    var secs = beatSections(songDur()), k = 0;
    secs.forEach(function(sec, i){
      sec.bars = [];
      for(; k < bars.length && (i === secs.length - 1 || bars[k].t + BAR_CUT_SHARE * barLenAt(bars, k) < sec.end); k++) sec.bars.push({t: bars[k].t, n: sec.bars.length + 1, bar: bars[k], i: k});
    });
    return secs;
  }
  // Beats per bar of an Abschnitt: as set in the header (kept on each bar as n), else its dance's.
  function sectionPer(sec){ var b = sec.bars.filter(function(x){ return x.bar.n; })[0]; return b ? b.bar.n : dancePer(sec.name); }

  // The beats as the app uses them: each bar divided evenly into its beats, the last bar of an
  // Abschnitt as long as the one before; in an Abschnitt without bars, the detected ones. ones: the 1s.
  function songBeats(){
    var out = [], ones = new Set(), all = state.bars || [], grid = state.beats || [];
    if(!songDur()) return {beats: out, ones: ones};
    barSections().forEach(function(sec){
      if(!sec.bars.length){ grid.forEach(function(t){ if(t >= sec.start && t < sec.end) out.push(t); }); return; }
      var len = 0;
      sec.bars.forEach(function(b, j){
        var next = sec.bars[j + 1], per = b.bar.n || dancePer(sec.name), stop = b.i + 1 < all.length ? all[b.i + 1].t - 0.03 : Infinity;
        if(next) len = next.t - b.t;
        ones.add(b.t);
        for(var k = 0; k < per; k++){
          var t = roundMs(b.t + k * len / per);
          if(k && (!len || t >= stop)) break;
          out.push(t);
        }
      });
    });
    out.sort(function(a, b){ return a - b; });
    return {beats: out.filter(function(t, i){ return !i || t - out[i - 1] > 0.08; }), ones: ones};
  }
  // The beat nearest to t (s) within maxDist, or null.
  function nearestBeat(t, maxDist){
    var b = nearestIn(songBeats().beats, t);
    return b !== null && Math.abs(b - t) <= maxDist ? b : null;
  }
  // t on the detected beat nearest to it (moved by shift), if that is within GRID_SNAP of a beat
  // (bar length l, per beats).
  function gridSnap(t, l, per, shift){
    var g = nearestIn(state.beats, t - shift);
    return g !== null && Math.abs(g + shift - t) < GRID_SNAP * l / per ? g + shift : t;
  }
  // The bar length the detected beats of an Abschnitt give (folded onto its dance's tempo), 0 without.
  function gridBarLen(sec, per){
    var g = (state.beats || []).filter(function(t){ return t >= sec.start && t < sec.end; });
    if(g.length < 5) return 0;
    var bpm = 60 / median(g.slice(1).map(function(t, i){ return t - g[i]; })), d = danceOfName(sec.name);
    return per * 60 / (d ? foldBpm(bpm, d) : bpm);
  }
  // A time set from the play position ("Jetzt", a Bild added while paused) on the nearest beat.
  function beatSnap(t){
    if(!beatSnapToggle.checked) return t;
    var b = nearestBeat(t, BEAT_SNAP_MAX);
    return b === null ? t : b;
  }

  /* Lays out one Abschnitt's bars (in order, changed in place) around its anchors and returns them:
     between two anchors they keep their number and are spread evenly; before the first and after the
     last they go on at the anchors' bar length up to the Abschnitt's edges (a partial bar is dropped),
     reusing the bars that were there in order from the anchor out, so their Phrasierung stays. Each
     filled-in line snaps onto a detected beat close by, the next one going on from there. len: the
     bar length to go on with where the anchors don't tell (one anchor only); 0 leaves those as they are. */
  function layBars(list, sec, len){
    var anchors = [], per = (list.filter(function(b){ return b.n; })[0] || {}).n || dancePer(sec.name);
    list.forEach(function(b, i){ if(!b.fill) anchors.push(i); });
    list.forEach(function(b){ if(per !== dancePer(sec.name)) b.n = per; else delete b.n; });
    if(!anchors.length) return list;
    // Detected beats sit a little off the music (mostly late): the anchors near them show by how much.
    var shift = median(anchors.map(function(i){ var g = nearestIn(state.beats, list[i].t); return g === null ? 1 : list[i].t - g; })
      .filter(function(d){ return Math.abs(d) < 0.1; }));
    for(var a = 0; a + 1 < anchors.length; a++){
      var i0 = anchors[a], i1 = anchors[a + 1], t0 = list[i0].t, t1 = list[i1].t;
      for(var i = i0 + 1; i < i1; i++) list[i].t = roundMs(gridSnap(t0 + (t1 - t0) * (i - i0) / (i1 - i0), (t1 - t0) / (i1 - i0), per, shift));
    }
    function extend(old, from, l, dir){
      if(!(l > BAR_MIN)) return old;
      var made = [], lo = Math.max(0, sec.start - BAR_CUT_SHARE * l);
      for(var t = gridSnap(from + dir * l, l, per, shift); dir > 0 ? t + BAR_CUT_SHARE * l < sec.end : t >= lo; t = gridSnap(t + dir * l, l, per, shift)){
        var b = old[made.length] || {};
        b.t = roundMs(t); b.fill = true;
        if(per !== dancePer(sec.name)) b.n = per;
        made.push(b);
      }
      return made;
    }
    // Outside the anchors: their mean bar length (taps jitter; a drag between two anchors leaves it be).
    var first = anchors[0], last = anchors[anchors.length - 1], edge = last > first ? (list[last].t - list[first].t) / (last - first) : len;
    var head = extend(list.slice(0, first).reverse(), list[first].t, edge, -1).reverse();
    var tail = extend(list.slice(last + 1), list[last].t, edge, 1);
    return head.concat(list.slice(first, last + 1), tail);
  }
  // `bars` (the whole song's) with one Abschnitt changed: edit(list, sec) gets copies of its bars in
  // order and returns them as they should be (usually through layBars).
  function editSection(bars, secStart, edit){
    var before = [], after = [], list = null, sec = null;
    barSections(bars).forEach(function(s){
      var own = s.bars.map(function(b){ return b.bar; });
      if(s.start === secStart){ sec = s; list = own.map(function(b){ return Object.assign({}, b); }); }
      else if(sec) after = after.concat(own);
      else before = before.concat(own);
    });
    if(!sec) return bars;
    var out = before.concat(edit(list, sec), after).sort(byT);
    return out.filter(function(b, i){ return !i || b.t - out[i - 1].t > 0.05; });
  }

  // Every change to the bars ends here.
  function setBars(bars, debounced){
    state.bars = bars && bars.length ? bars : null;
    if(debounced) saveStateDebounced(); else saveState();
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
        // The bar lines filled in so far move onto the beats found; the anchors stay.
        var bars = state.bars || [], open = 0;
        barSections(bars).forEach(function(sec){
          if(!sec.bars.length){ open++; return; }
          bars = editSection(bars, sec.start, function(list, s){ return layBars(list, s, barsLen(list)); });
        });
        state.bars = bars.length ? bars : null;
        saveState();
        beatStatusEl.textContent = (state.beats ? state.beats.length : 0) + ' Schläge erkannt. '
          + (open ? 'Jetzt in ' + (open === 1 ? 'dem Abschnitt' : 'jedem Abschnitt') + ' ohne Takte einmal auf die 1 tippen, den Rest füllt die App.' : 'Die Taktstriche sitzen jetzt auf ihnen.');
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

  /* Tapping the 1 while the song plays. A tap goes where it was heard — the position minus the
     Bluetooth delay, like "Jetzt" (heardSongTime, js/playback.js). Taps less than TAP_RUN_BARS bars
     apart in one Abschnitt form a run; each tap lays the Abschnitt out again from the bars it had
     before the run: the run's taps become anchors, the bars it passes over make way (each new one
     keeping the Phrasierung of the old one closest to it), and from two taps on the bar length is
     known, so the rest of the Abschnitt is filled. A run is saved (one undo step) once it ends. */
  var TAP_RUN_BARS = 2.5, TAP_RUN_FIRST = 5; // s — before any bar length is known
  var tapRun = null;
  function tapBars(list, sec, run){
    var taps = run.taps, len = run.prior, counts = [], sum = 0;
    for(var k = 1; k < taps.length; k++){
      var c = len ? Math.max(1, Math.round((taps[k] - taps[k - 1]) / len)) : 1; // a 1 left out makes it two bars
      counts.push(c); sum += c;
      len = (taps[k] - taps[0]) / sum;
    }
    run.len = taps.length > 1 ? len : 0;
    var fillLen = run.len || run.hint, half = fillLen / 2, lo = taps[0] - half, hi = taps[taps.length - 1] + half;
    var made = [], old = list.filter(function(b){ return b.t >= lo && b.t <= hi; });
    taps.forEach(function(t, k){
      made.push({t: t});
      for(var j = 1; j < (counts[k] || 0); j++) made.push({t: roundMs(t + (taps[k + 1] - t) * j / counts[k]), fill: true});
    });
    made.forEach(function(b){
      var best = null;
      old.forEach(function(o){ if(!o.taken && Math.abs(o.t - b.t) <= half && (!best || Math.abs(o.t - b.t) < Math.abs(best.t - b.t))) best = o; });
      if(best){ best.taken = true; if(best.p) b.p = best.p; if(best.n) b.n = best.n; }
    });
    return layBars(list.filter(function(b){ return b.t < lo || b.t > hi; }).concat(made).sort(byT), sec, fillLen);
  }
  function tapOne(eventTime){
    if(!songDur()) return;
    // The event waited a moment in the queue: count from when it happened.
    var lag = songAudioEl.paused ? 0 : Math.min(0.1, Math.max(0, (performance.now() - eventTime) / 1000)) * (songAudioEl.playbackRate || 1);
    var t = roundMs(Math.max(0, heardSongTime() - lag)), run = tapRun;
    if(run && Math.abs(t - run.last) < Math.max(0.15, run.len * 0.3)) return; // a bounce, or tapped again while paused
    var sec = beatSectionAt(t, (run && run.len) || 2);
    if(run && (sec.start !== run.sec.start || t <= run.last || t - run.last > (run.len || run.prior ? TAP_RUN_BARS * (run.len || run.prior) : TAP_RUN_FIRST))){ endTapRun(); run = null; }
    if(!run){
      var snap = state.bars ? state.bars.slice() : [], s = barSections(snap).filter(function(x){ return x.start === sec.start; })[0];
      var d = danceOfName(sec.name), per = sectionPer(s), hint = barsLen(s.bars) || gridBarLen(sec, per);
      // The dance's tempo only tells how many bars the first two taps are apart, not where they lie.
      run = tapRun = {sec: sec, snap: snap, taps: [], hint: hint, prior: hint || (d ? per * 120 / (d.lo + d.hi) : 0), per: per, len: 0, last: -Infinity, had: s.bars.length};
      // A lone 1 set before (while paused, or with a pause since) is this run's first tap.
      var lone = s.bars.length === 1 && !s.bars[0].bar.fill ? s.bars[0].t : null;
      if(lone !== null && t > lone && t - lone < (run.prior ? 8 * run.prior : TAP_RUN_FIRST)){ run.taps.push(lone); run.last = lone; }
    }
    run.taps.push(t);
    run.last = t;
    beatStatusEl.textContent = ''; // "… einmal auf die 1 tippen" after detection is done now
    state.bars = editSection(run.snap, sec.start, function(list, s){ return tapBars(list, s, run); }); // saved when the run ends
    if(!state.bars.length) state.bars = null;
    clearTimeout(run.timer);
    run.timer = setTimeout(endTapRun, Math.max(2, TAP_RUN_BARS * (run.len || run.prior || 2)) * 1000);
    var own = barSections().filter(function(x){ return x.start === sec.start; })[0].bars;
    if(run.had < 2 && own.length > 1 && !run.zoomed){ run.zoomed = true; zoomToBars(t, run.len || run.hint); }
    barStatusEl.textContent = own.length > 1 ? '„' + sectionName(sec, beatSections(songDur())) + '“: ' + own.length + ' Takte. Jede weitere 1 macht es genauer.'
      : songAudioEl.paused ? 'Gesetzt. Jetzt ▶ starten und bei jeder weiteren 1 tippen.' : 'Und weiter bei jeder 1 tippen – ab der zweiten füllt sich der Abschnitt.';
    renderBeats();
    barTapBtn.classList.add('bar-tap-btn--hit');
    setTimeout(function(){ barTapBtn.classList.remove('bar-tap-btn--hit'); }, 90);
  }
  function endTapRun(){
    var run = tapRun;
    if(!run) return;
    tapRun = null;
    clearTimeout(run.timer);
    setBars(state.bars);
    var own = barSections().filter(function(x){ return x.start === run.sec.start; })[0].bars;
    if(own.length > 1) barStatusEl.textContent = '„' + sectionName(run.sec, beatSections(songDur())) + '“: ' + own.length + ' Takte. Mit „Klicks“ anhören, ob sie sitzen; wo nicht, den Taktstrich an die richtige Stelle ziehen.';
  }
  ['pause', 'seeking'].forEach(function(t){ songAudioEl.addEventListener(t, endTapRun); });
  window.addEventListener('pagehide', endTapRun);
  var tapPressedAt = -Infinity;
  // On press, not on release: a click comes a good bit after the finger lands.
  barTapBtn.addEventListener('pointerdown', function(e){ if(e.button === 0){ e.preventDefault(); tapPressedAt = e.timeStamp; tapOne(e.timeStamp); } });
  // Enter/Space on the focused button; the click that follows a press is no second tap.
  barTapBtn.addEventListener('click', function(e){ if(e.timeStamp - tapPressedAt > 1000) tapOne(e.timeStamp); });
  document.addEventListener('keydown', function(e){
    if(e.key !== '1' || markerBackdrop.hidden || !confirmBackdrop.hidden || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    var ae = document.activeElement;
    if(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return;
    e.preventDefault();
    tapOne(e.timeStamp);
  });

  // Zoomed out too far to see bars, the timeline zooms in to about 64 px a bar around t.
  function zoomToBars(t, len){
    var w = barStripEl.clientWidth, v = markerView(), dur = songDur(); // js/marker.js
    if(!w || !(len > 0) || len / (v.t1 - v.t0) * w >= 40) return;
    markerSpan = Math.min(dur, Math.max(2, w / 64 * len));
    markerViewStart = t - markerSpan * 0.25;
    if(markerSpan >= dur) markerSpan = null;
    renderMarkerTimeline();
    updateMarkerPlayheadUI();
  }

  /* The bar strip under the waveform: a box per bar (number, Phrasierung) with its bar line on the
     left, a dot on the line where it is an anchor. Dragging a line moves it — it becomes an anchor and
     the bars to the anchors beside it are spread again, live. A click or tap on a box selects that bar
     (the editor below). Keyboard: ←/→ go from bar to bar, Umschalt + ←/→ move its line by 0,01 s,
     Enter goes to the Phrasierung. Only the bars in view are built; the selected one is barSelT. */
  var barSelT = null;
  // The selected bar: {k (index in state.bars), bar, n, sec, j (index in sec.bars), secs}, or null.
  function selectedBar(){
    if(barSelT === null || !state.bars) return null;
    var best = null, secs = barSections();
    secs.forEach(function(sec){
      sec.bars.forEach(function(b, j){
        if(Math.abs(b.t - barSelT) < 0.25 && (!best || Math.abs(b.t - barSelT) < Math.abs(best.bar.t - barSelT))) best = {k: b.i, bar: b.bar, n: b.n, sec: sec, j: j, secs: secs};
      });
    });
    return best;
  }
  // Where each bar ends in the strip: at the next bar of its Abschnitt, the last one a bar later.
  function barEnds(secs){
    var ends = [], all = state.bars || [];
    secs.forEach(function(sec){
      var len = 0;
      sec.bars.forEach(function(b, j){
        var next = sec.bars[j + 1];
        if(next) len = next.t - b.t;
        ends[b.i] = next ? next.t : Math.min(b.t + (len || 2), b.i + 1 < all.length ? all[b.i + 1].t : Infinity, sec.end + (len || 2));
      });
    });
    return ends;
  }
  function renderBarStrip(){
    var dur = songDur(), bars = state.bars || [], v = markerView(), w = barStripEl.clientWidth;
    var hadFocus = barStripEl.contains(document.activeElement);
    barStripEl.innerHTML = '';
    barHintEl.hidden = !bars.length;
    if(!dur) return;
    if(!bars.length){
      var empty = document.createElement('p');
      empty.className = 'bar-strip-empty';
      var line = empty.appendChild(document.createElement('span')), key = document.createElement('span'); // one flex item
      line.textContent = state.beats ? 'Schläge sind erkannt: Lied starten und je Abschnitt einmal bei der 1 auf „Tippe auf die 1“ tippen'
        : 'Lied starten und bei jeder 1 auf „Tippe auf die 1“ tippen – ab der zweiten füllt die App den Abschnitt';
      key.className = 'bar-hint-keys';
      key.textContent = ' (oder Taste 1)';
      line.appendChild(key);
      line.appendChild(document.createTextNode('.'));
      barStripEl.appendChild(empty);
      return;
    }
    var secs = barSections(), ends = barEnds(secs), sel = selectedBar(), pxs = w / (v.t1 - v.t0), focusK = -1;
    secs.forEach(function(sec){
      sec.bars.forEach(function(b){
        var end = ends[b.i];
        if(end <= v.t0 || b.t >= v.t1) return;
        var px = (end - b.t) * pxs, box = document.createElement('button');
        box.type = 'button';
        box.className = 'bar-box' + (b.bar.fill ? '' : ' bar-box--anchor') + (sel && sel.k === b.i ? ' bar-box--sel' : '');
        box.style.left = ((b.t - v.t0) / (v.t1 - v.t0) * 100) + '%';
        box.style.width = ((end - b.t) / (v.t1 - v.t0) * 100) + '%';
        box.dataset.i = b.i;
        box.tabIndex = -1;
        if(px >= 16){
          var num = document.createElement('span');
          num.className = 'bar-box-n';
          num.textContent = b.n;
          box.appendChild(num);
        }
        if(px >= 30){
          var ph = document.createElement('span');
          ph.className = 'bar-box-p';
          ph.textContent = b.bar.p || '·';
          box.appendChild(ph);
        }
        box.setAttribute('aria-label', sectionName(sec, secs) + ', Takt ' + b.n + ', ' + formatTime(b.t, 2) + (b.bar.p ? ', Phrasierung ' + b.bar.p : '') + (b.bar.fill ? '' : ', Fixpunkt'));
        barStripEl.appendChild(box);
        if(focusK < 0 || (sel && sel.k === b.i)) focusK = b.i;
      });
    });
    var target = barStripEl.querySelector('[data-i="' + focusK + '"]');
    if(target){ target.tabIndex = 0; if(hadFocus) target.focus({preventScroll: true}); }
    markBarNow(true);
  }
  // The box of the bar being heard, while the song plays.
  var barNowK = -1;
  function markBarNow(force){
    var k = !songAudioEl.paused ? barIndexAt(heardSongTime()) : -1;
    if(k === barNowK && !force) return;
    var was = barStripEl.querySelector('.bar-box--now');
    if(was) was.classList.remove('bar-box--now');
    barNowK = k;
    var box = k >= 0 && barStripEl.querySelector('[data-i="' + k + '"]');
    if(box) box.classList.add('bar-box--now');
  }

  // The bar line or box under clientX: {line, box} as indices into state.bars (-1: none).
  function barHitAt(clientX, pointerType){
    var bars = state.bars || [], rect = barStripEl.getBoundingClientRect(), v = markerView(), pxs = rect.width / (v.t1 - v.t0);
    var t = v.t0 + (clientX - rect.left) / pxs, ends = barEnds(barSections()), box = -1, line = -1, best = Infinity;
    bars.forEach(function(b, i){
      if(b.t <= t && t < ends[i]) box = i;
      var d = Math.abs(b.t - t) * pxs, w = Math.min(ends[i] - b.t, i > 0 ? b.t - bars[i - 1].t : Infinity) * pxs;
      // A finger reaches further than the mouse, but leaves the middle of a box to select it.
      if(w >= 12 && d <= Math.min(pointerType === 'mouse' ? 6 : 16, w * 0.3) && d < best){ best = d; line = i; }
    });
    return {line: line, box: box, t: t, dense: box >= 0 && (ends[box] - bars[box].t) * pxs < 16};
  }
  // A drag of bar k: the Abschnitt laid out again from how it was when the drag began.
  function barMover(k){
    var snap = state.bars.slice(), secs = barSections(snap), sec = secs.filter(function(s){ return s.bars.some(function(b){ return b.i === k; }); })[0];
    var j = sec.bars.map(function(b){ return b.i; }).indexOf(k), list = sec.bars, len = barsLen(list), p = -1, q = -1;
    list.forEach(function(b, x){ if(!b.bar.fill && x < j) p = x; if(!b.bar.fill && x > j && q < 0) q = x; });
    var lo = p >= 0 ? list[p].t + (j - p) * BAR_MIN : Math.max(0, sec.start - BAR_CUT_SHARE * len);
    var hi = q >= 0 ? list[q].t - (q - j) * BAR_MIN : sec.end - BAR_CUT_SHARE * len - 0.01;
    return {from: snap[k].t, snap: snap, to: function(t){
      t = roundMs(Math.min(hi, Math.max(lo, t)));
      barSelT = t;
      return editSection(snap, sec.start, function(own, s){ own[j].t = t; delete own[j].fill; return layBars(own, s, len); });
    }};
  }
  var barPointer = null;
  barStripEl.addEventListener('pointerdown', function(e){
    if(e.button !== 0 || !state.bars || !songDur() || barPointer) return;
    var hit = barHitAt(e.clientX, e.pointerType || 'mouse');
    barPointer = {id: e.pointerId, x: e.clientX, type: e.pointerType || 'mouse', hit: hit, moved: false, v: markerView(),
      mover: hit.line >= 0 ? barMover(hit.line) : null};
    barStripEl.setPointerCapture(e.pointerId);
    e.preventDefault(); // focus goes where the selection says, and no text selection
  });
  barStripEl.addEventListener('pointermove', function(e){
    var p = barPointer;
    if(!p){ // the mouse shows what a press does
      if(e.pointerType === 'mouse' && state.bars) barStripEl.style.cursor = barHitAt(e.clientX, 'mouse').line >= 0 ? 'ew-resize' : '';
      return;
    }
    if(e.pointerId !== p.id) return;
    if(!p.mover){ // off a line: a sideways swipe pans the zoomed view, as on the waveform
      if(!markerSpan || (!p.panned && Math.abs(e.clientX - p.x) < 6)) return;
      p.panned = true;
      markerViewStart = p.v.t0 - (e.clientX - p.x) / barStripEl.clientWidth * (p.v.t1 - p.v.t0); // js/marker.js clamps it
      renderMarkerTimeline();
      updateMarkerPlayheadUI();
      return;
    }
    if(!p.moved && Math.abs(e.clientX - p.x) < 4) return; // a shaky tap stays a tap
    p.moved = true;
    state.bars = p.mover.to(p.mover.from + (e.clientX - p.x) / barStripEl.clientWidth * (p.v.t1 - p.v.t0));
    renderBarStrip();
    renderBarEditor();
    drawBeatTicks();
  });
  function endBarPointer(e){
    var p = barPointer;
    if(!p || e.pointerId !== p.id) return;
    barPointer = null;
    if(e.type === 'pointercancel'){ if(p.moved){ state.bars = p.mover.snap; renderBeats(); } return; }
    if(p.moved){
      setBars(state.bars);
      barStatusEl.textContent = 'Der Strich sitzt jetzt fest (Punkt), die Takte bis zu den nächsten festen Strichen sind neu verteilt.';
      return;
    }
    var k = p.hit.line >= 0 ? p.hit.line : p.hit.box;
    if(k < 0 || p.panned) return;
    if(p.hit.dense) zoomToBars(state.bars[k].t, barsLen(state.bars.slice(Math.max(0, k - 1), k + 2)));
    selectBar(k, p.type === 'mouse' ? 'input' : null);
  }
  barStripEl.addEventListener('pointerup', endBarPointer);
  barStripEl.addEventListener('pointercancel', endBarPointer);
  barStripEl.addEventListener('keydown', function(e){
    var box = e.target.closest && e.target.closest('.bar-box');
    if(!box) return;
    var k = +box.dataset.i, bars = state.bars || [];
    if(e.key === 'ArrowLeft' || e.key === 'ArrowRight'){
      var dir = e.key === 'ArrowRight' ? 1 : -1;
      e.preventDefault();
      if(e.shiftKey){ setBars(barMover(k).to(bars[k].t + dir * 0.01), true); return; }
      if(bars[k + dir]) selectBar(k + dir, 'box');
    }else if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      selectBar(k, 'input');
    }else if(e.key === 'Escape' && barSelT !== null){
      e.stopPropagation(); // the dialog stays open
      barSelT = null;
      renderBeats();
    }
  });
  // Selects bar k; the view follows. focus: 'input' (the Phrasierung), 'box', or none (a touch).
  function selectBar(k, focus){
    var b = state.bars && state.bars[k];
    if(!b) return;
    barSelT = b.t;
    var v = markerView();
    if(b.t < v.t0 || b.t > v.t1) showInMarkerView(b.t); // js/marker.js
    renderBeats();
    if(focus === 'input'){ barPhraseInput.focus(); barPhraseInput.select(); }
    else if(focus === 'box'){ var box = barStripEl.querySelector('[data-i="' + k + '"]'); if(box) box.focus(); }
  }

  /* The editor under the strip for the selected bar: its Phrasierung (stored on the bar, so it moves
     with it), and what a wrong layout needs — an anchor let go, a bar more or less between two. */
  // The anchors around the selected bar: {p, q} as indices into sel.sec.bars, or null in the
  // Abschnitt's head or tail.
  function selSpan(sel){
    var list = sel.sec.bars, p = -1, q = -1;
    list.forEach(function(b, x){ if(!b.bar.fill && x <= sel.j) p = x; if(!b.bar.fill && x > sel.j && q < 0) q = x; });
    return p >= 0 && q >= 0 ? {p: p, q: q} : null;
  }
  function renderBarEditor(){
    var sel = selectedBar();
    barEditorEl.hidden = !sel;
    if(!sel) return;
    barEditorTitle.textContent = 'Takt ' + sel.n + ' · ' + sectionName(sel.sec, sel.secs) + ' · ' + formatTime(sel.bar.t, 2) + (sel.bar.fill ? '' : ' · Fixpunkt');
    if(document.activeElement !== barPhraseInput) barPhraseInput.value = sel.bar.p || '';
    barReleaseBtn.hidden = !!sel.bar.fill;
    var span = selSpan(sel);
    barInsertBtn.hidden = !span;
    barRemoveBtn.hidden = !span || span.q - span.p < 2;
  }
  // The selected bar's Abschnitt laid out again after edit(list, j) changed its bars; the selection
  // stays on the bar returned (or j's).
  function editSelected(edit){
    var sel = selectedBar();
    if(!sel) return null;
    var len = barsLen(sel.sec.bars), keep = null;
    setBars(editSection(state.bars, sel.sec.start, function(list, s){
      keep = edit(list, sel.j) || list[sel.j];
      var out = layBars(list, s, len);
      return out;
    }));
    if(keep) barSelT = keep.t;
    renderBeats();
    return sel;
  }
  barReleaseBtn.addEventListener('click', function(){
    var sel = editSelected(function(list, j){ list[j].fill = true; });
    if(sel) barStatusEl.textContent = 'Takt ' + sel.n + ' ist wieder frei und neu verteilt.';
  });
  barInsertBtn.addEventListener('click', function(){
    var sel = editSelected(function(list, j){ list.splice(j + 1, 0, {t: (list[j].t + list[j + 1].t) / 2, fill: true}); });
    if(sel) barStatusEl.textContent = 'Ein Takt mehr bis zum nächsten festen Strich.';
  });
  barRemoveBtn.addEventListener('click', function(){
    var sel = editSelected(function(list, j){
      var x = list[j].fill ? j : j + 1;
      list.splice(x, 1);
      return list[Math.min(j, list.length - 1)];
    });
    if(sel) barStatusEl.textContent = 'Ein Takt weniger bis zum nächsten festen Strich.';
  });
  barPhraseInput.addEventListener('input', function(){
    var sel = selectedBar();
    if(!sel) return;
    sel.bar.p = barPhraseInput.value;
    saveStateDebounced();
    renderBarStrip();
    updatePlaybarBar();
  });
  barPhraseInput.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); var s = selectedBar(); if(s) selectBar(s.k, 'box'); return; }
    if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); fillEmptyBars(); return; }
    if((e.key !== 'Enter' && e.key !== 'Tab') || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    var sel = selectedBar(), next = sel && state.bars[sel.k + 1];
    if(!next){ if(e.key === 'Enter') e.preventDefault(); return; }
    e.preventDefault();
    selectBar(sel.k + 1, null);
    barPhraseInput.value = next.p || '';
    barPhraseInput.select();
  });
  // The selected bar's Phrasierung for every later bar of its Abschnitt that has none yet.
  function fillEmptyBars(){
    var sel = selectedBar(), text = barPhraseInput.value.trim(), n = 0;
    if(!sel) return;
    if(!text){ barStatusEl.textContent = 'Erst eine Phrasierung eintragen.'; return; }
    sel.sec.bars.forEach(function(b, j){
      if(j > sel.j && !(b.bar.p || '').trim()){ b.bar.p = text; n++; }
    });
    saveState();
    renderBeats();
    barStatusEl.textContent = n ? '„' + text + '“ für ' + n + (n === 1 ? ' leeren Takt' : ' leere Takte') + ' übernommen.' : 'Danach ist kein Takt des Abschnitts mehr leer.';
  }
  barFillBtn.addEventListener('click', fillEmptyBars);

  /* The header line above the waveform: the Abschnitt in view — the selected bar's, else the one
     being heard, else the middle of the view — its tempo and its beats per bar. */
  function sectionTempo(sec){
    var d = danceOfName(sec.name), per = sectionPer(sec), bpm, text;
    if(sec.bars.length >= 2) bpm = 60 / barsLen(sec.bars) * per;
    else{
      var g = (state.beats || []).filter(function(t){ return t >= sec.start && t < sec.end; });
      if(g.length < 5) return null;
      bpm = 60 / median(g.slice(1).map(function(t, i){ return t - g[i]; }));
      if(!d) return {text: Math.round(bpm) + ' Schläge/min', off: false};
      bpm = foldBpm(bpm, d);
    }
    var off = !!d && (bpm < d.lo - per || bpm > d.hi + per);
    text = (bpm / per).toFixed(1).replace('.', ',') + ' Takte/min';
    return {text: text + (off ? ' — außerhalb von ' + Math.round(d.lo / per) + '–' + Math.round(d.hi / per) + ', bitte anhören' : ''), off: off};
  }
  // Half/double tempo (and ⅔ / ³⁄₂ around the waltzes) is the usual miss of detection — fold onto the dance.
  function foldBpm(bpm, d){
    var c = (d.lo + d.hi) / 2;
    return [0.5, 2/3, 1, 1.5, 2].map(function(k){ return bpm * k; }).reduce(function(a, b){ return Math.abs(b - c) < Math.abs(a - c) ? b : a; });
  }
  var barHeadSec = null;
  // moved: only if playback went on into another Abschnitt.
  function renderBarHead(moved){
    var dur = songDur();
    barHeadEl.hidden = !dur;
    if(!dur) return;
    var secs = barSections(), sel = selectedBar(), v = markerView(), heard = heardSongTime();
    var at = sel ? sel.bar.t : heard >= v.t0 && heard <= v.t1 ? heard : (v.t0 + v.t1) / 2;
    var sec = sel ? sel.sec : secs.filter(function(s){ return s.start <= at; }).pop();
    if(moved && barHeadSec && barHeadSec.start === sec.start) return;
    var tempo = sectionTempo(sec);
    barHeadSec = sec;
    barHeadText.textContent = sectionName(sec, secs) + ' · ab ' + formatTime(sec.start) + (tempo ? ' · ' + tempo.text : '')
      + (sec.bars.length ? '' : gridBarLen(sec, 4) ? ' · einmal auf die 1 tippen' : ' · noch keine Takte');
    barHeadEl.classList.toggle('bar-head--warn', !!tempo && tempo.off);
    barPerLabel.hidden = !sec.bars.length;
    if(document.activeElement !== barPerInput) barPerInput.value = sectionPer(sec);
  }
  barPerInput.addEventListener('change', function(){
    var sec = barHeadSec, per = Math.min(12, Math.max(1, Math.round(+barPerInput.value) || 0));
    if(!sec || !sec.bars.length || !per){ renderBarHead(); return; }
    setBars(editSection(state.bars, sec.start, function(list){
      list.forEach(function(b){ if(per !== dancePer(sec.name)) b.n = per; else delete b.n; });
      return list;
    }));
    barStatusEl.textContent = '„' + sectionName(sec, beatSections(songDur())) + '“: ' + per + ' Schläge je Takt.';
  });
  barPerInput.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); barPerInput.blur(); } });

  // Summary per Abschnitt in the Schläge section, buttons, strip, editor, ticks.
  function renderBeats(){
    var sb = songBeats(), dur = songDur();
    beatSnapAllBtn.hidden = !sb.beats.length;
    beatClearBtn.hidden = !state.bars && !state.beats;
    beatClickBtn.disabled = !sb.beats.length;
    beatClickBtn.setAttribute('aria-pressed', beatClickOn ? 'true' : 'false');
    beatClickBtn.title = sb.beats.length ? 'Beim Vorhören jeden Schlag mitklicken, die 1 höher' : 'Erst auf die 1 tippen';
    syncBeatClicks(); // bars set or removed while the song plays
    if(!selectedBar()) barSelT = null;
    renderBarStrip();
    renderBarEditor();
    renderBarHead();
    updatePlaybarBar();
    beatSummaryEl.innerHTML = '';
    if(dur) barSections().forEach(function(sec, i, secs){
      var tempo = sectionTempo(sec);
      if(!tempo) return;
      var row = document.createElement('div');
      row.className = 'beat-summary-row';
      row.classList.toggle('beat-summary-row--warn', tempo.off);
      row.textContent = sectionName(sec, secs) + ' (' + formatTime(sec.start) + '): ' + tempo.text;
      beatSummaryEl.appendChild(row);
    });
    drawBeatTicks();
  }

  // Beats as thin ticks over the waveform, bar lines as thick ones in another colour.
  function drawBeatTicks(){
    var w = beatCanvas.clientWidth, h = beatCanvas.clientHeight, dpr = window.devicePixelRatio || 1;
    beatCanvas.width = Math.round(w * dpr); beatCanvas.height = Math.round(h * dpr);
    var g = beatCanvas.getContext('2d'), v = markerView(), W = beatCanvas.width, H = beatCanvas.height; // markerView(): js/marker.js — the zoomed part (#2091)
    g.clearRect(0, 0, W, H);
    if(v.t1 <= v.t0) return;
    function x(t){ return Math.round((t - v.t0) / (v.t1 - v.t0) * W); }
    var cs = getComputedStyle(beatCanvas), sb = songBeats();
    g.fillStyle = cs.color;
    g.globalAlpha = 0.45;
    sb.beats.forEach(function(t){
      if(t >= v.t0 && t <= v.t1 && !sb.ones.has(t)) g.fillRect(x(t), 0, Math.max(1, dpr), H);
    });
    g.globalAlpha = 1;
    g.fillStyle = cs.getPropertyValue('--pair').trim() || cs.color;
    (state.bars || []).forEach(function(b){
      if(b.t >= v.t0 && b.t <= v.t1) g.fillRect(x(b.t) - Math.round(dpr), 0, Math.round(2 * dpr), H);
    });
  }

  // The index of the bar playing at song time t, or -1 before the first.
  function barIndexAt(t){
    var bars = state.bars || [], lo = 0, hi = bars.length;
    while(lo < hi){ var mid = (lo + hi) >> 1; if(bars[mid].t <= t + 0.02) lo = mid + 1; else hi = mid; }
    return lo - 1;
  }

  /* The bar being heard in the main playbar: its number in the Abschnitt and its Phrasierung — while
     anything plays the song, paused, and at the selected Bild. playback.js calls this with every
     timeline update; while the song plays a frame loop keeps it current ("Nur Musik" too). */
  var playbarBarEl = document.getElementById('playbarBar'), playbarBarShown = null;
  function updatePlaybarBar(){
    var k = -1, label = '', phrase = '';
    if(state.bars && songDur()){
      var t = !songAudioEl.paused ? heardSongTime() : pausedAt ? pausedAt.songTime : playbackStartTime(); // js/playback.js
      k = barIndexAt(t);
    }
    if(k >= 0){
      var bt = state.bars[k].t;
      barSections().forEach(function(s){ s.bars.forEach(function(b){ if(b.t === bt){ label = 'Takt ' + b.n; phrase = (b.bar.p || '').trim(); } }); });
    }
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
    if(!markerBackdrop.hidden){ markBarNow(); if(barSelT === null) renderBarHead(true); }
    if(!songAudioEl.paused) requestAnimationFrame(barPlayFrame);
  }
  songAudioEl.addEventListener('play', function(){ requestAnimationFrame(barPlayFrame); });
  ['pause', 'seeked', 'durationchange'].forEach(function(t){ songAudioEl.addEventListener(t, barPlayFrame); });

  // For the Schritte sheets (js/steps.js): the bars from song time t0 to t1 with their Phrasierung,
  // runs of the same one folded ("Takt 5–12: 4× QQS+ · SQQ · 3× QQS+"); '' without any Phrasierung.
  function barPhrasingLine(t0, t1){
    if(!state.bars || !songDur() || t0 === null || t1 === null || !(t1 > t0)) return '';
    var bars = [];
    barSections().forEach(function(s){ s.bars.forEach(function(b){ if(b.t + BAR_SLACK >= t0 && b.t + BAR_SLACK < t1) bars.push(b); }); });
    if(!bars.some(function(b){ return b.bar.p; })) return '';
    var runs = [];
    bars.forEach(function(b){
      var p = b.bar.p || '–', last = runs[runs.length - 1];
      if(last && last.p === p) last.n++; else runs.push({p: p, n: 1});
    });
    var first = bars[0].n, lastN = bars[bars.length - 1].n;
    return (bars.length === 1 ? 'Takt ' + first : 'Takt ' + first + '–' + lastN) + ': '
      + runs.map(function(r){ return (r.n > 1 ? r.n + '× ' : '') + r.p; }).join(' · ');
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
    var now = songAudioEl.currentTime, until = now + 0.12, rate = songAudioEl.playbackRate || 1, sb = songBeats();
    sb.beats.forEach(function(t){
      if(t <= clickedUntil || t < now || t > until) return;
      var at = clickCtx.currentTime + (t - now) / rate, o = clickCtx.createOscillator(), g = clickCtx.createGain();
      o.frequency.value = sb.ones.has(t) ? 2500 : 1500; // the 1 higher
      g.gain.setValueAtTime(0.4, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
      o.connect(g); g.connect(clickCtx.destination); o.start(at); o.stop(at + 0.05);
    });
    clickedUntil = until;
  }
  // Starts or stops the clicks to match the toggle, the beats and playback — also mid-song.
  function syncBeatClicks(){
    var run = beatClickOn && !!(state.bars || state.beats) && !markerBackdrop.hidden && !songAudioEl.paused;
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
    confirmDelete(state.bars ? 'Alle Takte mit ihrer Phrasierung entfernen?' : 'Erkannte Schläge entfernen?', function(){
      state.beats = null;
      state.bars = null;
      barSelT = null;
      saveState();
      beatStatusEl.textContent = barStatusEl.textContent = '';
      renderBeats();
    }, beatClearBtn, 'Entfernen');
  });
  window.addEventListener('resize', function(){ if(!markerBackdrop.hidden){ drawBeatTicks(); renderBarStrip(); } });
