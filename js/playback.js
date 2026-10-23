"use strict";

/* ---------- playback ---------- */

  function updatePlayButton(){
    playBtn.disabled = state.formations.length < 2;
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
    playBtn.setAttribute('aria-label', playing ? 'Pausieren' : 'Abspielen');
  }

  function updatePlaybarInfo(){
    var f = currentFormation();
    activeNameEl.textContent = f.name;
    activeReadoutEl.textContent = String(state.activeIndex+1).padStart(2,'0') + ' / ' + String(state.formations.length).padStart(2,'0');
  }

  function updateProgress(pct){ progressFillEl.style.width = pct + '%'; }

  // With a song loaded, the Tempo slider also sets how fast the song itself plays: 0,5× to 2,0× of
  // the original, 1,0× in the middle. Sync playback follows the song's clock, so the stage speeds
  // up with it. Piecewise linear so the readout lands on round values (75 → 1,50×).
  function songRate(){
    var t = state.tempo;
    return t <= 50 ? 0.5 + t/100 : 1 + (t-50)/50;
  }
  function applySongRate(audioEl){
    audioEl.defaultPlaybackRate = songRate(); // every new src resets playbackRate to this
    audioEl.playbackRate = songRate();
  }

  // Without a song, shows a rate ("Bilder pro Sekunde"), not a raw duration — a duration shrinks as
  // you push the slider up, which reads as the control running backwards even though the underlying
  // speed is correct. A rate grows with the slider instead, matching what "Tempo" implies.
  function applyTempo(){
    applySongRate(songAudioEl);
    if(state.song && state.song.url){
      tempoReadoutEl.textContent = songRate().toFixed(2).replace('.', ',') + '×';
      tempoSlider.title = 'Geschwindigkeit des Lieds (0,5× bis 2,0× vom Original)';
    }else{
      tempoReadoutEl.textContent = (1000/durations().move).toFixed(1) + '/s';
      tempoSlider.title = '';
    }
  }

  // Song position playback should begin at, given the currently selected Bild: its own time marker
  // if it has one, else the last marked Bild before it (so playing from an unmarked Bild still lands
  // in roughly the right place), else the start of the song.
  function playbackStartTime(){
    var own = formationTime(state.formations[state.activeIndex]);
    if(own !== null) return own;
    for(var i = state.activeIndex - 1; i >= 0; i--){
      var t = formationTime(state.formations[i]);
      if(t !== null) return t;
    }
    return 0;
  }

  // Where the play button last paused: the stage keeps showing the positions mid-move and the next
  // play continues from exactly there. Dropped as soon as anything else redraws the stage (Bild
  // switch, edit, undo, …) — positionMarkers() in stage.js clears it while not playing.
  var pausedAt = null;

  function moveDurationMs(){
    var d = durations();
    return prefersReducedMotion ? Math.min(180, d.move) : d.move;
  }

  function resumePaused(){
    var pa = pausedAt;
    pausedAt = null;
    if(!pa || pa.sync !== isSyncActive()) return false;
    if(!pa.sync && (state.activeIndex !== pa.fromIdx || pa.toIdx >= state.formations.length)) return false;
    syncActive = pa.sync;
    if(pa.sync){
      songAudioEl.currentTime = pa.songTime;
      songAudioEl.play().catch(function(){});
      rafId = requestAnimationFrame(syncTick);
    }else{
      fromIdx = pa.fromIdx;
      toIdx = pa.toIdx;
      phaseStart = performance.now() - pa.t * moveDurationMs();
      rafId = requestAnimationFrame(tick);
      if(state.song && state.song.url){
        songAudioEl.currentTime = pa.songTime;
        songAudioEl.play().catch(function(){});
      }
    }
    return true;
  }

  function playPause(){
    if(state.formations.length < 2) return;
    if(editingBetween){ editingBetween = null; if(typeof updateBetweenEditBanner === 'function') updateBetweenEditBanner(); } // playback always plays the real timeline
    playing = !playing;
    if(playing){
      if(typeof stopMusicOnly === 'function') stopMusicOnly(); // js/music.js — hand the song over to animated playback
      if(resumePaused()){ updatePlayButton(); return; }
      // On the last Bild, pressing play has nothing left to advance to (tick() would just hold
      // then immediately stop) — jump back to the first Bild so playback actually runs, matching
      // "stop after the last Bild" ending back at a state play can restart from.
      if(state.activeIndex >= state.formations.length - 1){
        state.activeIndex = 0;
        renderFilmstrip();
        positionMarkers(currentFormation().pos);
        refreshRosterCoords();
        updatePlaybarInfo();
        resetLayoutGhost();
        saveState();
      }
      syncActive = isSyncActive();
      if(syncActive){
        // Start the song (and therefore the animation) at the selected Bild, not always at 0.
        songAudioEl.currentTime = playbackStartTime();
        songAudioEl.play().catch(function(){});
        rafId = requestAnimationFrame(syncTick);
      }else{
        // No hold/pause at a Bild any more — playback is one continuous chain of moves straight
        // through to the last Bild (see tick() below), starting immediately.
        fromIdx = state.activeIndex;
        toIdx = state.activeIndex + 1;
        phaseStart = performance.now();
        rafId = requestAnimationFrame(tick);
        if(state.song && state.song.url){
          songAudioEl.currentTime = playbackStartTime();
          songAudioEl.play().catch(function(){});
        }
      }
    }else{
      // Hold everything right where it is — no jump back to the start of the Bild.
      cancelAnimationFrame(rafId);
      songAudioEl.pause();
      pausedAt = syncActive
        ? {sync: true, songTime: songAudioEl.currentTime}
        : {sync: false, fromIdx: fromIdx, toIdx: toIdx, songTime: songAudioEl.currentTime,
           t: Math.min(1, (performance.now() - phaseStart) / moveDurationMs())};
      syncActive = false;
      renderOnionSkin(); // back to editing semantics for the ghosts
    }
    updatePlayButton();
  }

  // Pause forced by another action (dragging, exporting, picking a Bild …): back to the Bild itself.
  function pausePlayback(){
    if(!playing) return;
    playing = false;
    syncActive = false;
    cancelAnimationFrame(rafId);
    positionMarkers(currentFormation().pos);
    updateProgress(0);
    songAudioEl.pause();
    updatePlayButton();
  }

  function syncTick(){
    if(!playing || !syncActive) return;
    var pts = syncWaypoints();
    if(pts.length < 2){ pausePlayback(); return; }
    var ct = songAudioEl.currentTime;
    var totalDur = songAudioEl.duration;

    var k = 0;
    while(k < pts.length-1 && ct >= pts[k+1].time) k++;
    var p0 = pts[k], p1 = pts[Math.min(k+1, pts.length-1)];

    var posMap, activeIdx, t;
    if(p0 === p1 || ct <= p0.time){
      posMap = state.formations[p0.idx].pos;
      activeIdx = p0.idx;
    }else{
      var span = p1.time - p0.time;
      t = span > 0 ? Math.min(1, Math.max(0, (ct - p0.time)/span)) : 1;
      // Zwischenpositionen (interpolateThroughBetweens, state.js) only chain in when p1 is literally
      // p0+1 — a marked Bild further out just means the ones in between (unmarked, so skipped by
      // syncWaypoints()) never show at all, betweens included.
      posMap = interpolateThroughBetweens(p0.idx, p1.idx, t);
      activeIdx = t >= 1 ? p1.idx : p0.idx;
    }
    positionMarkers(posMap);
    if(activeIdx !== state.activeIndex){
      state.activeIndex = activeIdx;
      renderFilmstripActiveOnly();
      refreshRosterCoords();
      updatePlaybarInfo();
      resetLayoutGhost();
    }
    if(isFinite(totalDur) && totalDur > 0) updateProgress(Math.min(100, (ct/totalDur)*100));
    if(playing && syncActive) rafId = requestAnimationFrame(syncTick);
  }

  // One continuous chain of moves, Bild to Bild, with no hold/pause in between — as soon as one
  // move finishes it immediately sets up and starts the next, until there's nothing left to move
  // to (playback then stops, per playPause()'s "stop after the last Bild" behavior).
  function tick(now){
    var moveMs = moveDurationMs();
    var elapsed = now - phaseStart;
    var t = Math.min(1, elapsed / moveMs);
    // Zwischenpositionen (see interpolateThroughBetweens in state.js) chain the move through any
    // poses on fromIdx's own betweens list — total duration unchanged, just divided evenly across
    // them — instead of a single straight fromPos->toPos interpolation.
    positionMarkers(interpolateThroughBetweens(fromIdx, toIdx, t));
    updateProgress(t*100);
    if(t >= 1){
      state.activeIndex = toIdx;
      positionMarkers(state.formations[toIdx].pos);
      renderFilmstripActiveOnly();
      refreshRosterCoords();
      updatePlaybarInfo();
      resetLayoutGhost();
      var next = toIdx + 1;
      if(next >= state.formations.length){
        playing = false;
        updatePlayButton();
        renderOnionSkin(); // playback finished — redraw ghosts with editing semantics (gray = Bild before)
        return;
      }
      fromIdx = toIdx;
      toIdx = next;
      phaseStart = now;
    }
    if(playing) rafId = requestAnimationFrame(tick);
  }

  function renderFilmstripActiveOnly(){
    var cards = filmTrackEl.querySelectorAll('.film-card');
    cards.forEach(function(card, idx){
      card.classList.toggle('active', idx === state.activeIndex);
      if(idx === state.activeIndex) keepFilmCardVisible(card);
    });
  }

  // Scrolls only the Bilder list (never the page) so the playing Bild stays in view.
  function keepFilmCardVisible(card){
    var t = filmTrackEl, tr = t.getBoundingClientRect(), cr = card.getBoundingClientRect();
    if(cr.top < tr.top) t.scrollTop -= tr.top - cr.top + 8;
    else if(cr.bottom > tr.bottom) t.scrollTop += cr.bottom - tr.bottom + 8;
    if(cr.left < tr.left) t.scrollLeft -= tr.left - cr.left + 8;
    else if(cr.right > tr.right) t.scrollLeft += cr.right - tr.right + 8;
  }
