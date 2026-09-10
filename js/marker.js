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
    syncBadge.hidden = !isSyncActive();
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
      Array.prototype.forEach.call(markerListEl.children, function(row, i){
        row.classList.toggle('marker-row--warn', !!bad[i]);
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
    state.formations.forEach(function(f, idx){
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
      clearBtn.textContent = '✕';
      clearBtn.title = 'Marke entfernen';
      clearBtn.hidden = formationTime(f) === null;
      clearBtn.addEventListener('click', function(){
        f.time = undefined;
        timeInput.value = '';
        clearBtn.hidden = true;
        saveState();
        renderMarkerTimeline();
        updateMarkerWarnings();
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
        f.time = snapTime(songAudioEl.currentTime);
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
    });
    updateMarkerWarnings();
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

  document.getElementById('axesBildToggle').addEventListener('change', function(e){
    currentFormation().showAxes = e.target.checked;
    renderAxes();
    saveState();
  });

  document.getElementById('addAxisBtn').addEventListener('click', function(){
    state.axes.push({id: uid('ax'), x1:0, y1:-7, x2:0, y2:7, label:'Achse ' + (state.axes.length+1)});
    renderAxesList();
    renderAxes();
    saveState();
  });

  document.getElementById('addLocalAxisBtn').addEventListener('click', function(){
    var f = currentFormation();
    if(!Array.isArray(f.localAxes)) f.localAxes = [];
    var local = f.localAxes;
    local.push({id: uid('ax'), x1:0, y1:-7, x2:0, y2:7, label:'Achse ' + (local.length+1)});
    renderAxesList();
    renderAxes();
    saveState();
  });

  // Shared row UI for both the global (state.axes) and per-Bild-only (currentFormation().localAxes)
  // lists below — same label/coordinate/delete controls either way, just backed by a different
  // array via the onDelete callback.
  function buildAxisRow(ax, onDelete){
    var row = document.createElement('div');
    row.className = 'axis-row';

    var labelInput = document.createElement('input');
    labelInput.className = 'axis-label-input';
    labelInput.value = ax.label || '';
    labelInput.placeholder = 'Bezeichnung';
    labelInput.setAttribute('aria-label', 'Bezeichnung der Achse');
    labelInput.addEventListener('input', function(){ ax.label = labelInput.value; renderAxes(); saveStateDebounced(); });

    var coordWrap = document.createElement('div');
    coordWrap.className = 'axis-coords';
    ['x1','y1','x2','y2'].forEach(function(key){
      var lab = document.createElement('span');
      lab.className = 'coord-label';
      lab.textContent = key.toUpperCase();
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'coord-input';
      inp.step = '0.5'; inp.min = GRID_MIN; inp.max = GRID_MAX;
      inp.value = roundNum(ax[key]);
      inp.setAttribute('aria-label', key + ' der Achse ' + (ax.label||''));
      inp.addEventListener('input', function(){
        ax[key] = clampGrid(parseFloat(inp.value)||0);
        renderAxes();
        saveStateDebounced();
      });
      coordWrap.appendChild(lab);
      coordWrap.appendChild(inp);
    });

    var del = document.createElement('button');
    del.className = 'remove-btn';
    del.type = 'button';
    del.textContent = '✕';
    del.setAttribute('aria-label', 'Achse entfernen');
    del.addEventListener('click', onDelete);

    row.appendChild(labelInput);
    row.appendChild(coordWrap);
    row.appendChild(del);
    return row;
  }

  function renderAxesList(){
    var listEl = document.getElementById('axesList');
    listEl.innerHTML = '';
    state.axes.forEach(function(ax){
      listEl.appendChild(buildAxisRow(ax, function(){
        state.axes = state.axes.filter(function(a){ return a.id !== ax.id; });
        renderAxesList();
        renderAxes();
        saveState();
      }));
    });

    var localListEl = document.getElementById('localAxesList');
    var localTitleEl = document.getElementById('localAxesTitle');
    if(localTitleEl) localTitleEl.textContent = 'Achsen — nur für dieses Bild';
    localListEl.innerHTML = '';
    (currentFormation().localAxes || []).forEach(function(ax){
      localListEl.appendChild(buildAxisRow(ax, function(){
        var f = currentFormation();
        f.localAxes = f.localAxes.filter(function(a){ return a.id !== ax.id; });
        renderAxesList();
        renderAxes();
        saveState();
      }));
    });
  }
