"use strict";

/* ---------- marker modal: link formations to timestamps in the song ---------- */

  var markerBtn = document.getElementById('markerBtn');
  var markerBackdrop = document.getElementById('markerBackdrop');
  var markerCloseBtn = document.getElementById('markerCloseBtn');
  var markerNoSongHint = document.getElementById('markerNoSongHint');
  var markerSongArea = document.getElementById('markerSongArea');
  var markerPlayBtn = document.getElementById('markerPlayBtn');
  var markerIconPlay = document.getElementById('markerIconPlay');
  var markerIconPause = document.getElementById('markerIconPause');
  var markerTimeReadout = document.getElementById('markerTimeReadout');
  var markerTimelineEl = document.getElementById('markerTimeline');
  var markerTimelinePlayed = document.getElementById('markerTimelinePlayed');
  var markerTimelineFlags = document.getElementById('markerTimelineFlags');
  var markerTimelineHead = document.getElementById('markerTimelineHead');
  var markerListEl = document.getElementById('markerList');
  var markerOrderWarning = document.getElementById('markerOrderWarning');
  var syncBadge = document.getElementById('syncBadge');
  var scrubTicksEl = document.getElementById('scrubTicks');

  // m:ss.s — with digits = 2 to the hundredth, as the marks are kept (#2091).
  function formatTime(sec, digits){
    if(sec === null || sec === undefined || !isFinite(sec)) return '';
    digits = digits || 1;
    var unit = Math.pow(10, digits), tot = Math.round(Math.max(0, sec) * unit) / unit;
    var m = Math.floor(tot/60);
    var s = tot - m*60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(digits);
  }

  function parseTimeInput(str){
    str = (str||'').trim();
    if(!str) return null;
    var m = str.match(/^(\d+):(\d+(?:[.,]\d+)?)$/);
    if(m) return parseInt(m[1],10)*60 + parseFloat(m[2].replace(',','.'));
    var f = parseFloat(str.replace(',','.'));
    return isFinite(f) ? f : null;
  }

  function snapTime(t){
    return Math.round(t*100)/100;
  }

  function updateSyncBadge(){
    var sync = isSyncActive();
    syncBadge.hidden = !sync;
    document.getElementById('playScrub').classList.toggle('synced', sync); // room for sections, bars and waveform
    // Every Bild as a numbered mark on the dock's timeline: in sync where it is in the song (#2054),
    // unmarked ones outlined where playback spreads them; without the song one equal stretch per move.
    scrubTicksEl.innerHTML = '';
    var dur = songAudioEl.duration, n = state.formations.length, times = sync ? syncTimes() : null;
    if(!sync || isFinite(dur) && dur > 0) state.formations.forEach(function(f, i){
      var pct = times ? (times[i] === null ? null : times[i] / dur * 100) : n > 1 ? i / (n - 1) * 100 : 0;
      if(pct === null) return;
      var tick = document.createElement('span');
      tick.textContent = i + 1;
      tick.dataset.idx = i;
      tick.title = 'Zu Bild ' + (i + 1) + (f.category ? ' · ' + f.category : '');
      if(times && formationTime(f) === null) tick.className = 'spread';
      tick.style.left = Math.min(100, pct) + '%';
      if(pct < 1 || pct > 99) tick.style.transform = pct < 1 ? 'none' : 'translateX(-100%)'; // keep the end marks inside the dock
      scrubTicksEl.appendChild(tick);
    });
    if(sync) loadWavePeaks();
    if(typeof drawDockTimeline === 'function') drawDockTimeline(); // js/beats.js
    updateBildBar();
    updateFilmMarks(); // js/formations.js
    if(typeof renderDancerView === 'function') renderDancerView(); // js/dancerview.js
  }
  songAudioEl.addEventListener('durationchange', updateSyncBadge);

  /* „Bild auf Takt setzen“ in the dock: held in the middle of a move, the Bild arriving next lands on
     the bar line nearest the playhead; standing on a Bild, its own mark moves onto the nearest one. */
  var bildBarBtn = document.getElementById('bildBarBtn'), bildMarkLabel = document.getElementById('bildMarkLabel'), bildBarShown = '';
  function bildBarTarget(){
    if(!state.song || !state.song.url || !state.music || !music().bars.length) return null; // js/beats.js
    var mid = pausedMidMove(), idx = mid ? mid.fromIdx + 1 : state.activeIndex, f = state.formations[idx];
    var t = mid ? mid.songTime : formationTime(f);
    if(t === null && isSyncActive()) t = syncTimes()[idx];
    var line = t === null || t === undefined ? null : nearestBarLine(t);
    var holder = typeof bildLockHolder === 'function' ? bildLockHolder(f.id) : null; // js/share.js (#2076)
    return line === null || holder ? null : {idx: idx, f: f, t: line};
  }
  function updateBildBar(){
    Array.prototype.forEach.call(scrubTicksEl.children, function(el){ el.classList.toggle('active', +el.dataset.idx === state.activeIndex); });
    var own = formationTime(currentFormation()), ownBar = barLineLabel(own); // js/beats.js
    var mark = own === null ? 'ohne Marke' : (ownBar ? ownBar + ' · ' : '') + formatTime(own, 2);
    var tg = playing ? null : bildBarTarget(), on = tg && formationTime(tg.f) !== null && Math.abs(formationTime(tg.f) - tg.t) < 0.006;
    var text = playing ? 'Bild auf Takt setzen' : !tg ? 'Bild auf Takt setzen' : 'Bild ' + (tg.idx + 1) + (on ? ' steht auf ' : ' auf ') + barLineLabel(tg.t);
    var bars = !!(state.music && music().bars.length);
    var title = !state.song || !state.song.url ? 'Erst unter Musik ein Lied wählen'
      : !bars ? 'Erst unter Musik → Takte & Abschnitte die Takte festlegen'
      : 'Steht die Zeitleiste zwischen zwei Bildern, kommt das nächste an der nächsten Taktgrenze an; steht sie auf einem Bild, rückt seine Marke auf die nächste Taktgrenze.';
    var disabled = playing ? !bars : !tg || on;
    var key = [mark, text, title, disabled].join('|');
    if(key === bildBarShown) return;
    bildBarShown = key;
    bildMarkLabel.textContent = mark;
    bildBarBtn.textContent = text;
    bildBarBtn.disabled = disabled;
    bildBarBtn.title = title;
  }
  bildBarBtn.addEventListener('click', function(){
    if(playing) playPause(); // hold where it is heard: the Bild arriving next lands there
    var tg = bildBarTarget();
    if(!tg) return;
    tg.f.time = snapTime(tg.t);
    selectFormation(tg.idx); // js/formations.js — saves, and list, timeline and stage show it there
  });

  // Time markers should climb in Bild order. When they don't — hand-entered out of sequence, or a
  // filmstrip reorder scrambled them — sync playback jumps around between Bilder (syncWaypoints()
  // sorts by time, not by Bild index). We don't block it, just flag it: a banner + red rows here,
  // and a dot on the toolbar Marker button so it shows with the modal closed.
  function updateMarkerWarnings(){
    var issues = markerOrderIssues();
    var bad = {};
    issues.forEach(function(is){ bad[is.idx] = true; });
    if(markerListEl){
      // Unmarked Bilder show in grey where sync playback spreads them to (syncTimes, js/stage.js).
      var times = isSyncActive() ? syncTimes() : [];
      Array.prototype.forEach.call(markerListEl.querySelectorAll('.marker-row:not(.marker-row--between)'), function(row, i){
        row.classList.toggle('marker-row--warn', !!bad[i]);
        row.querySelector('.marker-time-input').placeholder = times[i] != null ? formatTime(times[i], 2) : 'mm:ss';
        var bar = row.querySelector('.marker-bar'), label = barLineLabel(formationTime(state.formations[i])); // js/beats.js (#2180)
        bar.textContent = label;
        bar.title = label ? 'Taktgrenze: Takt davor | Takt danach' : '';
      });
      // A Zwischenposition's time is a share of its move (sanitizeBetweenAt), so it follows its Bilder.
      Array.prototype.forEach.call(markerListEl.querySelectorAll('.marker-row--between'), function(row){
        var fIdx = +row.dataset.f, bIdx = +row.dataset.b, b = ((state.formations[fIdx] || {}).betweens || [])[bIdx];
        if(!b || fIdx >= state.formations.length - 1) return;
        var span = betweenTimeSpan(fIdx), at = sanitizeBetweenAt(b.at), input = row.querySelector('.marker-time-input');
        input.value = at === null ? '' : formatBetweenAt(fIdx, at);
        input.placeholder = formatBetweenAt(fIdx, betweenTimes(fIdx)[bIdx]);
        var holder = typeof bildLockHolder === 'function' ? bildLockHolder(state.formations[fIdx].id) : null; // #2076
        input.disabled = row.querySelector('.marker-now-btn').disabled = !span || !!holder;
        Array.prototype.forEach.call(row.querySelectorAll('.marker-nudge-btn'), function(btn){ btn.disabled = input.disabled; });
        row.querySelector('.marker-clear-btn').hidden = at === null || !!holder;
        row.title = holder ? (holder.author || 'Jemand') + ' bearbeitet gerade dieses Bild' : span ? '' : 'Erst den beiden Bildern drumherum eine Zeitmarke geben';
      });
    }
    if(markerBtn){
      markerBtn.classList.toggle('has-warning', issues.length > 0);
      markerBtn.title = issues.length ? 'Zeitmarken nicht in Bild-Reihenfolge' : '';
    }
    if(markerOrderWarning){
      if(issues.length){
        var f = issues[0];
        markerOrderWarning.textContent = 'Zeitmarken sind nicht in Bild-Reihenfolge — die Wiedergabe '
          + 'springt dann zwischen den Bildern. Bild ' + (f.idx + 1) + ' hat keinen späteren Zeitpunkt '
          + 'als Bild ' + (f.prevIdx + 1) + '.';
        markerOrderWarning.hidden = false;
      }else{
        markerOrderWarning.hidden = true;
      }
    }
    updateSyncBadge();
  }

  function renderMarkerList(){
    markerListEl.innerHTML = '';
    var lastCategory = '';
    state.formations.forEach(function(f, idx){
      // Tanzgrenzen wie in der Schritte-PDF: Überschrift, wo ein neuer Abschnitt beginnt (#2066).
      var cat = categoryLabelAt(idx);
      if(cat && cat !== lastCategory){
        var head = document.createElement('div');
        head.className = 'marker-section';
        head.textContent = cat;
        markerListEl.appendChild(head);
      }
      lastCategory = cat;
      var row = document.createElement('div');
      row.className = 'marker-row';

      var badge = document.createElement('span');
      badge.className = 'marker-badge';
      badge.textContent = String(idx+1).padStart(2,'0');

      var name = document.createElement('span');
      name.className = 'marker-name';
      name.textContent = f.name;

      var timeInput = document.createElement('input');
      timeInput.type = 'text';
      timeInput.className = 'marker-time-input';
      timeInput.placeholder = 'mm:ss';
      timeInput.value = formatTime(formationTime(f), 2);
      timeInput.setAttribute('aria-label', 'Zeitpunkt für ' + f.name);

      var clearBtn = document.createElement('button');
      clearBtn.className = 'btn-ghost danger marker-clear-btn';
      clearBtn.type = 'button';
      clearBtn.appendChild(svgIcon('x', 14));
      clearBtn.setAttribute('aria-label', 'Marke entfernen');
      clearBtn.title = 'Marke entfernen';
      clearBtn.hidden = formationTime(f) === null;
      clearBtn.addEventListener('click', function(){
        confirmDelete('Zeitmarke von „' + f.name + '“ entfernen?', function(){
          f.time = undefined;
          timeInput.value = '';
          clearBtn.hidden = true;
          saveState();
          renderMarkerTimeline();
          updateMarkerWarnings();
        }, clearBtn, 'Entfernen');
      });

      function setTime(sec){
        if(sec === null){ f.time = undefined; timeInput.value = ''; clearBtn.hidden = true; }
        else{ f.time = Math.max(0, snapTime(sec)); timeInput.value = formatTime(f.time, 2); clearBtn.hidden = false; }
        saveState();
        renderMarkerTimeline();
        updateMarkerWarnings();
      }
      timeInput.addEventListener('change', function(){ setTime(parseTimeInput(timeInput.value)); });

      var nowBtn = document.createElement('button');
      nowBtn.className = 'btn-ghost marker-now-btn';
      nowBtn.type = 'button';
      nowBtn.textContent = 'Jetzt';
      nowBtn.title = 'Auf aktuelle Abspielposition setzen';
      nowBtn.addEventListener('click', function(){
        setTime(bildSnap(heardSongTime())); // js/playback.js — minus the Bluetooth delay (#2059); js/beats.js — on a bar line (#2180)
      });

      var bar = document.createElement('span');
      bar.className = 'marker-time marker-bar';

      row.appendChild(badge);
      row.appendChild(name);
      row.appendChild(bar);
      row.appendChild(timeInput);
      appendNudgeButtons(row, function(){
        var t = formationTime(f);
        return t !== null ? t : isSyncActive() ? syncTimes()[state.formations.indexOf(f)] : null;
      }, setTime, true);
      row.appendChild(nowBtn);
      row.appendChild(clearBtn);
      markerListEl.appendChild(row);
      if(idx < state.formations.length - 1) (f.betweens || []).forEach(function(b, bIdx){
        markerListEl.appendChild(buildBetweenMarkerRow(idx, bIdx, b));
      });
    });
    updateMarkerWarnings();
  }

  // A Zwischenposition of the move out of Bild fIdx, timed in the song between that Bild's marker
  // and the next one's (#2068). Values are filled in by updateMarkerWarnings.
  function buildBetweenMarkerRow(fIdx, bIdx, b){
    var row = document.createElement('div');
    row.className = 'marker-row marker-row--between';
    row.dataset.f = fIdx;
    row.dataset.b = bIdx;

    var badge = document.createElement('span');
    badge.className = 'marker-badge';
    badge.textContent = (fIdx+1) + '.' + (bIdx+1);

    var name = document.createElement('span');
    name.className = 'marker-name';
    name.textContent = b.name || 'Zwischenposition ' + (bIdx+1);

    var timeInput = document.createElement('input');
    timeInput.type = 'text';
    timeInput.className = 'marker-time-input';
    timeInput.setAttribute('aria-label', 'Zeitpunkt für ' + name.textContent);

    var nowBtn = document.createElement('button');
    nowBtn.className = 'btn-ghost marker-now-btn';
    nowBtn.type = 'button';
    nowBtn.textContent = 'Jetzt';
    nowBtn.title = 'Auf aktuelle Abspielposition setzen';

    var clearBtn = document.createElement('button');
    clearBtn.className = 'btn-ghost danger marker-clear-btn';
    clearBtn.type = 'button';
    clearBtn.appendChild(svgIcon('x', 14));
    clearBtn.setAttribute('aria-label', 'Marke entfernen');
    clearBtn.title = 'Marke entfernen (dann gleichmäßig verteilt)';

    function setTime(sec){
      var span = betweenTimeSpan(fIdx);
      if(sec === null) setBetweenAt(fIdx, bIdx, null);
      else if(span) setBetweenAt(fIdx, bIdx, (sec - span.t0) / (span.t1 - span.t0));
      updateMarkerWarnings();
    }
    timeInput.addEventListener('change', function(){ setTime(parseTimeInput(timeInput.value)); });
    nowBtn.addEventListener('click', function(){ setTime(beatSnap(heardSongTime())); });
    clearBtn.addEventListener('click', function(){ setTime(null); });

    row.appendChild(badge);
    row.appendChild(name);
    row.appendChild(timeInput);
    appendNudgeButtons(row, function(){
      var span = betweenTimeSpan(fIdx), at = sanitizeBetweenAt(b.at);
      return span ? span.t0 + (span.t1 - span.t0) * (at !== null ? at : betweenTimes(fIdx)[bIdx]) : null;
    }, setTime);
    row.appendChild(nowBtn);
    row.appendChild(clearBtn);
    return row;
  }

  // ±0,01 s next to a mark's field (#2091), from its time or where playback spreads it to; a Bild
  // (bild) inside the bars a whole bar, from bar line to bar line (#2180). The play position
  // follows, so the zoomed timeline shows the mark and play starts right there.
  function appendNudgeButtons(row, getTime, setTime, bild){
    [[-0.01, '−', 'früher'], [0.01, '+', 'später']].forEach(function(n){
      var btn = document.createElement('button');
      btn.className = 'btn-ghost marker-nudge-btn';
      btn.type = 'button';
      btn.textContent = n[1];
      btn.title = (bild ? 'Einen Takt (ohne Takte 0,01 s) ' : '0,01 s ') + n[2];
      btn.setAttribute('aria-label', btn.title);
      btn.addEventListener('click', function(){
        var t = getTime();
        if(t === null || t === undefined) return;
        var line = bild ? stepBarLine(t, n[0] > 0 ? 1 : -1) : null;
        t = Math.max(0, snapTime(line !== null ? line : t + n[0]));
        setTime(t);
        if(songAudioEl.paused){ songAudioEl.currentTime = t; showInMarkerView(t); }
      });
      row.appendChild(btn);
    });
  }

  /* Zoom (#2091): the timeline shows markerSpan seconds from markerViewStart, or the whole song. */
  var markerSpan = null, markerViewStart = 0, markerZoomSong = null;
  function songDur(){ return (isFinite(songAudioEl.duration) && songAudioEl.duration > 0) ? songAudioEl.duration : 0; }
  function markerView(){
    var dur = songDur();
    if(!markerSpan || markerSpan >= dur) return {t0: 0, t1: dur};
    markerViewStart = Math.min(Math.max(0, markerViewStart), dur - markerSpan);
    return {t0: markerViewStart, t1: markerViewStart + markerSpan};
  }
  function markerPct(t){
    var v = markerView();
    return v.t1 > v.t0 ? (t - v.t0) / (v.t1 - v.t0) * 100 : 0;
  }
  // factor < 1 zooms in; `at` (s) stays where it is on screen.
  function zoomMarkerTimeline(factor, at){
    var dur = songDur();
    if(!dur) return;
    var v = markerView(), span = Math.max(2, Math.min(dur, (v.t1 - v.t0) * factor));
    markerViewStart = at - (at - v.t0) / (v.t1 - v.t0) * span;
    markerSpan = span >= dur ? null : span;
    renderMarkerTimeline();
    updateMarkerPlayheadUI();
  }
  function showInMarkerView(t){
    var v = markerView();
    if(markerSpan && (t < v.t0 || t > v.t1)){ markerViewStart = t - markerSpan / 2; renderMarkerTimeline(); }
    updateMarkerPlayheadUI();
  }

  // Waveform behind the timeline: the loudest sample per 1/200 s, from a copy decoded at 8 kHz —
  // enough to see where the music hits, without keeping the decoded song in memory.
  var WAVE_RATE = 200;
  var markerTimelineWave = document.getElementById('markerTimelineWave');
  var wavePeaks = null, wavePeaksFor = null;
  function loadWavePeaks(){
    var song = state.song;
    if(!song || !song.blob || wavePeaksFor === song.blob) return;
    wavePeaksFor = song.blob;
    wavePeaks = null;
    song.blob.arrayBuffer().then(function(buf){
      return new OfflineAudioContext(1, 1, 8000).decodeAudioData(buf);
    }).then(function(audio){
      if(wavePeaksFor !== song.blob) return;
      var step = audio.sampleRate / WAVE_RATE, data = new Float32Array(Math.ceil(audio.length / step)), max = 0;
      for(var c = 0; c < audio.numberOfChannels; c++){
        var ch = audio.getChannelData(c);
        for(var i = 0; i < ch.length; i++){
          var k = (i / step) | 0, a = Math.abs(ch[i]);
          if(a > data[k]){ data[k] = a; if(a > max) max = a; }
        }
      }
      wavePeaks = {data: data, max: max || 1};
      drawMarkerWave();
      if(typeof drawDockTimeline === 'function') drawDockTimeline(); // js/beats.js
    }).catch(function(err){ console.warn('Wellenform nicht verfügbar', err); });
  }
  function drawMarkerWave(){
    var w = markerTimelineWave.clientWidth, h = markerTimelineWave.clientHeight, dpr = window.devicePixelRatio || 1;
    markerTimelineWave.width = Math.round(w * dpr); markerTimelineWave.height = Math.round(h * dpr);
    var g = markerTimelineWave.getContext('2d'), W = markerTimelineWave.width, H = markerTimelineWave.height, v = markerView();
    g.clearRect(0, 0, W, H);
    if(!wavePeaks || v.t1 <= v.t0) return;
    g.fillStyle = getComputedStyle(markerTimelineWave).color;
    var d = wavePeaks.data, perPx = (v.t1 - v.t0) / W * WAVE_RATE;
    for(var x = 0; x < W; x++){
      var k0 = Math.floor((v.t0 * WAVE_RATE) + x * perPx), k1 = Math.max(k0 + 1, Math.floor((v.t0 * WAVE_RATE) + (x + 1) * perPx)), m = 0;
      for(var k = k0; k < k1 && k < d.length; k++) if(d[k] > m) m = d[k];
      var bar = m / wavePeaks.max * H * 0.9;
      g.fillRect(x, (H - bar) / 2, 1, Math.max(1, bar));
    }
  }

  function renderMarkerTimeline(){
    var dur = songDur();
    markerTimelineFlags.innerHTML = '';
    renderBeats(); // js/beats.js — ticks and tempo follow the marks and Abschnitte
    drawMarkerWave();
    if(dur <= 0) return;
    state.formations.forEach(function(f, idx){
      var t = formationTime(f), pct = t === null ? -1 : markerPct(t);
      if(pct < -0.5 || pct > 100.5) return;
      var flag = document.createElement('div');
      flag.className = 'timeline-flag';
      flag.style.left = pct + '%';
      flag.textContent = String(idx+1);
      flag.title = f.name + ' — ' + formatTime(t, 2);
      markerTimelineFlags.appendChild(flag);
    });
  }

  function updateMarkerPlayheadUI(){
    var dur = songDur(), ct = songAudioEl.currentTime, v = markerView();
    // Zoomed in, playback turns the page once the head runs off the end.
    if(markerSpan && !songAudioEl.paused && (ct < v.t0 || ct > v.t1)){ markerViewStart = ct - markerSpan * 0.05; renderMarkerTimeline(); }
    var pct = Math.min(100, Math.max(0, markerPct(ct)));
    markerTimelinePlayed.style.width = pct + '%';
    markerTimelineHead.style.left = pct + '%';
    markerTimelineHead.hidden = ct < markerView().t0 || ct > markerView().t1;
    markerTimeReadout.textContent = formatTime(ct) + ' / ' + (dur > 0 ? formatTime(dur) : '0:00');
  }
  // timeupdate comes only a few times a second — too jumpy for a zoomed-in timeline.
  function markerPlayFrame(){
    if(markerBackdrop.hidden || songAudioEl.paused) return;
    updateMarkerPlayheadUI();
    requestAnimationFrame(markerPlayFrame);
  }

  songAudioEl.addEventListener('timeupdate', updateMarkerPlayheadUI);
  songAudioEl.addEventListener('play', function(){ requestAnimationFrame(markerPlayFrame); });
  songAudioEl.addEventListener('durationchange', function(){
    if(state.song && state.song.blob !== markerZoomSong){ markerSpan = null; markerZoomSong = state.song.blob; } // another song
    updateMarkerPlayheadUI();
    renderMarkerTimeline();
    updateMarkerWarnings(); // the song length places the Bilder after the last marker
  });
  songAudioEl.addEventListener('play', function(){ if(!markerBackdrop.hidden){ markerIconPlay.hidden = true; markerIconPause.hidden = false; } });
  songAudioEl.addEventListener('pause', function(){ if(!markerBackdrop.hidden){ markerIconPlay.hidden = false; markerIconPause.hidden = true; } });

  markerPlayBtn.addEventListener('click', function(){
    if(!state.song || !state.song.url) return;
    if(songAudioEl.paused) songAudioEl.play().catch(function(){});
    else songAudioEl.pause();
  });

  function markerTimeAt(clientX){
    var rect = markerTimelineEl.getBoundingClientRect(), v = markerView();
    return v.t0 + Math.min(1, Math.max(0, (clientX - rect.left)/rect.width)) * (v.t1 - v.t0);
  }
  markerTimelineEl.addEventListener('click', function(e){
    if(!songDur()) return;
    songAudioEl.currentTime = markerTimeAt(e.clientX);
    updateMarkerPlayheadUI();
  });
  // Mausrad over the timeline (#2159; also Strg/Cmd + Mausrad and a trackpad pinch) zooms around the
  // pointer; sideways scrolling or Shift + Mausrad moves along.
  markerTimelineEl.addEventListener('wheel', function(e){
    if(!songDur()) return;
    var dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
    if(e.ctrlKey || e.metaKey || (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX))){
      e.preventDefault();
      // deltaMode 1 (Firefox) counts lines, not pixels
      zoomMarkerTimeline(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.3 : 0.01)), markerTimeAt(e.clientX));
      return;
    }
    if(!markerSpan || !dx) return;
    e.preventDefault();
    markerViewStart += dx / markerTimelineEl.clientWidth * markerSpan;
    renderMarkerTimeline();
    updateMarkerPlayheadUI();
  }, {passive: false});
  document.getElementById('markerZoomInBtn').addEventListener('click', function(){ zoomMarkerTimeline(1 / 2.5, songAudioEl.currentTime); });
  document.getElementById('markerZoomOutBtn').addEventListener('click', function(){ zoomMarkerTimeline(2.5, songAudioEl.currentTime); });
  window.addEventListener('resize', function(){ if(!markerBackdrop.hidden) drawMarkerWave(); });

  function openMarkerModal(){
    pausePlayback();
    var hasSong = !!(state.song && state.song.url);
    markerNoSongHint.hidden = hasSong;
    markerSongArea.hidden = !hasSong;
    markerBackdrop.hidden = false; // first, so the beat ticks canvas has a width
    if(hasSong){
      loadWavePeaks();
      renderMarkerList();
      renderMarkerTimeline();
      updateMarkerPlayheadUI();
      updateMarkerWarnings();
    }
  }
  function closeMarkerModal(){
    songAudioEl.pause();
    markerBackdrop.hidden = true;
  }
  markerBtn.addEventListener('click', openMarkerModal);
  markerCloseBtn.addEventListener('click', closeMarkerModal);
  markerBackdrop.addEventListener('click', function(e){ if(e.target === markerBackdrop) closeMarkerModal(); });

