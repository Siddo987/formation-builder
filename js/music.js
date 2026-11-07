"use strict";

/* ---------- Nur Musik: play just the song, without animating the stage ---------- */

  // For rehearsing with the song alone — start at a typed-in time or at any Bild's marker, and
  // optionally stop at the next marker so one section can be practised on its own. Shares
  // songAudioEl with sync playback and the marker modal's preview; musicOnlyActive only marks that
  // *this* feature started it, so the playbar button can show it's still running after the dialog
  // is closed. Any pause of the element (ours, the marker modal's, the song ending) clears it.
  var musicOnlyBtn = document.getElementById('musicOnlyBtn');
  var musicBackdrop = document.getElementById('musicBackdrop');
  var musicCloseBtn = document.getElementById('musicCloseBtn');
  var musicNoSongHint = document.getElementById('musicNoSongHint');
  var musicSongArea = document.getElementById('musicSongArea');
  var musicPlayBtn = document.getElementById('musicPlayBtn');
  var musicIconPlay = document.getElementById('musicIconPlay');
  var musicIconPause = document.getElementById('musicIconPause');
  var musicTimeReadout = document.getElementById('musicTimeReadout');
  var musicCurrentBild = document.getElementById('musicCurrentBild');
  var musicTimelineEl = document.getElementById('musicTimeline');
  var musicTimelinePlayed = document.getElementById('musicTimelinePlayed');
  var musicTimelineFlags = document.getElementById('musicTimelineFlags');
  var musicTimelineHead = document.getElementById('musicTimelineHead');
  var musicStartInput = document.getElementById('musicStartInput');
  var musicStartBtn = document.getElementById('musicStartBtn');
  var musicStopAtNext = document.getElementById('musicStopAtNext');
  var musicMarkerList = document.getElementById('musicMarkerList');
  var musicNoMarkersHint = document.getElementById('musicNoMarkersHint');
  var musicPrerollInput = document.getElementById('musicPrerollInput');
  var musicRateSlider = document.getElementById('musicRateSlider');
  var musicRateInput = document.getElementById('musicRateInput');
  var musicRateResetBtn = document.getElementById('musicRateResetBtn');

  var musicOnlyActive = false;
  var musicStopAt = null;
  var musicAnchor = 0; // where "am nächsten Marker anhalten" counts from — the marker, not the Vorlauf start
  var musicRafId = 0;

  // "Vorlauf": starting at a Bild's marker begins this many seconds earlier, to hear the run-up.
  // A personal rehearsal habit rather than part of the choreography, so it lives in localStorage
  // instead of the project (and isn't shared).
  var PREROLL_KEY = 'aufstellung-music-preroll';
  function prerollSec(){
    var v = parseFloat(musicPrerollInput.value);
    return isFinite(v) && v > 0 ? Math.min(60, v) : 0;
  }

  function hasSong(){ return !!(state.song && state.song.url); }
  function songDuration(){
    var d = songAudioEl.duration;
    return (isFinite(d) && d > 0) ? d : 0;
  }

  // First marker strictly after t (small epsilon so starting exactly on a marker doesn't
  // immediately count that same marker as "the next one").
  function nextMarkerAfter(t){
    var pts = markerWaypoints();
    for(var i = 0; i < pts.length; i++) if(pts[i].time > t + 0.05) return pts[i].time;
    return null;
  }

  // The Bild whose section the song is currently in — the last marker at or before ct.
  function markerIdxAt(ct){
    var pts = markerWaypoints(), idx = -1;
    for(var i = 0; i < pts.length; i++){ if(pts[i].time <= ct + 0.05) idx = pts[i].idx; else break; }
    return idx;
  }

  // anchor: the marker a Vorlauf start leads up to, so stopping at the next marker doesn't stop
  // right at that one. Defaults to t itself.
  function playMusicFrom(t, anchor){
    if(!hasSong()) return;
    if(playing) pausePlayback(); // never animate alongside — that's the regular play button
    t = Math.max(0, t || 0);
    var dur = songDuration();
    if(dur > 0) t = Math.min(t, dur);
    songAudioEl.currentTime = t;
    musicAnchor = Math.max(t, anchor || 0);
    musicStopAt = musicStopAtNext.checked ? nextMarkerAfter(musicAnchor) : null;
    musicOnlyActive = true;
    songAudioEl.play().catch(function(){ stopMusicOnly(); });
    cancelAnimationFrame(musicRafId);
    musicRafId = requestAnimationFrame(musicTick);
    updateMusicUI();
  }

  function stopMusicOnly(){
    if(!musicOnlyActive) return;
    musicOnlyActive = false;
    musicStopAt = null;
    cancelAnimationFrame(musicRafId);
    songAudioEl.pause();
    updateMusicUI();
  }

  // rAF rather than the element's timeupdate (only ~4×/s) so "am nächsten Marker anhalten" stops
  // close to the marker instead of up to a quarter second into the next section.
  function musicTick(){
    if(!musicOnlyActive) return;
    if(musicStopAt !== null && songAudioEl.currentTime >= musicStopAt){
      songAudioEl.currentTime = musicStopAt;
      stopMusicOnly();
      return;
    }
    if(!musicBackdrop.hidden) updateMusicPlayhead();
    musicRafId = requestAnimationFrame(musicTick);
  }

  function updateMusicPlayhead(){
    var dur = songDuration();
    var ct = songAudioEl.currentTime;
    var pct = dur > 0 ? Math.min(100, (ct/dur)*100) : 0;
    musicTimelinePlayed.style.width = pct + '%';
    musicTimelineHead.style.left = pct + '%';
    musicTimeReadout.textContent = formatTime(ct) + ' / ' + (dur > 0 ? formatTime(dur) : '0:00');
    var idx = markerIdxAt(ct);
    musicCurrentBild.textContent = idx >= 0 ? (idx+1) + ' · ' + state.formations[idx].name : '–';
    Array.prototype.forEach.call(musicMarkerList.children, function(row){
      row.classList.toggle('music-row--current', Number(row.dataset.idx) === idx);
    });
  }

  function updateMusicUI(){
    var on = musicOnlyActive;
    musicOnlyBtn.classList.toggle('active', on);
    musicOnlyBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    musicIconPlay.hidden = on;
    musicIconPause.hidden = !on;
    musicPlayBtn.setAttribute('aria-label', on ? 'Musik pausieren' : 'Musik abspielen');
    if(!musicBackdrop.hidden) updateMusicPlayhead();
  }

  function updateMusicOnlyBtnVisibility(){
    musicOnlyBtn.hidden = !hasSong();
    if(!hasSong()) stopMusicOnly();
  }

  function renderMusicTimeline(){
    var dur = songDuration();
    musicTimelineFlags.innerHTML = '';
    if(dur <= 0) return;
    markerWaypoints().forEach(function(p){
      var flag = document.createElement('div');
      flag.className = 'timeline-flag';
      flag.style.left = Math.min(100, (p.time/dur)*100) + '%';
      flag.textContent = String(p.idx+1);
      flag.title = state.formations[p.idx].name + ' — ' + formatTime(p.time);
      musicTimelineFlags.appendChild(flag);
    });
  }

  // Only marked Bilder, in song order — an unmarked Bild has no place in the song to start from.
  function renderMusicMarkerList(){
    var pts = markerWaypoints();
    musicMarkerList.innerHTML = '';
    musicNoMarkersHint.hidden = pts.length > 0;
    pts.forEach(function(p){
      var f = state.formations[p.idx];
      var row = document.createElement('div');
      row.className = 'marker-row';
      row.dataset.idx = String(p.idx);
      var badge = document.createElement('span');
      badge.className = 'marker-badge';
      badge.textContent = String(p.idx+1).padStart(2,'0');
      var name = document.createElement('span');
      name.className = 'marker-name';
      name.textContent = f.name;
      var time = document.createElement('span');
      time.className = 'marker-time';
      time.textContent = formatTime(p.time);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-ghost marker-now-btn';
      setIconLabel(btn, 'play', 12, 'Ab hier');
      btn.setAttribute('aria-label', 'Musik ab Bild ' + (p.idx+1) + ' abspielen');
      btn.addEventListener('click', function(){
        var start = Math.max(0, p.time - prerollSec());
        musicStartInput.value = formatTime(start);
        playMusicFrom(start, p.time);
      });
      row.appendChild(badge);
      row.appendChild(name);
      row.appendChild(time);
      row.appendChild(btn);
      musicMarkerList.appendChild(row);
    });
  }

  // The dialog covers the playbar, so it carries its own copy of the Tempo slider and field: same
  // songTempo, same songRate() mapping. applyTempo() (js/playback.js) calls this after every change,
  // from either control or a song being loaded/removed.
  function syncMusicRate(){
    musicRateSlider.value = songTempo;
    if(document.activeElement !== musicRateInput) musicRateInput.value = formatDecimal(songRate(), 2);
  }
  musicRateSlider.addEventListener('input', function(){ setSongTempo(+musicRateSlider.value); });
  wireTempoInput(musicRateInput, function(r){ setSongTempo(songTempoForRate(r)); });
  musicRateResetBtn.addEventListener('click', function(){ setSongTempo(50); });

  function openMusicModal(){
    var song = hasSong();
    musicNoSongHint.hidden = song;
    musicSongArea.hidden = !song;
    if(song){
      // Pre-fill with where the regular play button would start the song for the selected Bild.
      if(!musicOnlyActive) musicStartInput.value = formatTime(playbackStartTime());
      renderMusicMarkerList();
      renderMusicTimeline();
      syncMusicRate();
      updateMusicUI();
    }
    musicBackdrop.hidden = false;
  }
  // Closing keeps the music running — listening while watching the stage is the point. The
  // playbar button stays highlighted and reopens the dialog to stop it.
  function closeMusicModal(){ musicBackdrop.hidden = true; }

  musicPlayBtn.addEventListener('click', function(){
    if(musicOnlyActive){ stopMusicOnly(); return; }
    var dur = songDuration();
    var ct = songAudioEl.currentTime;
    if(dur > 0 && ct >= dur - 0.05){ playMusicFrom(0); return; }
    // Paused during a Vorlauf: still lead up to that marker rather than stop at it.
    playMusicFrom(ct, musicAnchor > ct && musicAnchor - ct <= prerollSec() ? musicAnchor : ct);
  });
  function startFromInput(){
    var t = parseTimeInput(musicStartInput.value);
    if(t === null){ musicStartInput.focus(); return; }
    musicStartInput.value = formatTime(t);
    playMusicFrom(t);
  }
  musicStartBtn.addEventListener('click', startFromInput);
  musicStartInput.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); startFromInput(); } });
  musicStopAtNext.addEventListener('change', function(){
    if(musicOnlyActive) musicStopAt = musicStopAtNext.checked ? nextMarkerAfter(Math.max(songAudioEl.currentTime, musicAnchor)) : null;
  });
  try{ var storedPreroll = localStorage.getItem(PREROLL_KEY); if(storedPreroll !== null) musicPrerollInput.value = storedPreroll; }catch(e){}
  musicPrerollInput.addEventListener('change', function(){
    musicPrerollInput.value = String(prerollSec());
    try{ localStorage.setItem(PREROLL_KEY, musicPrerollInput.value); }catch(e){}
  });
  musicTimelineEl.addEventListener('click', function(e){
    var dur = songDuration();
    if(dur <= 0) return;
    var rect = musicTimelineEl.getBoundingClientRect();
    var t = Math.min(1, Math.max(0, (e.clientX - rect.left)/rect.width))*dur;
    musicStartInput.value = formatTime(t);
    if(musicOnlyActive) playMusicFrom(t);
    else { songAudioEl.currentTime = t; musicAnchor = t; updateMusicPlayhead(); }
  });

  // The paused check matters: playMusicFrom() may pausePlayback() and then play() in the same
  // turn, and that pause event still arrives afterwards while the song is already running again.
  songAudioEl.addEventListener('pause', function(){
    if(!musicOnlyActive || !songAudioEl.paused) return;
    musicOnlyActive = false;
    musicStopAt = null;
    cancelAnimationFrame(musicRafId);
    updateMusicUI();
  });
  songAudioEl.addEventListener('loadedmetadata', function(){ if(!musicBackdrop.hidden){ renderMusicTimeline(); updateMusicPlayhead(); } });
  // applySongSource() (js/main.js) sets or clears src whenever the project's song changes.
  songAudioEl.addEventListener('loadstart', updateMusicOnlyBtnVisibility);
  songAudioEl.addEventListener('emptied', updateMusicOnlyBtnVisibility);
  // The marker modal previews the same song with its own controls — hand the element over.
  markerBtn.addEventListener('click', stopMusicOnly);

  musicOnlyBtn.addEventListener('click', openMusicModal);
  musicCloseBtn.addEventListener('click', closeMusicModal);
  musicBackdrop.addEventListener('click', function(e){ if(e.target === musicBackdrop) closeMusicModal(); });

  updateMusicOnlyBtnVisibility();
