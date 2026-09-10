"use strict";

var PALETTE = ['#e0a336','#4fa3a0','#8d79d1','#d1637d','#5b93c4','#8fae4f','#c96b3f','#a688c9'];
  var STORAGE_KEY = 'aufstellung-choreo-v2';
  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var GRID_MIN = -7, GRID_MAX = 7, GRID_SPAN = 14, GRID_INSET = 6;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function uid(prefix){ return prefix + '-' + Math.random().toString(36).slice(2,9); }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function normAngle(a){ return ((a % 360) + 360) % 360; }
  function lerpAngle(a,b,t){ var diff = (((b-a) % 360) + 540) % 360 - 180; return normAngle(a + diff*t); }
  function clampGrid(v){ return Math.min(GRID_MAX, Math.max(GRID_MIN, v)); }
  function gridToPercent(v){ return GRID_INSET + ((v-GRID_MIN)/GRID_SPAN)*(100-2*GRID_INSET); }
  function percentToGrid(p){ return ((p-GRID_INSET)/(100-2*GRID_INSET))*GRID_SPAN + GRID_MIN; }
  function roundNum(v){ return Math.round(v*10)/10; }
  // A plain {dancerId:{x,y}} copy of a pos map, detached from the source object — used to freeze a
  // Bild's own startPos (see addFormation/applyFigure) so later edits to the position it was
  // copied from never leak into it.
  function snapshotPos(pos){
    var out = {};
    Object.keys(pos || {}).forEach(function(id){ out[id] = {x: pos[id].x, y: pos[id].y}; });
    return out;
  }
  // Validates/repairs a formation's Zwischenpositionen (see interpolateThroughBetweens below) after
  // loading from anywhere untrusted (localStorage, an imported file, a share link) — same idea as
  // the per-Bild startPos/localAxes migrations around loadState(), just shared across the three
  // call sites (loadState here, parseStg in export.js, reconstructSharedState in share.js) since a
  // between's pos is a full per-dancer map rather than a single flat field.
  function sanitizeBetweens(betweens, dancers){
    if(!Array.isArray(betweens)) return [];
    var validIds = (dancers||[]).map(function(d){ return d.id; });
    return betweens.filter(function(b){ return b && typeof b === 'object' && b.pos && typeof b.pos === 'object'; }).map(function(b){
      var pos = {};
      validIds.forEach(function(id){
        var p = b.pos[id];
        pos[id] = {
          x: clampGrid(p && typeof p.x === 'number' ? p.x : 0),
          y: clampGrid(p && typeof p.y === 'number' ? p.y : 0),
          rot: normAngle(p && typeof p.rot === 'number' ? p.rot : 0)
        };
      });
      return {id: b.id || uid('bw'), name: typeof b.name === 'string' ? b.name.slice(0, 40) : '', pos: pos};
    });
  }
  // A move between two Bilder normally interpolates in one straight leg (fromPos -> toPos). If the
  // *from* Bild has Zwischenpositionen — poses along the way that don't get their own Bild/filmstrip
  // card, added via the "+" between filmstrip cards (see formations.js) — the same move instead
  // chains through each of them in turn, without changing the move's total duration: it's simply
  // divided evenly across (Zwischenpositionen + 1) legs, per "Gesamtlänge der Bewegung/(Anzahl der
  // Zwischenpositionen + 1)". Used by both playback paths (playback.js tick() and syncTick()), each
  // of which already has its own overall progress `overallT` (0..1) for the whole move — this just
  // resolves that into the right leg and re-eases within it. Betweens only apply when `toIdx` is
  // literally the next Bild after `fromIdx` (fromIdx+1) — sync playback can skip over Bilder with no
  // time marker of their own, and a between belongs to a specific gap, not to whatever pair of
  // Bilder happen to be interpolating at the moment.
  function interpolateThroughBetweens(fromIdx, toIdx, overallT){
    var fromF = state.formations[fromIdx], toF = state.formations[toIdx];
    var mids = (toIdx === fromIdx + 1 && Array.isArray(fromF.betweens)) ? fromF.betweens.map(function(b){ return b.pos; }) : [];
    var waypoints = [fromF.pos].concat(mids, [toF.pos]);
    var legCount = waypoints.length - 1;
    var scaled = Math.min(legCount - 1e-9, Math.max(0, overallT * legCount));
    var legIdx = Math.min(legCount - 1, Math.floor(scaled));
    var legT = overallT >= 1 ? 1 : (scaled - legIdx);
    var e = easeInOutCubic(legT);
    var a = waypoints[legIdx], b = waypoints[legIdx + 1];
    var interp = {};
    state.dancers.forEach(function(dd){
      var pa = a[dd.id] || {x:0,y:0,rot:0};
      var pb = b[dd.id] || {x:0,y:0,rot:0};
      interp[dd.id] = { x: pa.x + (pb.x-pa.x)*e, y: pa.y + (pb.y-pa.y)*e, rot: lerpAngle(pa.rot||0, pb.rot||0, e) };
    });
    return interp;
  }
  function easeInOutCubic(t){ return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }
  function paletteColor(i){
    if(i < PALETTE.length) return PALETTE[i];
    var hue = (i*137.508) % 360;
    return 'hsl(' + hue.toFixed(0) + ',48%,54%)';
  }
  // Shared "click again to confirm" pattern for small icon-only delete buttons (roster remove,
  // Bild remove) — same idea as the text-swapping resetBtn confirm, adapted for buttons with no
  // room for a label: a CSS-driven "armed" state stands in for the text change, and a second
  // click within the window actually deletes. Attaches its own click listener; callers don't add
  // one themselves.
  function armDeleteButton(btn, onConfirm){
    var armed = false, timer = null;
    function disarm(){
      armed = false;
      clearTimeout(timer);
      btn.classList.remove('armed');
    }
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      if(armed){
        disarm();
        onConfirm();
      }else{
        armed = true;
        btn.classList.add('armed');
        timer = setTimeout(disarm, 2500);
      }
    });
  }

  function initials(name){
    var parts = name.trim().split(/\s+/).filter(Boolean);
    if(!parts.length) return '?';
    if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function defaultState(){
    var names = ['1','2','3','4','5'];
    var dancers = names.map(function(name,i){ return {id:uid('d'), name:name, color:paletteColor(i)}; });

    var startlinie = {};
    dancers.forEach(function(d,i){
      var t = dancers.length>1 ? i/(dancers.length-1) : 0.5;
      startlinie[d.id] = {x: roundNum(-6 + t*12), y: 5, rot: 0};
    });

    var kreis = {};
    dancers.forEach(function(d,i){
      var angle = (i/dancers.length)*Math.PI*2 - Math.PI/2;
      kreis[d.id] = {x: roundNum(Math.cos(angle)*4.5), y: roundNum(Math.sin(angle)*4), rot: 0};
    });

    var diagonale = {};
    dancers.forEach(function(d,i){
      var t = dancers.length>1 ? i/(dancers.length-1) : 0.5;
      diagonale[d.id] = {x: roundNum(-6 + t*12), y: roundNum(-6 + t*12), rot: 0};
    });

    return {
      projectName: 'Meine Formation',
      dancers: dancers,
      formations: [
        // startPos is this Bild's *own* frozen starting position — snapshotted once, equal to `pos`
        // until a dancer is actually dragged within this Bild, at which point their gray "came from
        // here" dot appears (see renderOnionSkin()). It is never a pointer at the previous Bild:
        // landing on an untouched Bild shows only the dancers, no gray ghost.
        {id:uid('f'), name:'Startlinie', pos: startlinie, showAxes:true, localAxes:[], category:'', startPos: snapshotPos(startlinie), betweens: []},
        {id:uid('f'), name:'Kreis', pos: kreis, showAxes:true, localAxes:[], category:'', startPos: snapshotPos(kreis), betweens: []},
        {id:uid('f'), name:'Diagonale', pos: diagonale, showAxes:true, localAxes:[], category:'', startPos: snapshotPos(diagonale), betweens: []}
      ],
      axes: [],
      showAxes: true,
      roomLabels: {top:'WAND', right:'SPIEGEL', bottom:'EINGANG', left:'FENSTER'},
      pairs: [],
      customFigures: [],
      logo: null,
      song: null,
      activeIndex: 0,
      tempo: 50,
      // Local-only pointer at a live share (see js/share.js) — null until "Teilen" is used (or a
      // ?share=<id> link is opened), never itself part of what gets pushed to/pulled from the
      // server, and never written into .stg/.auf exports (buildProjectHeader doesn't reference it).
      sharedId: null,
      // Schreib-Token für den gebundenen Share (aus create.php bzw. ?t= im Bearbeiten-Link).
      // Fehlt es und shareReadOnly ist true, wurde ein reiner Nur-Ansehen-Link geöffnet:
      // dann werden lokale Änderungen nicht mehr hochgeladen (js/state.js saveState).
      shareEditToken: null,
      shareReadOnly: false,
      // Stable per-project key the undo/redo history (js/history.js) is filed under while a project
      // isn't bound to a share link. Local-only, like sharedId.
      localId: uid('proj')
    };
  }

  function loadState(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      var parsed = JSON.parse(raw);
      if(!parsed || !parsed.dancers || !parsed.formations || !parsed.formations.length) return defaultState();
      if(typeof parsed.tempo !== 'number') parsed.tempo = 50;
      if(typeof parsed.activeIndex !== 'number' || parsed.activeIndex >= parsed.formations.length) parsed.activeIndex = 0;
      if(typeof parsed.projectName !== 'string' || !parsed.projectName.trim()) parsed.projectName = 'Meine Formation';
      if(!Array.isArray(parsed.axes)) parsed.axes = [];
      if(typeof parsed.showAxes !== 'boolean') parsed.showAxes = true;
      // migration: older saves predate editable room-orientation labels entirely
      var defaultRoomLabels = {top:'WAND', right:'SPIEGEL', bottom:'EINGANG', left:'FENSTER'};
      if(!parsed.roomLabels || typeof parsed.roomLabels !== 'object') parsed.roomLabels = {};
      ['top','right','bottom','left'].forEach(function(side){
        if(typeof parsed.roomLabels[side] !== 'string') parsed.roomLabels[side] = defaultRoomLabels[side];
      });
      if(!Array.isArray(parsed.pairs)) parsed.pairs = [];
      var knownDancerIds = parsed.dancers.map(function(d){ return d.id; });
      parsed.pairs = parsed.pairs.filter(function(p){
        return p && Array.isArray(p.memberIds) && p.memberIds.length === 2 &&
          knownDancerIds.indexOf(p.memberIds[0]) !== -1 && knownDancerIds.indexOf(p.memberIds[1]) !== -1;
      });
      parsed.pairs.forEach(function(p){
        if(typeof p.name !== 'string') p.name = '';
        if(typeof p.collapsed !== 'boolean') p.collapsed = false;
      });
      if(!Array.isArray(parsed.customFigures)) parsed.customFigures = [];
      parsed.customFigures = parsed.customFigures.filter(function(fig){
        return fig && typeof fig.name === 'string' && fig.transform && typeof fig.transform === 'object';
      });
      if(typeof parsed.sharedId !== 'string' || !parsed.sharedId) parsed.sharedId = null;
      if(typeof parsed.shareEditToken !== 'string' || !parsed.shareEditToken) parsed.shareEditToken = null;
      // Vor diesem Feature gespeicherte Bindungen haben kein shareReadOnly-Feld -> als
      // bearbeitbar behandeln (der Server lässt Alt-Links mit edit_token IS NULL ohnehin durch).
      parsed.shareReadOnly = parsed.shareReadOnly === true;
      if(typeof parsed.localId !== 'string' || !parsed.localId) parsed.localId = uid('proj');
      // logo/song blobs are never stored in this localStorage JSON (too large/binary) — they're
      // persisted separately in IndexedDB and hydrated back in via hydrateBlobsFromIdb().
      parsed.logo = null;
      parsed.song = null;
      parsed.formations.forEach(function(f, i){
        Object.keys(f.pos).forEach(function(id){
          if(typeof f.pos[id].rot !== 'number') f.pos[id].rot = 0;
        });
        // migration: older saves only had the single global `showAxes` — fall back to it per Bild
        if(typeof f.showAxes !== 'boolean') f.showAxes = parsed.showAxes;
        // migration: older saves predate per-Bild-only axes entirely
        if(!Array.isArray(f.localAxes)) f.localAxes = [];
        // migration: older saves predate section categories entirely
        if(typeof f.category !== 'string') f.category = '';
        // migration: older saves predate the fixed per-Bild startPos snapshot (see
        // renderOnionSkin()). Seed it from the Bild's *own* current pos — same as a freshly
        // created Bild (addFormation/applyFigure) — so nothing shows until a dancer is dragged,
        // rather than back-filling the previous Bild's pos and lighting up ghosts everywhere.
        if(!f.startPos || typeof f.startPos !== 'object'){
          f.startPos = snapshotPos(f.pos);
        }
        // migration: older saves predate Zwischenpositionen entirely — see interpolateThroughBetweens()
        f.betweens = sanitizeBetweens(f.betweens, parsed.dancers);
      });
      return parsed;
    }catch(e){ return defaultState(); }
  }
  function saveState(){
    try{
      var toSave = {
        projectName: state.projectName,
        dancers: state.dancers,
        formations: state.formations,
        axes: state.axes,
        showAxes: state.showAxes,
        roomLabels: state.roomLabels,
        pairs: state.pairs,
        customFigures: state.customFigures,
        activeIndex: state.activeIndex,
        tempo: state.tempo,
        sharedId: state.sharedId,
        shareEditToken: state.shareEditToken,
        shareReadOnly: state.shareReadOnly,
        localId: state.localId
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    }catch(e){}
    // Every mutation in the app funnels through saveState() (directly or via saveStateDebounced),
    // so this is the one choke point that guarantees "bound to a live share -> every edit
    // propagates" without every individual call site needing to know about sharing. Soft dependency
    // (js/share.js defines this) so state.js — loaded first — doesn't need to know share.js exists;
    // by the time any edit actually happens, every script has finished loading regardless of order.
    if(state.sharedId && !state.shareReadOnly && typeof schedulePushSharedUpdate === 'function') schedulePushSharedUpdate();
    // Same soft-dependency trick for the undo/redo history (js/history.js) — one debounced snapshot
    // per settled edit, skipped while history itself is applying an undo/redo/merge.
    if(typeof captureHistorySoon === 'function') captureHistorySoon();
  }
  var saveStateDebounced = (function(){
    var timer = null;
    return function(){ clearTimeout(timer); timer = setTimeout(saveState, 400); };
  })();

  /* ---------- IndexedDB persistence for logo/song blobs (too large/binary for localStorage) ---------- */
  var IDB_NAME = 'aufstellung-blobs';
  var IDB_STORE = 'blobs';
  var idbHydrationGen = 0; // bumped whenever the user removes a logo/song, so a late in-flight hydration read can't resurrect it

  function idbOpen(){
    return new Promise(function(resolve, reject){
      if(!window.indexedDB){ reject(new Error('IndexedDB nicht verfügbar')); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function(){ req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
  }
  function idbPut(key, val){
    return idbOpen().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = function(){ resolve(); };
        tx.onerror = function(){ reject(tx.error); };
      });
    }).catch(function(){});
  }
  function idbDelete(key){
    return idbOpen().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = function(){ resolve(); };
        tx.onerror = function(){ reject(tx.error); };
      });
    }).catch(function(){});
  }
  function idbGet(key){
    return idbOpen().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function(){ resolve(req.result || null); };
        req.onerror = function(){ reject(req.error); };
      });
    }).catch(function(){ return null; });
  }

  function hydrateBlobsFromIdb(){
    var myGen = idbHydrationGen;
    idbGet('logo').then(function(rec){
      if(!rec || !rec.blob || idbHydrationGen !== myGen) return;
      state.logo = { name:rec.name, mime:rec.mime, blob:rec.blob, url:URL.createObjectURL(rec.blob), opacity:rec.opacity||18 };
      updateStageLogo();
      if(!settingsBackdrop.hidden) updateLogoSettingsUI();
    });
    idbGet('song').then(function(rec){
      if(!rec || !rec.blob || idbHydrationGen !== myGen) return;
      state.song = { name:rec.name, mime:rec.mime, blob:rec.blob, url:URL.createObjectURL(rec.blob) };
      applySongSource();
      if(!settingsBackdrop.hidden) updateSongSettingsUI();
    });
  }

  // Overwrites the IndexedDB logo/song records to match the current in-memory state — used
  // whenever `state` is replaced wholesale (import, reset) rather than edited via the upload/remove
  // handlers above (which keep IndexedDB in sync themselves).
  function syncBlobsToIdb(){
    idbHydrationGen++;
    if(state.logo && state.logo.blob) idbPut('logo', { name:state.logo.name, mime:state.logo.mime, blob:state.logo.blob, opacity:state.logo.opacity });
    else idbDelete('logo');
    if(state.song && state.song.blob) idbPut('song', { name:state.song.name, mime:state.song.mime, blob:state.song.blob });
    else idbDelete('song');
  }

  var state = loadState();
  hydrateBlobsFromIdb();
  var selectedDancerId = null;
  // dancerIds chosen via Strg/Cmd-Klick (or auto-populated with a saved pair's members on a plain
  // click) — rotated together around their centroid; exactly 2 also unlocks "als Paar speichern".
  var pairSelection = [];
  var stageMarkers = {}; // dancerId -> element
  var rosterCoordInputs = {}; // dancerId -> {x, y} input elements
  var rosterPairMidpointInputs = {}; // pairId -> {x, y} input elements (only present while collapsed)
  var rosterRowEls = {}; // dancerId -> .dancer-row element
  var rosterPairGroupEls = {}; // pairId -> .pair-group element

  // Non-null while posing a Zwischenposition on the stage instead of the active Bild itself — see
  // currentFormation() below and enterBetweenEdit()/exitBetweenEdit() in formations.js. {fIdx, bIdx}:
  // the Bild it belongs after, and its index within that Bild's own `betweens` array.
  var editingBetween = null;

  var playing = false, phaseStart = 0, fromIdx = 0, toIdx = 0, rafId = null, syncActive = false;

  var stageEl = document.getElementById('stage');
  var stageAreaEl = document.querySelector('.stage-area');
  var roomLabelInputs = {
    top: document.getElementById('roomLabelTop'),
    right: document.getElementById('roomLabelRight'),
    bottom: document.getElementById('roomLabelBottom'),
    left: document.getElementById('roomLabelLeft')
  };
  var rosterEl = document.querySelector('.roster');
  var pairRotateEl = document.getElementById('pairRotate');
  var pairRotateLabelEl = document.getElementById('pairRotateLabel');
  var pairRotateAngleInput = document.getElementById('pairRotateAngle');
  var pairRotateBtn = document.getElementById('pairRotateBtn');
  var pairSaveBtn = document.getElementById('pairSaveBtn');
  var pairSameRoleBtn = document.getElementById('pairSameRoleBtn');
  var pairRotateClearBtn = document.getElementById('pairRotateClearBtn');
  var rosterListEl = document.getElementById('rosterList');
  var dancerCountEl = document.getElementById('dancerCount');
  var addDancerBtn = document.getElementById('addDancerBtn');
  var filmTrackEl = document.getElementById('filmTrack');
  var playBtn = document.getElementById('playBtn');
  var iconPlay = document.getElementById('iconPlay');
  var iconPause = document.getElementById('iconPause');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var activeNameEl = document.getElementById('activeName');
  var activeReadoutEl = document.getElementById('activeReadout');
  var progressFillEl = document.getElementById('progressFill');
  var tempoSlider = document.getElementById('tempoSlider');
  var tempoReadoutEl = document.getElementById('tempoReadout');
  var exportBtn = document.getElementById('exportBtn');
  var importBtn = document.getElementById('importBtn');
  var importInput = document.getElementById('importInput');
  var importErrorEl = document.getElementById('importError');
  var resetBtn = document.getElementById('resetBtn');
  var projectNameInput = document.getElementById('projectNameInput');
  var videoExportBtn = document.getElementById('videoExportBtn');
  var settingsBtn = document.getElementById('settingsBtn');
  var settingsBackdrop = document.getElementById('settingsBackdrop');
  var settingsCloseBtn = document.getElementById('settingsCloseBtn');
  var videoBackdrop = document.getElementById('videoBackdrop');
  var videoProgressFill = document.getElementById('videoProgressFill');
  var videoStatusText = document.getElementById('videoStatusText');
  var videoCancelBtn = document.getElementById('videoCancelBtn');
  var songAudioEl = new Audio();
  songAudioEl.preload = 'auto';
  songAudioEl.addEventListener('ended', function(){
    if(!syncActive) return;
    playing = false;
    cancelAnimationFrame(rafId);
    updatePlayButton();
    renderOnionSkin(); // sync playback finished — redraw ghosts with editing semantics
  });

  // Almost every stage/roster edit function reads/writes through currentFormation().pos rather than
  // reaching into state.formations directly — which means overriding what it returns while
  // editingBetween is set (see above) is enough to make dragging on the stage, the roster's numeric
  // inputs, keyboard nudging and pair-rotate all transparently pose a Zwischenposition instead of
  // the real active Bild, with no changes needed in any of them. The synthetic object forwards
  // showAxes/localAxes reads *and writes* to the real anchor Bild (there's no separate per-
  // Zwischenposition concept for either) via getters/setters rather than a plain copy.
  function currentFormation(){
    if(editingBetween){
      var anchor = state.formations[editingBetween.fIdx];
      var between = anchor && anchor.betweens && anchor.betweens[editingBetween.bIdx];
      if(anchor && between){
        return {
          id: anchor.id + ':between:' + between.id,
          name: 'Zwischenposition ' + (editingBetween.bIdx + 1) + (between.name ? ' — ' + between.name : '')
            + ' (' + anchor.name + ' → ' + (state.formations[editingBetween.fIdx+1]||{}).name + ')',
          pos: between.pos,
          category: anchor.category,
          get showAxes(){ return anchor.showAxes; },
          set showAxes(v){ anchor.showAxes = v; },
          get localAxes(){ return anchor.localAxes; },
          set localAxes(v){ anchor.localAxes = v; }
        };
      }
      editingBetween = null; // stale pointer (Bild/between deleted from under it) — fall through
    }
    return state.formations[state.activeIndex];
  }

  function durations(){
    var t = state.tempo/100;
    return { move: lerp(2200,500,t), hold: lerp(1600,300,t) };
  }
