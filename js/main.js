"use strict";

/* ---------- settings panel: project name, logo, song ---------- */

  function openSettings(){
    stageWidthInput.value = stageSize().w;
    stageDepthInput.value = stageSize().d;
    updateLogoSettingsUI();
    updateSongSettingsUI();
    settingsBackdrop.hidden = false;
  }
  function closeSettings(){ settingsBackdrop.hidden = true; }

  // Design (#2165): Hell, Dunkel or like the device — per device; index.html's head applies it on load.
  var themeSelect = document.getElementById('themeSelect');
  try{ themeSelect.value = localStorage.getItem('aufstellung-theme') || ''; }catch(e){}
  themeSelect.addEventListener('change', function(){
    if(themeSelect.value) document.documentElement.dataset.theme = themeSelect.value;
    else delete document.documentElement.dataset.theme;
    try{ localStorage.setItem('aufstellung-theme', themeSelect.value); }catch(e){}
  });

  settingsBtn.addEventListener('click', openSettings);
  settingsCloseBtn.addEventListener('click', closeSettings);
  settingsBackdrop.addEventListener('click', function(e){ if(e.target === settingsBackdrop) closeSettings(); });
  helpBtn.addEventListener('click', function(){ helpBackdrop.hidden = false; });
  helpCloseBtn.addEventListener('click', function(){ helpBackdrop.hidden = true; });
  helpBackdrop.addEventListener('click', function(e){ if(e.target === helpBackdrop) helpBackdrop.hidden = true; });
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    if(!confirmBackdrop.hidden){ closeConfirm(); return; } // only the popup, not the dialog behind it
    if(!settingsBackdrop.hidden) closeSettings();
    if(!helpBackdrop.hidden) helpBackdrop.hidden = true;
    if(!openBackdrop.hidden) closeOpenProjectsModal();
    if(!newChoreoBackdrop.hidden) closeNewChoreoModal();
    if(!videoBackdrop.hidden && exportState) exportState.cancelled = true;
    if(!exportBackdrop.hidden) closeExportDialog();
    if(!markerBackdrop.hidden) closeMarkerModal();
    if(!musicBackdrop.hidden) closeMusicModal();
    if(!addBildBackdrop.hidden) closeAddBildModal();
    if(!videosBackdrop.hidden) closeVideos();
    var hb = document.getElementById('historyBackdrop');
    if(hb && !hb.hidden && typeof closeHistoryPanel === 'function') closeHistoryPanel();
    var mb = document.getElementById('mergeBackdrop');
    if(mb && !mb.hidden && typeof closeMergeModal === 'function'){ pendingMerge = null; closeMergeModal(); }
  });

  // Rückgängig / Wiederholen (js/history.js) — not while typing in a field.
  document.addEventListener('keydown', function(e){
    if(!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var ae = document.activeElement;
    if(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    var k = (e.key || '').toLowerCase();
    if(k === 'z' && !e.shiftKey){ e.preventDefault(); if(typeof historyUndo === 'function') historyUndo(); }
    else if((k === 'z' && e.shiftKey) || k === 'y'){ e.preventDefault(); if(typeof historyRedo === 'function') historyRedo(); }
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
    idbPut(idbBlobKey('logo'), { name:state.logo.name, mime:state.logo.mime, blob:state.logo.blob, opacity:state.logo.opacity });
    updateStageLogo();
    updateLogoSettingsUI();
    saveState();
    e.target.value = '';
  });
  document.getElementById('logoRemoveBtn').addEventListener('click', function(){
    confirmDelete('Logo entfernen?', function(){
      if(state.logo && state.logo.url) URL.revokeObjectURL(state.logo.url);
      state.logo = null;
      idbHydrationGen++;
      idbDelete(idbBlobKey('logo'));
      updateStageLogo();
      updateLogoSettingsUI();
      saveState();
    }, this, 'Entfernen');
  });
  document.getElementById('logoOpacitySlider').addEventListener('input', function(e){
    if(!state.logo) return;
    state.logo.opacity = +e.target.value;
    document.getElementById('logoOpacityReadout').textContent = state.logo.opacity + '%';
    idbPut(idbBlobKey('logo'), { name:state.logo.name, mime:state.logo.mime, blob:state.logo.blob, opacity:state.logo.opacity });
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

  // Chrome jumps in a VBR MP3 by the file's coarse seek table, up to 2 s off the sound played
  // straight through — marks set after a jump didn't fit playback from the start (#2093). Fed
  // through a MediaSource the browser counts the frames itself, so every jump lands exactly; it
  // holds the compressed file, not a decoded copy. The duration only arrives with endOfStream(),
  // hence 'durationchange' rather than 'loadedmetadata' wherever the length is needed.
  // Whatever MSE can't take (no audio/mpeg support, a mislabelled file) plays the plain file as before.
  // The same song isn't loaded again on every fullRerender: that left the length unknown for a moment.
  var songSourceUrl = null, appliedSongUrl = null;
  function applySongSource(){
    var song = state.song;
    if(song && song.url && song.url === appliedSongUrl){ applyTempo(); updateSyncBadge(); return; }
    appliedSongUrl = song && song.url;
    if(songSourceUrl){ URL.revokeObjectURL(songSourceUrl); songSourceUrl = null; }
    if(song && song.blob && /mpeg|mp3/i.test(song.mime + ' ' + song.name) && window.MediaSource && MediaSource.isTypeSupported('audio/mpeg')){
      var ms = new MediaSource(), url = songSourceUrl = URL.createObjectURL(ms);
      var plain = function(){ if(songSourceUrl === url) songAudioEl.src = song.url; };
      songAudioEl.src = url;
      ms.addEventListener('sourceopen', function(){
        song.blob.arrayBuffer().then(function(buf){
          var sb = ms.addSourceBuffer('audio/mpeg');
          sb.addEventListener('error', plain);
          sb.addEventListener('updateend', function(){
            if(!sb.buffered.length) plain(); // not an MP3 after all
            else if(ms.readyState === 'open') ms.endOfStream();
          });
          sb.appendBuffer(buf);
        }).catch(plain);
      }, {once:true});
    }else if(song && song.url){
      songAudioEl.src = song.url;
    }else{
      songAudioEl.removeAttribute('src');
      songAudioEl.pause();
    }
    applyTempo(); // the readout switches between Bilder/s and the song's speed
    updateSyncBadge(); // no song, no sync badge or timeline ticks (js/marker.js)
  }

  document.getElementById('songUploadBtn').addEventListener('click', function(){ document.getElementById('songInput').click(); });
  document.getElementById('songInput').addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    if(state.song && state.song.url) URL.revokeObjectURL(state.song.url);
    // An .mp4 (e.g. a downloaded music video) works too — <audio> just plays its sound track.
    var mime = file.type || (/\.(mp4|m4a)$/i.test(file.name) ? 'audio/mp4' : 'audio/mpeg');
    state.song = { name:file.name, mime:mime, blob:file, url:URL.createObjectURL(file) };
    state.beats = null; // they belonged to the old song (#2041)
    state.music = null;
    idbHydrationGen++;
    idbPut(idbBlobKey('song'), { name:state.song.name, mime:state.song.mime, blob:state.song.blob });
    applySongSource();
    updateSongSettingsUI();
    saveState();
    e.target.value = '';
  });
  document.getElementById('songRemoveBtn').addEventListener('click', function(){
    confirmDelete('Lied entfernen?', function(){
      if(state.song && state.song.url) URL.revokeObjectURL(state.song.url);
      state.song = null;
      state.beats = null;
      state.music = null;
      idbHydrationGen++;
      idbDelete(idbBlobKey('song'));
      applySongSource();
      updateSongSettingsUI();
      saveState();
    }, this, 'Entfernen');
  });

  var facingToggle = document.getElementById('facingToggle');
  function applyFacingVisibility(){
    document.body.classList.toggle('hide-facing', state.showFacing === false);
    facingToggle.checked = state.showFacing !== false;
  }
  facingToggle.addEventListener('change', function(){
    state.showFacing = facingToggle.checked;
    applyFacingVisibility();
    saveState();
  });
  applyFacingVisibility();

  // Bühnengröße (#2060). Whoever would stand outside a smaller stage is brought to its edge.
  var stageWidthInput = document.getElementById('stageWidthInput');
  var stageDepthInput = document.getElementById('stageDepthInput');
  function applyStageSizeInputs(){
    var next = sanitizeStage({w: parseFloat(stageWidthInput.value), d: parseFloat(stageDepthInput.value)});
    stageWidthInput.value = next.w;
    stageDepthInput.value = next.d;
    if(next.w === stageSize().w && next.d === stageSize().d) return;
    state.stage = next;
    state.formations.forEach(function(f){
      [f.pos, f.startPos].concat((f.betweens || []).map(function(b){ return b.pos; })).forEach(function(pos){
        if(pos) Object.keys(pos).forEach(function(k){ pos[k].x = clampX(pos[k].x); pos[k].y = clampY(pos[k].y); });
      });
    });
    saveState();
    fullRerender();
  }
  stageWidthInput.addEventListener('change', applyStageSizeInputs);
  stageDepthInput.addEventListener('change', applyStageSizeInputs);

  /* ---------- wiring ---------- */

  addDancerBtn.addEventListener('click', addDancer);
  playBtn.addEventListener('click', playPause);
  prevBtn.addEventListener('click', function(){ selectFormation(Math.max(0, state.activeIndex-1)); });
  nextBtn.addEventListener('click', function(){ selectFormation(Math.min(state.formations.length-1, state.activeIndex+1)); });
  tempoSlider.addEventListener('input', function(){ setTempo(+tempoSlider.value); });
  wireTempoInput(tempoInputEl, function(r){ setTempo(state.song && state.song.url ? songTempoForRate(r) : bilderTempoForRate(r)); });

  /* ---------- init ---------- */

  buildStageLayers();
  ensureMarkers();
  positionMarkers(currentFormation().pos);
  updateRoomLabelInputs();
  renderRoster();
  renderFilmstrip();
  updatePlaybarInfo();
  updatePlayButton();
  projectNameInput.value = state.projectName || '';
  document.title = (state.projectName || 'Aufstellung') + ' — Aufstellung';
  applySongSource();

  var openingShareLink = /[?&]share=/.test(location.search);
  loadSharedProjectFromUrl();
  // With a ?share= link, js/share.js re-keys the history to the share id once the project loads;
  // otherwise start it now against the local project.
  if(!openingShareLink && typeof initHistory === 'function') initHistory();
  // A share link brings its own project (new localId), so only check right away without one.
  startTabProjectGuard(!openingShareLink);
  ensureFiguresLoaded();
  renderLayoutSelectOptions();

  /* ---------- Tänzer-Schublade ---------- */
  // Breit genug (≥1200px): die Liste steht neben der Bühne und merkt sich, ob sie offen war.
  // Schmaler: sie legt sich über die Bühne und startet immer geschlossen.
  (function(){
    var KEY = 'aufstellung.rosterOpen';
    var toggleBtn = document.getElementById('rosterToggleBtn');
    var closeBtn = document.getElementById('rosterCloseBtn');
    var scrim = document.getElementById('rosterScrim');
    var countEl = document.getElementById('dancerCount');
    var toggleCount = document.getElementById('rosterToggleCount');
    var wideMq = window.matchMedia('(min-width:1200px)');
    function stored(){ try{ return localStorage.getItem(KEY); }catch(e){ return null; } }
    function setOpen(open, remember){
      document.body.classList.toggle('roster-open', open);
      if(open) document.body.classList.remove('menu-open');
      toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggleBtn.classList.toggle('active', open);
      if(remember && wideMq.matches){ try{ localStorage.setItem(KEY, open ? '1' : '0'); }catch(e){} }
    }
    function initial(){ setOpen(wideMq.matches && stored() !== '0', false); }
    toggleBtn.addEventListener('click', function(){ setOpen(!document.body.classList.contains('roster-open'), true); });
    closeBtn.addEventListener('click', function(){ setOpen(false, true); });
    scrim.addEventListener('click', function(){ setOpen(false, false); });
    if(wideMq.addEventListener) wideMq.addEventListener('change', initial);
    function syncCount(){ toggleCount.textContent = countEl.textContent; }
    new MutationObserver(syncCount).observe(countEl, {childList:true, characterData:true, subtree:true});
    syncCount();
    initial();
  })();

  /* ---------- „Mehr“-Menü ---------- */
  // Am Handy liegen alle Aktionen der Kopfleiste in einer Ausklappliste, auf dem Desktop nur
  // die seltenen (.tb-rare) – welche, regelt allein das CSS.
  (function(){
    var moreBtn = document.getElementById('moreBtn');
    var menu = document.getElementById('topbarMenu');
    var scrim = document.getElementById('menuScrim');
    function setMenu(open){
      document.body.classList.toggle('menu-open', open);
      moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    moreBtn.addEventListener('click', function(){ setMenu(!document.body.classList.contains('menu-open')); });
    scrim.addEventListener('click', function(){ setMenu(false); });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && document.body.classList.contains('menu-open')) setMenu(false);
    });
    // Jede Aktion schließt das Menü.
    menu.addEventListener('click', function(e){
      var btn = e.target.closest('button');
      if(!btn) return;
      setMenu(false);
    });
  })();
