"use strict";

/* ---------- playback ---------- */

  function updatePlayButton(){
    playBtn.disabled = state.formations.length < 2;
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
    playBtn.setAttribute('aria-label', playing ? 'Pausieren' : 'Abspielen');
    // The Vorlage is for placing — greyed out while the Bilder move (#2080).
    document.body.classList.toggle('playing', playing);
    Array.prototype.forEach.call(document.querySelectorAll('#layoutSelectWrap select, #layoutSelectWrap input'), function(el){ el.disabled = playing; });
    if(typeof updateBildBar === 'function') updateBildBar(); // js/marker.js — it waits while playing
  }

  function updatePlaybarInfo(){
    var f = currentFormation();
    activeNameEl.textContent = f.name;
    activeReadoutEl.textContent = String(state.activeIndex+1).padStart(2,'0') + ' / ' + String(state.formations.length).padStart(2,'0');
    updateNoteBtn(); // the inspector's Notiz button follows what is shown (js/formations.js)
    if(typeof updateBildBar === 'function') updateBildBar(); // js/marker.js
    if(typeof renderDancerView === 'function') renderDancerView(); // js/dancerview.js
    if(typeof updateBildLocks === 'function') updateBildLocks(); // someone else may hold this Bild (js/share.js)
    if(!playing && !pausedAt) updateProgress(idleTimelinePct());
  }

  // The playbar timeline (#playScrub) spans the whole choreo, not just the current move: with sync
  // playback the song from 0:00 to its end, otherwise the chain of moves from the first Bild to the
  // last, one equal stretch per move (Bild i sits at i/(n-1)). Dragging it seeks — see scrubTo().
  var timelinePct = 0;
  function updateProgress(pct){
    timelinePct = pct;
    progressFillEl.style.width = pct + '%';
    scrubThumbEl.style.left = pct + '%';
    playScrubEl.setAttribute('aria-valuenow', String(Math.round(pct)));
    var dur = songDurationSec();
    playScrubEl.setAttribute('aria-valuetext', isSyncActive() && dur
      ? formatTime(pct/100*dur) + ' von ' + formatTime(dur)
      : 'Bild ' + (state.activeIndex+1) + ' von ' + state.formations.length);
    if(typeof updatePlaybarBar === 'function') updatePlaybarBar(); // the bar being heard (js/beats.js)
    if(typeof updateBildBar === 'function') updateBildBar(); // the dock's „Bild auf Takt setzen“ (js/marker.js)
  }
  function songDurationSec(){
    var d = songAudioEl.duration;
    return isFinite(d) && d > 0 ? d : 0;
  }
  // Where the timeline stands while nothing plays or is held: at the selected Bild.
  function idleTimelinePct(){
    var n = state.formations.length;
    if(isSyncActive()){
      var dur = songDurationSec();
      return dur ? Math.min(100, playbackStartTime()/dur*100) : 0;
    }
    return n > 1 ? state.activeIndex/(n-1)*100 : 0;
  }

  // With a song loaded, the Tempo slider sets how fast the song itself plays (songTempo, see
  // js/state.js): 0,5× to 2,0× of the original, 1,0× in the middle. Sync playback follows the song's
  // clock, so the stage speeds up with it. Piecewise linear so the readout lands on round values
  // (75 → 1,50×). Typed into the field it goes on down to 0,25× (songTempo below 0, #2049).
  function songRate(){
    var t = songTempo;
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
    tempoSlider.value = activeTempo();
    var song = !!(state.song && state.song.url);
    if(document.activeElement !== tempoInputEl){
      var bps = 1000/durations().move;
      tempoInputEl.value = song ? formatDecimal(songRate(), 2) : formatDecimal(bps, bps < 0.5 ? 2 : 1);
    }
    tempoUnitEl.textContent = song ? '×' : 'Bilder/s';
    tempoSlider.title = song ? 'Geschwindigkeit des Lieds (0,5× bis 2,0× vom Original)' : '';
    tempoInputEl.title = song ? 'Geschwindigkeit des Lieds eingeben (0,25 bis 2,0)' : 'Bilder pro Sekunde eingeben (0,25 bis 2,0)';
    syncMusicRate(); // js/music.js
  }

  function formatDecimal(v, digits){ return v.toFixed(digits).replace('.', ','); }

  // Inverses of the two readouts, for typing a value instead of dragging (both clamp to 0,25…2,0,
  // below the slider's range — the slider then just sits at its left end, #2049): songRate()
  // above, and Bilder/s = 1000/durations().move with move = 2200 - 17·tempo.
  function songTempoForRate(r){
    r = Math.min(2, Math.max(0.25, r));
    return r <= 1 ? (r - 0.5)*100 : 50 + (r - 1)*50;
  }
  function bilderTempoForRate(r){
    return Math.round(Math.min(100, (2200 - 1000/Math.max(0.25, r))/17));
  }

  // The Tempo readouts are text fields: Enter or leaving the field applies the typed value (comma or
  // point), Escape keeps the old one. An untouched field applies nothing, so tabbing through doesn't
  // round the tempo to what the readout shows. apply(rate) gets a number ≥ 0 (0 = slowest).
  function wireTempoInput(input, apply){
    var before = '', cancelled = false;
    input.addEventListener('focus', function(){ before = input.value; cancelled = false; input.select(); });
    input.addEventListener('keydown', function(e){
      if(e.key === 'Enter'){ e.preventDefault(); input.blur(); }
      else if(e.key === 'Escape'){ e.stopPropagation(); cancelled = true; input.blur(); } // don't close the dialog too
    });
    input.addEventListener('blur', function(){
      var r = parseFloat(input.value.trim().replace(',', '.'));
      if(!cancelled && input.value !== before && isFinite(r) && r >= 0) apply(r);
      applyTempo(); // shows the clamped value, or the old one again
    });
  }

  // Every Tempo control funnels through these. The song's speed is tab-local (no saveState(), so
  // no share push or history entry); without a song the slider edits the project's Bilder tempo.
  function setSongTempo(v){
    songTempo = v;
    try{ sessionStorage.setItem(SONG_TEMPO_KEY, String(v)); }catch(e){}
    applyTempo();
  }
  function setTempo(v){
    if(state.song && state.song.url){ setSongTempo(v); return; }
    state.tempo = v;
    applyTempo();
    saveState();
  }

  // Song position playback should begin at, given the currently selected Bild: its place in the song
  // under sync playback (syncTimes, js/stage.js — its own time marker, or where the unmarked ones
  // get spread to; past the last marker with the song length still unknown, the last placed Bild
  // before it). Free playback counts on from 0:00 at Bild 1, one move per Bild, so the song is where
  // it would be had playback run up to this Bild.
  function playbackStartTime(){
    if(!isSyncActive()) return freeSongTimeAt(state.activeIndex, 0);
    var times = syncTimes();
    for(var i = state.activeIndex; i >= 0; i--){
      if(times[i] !== null) return times[i];
    }
    return 0;
  }
  // Song position of free playback at fraction t of the move from Bild idx to idx+1.
  function freeSongTimeAt(idx, t){
    var base = 0, baseIdx = 0;
    for(var i = idx; i >= 0; i--){
      var m = formationTime(state.formations[i]);
      if(m !== null){ base = m; baseIdx = i; break; }
    }
    var at = base + (idx - baseIdx + t) * moveDurationMs()/1000 * songRate();
    var dur = songDurationSec();
    return dur ? Math.min(at, dur) : at;
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
      songAudioEl.currentTime = syncHeardFrom = pa.songTime;
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
      renderOnionSkin(); // playback ghosts: gray = the Bild the move starts from (stage.js)
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
        songAudioEl.currentTime = syncHeardFrom = playbackStartTime();
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
      if(syncActive){
        // Hold at what was heard (and shown), so play carries on from there (#2059).
        var heard = Math.max(syncHeardFrom, heardSongTime());
        songAudioEl.pause();
        songAudioEl.currentTime = heard;
      }else songAudioEl.pause();
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
    updateProgress(idleTimelinePct());
    songAudioEl.pause();
    updatePlayButton();
  }

  // What sync playback shows at song time ct: the positions, and the Bild that counts as current.
  // null while fewer than two Bilder have a place in the song (syncWaypoints, js/stage.js).
  function syncFrameAt(ct){
    var pts = syncWaypoints();
    if(pts.length < 2) return null;
    var k = 0;
    // 1 ms slack: the browser keeps currentTime in whole µs, so seeking to a Bild's place lands
    // just before it and would show the Bild before (#2033).
    while(k < pts.length-1 && ct >= pts[k+1].time - 0.001) k++;
    var p0 = pts[k], p1 = pts[Math.min(k+1, pts.length-1)];

    var posMap, activeIdx, t;
    if(p0 === p1 || ct <= p0.time){
      posMap = state.formations[p0.idx].pos;
      activeIdx = p0.idx;
    }else{
      var span = p1.time - p0.time;
      t = span > 0 ? Math.min(1, Math.max(0, (ct - p0.time)/span)) : 1;
      // Zwischenpositionen (interpolateThroughBetweens, state.js) chain in between neighbouring
      // Bilder — every Bild has a place now, so p1 is p0+1 unless time markers are out of order
      // (the in-between Bilder then don't show at all, betweens included).
      posMap = interpolateThroughBetweens(p0.idx, p1.idx, t);
      activeIdx = t >= 1 ? p1.idx : p0.idx;
    }
    return {pos: posMap, idx: activeIdx, from: p0.idx, to: p1.idx, t: t};
  }

  // Where a held pause/scrub stopped in the middle of a move: {fromIdx, t, songTime, sync} — t the
  // share of the time from Bild fromIdx to the next — or null when it holds on a Bild. New Bilder
  // and Zwischenpositionen start from there (#2031); read it before anything redraws the stage.
  function pausedMidMove(){
    if(playing || !pausedAt) return null;
    var from = pausedAt.fromIdx, t = pausedAt.t;
    if(pausedAt.sync){
      var fr = syncFrameAt(pausedAt.songTime);
      if(!fr || fr.to !== fr.from + 1) return null;
      from = fr.from; t = fr.t;
    }
    if(!(t > 0 && t < 1) || !state.formations[from + 1]) return null;
    return {fromIdx: from, t: t, songTime: pausedAt.songTime, sync: pausedAt.sync};
  }

  // The song's currentTime only moves in coarse, uneven steps in some browsers, which made the
  // stage jitter against the music (#2038). Run our own clock at the song's rate and pull it gently
  // towards currentTime; a seek, rate change, pause or skipped frames start it afresh, and it only
  // runs once the song has actually started moving (playback start lags a few frames).
  var syncClock = null;
  function smoothSongTime(){
    var now = performance.now(), raw = songAudioEl.currentTime, c = syncClock;
    if(c && !songAudioEl.paused && now - c.perf < 100 && (c.moving || raw !== c.ct)){
      var est = c.ct + (now - c.perf)/1000*songAudioEl.playbackRate;
      if(Math.abs(raw - est) < 0.1){
        est += (raw - est)*0.15;
        syncClock = {perf: now, ct: est, moving: true};
        return est;
      }
    }
    syncClock = {perf: now, ct: raw};
    return raw;
  }

  // Bluetooth & co. play the song this long after currentTime (#2059). Per device like the Vorlauf
  // (js/music.js), so it lives in localStorage, not in the project.
  var AUDIO_DELAY_KEY = 'aufstellung-audio-delay';
  var audioDelayInput = document.getElementById('audioDelayInput');
  function audioDelaySec(){
    var v = parseFloat(audioDelayInput.value);
    return isFinite(v) && v > 0 ? Math.min(1000, v)/1000 : 0;
  }
  try{ var storedDelay = localStorage.getItem(AUDIO_DELAY_KEY); if(storedDelay !== null) audioDelayInput.value = storedDelay; }catch(e){}
  audioDelayInput.addEventListener('change', function(){
    audioDelayInput.value = String(Math.round(audioDelaySec()*1000));
    try{ localStorage.setItem(AUDIO_DELAY_KEY, audioDelayInput.value); }catch(e){}
  });
  // What is being heard right now: the song's position minus that delay, while it plays.
  function heardSongTime(){
    return songAudioEl.paused ? songAudioEl.currentTime : Math.max(0, songAudioEl.currentTime - audioDelaySec());
  }

  var syncHeardFrom = 0; // where sync playback started: the picture holds there until the sound arrives
  function syncTick(){
    if(!playing || !syncActive) return;
    var ct = Math.max(syncHeardFrom, smoothSongTime() - audioDelaySec());
    var fr = syncFrameAt(ct);
    if(!fr){ pausePlayback(); return; }
    positionMarkers(fr.pos);
    var changed = fr.idx !== state.activeIndex;
    state.activeIndex = fr.idx;
    renderFilmstripActiveOnly(fr.from, fr.to === fr.from + 1 ? fr.t : 0);
    if(changed){
      refreshRosterCoords();
      updatePlaybarInfo();
      resetLayoutGhost();
    }
    var totalDur = songDurationSec();
    if(totalDur) updateProgress(Math.min(100, (ct/totalDur)*100));
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
    // poses on fromIdx's own betweens list — total duration unchanged, divided at the times set on
    // them (evenly where none is set) — instead of a single straight fromPos->toPos interpolation.
    positionMarkers(interpolateThroughBetweens(fromIdx, toIdx, t));
    updateProgress((fromIdx + t)/(state.formations.length - 1)*100);
    if(t < 1) renderFilmstripActiveOnly(fromIdx, t);
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
      phaseStart += moveMs; // not `now` — the frame's overshoot would add up and drift off the song (#2038)
    }
    if(playing) rafId = requestAnimationFrame(tick);
  }

  // Only moves the highlight — the Bilder list deliberately does not scroll along during playback,
  // so it stays where the user left it. Mid-move (share t of the way on from Bild `from`) the last
  // Zwischenposition passed is marked instead of its Bild (#2035, #2078).
  function renderFilmstripActiveOnly(from, t){
    var passed = -1;
    if(from === state.activeIndex && t > 0){
      betweenTimes(from).forEach(function(bt, i){ if(bt <= t) passed = i; });
    }
    filmTrackEl.querySelectorAll('.film-card').forEach(function(card, idx){
      card.classList.toggle('active', idx === state.activeIndex && passed < 0);
    });
    filmTrackEl.querySelectorAll('.film-between-chip').forEach(function(chip){
      chip.classList.toggle('active', +chip.dataset.f === state.activeIndex && +chip.dataset.b === passed);
    });
  }

  // Seeks the playbar timeline to frac (0…1) and holds there like the play button's pause, so the
  // next play carries on from exactly that spot (resumePaused). Landing right on a Bild just selects
  // it — play then starts there the regular way.
  // snap: how close (in Bild intervals) to a whole Bild counts as that Bild instead of a spot between.
  function scrubTo(frac, snap){
    var n = state.formations.length;
    if(n < 2) return;
    frac = Math.min(1, Math.max(0, frac));
    var idx, posMap, hold = null, mvFrom = -1, mvT = 0;
    if(isSyncActive()){
      var dur = songDurationSec();
      if(!dur) return;
      var ct = frac*dur;
      var fr = syncFrameAt(ct);
      if(!fr) return;
      songAudioEl.currentTime = ct;
      idx = fr.idx; posMap = fr.pos;
      hold = {sync: true, songTime: ct};
      if(fr.to === fr.from + 1){ mvFrom = fr.from; mvT = fr.t; }
    }else{
      var x = frac*(n-1);
      var from = Math.min(n-2, Math.floor(x)), t = x - from;
      snap = Math.max(0.001, snap || 0);
      if(t < snap || t > 1 - snap){
        idx = t > 1 - snap ? from + 1 : from;
        posMap = state.formations[idx].pos;
      }else{
        idx = from;
        posMap = interpolateThroughBetweens(from, from + 1, t);
        hold = {sync: false, fromIdx: from, toIdx: from + 1, t: t, songTime: freeSongTimeAt(from, t)};
        mvFrom = from; mvT = t;
      }
    }
    var changed = idx !== state.activeIndex || !hold !== !pausedAt;
    state.activeIndex = idx;
    positionMarkers(posMap); // drops any earlier hold
    pausedAt = hold; // before the redraw: the ghosts depend on it (#2039)
    renderFilmstripActiveOnly(mvFrom, mvT);
    if(changed){
      refreshRosterCoords();
      updatePlaybarInfo();
      resetLayoutGhost();
      renderOnionSkin();
    }
    updateProgress(frac*100);
  }

  // Drag or click the timeline to seek; running playback pauses while the pointer is down and
  // carries on from the new spot once it lets go. Arrow keys step a Bild (with a song in sync:
  // 5 s), Home/End jump to the start/end.
  (function(){
    var dragging = false, resumeAfter = false;
    function scrubAt(e){
      var r = playScrubEl.getBoundingClientRect(), n = state.formations.length;
      if(!(r.width > 0)) return;
      // Within 4px of a Bild the pointer picks that Bild.
      scrubTo((e.clientX - r.left)/r.width, Math.min(0.25, 4*(n-1)/r.width));
    }
    function begin(){
      if(typeof stopMusicOnly === 'function') stopMusicOnly(); // js/music.js
      if(editingBetween){ editingBetween = null; updateBetweenEditBanner(); }
      resumeAfter = playing;
      if(playing) playPause();
    }
    function finish(){
      // Dragged right onto the last Bild: nothing left to play (play would start over at Bild 1).
      var atEnd = !pausedAt && state.activeIndex === state.formations.length - 1;
      if(resumeAfter && !playing && !atEnd) playPause();
      resumeAfter = false;
      if(!playing) saveState(); // remember the selected Bild, as picking it in the list would
    }
    playScrubEl.addEventListener('pointerdown', function(e){
      if(e.button !== 0 || state.formations.length < 2) return;
      e.preventDefault();
      // Focus for the arrow keys; not on touch, where it would only leave a focus ring behind.
      if(e.pointerType !== 'touch') playScrubEl.focus({preventScroll: true, focusVisible: false});
      begin();
      dragging = true;
      playScrubEl.setPointerCapture(e.pointerId);
      playScrubEl.classList.add('dragging');
      scrubAt(e);
    });
    playScrubEl.addEventListener('pointermove', function(e){ if(dragging) scrubAt(e); });
    function end(){
      if(!dragging) return;
      dragging = false;
      playScrubEl.classList.remove('dragging');
      finish();
    }
    playScrubEl.addEventListener('pointerup', end);
    playScrubEl.addEventListener('pointercancel', end);
    playScrubEl.addEventListener('lostpointercapture', end);
    playScrubEl.addEventListener('keydown', function(e){
      var n = state.formations.length;
      if(n < 2 || e.ctrlKey || e.metaKey || e.altKey) return;
      var dur = songDurationSec(), bySong = isSyncActive() && dur > 0;
      var dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
      var to, x = timelinePct/100*(n-1);
      if(e.key === 'Home') to = 0;
      else if(e.key === 'End') to = 1;
      else if(!dir) return;
      else if(bySong) to = timelinePct/100 + dir*5/dur;
      // By Bild: always onto the neighbouring whole Bild, also from a spot between two.
      else to = (dir < 0 ? Math.ceil(x - 0.001) - 1 : Math.floor(x + 0.001) + 1)/(n-1);
      e.preventDefault();
      begin();
      scrubTo(to);
      finish();
    });
  })();
  songAudioEl.addEventListener('durationchange', function(){ if(!playing && !pausedAt) updateProgress(idleTimelinePct()); });
