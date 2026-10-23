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
  // How a move runs through its Zwischenpositionen (a per-Bild setting, like the betweens list it
  // belongs to): 'corner' = straight legs that turn sharply at each one, 'smooth' = one rounded,
  // flowing curve through all of them (see smoothLeg below). Unknown/missing means 'corner', which is
  // how every move played before the setting existed.
  function sanitizeBetweenPath(v){ return v === 'smooth' ? 'smooth' : 'corner'; }
  // A move between two Bilder normally interpolates in one straight leg (fromPos -> toPos). If the
  // *from* Bild has Zwischenpositionen — poses along the way that don't get their own Bild/filmstrip
  // card, added via the "+" between filmstrip cards (see formations.js) — the same move instead
  // chains through each of them in turn, without changing the move's total duration: it's simply
  // divided evenly across (Zwischenpositionen + 1) legs, per "Gesamtlänge der Bewegung/(Anzahl der
  // Zwischenpositionen + 1)". Used by both playback paths (playback.js tick() and syncTick()), each
  // of which already has its own overall progress `overallT` (0..1) for the whole move — this eases
  // that once for the whole move and then resolves it into the right leg, so the dancers keep going
  // through each Zwischenposition instead of stopping there. Betweens only apply when `toIdx` is
  // literally the next Bild after `fromIdx` (fromIdx+1) — sync playback can skip over Bilder with no
  // time marker of their own, and a between belongs to a specific gap, not to whatever pair of
  // Bilder happen to be interpolating at the moment.
  function interpolateThroughBetweens(fromIdx, toIdx, overallT){
    var fromF = state.formations[fromIdx], toF = state.formations[toIdx];
    var mids = (toIdx === fromIdx + 1 && Array.isArray(fromF.betweens)) ? fromF.betweens.map(function(b){ return b.pos; }) : [];
    var waypoints = [fromF.pos].concat(mids, [toF.pos]);
    var legCount = waypoints.length - 1;
    var eAll = easeMove(overallT >= 1 ? 1 : Math.max(0, overallT));
    var scaled = Math.min(legCount - 1e-9, eAll * legCount);
    var legIdx = Math.min(legCount - 1, Math.floor(scaled));
    var e = overallT >= 1 ? 1 : (scaled - legIdx);
    var a = waypoints[legIdx], b = waypoints[legIdx + 1];
    var smooth = mids.length && sanitizeBetweenPath(fromF.betweenPath) === 'smooth';
    var interp = {};
    state.dancers.forEach(function(dd){
      var pa = a[dd.id] || {x:0,y:0,rot:0};
      var pb = b[dd.id] || {x:0,y:0,rot:0};
      interp[dd.id] = { x: pa.x + (pb.x-pa.x)*e, y: pa.y + (pb.y-pa.y)*e, rot: lerpAngle(pa.rot||0, pb.rot||0, e) };
      if(smooth){
        var c = smoothLeg(waypoints.map(function(w){ return w[dd.id] || {x:0,y:0}; }), legIdx, e);
        interp[dd.id].x = clampGrid(c.x); interp[dd.id].y = clampGrid(c.y);
      }
    });
    // Split couples: the Follow travels straight (no betweens) from its own spot — or out of the
    // couple's dot if it wasn't split before — to its next spot, or back into the dot.
    state.dancers.forEach(function(dd){
      var k = followKey(dd.id);
      if(!fromF.pos[k] && !toF.pos[k]) return;
      var pa = fromF.pos[k] || fromF.pos[dd.id] || {x:0,y:0,rot:0};
      var pb = toF.pos[k] || toF.pos[dd.id] || {x:0,y:0,rot:0};
      interp[k] = { x: pa.x + (pb.x-pa.x)*eAll, y: pa.y + (pb.y-pa.y)*eAll, rot: lerpAngle(pa.rot||0, pb.rot||0, eAll) };
    });
    // Turning within a couple: if Lead and Follow are apart in both Bilder, they don't walk straight
    // (and possibly right through each other) — see turnCouple below. Only for a plain move without
    // Zwischenpositionen: those are hand-placed paths and are followed as-is. Without betweens the
    // single leg above ran on eAll too, so overwriting both positions here stays in step.
    if(!mids.length){
      state.dancers.forEach(function(dd){
        var k = followKey(dd.id);
        if(fromF.pos[k] && toF.pos[k] && fromF.pos[dd.id] && toF.pos[dd.id]) turnCouple(interp, dd.id, k, fromF.pos, toF.pos, eAll);
      });
      // Legacy linked pairs (two separate dots, memberIds = [lead, follow]) turn the same way —
      // unless one of them is itself split, which the loop above already handled.
      (state.pairs || []).forEach(function(pr){
        var ids = pr.memberIds || [];
        if(ids.length !== 2 || ids.some(function(id){ return !fromF.pos[id] || !toF.pos[id] || fromF.pos[followKey(id)] || toF.pos[followKey(id)]; })) return;
        turnCouple(interp, ids[0], ids[1], fromF.pos, toF.pos, eAll);
      });
    }
    return interp;
  }
  // "Abgerundet" (betweenPath 'smooth'): a Hermite spline through all waypoints of the move. Every
  // leg keeps its equal share of the time, and the two legs meeting at a Zwischenposition share
  // one tangent there, so the dancer passes through it without a corner or a jump in speed. The
  // tangent is the usual Catmull-Rom one, shortened next to a much shorter leg so the curve can't
  // overshoot or loop — down to zero when the dancer stands still for a leg.
  function smoothLeg(points, legIdx, t){
    var n = points.length - 1;
    function tangent(i){
      if(i === 0) return {x: points[1].x - points[0].x, y: points[1].y - points[0].y};
      if(i === n) return {x: points[n].x - points[n-1].x, y: points[n].y - points[n-1].y};
      var p = points[i-1], q = points[i], r = points[i+1];
      var l1 = Math.hypot(q.x-p.x, q.y-p.y), l2 = Math.hypot(r.x-q.x, r.y-q.y);
      var damp = Math.max(l1, l2) < 1e-6 ? 0 : Math.min(1, 3 * Math.min(l1, l2) / Math.max(l1, l2));
      return {x: (r.x-p.x)/2 * damp, y: (r.y-p.y)/2 * damp};
    }
    var p0 = points[legIdx], p1 = points[legIdx+1], m0 = tangent(legIdx), m1 = tangent(legIdx+1);
    var t2 = t*t, t3 = t2*t;
    var h00 = 2*t3 - 3*t2 + 1, h10 = t3 - 2*t2 + t, h01 = 3*t2 - 2*t3, h11 = t3 - t2;
    return {x: h00*p0.x + h10*m0.x + h01*p1.x + h11*m1.x, y: h00*p0.y + h10*m0.y + h01*p1.y + h11*m1.y};
  }
  // The couple's midpoint — the axis they turn around — travels straight from one Bild to the next,
  // while the Follow→Lead vector rotates around it the short way and its length eases from the old
  // spacing to the new one. A couple that only moves (no change of direction between them) ends up
  // exactly on the straight lines; one that swaps sides turns around its moving middle instead of
  // running through each other.
  function turnCouple(interp, lk, fk, pa, pb, t){
    var la = pa[lk], fa = pa[fk], lb = pb[lk], fb = pb[fk];
    var cx = lerp((la.x+fa.x)/2, (lb.x+fb.x)/2, t), cy = lerp((la.y+fa.y)/2, (lb.y+fb.y)/2, t);
    var distA = Math.hypot(la.x-fa.x, la.y-fa.y), distB = Math.hypot(lb.x-fb.x, lb.y-fb.y);
    var angA = Math.atan2(la.y-fa.y, la.x-fa.x) * 180/Math.PI, angB = Math.atan2(lb.y-fb.y, lb.x-fb.x) * 180/Math.PI;
    // On top of each other on one side: no direction to turn from/to, just open up or close.
    if(distA < 1e-6) angA = angB;
    if(distB < 1e-6) angB = angA;
    var ang = lerpAngle(angA, angB, t) * Math.PI/180;
    var half = lerp(distA, distB, t) / 2;
    var dx = Math.cos(ang)*half, dy = Math.sin(ang)*half;
    interp[lk].x = cx + dx; interp[lk].y = cy + dy;
    interp[fk].x = cx - dx; interp[fk].y = cy - dy;
  }
  // "Punkt = Paar aufspalten": every dot is a couple by default. In single Bilder it can be split
  // into Lead (the dot's own pos key) and Follow, stored in the same Bild's pos map under
  // `<dancerId>~f`. Only real Bilder carry follow keys (sanitizeBetweens drops them), and every
  // serializer (.stg/.auf/share/Verlauf) already round-trips arbitrary pos keys.
  var FOLLOW_SUFFIX = '~f';
  function followKey(did){ return did + FOLLOW_SUFFIX; }
  function isFollowKey(id){ return typeof id === 'string' && id.slice(-FOLLOW_SUFFIX.length) === FOLLOW_SUFFIX; }
  function baseDancerId(id){ return isFollowKey(id) ? id.slice(0, -FOLLOW_SUFFIX.length) : id; }
  function isCoupleSplitIn(f, did){ return !!(f && f.pos && f.pos[followKey(did)]); }
  function markerDisplayName(id){
    var base = baseDancerId(id);
    var d = state.dancers.find(function(dd){ return dd.id === base; });
    var n = d ? d.name : '?';
    return isFollowKey(id) ? n + ' (Follow)' : n;
  }
  // Nearly constant speed: mostly linear, with just enough smoothstep mixed in that a move doesn't
  // start or end with a jolt (speed 0.8 at the ends, 1.1 in the middle — not the 0→3→0 of a cubic).
  function easeMove(t){ return 0.8*t + 0.2*t*t*(3 - 2*t); }
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

  // Shared line icons (same 24-unit grid and 2px round stroke as the topbar SVGs in index.html),
  // so icon buttons built in JS look identical to the static ones instead of relying on text
  // glyphs like ✕/+/▶ whose size and baseline differ per font.
  var ICON_PATHS = {
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    play: '<path d="M7 4.5v15l12.5-7.5Z" fill="currentColor"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'path-corner': '<path d="M3 17 9 7l6 10 6-10"/>',
    'path-smooth': '<path d="M3 17C5 10 7 7 9 7s4 10 6 10 4-3 6-10"/>'
  };
  function svgIcon(name, size, strokeWidth){
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('width', size || 16);
    svg.setAttribute('height', size || 16);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', strokeWidth || 2);
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML = ICON_PATHS[name];
    return svg;
  }
  // Icon followed by a text label, for buttons like "▶ Ab hier".
  function setIconLabel(btn, name, size, label){
    btn.textContent = '';
    btn.appendChild(svgIcon(name, size));
    var span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
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
        f.betweenPath = sanitizeBetweenPath(f.betweenPath);
        // migration: older saves predate temporarily split pairs ("Paar lösen") entirely
        f.splitPairs = sanitizeSplitPairs(f.splitPairs);
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
  // click) — rotated together around their centroid.
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
  var pairSameRoleBtn = document.getElementById('pairSameRoleBtn');
  var pairSplitBtn = document.getElementById('pairSplitBtn');
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

  // "Paar lösen": a saved pair can be uncoupled for single Bilder only — there, Lead and Follow are
  // selected/dragged independently while staying a pair everywhere else. Stored as the pair ids in
  // the *real* Bild's `splitPairs` (a Zwischenposition being edited uses its anchor Bild's list).
  function sanitizeSplitPairs(arr){
    if(!Array.isArray(arr)) return [];
    var seen = {};
    return arr.filter(function(id){
      if(typeof id !== 'string' || !id || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  function splitHostFormation(){
    var idx = editingBetween ? editingBetween.fIdx : state.activeIndex;
    return state.formations[idx] || state.formations[state.activeIndex];
  }

  function isPairSplitHere(pair){
    if(!pair) return false;
    var host = splitHostFormation();
    return !!(host && Array.isArray(host.splitPairs) && host.splitPairs.indexOf(pair.id) !== -1);
  }

  function splitSignature(){
    var host = splitHostFormation();
    var base = (host && Array.isArray(host.splitPairs)) ? host.splitPairs.slice().sort().join(',') : '';
    var cf = currentFormation();
    var couples = state.dancers.filter(function(d){ return isCoupleSplitIn(cf, d.id); }).map(function(d){ return d.id; }).join(',');
    return base + '|' + couples;
  }

  function durations(){
    var t = state.tempo/100;
    return { move: lerp(2200,500,t), hold: lerp(1600,300,t) };
  }
