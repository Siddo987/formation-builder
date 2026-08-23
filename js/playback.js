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

  // Shows a rate ("Bilder pro Sekunde"), not a raw duration — a duration shrinks as you push the
  // slider up, which reads as the control running backwards even though the underlying speed is
  // correct. A rate grows with the slider instead, matching what "Tempo" implies.
  function updateTempoReadout(){
    var d = durations();
    tempoReadoutEl.textContent = (1000/d.move).toFixed(1) + '/s';
  }

  function playPause(){
    if(state.formations.length < 2) return;
    playing = !playing;
    if(playing){
      // On the last Bild, pressing play has nothing left to advance to (tick() would just hold
      // then immediately stop) — jump back to the first Bild so playback actually runs, matching
      // "stop after the last Bild" ending back at a state play can restart from.
      if(state.activeIndex >= state.formations.length - 1){
        state.activeIndex = 0;
        renderFilmstrip();
        positionMarkers(currentFormation().pos);
        refreshRosterCoords();
        updatePlaybarInfo();
        renderAxes();
        resetLayoutGhost();
        saveState();
      }
      syncActive = isSyncActive();
      if(syncActive){
        songAudioEl.currentTime = 0;
        songAudioEl.play().catch(function(){});
        rafId = requestAnimationFrame(syncTick);
      }else{
        phase = 'hold';
        phaseStart = performance.now();
        rafId = requestAnimationFrame(tick);
        if(state.song && state.song.url){
          songAudioEl.currentTime = 0;
          songAudioEl.play().catch(function(){});
        }
      }
    }else{
      cancelAnimationFrame(rafId);
      positionMarkers(currentFormation().pos);
      updateProgress(0);
      songAudioEl.pause();
    }
    updatePlayButton();
  }

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
      var e = easeInOutCubic(t);
      var fromPos = state.formations[p0.idx].pos, toPos = state.formations[p1.idx].pos;
      var interp = {};
      state.dancers.forEach(function(dd){
        var a = fromPos[dd.id] || {x:0,y:0,rot:0};
        var b = toPos[dd.id] || {x:0,y:0,rot:0};
        interp[dd.id] = { x: a.x + (b.x-a.x)*e, y: a.y + (b.y-a.y)*e, rot: lerpAngle(a.rot||0, b.rot||0, e) };
      });
      posMap = interp;
      activeIdx = t >= 1 ? p1.idx : p0.idx;
    }
    positionMarkers(posMap);
    if(activeIdx !== state.activeIndex){
      state.activeIndex = activeIdx;
      renderFilmstripActiveOnly();
      refreshRosterCoords();
      updatePlaybarInfo();
      renderAxes();
      resetLayoutGhost();
    }
    if(isFinite(totalDur) && totalDur > 0) updateProgress(Math.min(100, (ct/totalDur)*100));
    if(playing && syncActive) rafId = requestAnimationFrame(syncTick);
  }

  function tick(now){
    var d = durations();
    var moveMs = prefersReducedMotion ? Math.min(180, d.move) : d.move;
    var elapsed = now - phaseStart;

    if(phase === 'hold'){
      updateProgress(0);
      if(elapsed >= d.hold){
        var next = state.activeIndex + 1;
        if(next >= state.formations.length){
          playing = false; updatePlayButton(); return;
        }
        fromIdx = state.activeIndex;
        toIdx = next;
        phase = 'move';
        phaseStart = now;
      }
    }else{
      var t = Math.min(1, elapsed / moveMs);
      var e = easeInOutCubic(t);
      var fromPos = state.formations[fromIdx].pos;
      var toPos = state.formations[toIdx].pos;
      var interp = {};
      state.dancers.forEach(function(dd){
        var a = fromPos[dd.id] || {x:0,y:0,rot:0};
        var b = toPos[dd.id] || {x:0,y:0,rot:0};
        interp[dd.id] = { x: a.x + (b.x-a.x)*e, y: a.y + (b.y-a.y)*e, rot: lerpAngle(a.rot||0, b.rot||0, e) };
      });
      positionMarkers(interp);
      updateProgress(t*100);
      if(t >= 1){
        state.activeIndex = toIdx;
        phase = 'hold';
        phaseStart = now;
        positionMarkers(state.formations[toIdx].pos);
        renderFilmstripActiveOnly();
        refreshRosterCoords();
        updatePlaybarInfo();
        renderAxes();
        resetLayoutGhost();
      }
    }
    if(playing) rafId = requestAnimationFrame(tick);
  }

  function renderFilmstripActiveOnly(){
    var cards = filmTrackEl.querySelectorAll('.film-card');
    cards.forEach(function(card, idx){
      card.classList.toggle('active', idx === state.activeIndex);
    });
  }
