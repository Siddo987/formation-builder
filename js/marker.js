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
    // The marked Bilder as ticks on the playbar timeline, which spans the song in sync (#2054).
    scrubTicksEl.innerHTML = '';
    var dur = songAudioEl.duration;
    if(!sync || !isFinite(dur) || dur <= 0) return;
    markerWaypoints().forEach(function(w){
      var tick = document.createElement('span');
      tick.style.left = Math.min(100, w.time/dur*100) + '%';
      scrubTicksEl.appendChild(tick);
    });
  }

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
        setTime(beatSnap(heardSongTime())); // js/playback.js — minus the Bluetooth delay (#2059)
      });

      row.appendChild(badge);
      row.appendChild(name);
      row.appendChild(timeInput);
      appendNudgeButtons(row, function(){
        var t = formationTime(f);
        return t !== null ? t : isSyncActive() ? syncTimes()[state.formations.indexOf(f)] : null;
      }, setTime);
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

  // ±0,01 s next to a mark's field (#2091), from its time or where playback spreads it to. The play
  // position follows, so the zoomed timeline shows the mark and play starts right there.
  function appendNudgeButtons(row, getTime, setTime){
    [[-0.01, '−', 'früher'], [0.01, '+', 'später']].forEach(function(n){
      var btn = document.createElement('button');
      btn.className = 'btn-ghost marker-nudge-btn';
      btn.type = 'button';
      btn.textContent = n[1];
      btn.title = '0,01 s ' + n[2];
      btn.setAttribute('aria-label', btn.title);
      btn.addEventListener('click', function(){
        var t = getTime();
        if(t === null || t === undefined) return;
        t = Math.max(0, snapTime(t + n[0]));
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
  // Strg/Cmd + Mausrad (and a trackpad pinch) zoom around the pointer; sideways scrolling moves along.
  markerTimelineEl.addEventListener('wheel', function(e){
    if(!songDur()) return;
    if(e.ctrlKey || e.metaKey){
      e.preventDefault();
      zoomMarkerTimeline(Math.exp(e.deltaY * 0.01), markerTimeAt(e.clientX));
      return;
    }
    var dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
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

