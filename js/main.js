"use strict";

/* ---------- settings panel: project name, logo, song, axes ---------- */

  function openSettings(){
    renderAxesList();
    updateLogoSettingsUI();
    updateSongSettingsUI();
    settingsBackdrop.hidden = false;
  }
  function closeSettings(){ settingsBackdrop.hidden = true; }

  settingsBtn.addEventListener('click', openSettings);
  settingsCloseBtn.addEventListener('click', closeSettings);
  settingsBackdrop.addEventListener('click', function(e){ if(e.target === settingsBackdrop) closeSettings(); });
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    if(!settingsBackdrop.hidden) closeSettings();
    if(!videoBackdrop.hidden && exportState) exportState.cancelled = true;
    if(!filenameBackdrop.hidden) closeFilenameDialog();
    if(!markerBackdrop.hidden) closeMarkerModal();
    if(!addBildBackdrop.hidden) closeAddBildModal();
  });

  projectNameInput.addEventListener('input', function(){
    state.projectName = projectNameInput.value;
    document.title = (state.projectName || 'Aufstellung') + ' — Aufstellung';
    saveStateDebounced();
  });
  projectNameInput.addEventListener('blur', function(){
    if(!projectNameInput.value.trim()){
      projectNameInput.value = state.projectName = 'Meine Formation';
      saveState();
    }
  });

  function updateLogoSettingsUI(){
    var wrap = document.getElementById('logoPreviewWrap');
    var img = document.getElementById('logoPreview');
    var removeBtn = document.getElementById('logoRemoveBtn');
    var opacityRow = document.getElementById('logoOpacityRow');
    var slider = document.getElementById('logoOpacitySlider');
    var readout = document.getElementById('logoOpacityReadout');
    if(state.logo && state.logo.url){
      img.src = state.logo.url;
      wrap.hidden = false;
      removeBtn.hidden = false;
      opacityRow.hidden = false;
      slider.value = state.logo.opacity || 18;
      readout.textContent = (state.logo.opacity || 18) + '%';
    }else{
      wrap.hidden = true;
      removeBtn.hidden = true;
      opacityRow.hidden = true;
    }
  }

  document.getElementById('logoUploadBtn').addEventListener('click', function(){ document.getElementById('logoInput').click(); });
  document.getElementById('logoInput').addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    if(state.logo && state.logo.url) URL.revokeObjectURL(state.logo.url);
    state.logo = { name:file.name, mime:file.type || 'image/png', blob:file, url:URL.createObjectURL(file), opacity:18 };
    idbHydrationGen++;
    idbPut('logo', { name:state.logo.name, mime:state.logo.mime, blob:state.logo.blob, opacity:state.logo.opacity });
    updateStageLogo();
    updateLogoSettingsUI();
    saveState();
    e.target.value = '';
  });
  document.getElementById('logoRemoveBtn').addEventListener('click', function(){
    if(state.logo && state.logo.url) URL.revokeObjectURL(state.logo.url);
    state.logo = null;
    idbHydrationGen++;
    idbDelete('logo');
    updateStageLogo();
    updateLogoSettingsUI();
    saveState();
  });
  document.getElementById('logoOpacitySlider').addEventListener('input', function(e){
    if(!state.logo) return;
    state.logo.opacity = +e.target.value;
    document.getElementById('logoOpacityReadout').textContent = state.logo.opacity + '%';
    idbPut('logo', { name:state.logo.name, mime:state.logo.mime, blob:state.logo.blob, opacity:state.logo.opacity });
    updateStageLogo();
    saveStateDebounced();
  });

  function updateSongSettingsUI(){
    var nameEl = document.getElementById('songName');
    var removeBtn = document.getElementById('songRemoveBtn');
    if(state.song && state.song.url){
      nameEl.hidden = false;
      nameEl.textContent = 'Aktuell: ' + state.song.name;
      removeBtn.hidden = false;
    }else{
      nameEl.hidden = true;
      removeBtn.hidden = true;
    }
  }

  function applySongSource(){
    if(state.song && state.song.url){
      songAudioEl.src = state.song.url;
    }else{
      songAudioEl.removeAttribute('src');
      songAudioEl.pause();
    }
  }

  document.getElementById('songUploadBtn').addEventListener('click', function(){ document.getElementById('songInput').click(); });
  document.getElementById('songInput').addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    if(state.song && state.song.url) URL.revokeObjectURL(state.song.url);
    state.song = { name:file.name, mime:file.type || 'audio/mpeg', blob:file, url:URL.createObjectURL(file) };
    idbHydrationGen++;
    idbPut('song', { name:state.song.name, mime:state.song.mime, blob:state.song.blob });
    applySongSource();
    updateSongSettingsUI();
    resetBeatData();
    saveState();
    e.target.value = '';
  });
  document.getElementById('songRemoveBtn').addEventListener('click', function(){
    if(state.song && state.song.url) URL.revokeObjectURL(state.song.url);
    state.song = null;
    idbHydrationGen++;
    idbDelete('song');
    applySongSource();
    updateSongSettingsUI();
    resetBeatData();
    saveState();
  });

  /* ---------- wiring ---------- */

  addDancerBtn.addEventListener('click', addDancer);
  playBtn.addEventListener('click', playPause);
  prevBtn.addEventListener('click', function(){ selectFormation(Math.max(0, state.activeIndex-1)); });
  nextBtn.addEventListener('click', function(){ selectFormation(Math.min(state.formations.length-1, state.activeIndex+1)); });
  tempoSlider.addEventListener('input', function(){
    state.tempo = +tempoSlider.value;
    updateTempoReadout();
    saveState();
  });

  /* ---------- init ---------- */

  buildStageLayers();
  ensureMarkers();
  positionMarkers(currentFormation().pos);
  updateRoomLabelInputs();
  renderRoster();
  renderFilmstrip();
  updatePlaybarInfo();
  updatePlayButton();
  tempoSlider.value = state.tempo;
  updateTempoReadout();
  projectNameInput.value = state.projectName || '';
  document.title = (state.projectName || 'Aufstellung') + ' — Aufstellung';
  applySongSource();

  // Keeps the "TÄNZER" roster box exactly as tall as the stage box beside it (CSS Grid alone
  // can't cap a sibling's height to another's intrinsic/aspect-ratio-driven height — the roster's
  // own content would otherwise grow the whole grid row). The roster list then scrolls internally
  // within that fixed height (see .roster-list{flex:1;min-height:0;overflow-y:auto}).
  if(window.ResizeObserver && stageAreaEl && rosterEl){
    var roHeightObserver = new ResizeObserver(function(entries){
      rosterEl.style.height = entries[0].contentRect.height + 'px';
    });
    roHeightObserver.observe(stageAreaEl);
  }

  loadSharedProjectFromUrl();
  ensureFiguresLoaded();
  ensureLayoutsLoaded();
