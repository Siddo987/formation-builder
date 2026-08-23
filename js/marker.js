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
  var markerTimelineTicks = document.getElementById('markerTimelineTicks');
  var markerTimelineFlags = document.getElementById('markerTimelineFlags');
  var markerTimelineHead = document.getElementById('markerTimelineHead');
  var markerListEl = document.getElementById('markerList');
  var syncBadge = document.getElementById('syncBadge');
  var detectBeatsBtn = document.getElementById('detectBeatsBtn');
  var detectStatus = document.getElementById('detectStatus');
  var beatsPerBarRow = document.getElementById('beatsPerBarRow');
  var beatsPerBarSelect = document.getElementById('beatsPerBarSelect');
  var distributeBtn = document.getElementById('distributeBtn');
  var snapRow = document.getElementById('snapRow');
  var snapToggle = document.getElementById('snapToggle');

  var beatData = null; // {bpm, beatTimes:[...], beatsPerBar, duration}

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
    if(snapToggle.checked && beatData && beatData.beatTimes.length){
      var nearest = beatData.beatTimes[0], bestD = Infinity;
      beatData.beatTimes.forEach(function(bt){
        var d = Math.abs(bt-t);
        if(d < bestD){ bestD = d; nearest = bt; }
      });
      return nearest;
    }
    return Math.round(t*100)/100;
  }

  function updateSyncBadge(){
    syncBadge.hidden = !isSyncActive();
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
        updateSyncBadge();
      });

      timeInput.addEventListener('change', function(){
        var parsed = parseTimeInput(timeInput.value);
        if(parsed === null){ f.time = undefined; timeInput.value = ''; clearBtn.hidden = true; }
        else{ f.time = Math.max(0, snapTime(parsed)); timeInput.value = formatTime(f.time); clearBtn.hidden = false; }
        saveState();
        renderMarkerTimeline();
        updateSyncBadge();
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
        updateSyncBadge();
      });

      row.appendChild(badge);
      row.appendChild(name);
      row.appendChild(timeInput);
      row.appendChild(nowBtn);
      row.appendChild(clearBtn);
      markerListEl.appendChild(row);
    });
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

  function renderBeatTicks(){
    markerTimelineTicks.innerHTML = '';
    var dur = (isFinite(songAudioEl.duration) && songAudioEl.duration > 0) ? songAudioEl.duration : 0;
    if(!beatData || !beatData.beatTimes.length || dur <= 0) return;
    beatData.beatTimes.forEach(function(t, i){
      var tick = document.createElement('div');
      var isBar = (i % beatData.beatsPerBar) === 0;
      tick.className = 'beat-tick' + (isBar ? ' bar-tick' : '');
      tick.style.left = Math.min(100, (t/dur)*100) + '%';
      markerTimelineTicks.appendChild(tick);
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
    renderBeatTicks();
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

  function resetBeatData(){
    beatData = null;
    detectStatus.textContent = '';
    beatsPerBarRow.hidden = true;
    snapRow.hidden = true;
    snapToggle.checked = false;
    renderBeatTicks();
  }

  function openMarkerModal(){
    pausePlayback();
    var hasSong = !!(state.song && state.song.url);
    markerNoSongHint.hidden = hasSong;
    markerSongArea.hidden = !hasSong;
    if(hasSong){
      renderMarkerList();
      renderMarkerTimeline();
      renderBeatTicks();
      updateMarkerPlayheadUI();
      updateSyncBadge();
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

  /* ---------- automatic beat/bar detection (offline signal analysis, no server/AI service involved) ---------- */

  function boxFilter(arr, win){
    var n = arr.length;
    var out = new Float32Array(n);
    var half = Math.max(0, Math.floor(win/2));
    var prefix = new Float64Array(n+1);
    for(var i=0; i<n; i++) prefix[i+1] = prefix[i] + arr[i];
    for(var j=0; j<n; j++){
      var lo = Math.max(0, j-half), hi = Math.min(n-1, j+half);
      out[j] = (prefix[hi+1]-prefix[lo]) / (hi-lo+1);
    }
    return out;
  }

  function analyzeEnvelope(samples, sampleRate, duration){
    var n = samples.length;
    var rect = new Float32Array(n);
    for(var i=0; i<n; i++) rect[i] = Math.abs(samples[i]);

    var smooth = boxFilter(rect, Math.max(1, Math.round(sampleRate*0.025)));
    var baseline = boxFilter(smooth, Math.max(1, Math.round(sampleRate*0.4)));

    var minGap = Math.round(sampleRate*0.24);
    var peaks = [];
    var lastPeak = -minGap;
    for(var j=1; j<n-1; j++){
      var thresh = baseline[j]*1.4 + 0.0005;
      if(smooth[j] > thresh && smooth[j] >= smooth[j-1] && smooth[j] >= smooth[j+1] && (j-lastPeak) >= minGap){
        peaks.push(j/sampleRate);
        lastPeak = j;
      }
    }
    if(peaks.length < 4) return { bpm:null, beatTimes:[], beatsPerBar:4, duration:duration };

    var tracked = trackBeats(peaks, duration);
    if(tracked.beatTimes.length < 4) return { bpm:null, beatTimes:[], beatsPerBar:4, duration:duration };

    var bpms = tracked.periods.map(function(p){ return 60/p; }).filter(function(b){ return isFinite(b) && b > 0; });
    if(!bpms.length) return { bpm:null, beatTimes:[], beatsPerBar:4, duration:duration };
    var avgBpm = bpms.reduce(function(a,b){ return a+b; }, 0) / bpms.length;
    var minBpm = Math.min.apply(null, bpms), maxBpm = Math.max.apply(null, bpms);
    var bpmRange = (maxBpm - minBpm > 6) ? [Math.round(minBpm), Math.round(maxBpm)] : null;

    return {
      bpm: Math.round(avgBpm*10)/10,
      bpmRange: bpmRange,
      beatTimes: tracked.beatTimes,
      beatsPerBar: 4,
      duration: duration
    };
  }

  // Estimates one representative beat period (seconds) from a set of onset times,
  // by folding inter-onset intervals into a plausible tempo range and taking the
  // most common interval (10ms buckets).
  function estimatePeriod(somePeaks){
    if(somePeaks.length < 2) return null;
    var intervals = [];
    for(var k=1; k<somePeaks.length; k++){
      var iv = somePeaks[k]-somePeaks[k-1];
      if(iv < 0.15 || iv > 2.4) continue;
      while(iv > 1.0) iv /= 2;
      while(iv < 0.3) iv *= 2;
      intervals.push(iv);
    }
    if(!intervals.length) return null;
    var buckets = {};
    intervals.forEach(function(iv){
      var key = Math.round(iv*100);
      buckets[key] = (buckets[key]||0) + 1;
    });
    var bestKey = null, bestCount = -1;
    Object.keys(buckets).forEach(function(k2){
      if(buckets[k2] > bestCount){ bestCount = buckets[k2]; bestKey = k2; }
    });
    var period = parseInt(bestKey,10)/100;
    var bpm = 60/period;
    while(bpm < 80) bpm *= 2;
    while(bpm > 160) bpm /= 2;
    return 60/bpm;
  }

  // Follows the tempo through the song instead of assuming one fixed BPM throughout:
  // starts from a local tempo estimate, then repeatedly predicts the next beat and
  // locks onto the nearest real onset near that prediction (adapting the running
  // period toward it), so accelerandi/ritardandi and tempo changes between sections
  // are tracked rather than washed into a single average.
  function trackBeats(peaks, duration){
    var seed = peaks.filter(function(p){ return p <= 8; });
    if(seed.length < 4) seed = peaks.slice(0, Math.min(peaks.length, 8));
    var period = estimatePeriod(seed) || estimatePeriod(peaks);
    if(!period) return { beatTimes: [], periods: [] };

    var beatTimes = [peaks[0]];
    var periods = [];
    var t = peaks[0];
    var searchFrom = 0;

    while(t + period*0.5 < duration){
      var predicted = t + period;
      var tol = period*0.28;
      var best = null, bestDist = Infinity;
      for(var i=searchFrom; i<peaks.length; i++){
        var p = peaks[i];
        if(p < predicted - tol) continue;
        if(p > predicted + tol) break;
        var d = Math.abs(p - predicted);
        if(d < bestDist){ bestDist = d; best = p; searchFrom = i; }
      }
      var next;
      if(best !== null){
        next = best;
        period = period*0.7 + (next-t)*0.3; // adapt toward the observed spacing
      }else{
        next = predicted; // no onset nearby — glide forward at the current tempo
      }
      beatTimes.push(Math.round(next*1000)/1000);
      periods.push(period);
      t = next;
    }
    return { beatTimes: beatTimes, periods: periods };
  }

  function detectBeats(blob){
    var AudioCtor = window.AudioContext || window.webkitAudioContext;
    var OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if(!AudioCtor || !OfflineCtor) return Promise.reject(new Error('Web Audio API nicht verfügbar'));
    var decodeCtx = new AudioCtor();
    return blobToArrayBuffer(blob).then(function(buf){
      return decodeCtx.decodeAudioData(buf);
    }).then(function(decoded){
      var duration = decoded.duration;
      var targetRate = 11025;
      var len = Math.max(1, Math.ceil(duration*targetRate));
      var offlineCtx = new OfflineCtor(1, len, targetRate);
      var src = offlineCtx.createBufferSource();
      src.buffer = decoded;
      var lowpass = offlineCtx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 150;
      lowpass.Q.value = 0.7;
      src.connect(lowpass);
      lowpass.connect(offlineCtx.destination);
      src.start(0);
      return offlineCtx.startRendering().then(function(rendered){
        return analyzeEnvelope(rendered.getChannelData(0), targetRate, duration);
      });
    }).then(function(result){
      decodeCtx.close().catch(function(){});
      return result;
    }, function(err){
      decodeCtx.close().catch(function(){});
      throw err;
    });
  }

  detectBeatsBtn.addEventListener('click', function(){
    if(!state.song || !state.song.blob) return;
    detectBeatsBtn.disabled = true;
    detectStatus.textContent = 'Analysiere Musik …';
    detectBeats(state.song.blob).then(function(result){
      if(!result.bpm || !result.beatTimes.length){
        beatData = null;
        beatsPerBarRow.hidden = true;
        snapRow.hidden = true;
        detectStatus.textContent = 'Kein eindeutiger Takt erkannt — Marken bitte manuell setzen.';
      }else{
        beatData = result;
        beatData.beatsPerBar = parseInt(beatsPerBarSelect.value, 10) || 4;
        var bpmText = 'Ø ' + result.bpm + ' BPM' + (result.bpmRange ? ' (schwankt zwischen ' + result.bpmRange[0] + '–' + result.bpmRange[1] + ' BPM)' : '');
        detectStatus.textContent = bpmText + ' · ' + result.beatTimes.length + ' Schläge erkannt — folgt dem Tempo im Verlauf des Lieds';
        beatsPerBarRow.hidden = false;
        snapRow.hidden = false;
      }
      renderBeatTicks();
    }).catch(function(err){
      console.error(err);
      detectStatus.textContent = 'Analyse fehlgeschlagen.';
    }).then(function(){ detectBeatsBtn.disabled = false; });
  });

  beatsPerBarSelect.addEventListener('change', function(){
    if(beatData) beatData.beatsPerBar = parseInt(beatsPerBarSelect.value, 10) || 4;
    renderBeatTicks();
  });

  distributeBtn.addEventListener('click', function(){
    if(!beatData || !beatData.beatTimes.length) return;
    var barTimes = beatData.beatTimes.filter(function(t, i){ return i % beatData.beatsPerBar === 0; });
    if(barTimes.length < 2) return;
    var n = state.formations.length;
    state.formations.forEach(function(f, idx){
      var barIdx = n > 1 ? Math.round((idx/(n-1)) * (barTimes.length-1)) : 0;
      f.time = barTimes[barIdx];
    });
    saveState();
    renderMarkerList();
    renderMarkerTimeline();
    updateSyncBadge();
  });

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

  function renderAxesList(){
    var listEl = document.getElementById('axesList');
    listEl.innerHTML = '';
    state.axes.forEach(function(ax){
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
      del.addEventListener('click', function(){
        state.axes = state.axes.filter(function(a){ return a.id !== ax.id; });
        renderAxesList();
        renderAxes();
        saveState();
      });

      row.appendChild(labelInput);
      row.appendChild(coordWrap);
      row.appendChild(del);
      listEl.appendChild(row);
    });
  }
