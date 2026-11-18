"use strict";

/* ---------- project settings: stage size, logo (Bühne), song (Musik page) ---------- */

  // The fields stand open on their pages, so they follow every swap of the whole state (js/export.js).
  function updateSettingsUI(){
    stageWidthInput.value = stageSize().w;
    stageDepthInput.value = stageSize().d;
    updateLogoSettingsUI();
    updateSongSettingsUI();
  }

  // Design (#2165): Hell, Dunkel or like the device — per device; index.html's head applies it on load.
  var themeSelect = document.getElementById('themeSelect');
  try{ themeSelect.value = localStorage.getItem('aufstellung-theme') || ''; }catch(e){}
  themeSelect.addEventListener('change', function(){
    if(themeSelect.value) document.documentElement.dataset.theme = themeSelect.value;
    else delete document.documentElement.dataset.theme;
    try{ localStorage.setItem('aufstellung-theme', themeSelect.value); }catch(e){}
    drawDockTimeline(); // js/beats.js — the canvas takes its colours from the theme
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawDockTimeline);
  // The UI is Inter; the video export still draws with these two, which no element uses any more.
  if(document.fonts) ['500 12px "Manrope"', '700 12px "Manrope"', '600 12px "JetBrains Mono"', '700 12px "JetBrains Mono"'].forEach(function(f){ document.fonts.load(f); });

  helpBtn.addEventListener('click', function(){ helpBackdrop.hidden = false; });
  document.getElementById('helpMenuBtn').addEventListener('click', function(){ helpBackdrop.hidden = false; });
  helpCloseBtn.addEventListener('click', function(){ helpBackdrop.hidden = true; });
  helpBackdrop.addEventListener('click', function(e){ if(e.target === helpBackdrop) helpBackdrop.hidden = true; });
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    if(!confirmBackdrop.hidden){ closeConfirm(); return; } // only the popup, not the dialog behind it
    if(!helpBackdrop.hidden) helpBackdrop.hidden = true;
    if(!openBackdrop.hidden) closeOpenProjectsModal();
    if(!newChoreoBackdrop.hidden) closeNewChoreoModal();
    if(!videoBackdrop.hidden && exportState) exportState.cancelled = true;
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
    var has = !!(state.song && state.song.url);
    nameEl.textContent = has ? state.song.name : 'Noch kein Lied';
    nameEl.classList.toggle('empty', !has);
    removeBtn.hidden = !has;
    document.getElementById('songUploadBtn').textContent = has ? 'Anderes Lied …' : 'Lied wählen …';
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
  updateSettingsUI();

  /* ---------- Bilder | Tänzer, am Handy Tänzer und „Bild & Bühne“ als Blatt von unten ---------- */
  // Links stehen die Bilder oder die Tänzer (gemerkt). Am Handy laufen die Bilder als Streifen unter
  // der Bühne; die Tänzerliste und die Eigenschaften kommen dort als Blatt von unten.
  var phoneMq = window.matchMedia('(max-width:899.98px) and (orientation:portrait),(max-width:599.98px)');
  (function(){
    var KEY = 'aufstellung.sideTab';
    var bilderTab = document.getElementById('sideBilderTab');
    var taenzerTab = document.getElementById('sideTaenzerTab');
    var rosterBtn = document.getElementById('rosterToggleBtn');
    var inspectorBtn = document.getElementById('inspectorBtn');
    var scrim = document.getElementById('rosterScrim');
    var countEl = document.getElementById('dancerCount');
    var toggleCount = document.getElementById('rosterToggleCount');
    function setRoster(open, remember){
      document.body.classList.toggle('roster-open', open);
      if(open) document.body.classList.remove('inspector-open');
      bilderTab.setAttribute('aria-selected', open ? 'false' : 'true');
      taenzerTab.setAttribute('aria-selected', open ? 'true' : 'false');
      bilderTab.tabIndex = open ? -1 : 0;
      taenzerTab.tabIndex = open ? 0 : -1;
      rosterBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if(remember && !phoneMq.matches){ try{ localStorage.setItem(KEY, open ? 'taenzer' : 'bilder'); }catch(e){} }
    }
    function setInspector(open){
      document.body.classList.toggle('inspector-open', open);
      if(open) setRoster(false, false);
      inspectorBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function stored(){ try{ return localStorage.getItem(KEY); }catch(e){ return null; } }
    function initial(){ setInspector(false); setRoster(!phoneMq.matches && stored() === 'taenzer', false); }
    bilderTab.addEventListener('click', function(){ setRoster(false, true); });
    taenzerTab.addEventListener('click', function(){ setRoster(true, true); });
    bilderTab.parentNode.addEventListener('keydown', function(e){
      if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var toRoster = !document.body.classList.contains('roster-open');
      setRoster(toRoster, true);
      (toRoster ? taenzerTab : bilderTab).focus();
    });
    rosterBtn.addEventListener('click', function(){ setRoster(!document.body.classList.contains('roster-open'), false); });
    document.getElementById('rosterCloseBtn').addEventListener('click', function(){ setRoster(false, false); });
    inspectorBtn.addEventListener('click', function(){ setInspector(!document.body.classList.contains('inspector-open')); });
    document.getElementById('inspectorCloseBtn').addEventListener('click', function(){ setInspector(false); });
    scrim.addEventListener('click', function(){ setRoster(false, false); setInspector(false); });
    document.addEventListener('keydown', function(e){
      if(e.key !== 'Escape' || !phoneMq.matches) return;
      if(document.body.classList.contains('roster-open')) setRoster(false, false);
      if(document.body.classList.contains('inspector-open')) setInspector(false);
    });
    if(phoneMq.addEventListener) phoneMq.addEventListener('change', initial);
    function syncCount(){ toggleCount.textContent = countEl.textContent; }
    new MutationObserver(syncCount).observe(countEl, {childList:true, characterData:true, subtree:true});
    syncCount();
    initial();
    window.closeSideSheets = function(){ if(phoneMq.matches) setRoster(false, false); setInspector(false); };
  })();

  /* ---------- Projekt-Menü (Pfeil neben dem Namen) ---------- */
  // Neu, Öffnen, Design, Bedienung, Löschen.
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

  /* ---------- Arbeitsbereiche: Choreo · Musik · Teilen & Export ---------- */
  // Musik und Teilen & Export sind Seiten statt Dialoge. Ihre Ansichten öffnen und schließen
  // marker.js, beats.js, music.js, export.js, share.js und videolayout.js wie bisher über hidden;
  // hier steht nur, welche Seite zu sehen ist. Eine nicht sichtbare Seite hat keine offene Ansicht.
  (function(){
    var pages = {choreo: document.getElementById('wsChoreo'), musik: document.getElementById('wsMusik'), teilen: document.getElementById('wsTeilen')};
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.ws-tab'));
    var vlBackdrop = document.getElementById('videoLayoutBackdrop');
    var musikTabs = [document.getElementById('musikOpenBtn'), markerBtn, musicOnlyBtn];
    var musikViews = [mtBackdrop, markerBackdrop, musicBackdrop];
    var musikClose = [function(){ closeMusikView(true); }, closeMarkerModal, closeMusicModal];
    var lastMusik = markerBtn, current = 'choreo';

    function leave(ws){
      if(ws === 'musik') musikViews.forEach(function(v, i){ if(!v.hidden) musikClose[i](); });
      if(ws === 'teilen'){
        if(!vlBackdrop.hidden) closeVideoLayout();
        if(!exportBackdrop.hidden) closeExportDialog();
        if(!shareBackdrop.hidden) closeShareModal();
      }
    }
    function show(ws){
      if(ws !== current){
        leave(current);
        if(current === 'choreo'){
          if(document.body.classList.contains('dancer-view')) setDancerView(false); // js/dancerview.js
          pausePlayback();
          if(typeof closeSelectionMenu === 'function') closeSelectionMenu(); // js/stage.js
          window.closeSideSheets();
        }
        current = ws;
        Object.keys(pages).forEach(function(k){ pages[k].hidden = k !== ws; });
        document.body.dataset.ws = ws;
        tabs.forEach(function(t){ if(t.dataset.ws === ws) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
        document.body.classList.remove('menu-open');
      }
      if(ws === 'musik' && musikViews.every(function(v){ return v.hidden; })){
        var btn = [lastMusik].concat(musikTabs).filter(function(b){ return !b.disabled && b.offsetParent !== null; })[0] || markerBtn;
        btn.click();
      }
      if(ws === 'teilen'){
        if(shareBackdrop.hidden) openShareModal();
        if(exportBackdrop.hidden && vlBackdrop.hidden) openExportDialog();
      }
    }
    function syncMusikTabs(){
      musikViews.forEach(function(v, i){
        if(!v.hidden) lastMusik = musikTabs[i];
        musikTabs[i].setAttribute('aria-current', v.hidden ? 'false' : 'page');
      });
    }
    // Whoever opens a view (a tab, Teilen, „Alle Marken …“) brings its page along.
    var mo = new MutationObserver(function(records){
      records.forEach(function(r){
        var v = r.target;
        if(v.hidden) return;
        var ws = pages.musik.contains(v) ? 'musik' : 'teilen';
        if(ws !== current) show(ws);
        if(ws === 'musik') musikViews.forEach(function(o, i){ if(o !== v && !o.hidden) musikClose[i](); });
      });
      syncMusikTabs();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ws .view'), function(v){ mo.observe(v, {attributes: true, attributeFilter: ['hidden']}); });

    document.getElementById('wsChoreoTab').addEventListener('click', function(){ show('choreo'); });
    document.getElementById('wsMusikTab').addEventListener('click', function(){ show('musik'); });
    document.getElementById('bildMarksBtn').addEventListener('click', function(){ markerBtn.click(); });
    // exportBtn (the Teilen & Export tab) and shareBtn open their view themselves — the observer follows.
    document.body.dataset.ws = 'choreo';
    window.showWorkspace = show;
  })();
