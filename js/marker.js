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

  function formatTime(sec){
    if(sec === null || sec === undefined || !isFinite(sec)) return '';
    sec = Math.max(0, sec);
    var m = Math.floor(sec/60);
    var s = sec - m*60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
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
        row.querySelector('.marker-time-input').placeholder = times[i] != null ? formatTime(times[i]) : 'mm:ss';
      });
      // A Zwischenposition's time is a share of its move (sanitizeBetweenAt), so it follows its Bilder.
      Array.prototype.forEach.call(markerListEl.querySelectorAll('.marker-row--between'), function(row){
        var fIdx = +row.dataset.f, bIdx = +row.dataset.b, b = ((state.formations[fIdx] || {}).betweens || [])[bIdx];
        if(!b || fIdx >= state.formations.length - 1) return;
        var span = betweenTimeSpan(fIdx), at = sanitizeBetweenAt(b.at), input = row.querySelector('.marker-time-input');
        input.value = at === null ? '' : formatBetweenAt(fIdx, at);
        input.placeholder = formatBetweenAt(fIdx, betweenTimes(fIdx)[bIdx]);
        input.disabled = row.querySelector('.marker-now-btn').disabled = !span;
        row.querySelector('.marker-clear-btn').hidden = at === null;
        row.title = span ? '' : 'Erst den beiden Bildern drumherum eine Zeitmarke geben';
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
      timeInput.value = formatTime(formationTime(f));
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

      timeInput.addEventListener('change', function(){
        var parsed = parseTimeInput(timeInput.value);
        if(parsed === null){ f.time = undefined; timeInput.value = ''; clearBtn.hidden = true; }
        else{ f.time = Math.max(0, snapTime(parsed)); timeInput.value = formatTime(f.time); clearBtn.hidden = false; }
        saveState();
        renderMarkerTimeline();
        updateMarkerWarnings();
      });

      var nowBtn = document.createElement('button');
      nowBtn.className = 'btn-ghost marker-now-btn';
      nowBtn.type = 'button';
      nowBtn.textContent = 'Jetzt';
      nowBtn.title = 'Auf aktuelle Abspielposition setzen';
      nowBtn.addEventListener('click', function(){
        f.time = snapTime(heardSongTime()); // js/playback.js — minus the Bluetooth delay (#2059)
        timeInput.value = formatTime(f.time);
        clearBtn.hidden = false;
        saveState();
        renderMarkerTimeline();
        updateMarkerWarnings();
      });

      row.appendChild(badge);
      row.appendChild(name);
      row.appendChild(timeInput);
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
    nowBtn.addEventListener('click', function(){ setTime(heardSongTime()); });
    clearBtn.addEventListener('click', function(){ setTime(null); });

    row.appendChild(badge);
    row.appendChild(name);
    row.appendChild(timeInput);
    row.appendChild(nowBtn);
    row.appendChild(clearBtn);
    return row;
  }

  function renderMarkerTimeline(){
    var dur = (isFinite(songAudioEl.duration) && songAudioEl.duration > 0) ? songAudioEl.duration : 0;
    markerTimelineFlags.innerHTML = '';
    if(dur <= 0) return;
    state.formations.forEach(function(f, idx){
      var t = formationTime(f);
      if(t === null) return;
      var flag = document.createElement('div');
      flag.className = 'timeline-flag';
      flag.style.left = Math.min(100, (t/dur)*100) + '%';
      flag.textContent = String(idx+1);
      flag.title = f.name + ' — ' + formatTime(t);
      markerTimelineFlags.appendChild(flag);
    });
  }

  function updateMarkerPlayheadUI(){
    var dur = songAudioEl.duration;
    var ct = songAudioEl.currentTime;
    var pct = (isFinite(dur) && dur > 0) ? Math.min(100, (ct/dur)*100) : 0;
    markerTimelinePlayed.style.width = pct + '%';
    markerTimelineHead.style.left = pct + '%';
    markerTimeReadout.textContent = formatTime(ct) + ' / ' + (isFinite(dur) && dur > 0 ? formatTime(dur) : '0:00');
  }

  songAudioEl.addEventListener('timeupdate', updateMarkerPlayheadUI);
  songAudioEl.addEventListener('loadedmetadata', function(){
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

  markerTimelineEl.addEventListener('click', function(e){
    var dur = songAudioEl.duration;
    if(!isFinite(dur) || dur <= 0) return;
    var rect = markerTimelineEl.getBoundingClientRect();
    var frac = Math.min(1, Math.max(0, (e.clientX - rect.left)/rect.width));
    songAudioEl.currentTime = frac*dur;
    updateMarkerPlayheadUI();
  });

  function openMarkerModal(){
    pausePlayback();
    var hasSong = !!(state.song && state.song.url);
    markerNoSongHint.hidden = hasSong;
    markerSongArea.hidden = !hasSong;
    if(hasSong){
      renderMarkerList();
      renderMarkerTimeline();
      updateMarkerPlayheadUI();
      updateMarkerWarnings();
    }
    markerBackdrop.hidden = false;
  }
  function closeMarkerModal(){
    songAudioEl.pause();
    markerBackdrop.hidden = true;
  }
  markerBtn.addEventListener('click', openMarkerModal);
  markerCloseBtn.addEventListener('click', closeMarkerModal);
  markerBackdrop.addEventListener('click', function(e){ if(e.target === markerBackdrop) closeMarkerModal(); });

