"use strict";

/* ---------- Verlauf / Rückgängig / Ast-Merge --------------------------------------------------
   Everything here works on the *canonical* project shape — the plain-JSON object
   serializableState() / buildProjectHeader(state, null, null) produces (js/export.js): no
   logo/song bytes, no sharedId/localId, just the content.

   The state decomposes into independently-addressable "fields" (flattenState) — stable ids
   everywhere (f.id, d.id, p.id, ax.id, positions keyed by dancer id) — so diff and 3-way merge
   are field-based, never line-based:
     flattenState(s)                      -> Map<path, value>
     diffStates(base, other)              -> [{path, kind, label, before, after}]
     mergeStates(base, mine, theirs)      -> {merged: Map, conflicts: [...]}
     rebuildState(flatMap)                -> canonical project shape
   ------------------------------------------------------------------------------------------- */

  // Stable stringify (sorted keys) so eq() doesn't care about property insertion order.
  function hStable(v){
    if(v === null || typeof v !== 'object') return JSON.stringify(v);
    if(Array.isArray(v)) return '[' + v.map(hStable).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function(k){ return JSON.stringify(k) + ':' + hStable(v[k]); }).join(',') + '}';
  }
  function hEq(a, b){ return hStable(a) === hStable(b); }
  function hClone(v){ return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function hNum(n){ return Math.round((n || 0) * 100) / 100; }

  /* ---------- flatten ---------- */

  // Map<path,value>. Each entry is one thing that can change independently of the others.
  function flattenState(s){
    var m = new Map();
    if(!s) return m;
    m.set('meta/projectName', s.projectName || '');
    m.set('meta/tempo', typeof s.tempo === 'number' ? s.tempo : 50);
    m.set('meta/showAxes', s.showAxes !== false);
    var rl = s.roomLabels || {};
    ['top','right','bottom','left'].forEach(function(side){ m.set('room/' + side, rl[side] || ''); });

    (s.dancers || []).forEach(function(d){ m.set('dancer/' + d.id, {name: d.name || '', color: d.color || ''}); });
    m.set('order/dancers', (s.dancers || []).map(function(d){ return d.id; }));

    (s.pairs || []).forEach(function(p){
      m.set('pair/' + p.id, {memberIds: (p.memberIds || []).slice(), name: p.name || '', collapsed: !!p.collapsed});
    });
    (s.axes || []).forEach(function(ax){
      m.set('axis/' + ax.id, {x1: hNum(ax.x1), y1: hNum(ax.y1), x2: hNum(ax.x2), y2: hNum(ax.y2), label: ax.label || ''});
    });
    (s.customFigures || []).forEach(function(fig){
      m.set('figure/' + fig.id, {name: fig.name || '', transform: fig.transform || {}});
    });

    m.set('order/formations', (s.formations || []).map(function(f){ return f.id; }));
    (s.formations || []).forEach(function(f){
      m.set('bild/' + f.id + '/meta', {
        name: f.name || '',
        category: f.category || '',
        time: (typeof f.time === 'number' && isFinite(f.time) && f.time >= 0) ? Math.round(f.time * 100) / 100 : null,
        showAxes: f.showAxes !== false,
        splitPairs: sanitizeSplitPairs(f.splitPairs)
      });
      Object.keys(f.pos || {}).forEach(function(did){
        var p = f.pos[did];
        m.set('bild/' + f.id + '/pos/' + did, {x: hNum(p.x), y: hNum(p.y), rot: hNum(p.rot)});
      });
      (f.localAxes || []).forEach(function(ax){
        m.set('bild/' + f.id + '/localaxis/' + ax.id, {x1: hNum(ax.x1), y1: hNum(ax.y1), x2: hNum(ax.x2), y2: hNum(ax.y2), label: ax.label || ''});
      });
      // Zwischenpositionen (see interpolateThroughBetweens in state.js) are strictly ordered — unlike
      // pairs/axes/figures above, their sequence is part of what a move plays back, so (unlike those)
      // they need their own order/* entry alongside the per-dancer pos values. keysWithPrefix only
      // resolves one path segment per prefix (see its own comment below), so a between's two-part key
      // (which between, which dancer) is joined with '::' rather than another '/'.
      m.set('bild/' + f.id + '/betweenorder', (f.betweens || []).map(function(b){ return b.id; }));
      (f.betweens || []).forEach(function(b){
        m.set('bild/' + f.id + '/betweenmeta/' + b.id, {name: b.name || ''});
        Object.keys(b.pos || {}).forEach(function(did){
          var p = b.pos[did];
          m.set('bild/' + f.id + '/between/' + b.id + '::' + did, {x: hNum(p.x), y: hNum(p.y), rot: hNum(p.rot)});
        });
      });
    });
    return m;
  }

  /* ---------- rebuild ---------- */

  // Map<path,value> -> canonical project shape. `order/*` entries decide sequence; anything with a
  // real entry but missing from the order list is appended (so a merge that adds a Bild without
  // touching the order still keeps it).
  function rebuildState(m){
    function get(k, dflt){ return m.has(k) ? m.get(k) : dflt; }

    var dancerIds = orderedIds(m, 'order/dancers', 'dancer/');
    var dancers = dancerIds.map(function(id){
      var d = m.get('dancer/' + id) || {};
      return {id: id, name: d.name || '', color: d.color || ''};
    });
    var dancerIdSet = {};
    dancerIds.forEach(function(id){ dancerIdSet[id] = true; });

    var pairs = keysWithPrefix(m, 'pair/').map(function(id){
      var p = m.get('pair/' + id) || {};
      return {id: id, memberIds: (p.memberIds || []).filter(function(x){ return dancerIdSet[x]; }), name: p.name || '', collapsed: !!p.collapsed};
    }).filter(function(p){ return p.memberIds.length === 2; });

    var axes = keysWithPrefix(m, 'axis/').map(function(id){
      var ax = m.get('axis/' + id) || {};
      return {id: id, x1: ax.x1 || 0, y1: ax.y1 || 0, x2: ax.x2 || 0, y2: ax.y2 || 0, label: ax.label || ''};
    });

    var customFigures = keysWithPrefix(m, 'figure/').map(function(id){
      var fig = m.get('figure/' + id) || {};
      return {id: id, name: fig.name || '', transform: fig.transform || {}};
    });

    var formationIds = orderedIds(m, 'order/formations', 'bild/', '/meta');
    var formations = formationIds.map(function(fid){
      var meta = m.get('bild/' + fid + '/meta') || {};
      var pos = {};
      keysWithPrefix(m, 'bild/' + fid + '/pos/').forEach(function(did){
        if(!dancerIdSet[baseDancerId(did)]) return; // also keeps split Follow keys (<id>~f)
        var p = m.get('bild/' + fid + '/pos/' + did) || {};
        pos[did] = {x: p.x || 0, y: p.y || 0, rot: p.rot || 0};
      });
      var localAxes = keysWithPrefix(m, 'bild/' + fid + '/localaxis/').map(function(axid){
        var ax = m.get('bild/' + fid + '/localaxis/' + axid) || {};
        return {id: axid, x1: ax.x1 || 0, y1: ax.y1 || 0, x2: ax.x2 || 0, y2: ax.y2 || 0, label: ax.label || ''};
      });
      // Reassemble each between's pos map from its '<bwid>::<did>' keys (see flattenState), then put
      // them back in betweenorder's sequence — falling back to encounter order for a between that
      // somehow has pos entries but wasn't listed (mirrors orderedIds()'s own append-if-missing).
      var betweenPosByBw = {};
      keysWithPrefix(m, 'bild/' + fid + '/between/').forEach(function(key){
        var sep = key.indexOf('::');
        if(sep === -1) return;
        var bwid = key.slice(0, sep), did = key.slice(sep + 2);
        if(!dancerIdSet[did]) return;
        var v = m.get('bild/' + fid + '/between/' + key) || {};
        if(!betweenPosByBw[bwid]) betweenPosByBw[bwid] = {};
        betweenPosByBw[bwid][did] = {x: v.x || 0, y: v.y || 0, rot: v.rot || 0};
      });
      var betweenOrder = (m.get('bild/' + fid + '/betweenorder') || []).filter(function(id){ return betweenPosByBw[id]; });
      Object.keys(betweenPosByBw).forEach(function(id){ if(betweenOrder.indexOf(id) === -1) betweenOrder.push(id); });
      var betweens = betweenOrder.map(function(id){
        var bmeta = m.get('bild/' + fid + '/betweenmeta/' + id) || {};
        return {id: id, name: bmeta.name || '', pos: betweenPosByBw[id]};
      });
      var startPos = {};
      Object.keys(pos).forEach(function(did){ startPos[did] = {x: pos[did].x, y: pos[did].y}; });
      var out = {id: fid, name: meta.name || 'Bild', pos: pos, showAxes: meta.showAxes !== false, localAxes: localAxes, category: meta.category || '', startPos: startPos, betweens: betweens, splitPairs: sanitizeSplitPairs(meta.splitPairs)};
      if(typeof meta.time === 'number' && isFinite(meta.time) && meta.time >= 0) out.time = meta.time;
      return out;
    });

    var rl = {};
    ['top','right','bottom','left'].forEach(function(side){ rl[side] = get('room/' + side, ''); });

    return {
      version: 1,
      projectName: get('meta/projectName', 'Meine Formation'),
      dancers: dancers,
      formations: formations.length ? formations : [{id: uid('f'), name: 'Bild 1', pos: {}, showAxes: true, localAxes: [], category: '', startPos: {}, betweens: []}],
      axes: axes,
      showAxes: get('meta/showAxes', true) !== false,
      roomLabels: rl,
      pairs: pairs,
      customFigures: customFigures,
      activeIndex: 0,
      tempo: get('meta/tempo', 50),
      logo: null,
      song: null
    };
  }

  // ids present as `<prefix><id>` (optionally `<prefix><id><suffix>`), in whatever order the Map
  // iterates — used only for entities where order doesn't matter (pairs, axes, figures).
  function keysWithPrefix(m, prefix, suffix){
    var out = [], seen = {};
    m.forEach(function(_v, k){
      if(k.indexOf(prefix) !== 0) return;
      var rest = k.slice(prefix.length);
      if(suffix){
        if(rest.slice(-suffix.length) !== suffix) return;
        rest = rest.slice(0, -suffix.length);
      }
      if(rest.indexOf('/') !== -1) return; // deeper path, not this level
      if(!seen[rest]){ seen[rest] = true; out.push(rest); }
    });
    return out;
  }
  // Ordered per an `order/*` list, with any entity that exists but isn't listed appended at the end.
  function orderedIds(m, orderKey, prefix, suffix){
    var present = keysWithPrefix(m, prefix, suffix);
    var presentSet = {};
    present.forEach(function(id){ presentSet[id] = true; });
    var ordered = (m.get(orderKey) || []).filter(function(id){ return presentSet[id]; });
    var inOrder = {};
    ordered.forEach(function(id){ inOrder[id] = true; });
    present.forEach(function(id){ if(!inOrder[id]) ordered.push(id); });
    return ordered;
  }

  /* ---------- readable labels ---------- */

  function bildLabel(s, fid){
    var idx = (s.formations || []).findIndex(function(f){ return f.id === fid; });
    var f = idx >= 0 ? s.formations[idx] : null;
    if(!f) return 'ein Bild';
    return 'Bild ' + (idx + 1) + (f.name ? ' „' + f.name + '“' : '');
  }
  function dancerLabel(s, did){
    var d = (s.dancers || []).find(function(dd){ return dd.id === did; });
    return d ? (d.name || 'Tänzer') : 'ein Tänzer';
  }
  function coord(p){ return '(' + hNum(p.x) + ', ' + hNum(p.y) + ')'; }
  function fmtMark(t){
    if(t === null || t === undefined) return '—';
    var mm = Math.floor(t / 60), ss = t - mm * 60;
    return mm + ':' + (ss < 10 ? '0' : '') + (Math.round(ss * 10) / 10);
  }

  // One change -> a German sentence. `ctx` is the state whose names we describe against (usually
  // the "after" side).
  function changeLabel(path, kind, before, after, ctx){
    var parts = path.split('/');
    if(path === 'meta/projectName') return 'Projektname: „' + before + '“ → „' + after + '“';
    if(path === 'meta/tempo') return 'Tempo: ' + before + ' → ' + after;
    if(path === 'meta/showAxes') return after ? 'Achsen global eingeblendet' : 'Achsen global ausgeblendet';
    if(parts[0] === 'room') return 'Bühnenrand ' + parts[1] + ': „' + (before || '') + '“ → „' + (after || '') + '“';
    if(path === 'order/dancers') return 'Tänzer-Reihenfolge geändert';
    if(path === 'order/formations') return 'Bild-Reihenfolge geändert';

    if(parts[0] === 'dancer'){
      if(kind === 'added') return 'Tänzer „' + (after.name || '') + '“ hinzugefügt';
      if(kind === 'removed') return 'Tänzer „' + (before.name || '') + '“ entfernt';
      if(before.name !== after.name) return 'Tänzer umbenannt: „' + before.name + '“ → „' + after.name + '“';
      return 'Tänzer „' + after.name + '“: Farbe geändert';
    }
    if(parts[0] === 'pair'){
      if(kind === 'added') return 'Paar gespeichert';
      if(kind === 'removed') return 'Paar aufgelöst';
      return 'Paar geändert';
    }
    if(parts[0] === 'axis'){
      if(kind === 'added') return 'Achse „' + (after.label || '') + '“ hinzugefügt';
      if(kind === 'removed') return 'Achse „' + (before.label || '') + '“ entfernt';
      return 'Achse „' + (after.label || before.label || '') + '“ geändert';
    }
    if(parts[0] === 'figure'){
      if(kind === 'added') return 'Figur „' + (after.name || '') + '“ angelegt';
      if(kind === 'removed') return 'Figur „' + (before.name || '') + '“ gelöscht';
      return 'Figur „' + (after.name || '') + '“ geändert';
    }
    if(parts[0] === 'bild'){
      var fid = parts[1];
      var where = bildLabel(ctx, fid);
      if(parts[2] === 'meta'){
        if(kind === 'added') return where + ' hinzugefügt';
        if(kind === 'removed') return bildLabel({formations: [{id: fid, name: before.name}]}, fid) + ' entfernt';
        if(before.name !== after.name) return where + ' umbenannt (vorher „' + before.name + '“)';
        if(before.category !== after.category) return where + ': Abschnitt „' + (after.category || '') + '“';
        if(before.time !== after.time) return where + ': Marke ' + fmtMark(before.time) + ' → ' + fmtMark(after.time);
        if(before.showAxes !== after.showAxes) return where + ': Achsen ' + (after.showAxes ? 'ein' : 'aus');
        return where + ' geändert';
      }
      if(parts[2] === 'pos'){
        var who = dancerLabel(ctx, parts[3]);
        if(kind === 'added') return who + ' in ' + where + ' platziert ' + coord(after);
        if(kind === 'removed') return who + ' aus ' + where + ' entfernt';
        if(before.x !== after.x || before.y !== after.y) return who + ' in ' + where + ' verschoben: ' + coord(before) + ' → ' + coord(after);
        return who + ' in ' + where + ' gedreht: ' + hNum(before.rot) + '° → ' + hNum(after.rot) + '°';
      }
      if(parts[2] === 'localaxis'){
        if(kind === 'added') return where + ': lokale Achse hinzugefügt';
        if(kind === 'removed') return where + ': lokale Achse entfernt';
        return where + ': lokale Achse geändert';
      }
      if(parts[2] === 'betweenorder') return where + ': Zwischenpositionen neu angeordnet';
      if(parts[2] === 'between'){
        if(kind === 'added') return where + ': Zwischenposition hinzugefügt';
        if(kind === 'removed') return where + ': Zwischenposition entfernt';
        return where + ': Zwischenposition geändert';
      }
      if(parts[2] === 'betweenmeta'){
        if(kind === 'changed' && before.name !== after.name) return where + ': Zwischenposition umbenannt (vorher „' + (before.name || '') + '“)';
        return where + ': Zwischenposition umbenannt';
      }
    }
    return path + ' geändert';
  }

  /* ---------- diff ---------- */

  function diffStates(base, other){
    var a = flattenState(base), b = flattenState(other);
    var keys = {};
    a.forEach(function(_v, k){ keys[k] = true; });
    b.forEach(function(_v, k){ keys[k] = true; });
    var out = [];
    Object.keys(keys).forEach(function(k){
      var inA = a.has(k), inB = b.has(k);
      var va = a.get(k), vb = b.get(k);
      if(inA && inB){
        if(hEq(va, vb)) return;
        out.push({path: k, kind: 'changed', before: va, after: vb, label: changeLabel(k, 'changed', va, vb, other)});
      }else if(inB){
        out.push({path: k, kind: 'added', before: undefined, after: vb, label: changeLabel(k, 'added', undefined, vb, other)});
      }else{
        out.push({path: k, kind: 'removed', before: va, after: undefined, label: changeLabel(k, 'removed', va, undefined, base)});
      }
    });
    // order/* entries are noisy when a Bild/dancer was added or removed (the list necessarily
    // changed) — drop them if there's already an add/remove for that entity kind.
    var hasBildAddRemove = out.some(function(c){ return /^bild\/[^/]+\/meta$/.test(c.path) && c.kind !== 'changed'; });
    var hasDancerAddRemove = out.some(function(c){ return /^dancer\//.test(c.path) && c.kind !== 'changed'; });
    return out.filter(function(c){
      if(c.path === 'order/formations' && hasBildAddRemove) return false;
      if(c.path === 'order/dancers' && hasDancerAddRemove) return false;
      return true;
    });
  }

  function summarizeDiff(changes){
    if(!changes.length) return 'keine Änderung';
    if(changes.length === 1) return changes[0].label;
    if(changes.length <= 3) return changes.map(function(c){ return c.label; }).join(' · ');
    return changes.length + ' Änderungen';
  }

  /* ---------- 3-way merge ---------- */

  function mergeStates(base, mine, theirs){
    var b = flattenState(base), m = flattenState(mine), t = flattenState(theirs);
    var keys = {};
    [b, m, t].forEach(function(map){ map.forEach(function(_v, k){ keys[k] = true; }); });

    var merged = new Map();
    var conflicts = [];

    Object.keys(keys).forEach(function(k){
      var hb = b.has(k), hm = m.has(k), ht = t.has(k);
      var vb = b.get(k), vm = m.get(k), vt = t.get(k);

      var mSame = (hb === hm) && (!hm || hEq(vb, vm)); // mine unchanged vs base
      var tSame = (hb === ht) && (!ht || hEq(vb, vt)); // theirs unchanged vs base

      if(hm === ht && (!hm || hEq(vm, vt))){            // mine == theirs (incl. both absent)
        if(hm) merged.set(k, vm);
        return;
      }
      if(mSame){ if(ht) merged.set(k, vt); return; }    // only theirs changed
      if(tSame){ if(hm) merged.set(k, vm); return; }    // only mine changed

      // both diverged from base and from each other -> conflict (default keep mine)
      if(hm) merged.set(k, vm);
      conflicts.push({
        path: k,
        label: changeLabel(k, hm ? (hb ? 'changed' : 'added') : 'removed', vb, hm ? vm : vt, mine),
        base: hb ? vb : undefined,
        mine: hm ? vm : undefined,
        theirs: ht ? vt : undefined,
        choice: 'mine'
      });
    });

    return {merged: merged, conflicts: conflicts};
  }

  // Apply the user's per-conflict choices onto a merge result, then rebuild.
  function applyConflictChoices(merged, conflicts){
    var out = new Map(merged);
    conflicts.forEach(function(c){
      var pick = c.choice === 'theirs' ? c.theirs : c.mine;
      if(pick === undefined) out.delete(c.path); else out.set(c.path, pick);
    });
    return rebuildState(out);
  }

  /* ============================================================================================
     Local history buffer + undo/redo  (its own tiny IndexedDB — the blobs DB stays untouched)
     ========================================================================================== */

  var HIST_CAP = 80;
  var histEntries = [];   // [{ts, author, snapshot, summary}]  oldest -> newest
  var histPointer = -1;   // index of the entry that equals the current live state
  var histKey = null;     // per-project key
  var histLoaded = false;
  var suppressHistoryCapture = false;
  var histCaptureTimer = null;

  function histDbOpen(){
    return new Promise(function(resolve, reject){
      if(!window.indexedDB){ reject(new Error('no idb')); return; }
      var req = indexedDB.open('aufstellung-history', 1);
      req.onupgradeneeded = function(){ req.result.createObjectStore('projects'); };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
  }
  function histDbGet(key){
    return histDbOpen().then(function(db){
      return new Promise(function(resolve){
        var req = db.transaction('projects', 'readonly').objectStore('projects').get(key);
        req.onsuccess = function(){ resolve(req.result || null); };
        req.onerror = function(){ resolve(null); };
      });
    }).catch(function(){ return null; });
  }
  function histDbPut(key, val){
    return histDbOpen().then(function(db){
      return new Promise(function(resolve){
        var tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put(val, key);
        tx.oncomplete = function(){ resolve(); };
        tx.onerror = function(){ resolve(); };
      });
    }).catch(function(){});
  }

  function historyKeyFor(s){ return 'proj:' + (s.sharedId || s.localId || 'default'); }

  function histPersist(){
    if(!histKey) return;
    histDbPut(histKey, {entries: histEntries, pointer: histPointer});
  }

  // Loaded at startup; re-run (idempotent per key) when a project binds to / loads from a share id,
  // so the timeline re-files from the local key onto the share key.
  function initHistory(){
    var key = historyKeyFor(state);
    if(histLoaded && histKey === key) return Promise.resolve();
    histKey = key;
    histLoaded = false;
    histEntries = [];
    histPointer = -1;
    return histDbGet(histKey).then(function(rec){
      if(rec && Array.isArray(rec.entries) && rec.entries.length){
        histEntries = rec.entries;
        histPointer = typeof rec.pointer === 'number' ? rec.pointer : histEntries.length - 1;
      }
      // Always make sure the current live state is the tail entry (covers: first run, or edits
      // made in another tab / before history existed).
      var snap = serializableState(state);
      if(!histEntries.length || !hEq(stripVolatile(histEntries[histPointer] && histEntries[histPointer].snapshot), stripVolatile(snap))){
        histEntries.push({ts: Date.now(), author: currentAuthor(), snapshot: snap, summary: histEntries.length ? 'Stand beim Öffnen' : 'Ausgangsstand'});
        if(histEntries.length > HIST_CAP) histEntries = histEntries.slice(-HIST_CAP);
        histPointer = histEntries.length - 1;
        histPersist();
      }
      histLoaded = true;
      updateHistoryUI();
    });
  }

  // activeIndex is view state, not content — never let it alone trigger a history entry.
  function stripVolatile(snap){
    if(!snap) return snap;
    var c = hClone(snap);
    c.activeIndex = 0;
    return c;
  }

  function captureHistorySoon(){
    if(suppressHistoryCapture || !histLoaded) return;
    clearTimeout(histCaptureTimer);
    histCaptureTimer = setTimeout(captureHistory, 900);
  }

  function captureHistory(){
    histCaptureTimer = null;
    if(suppressHistoryCapture || !histLoaded) return;
    var snap = serializableState(state);
    var cur = histEntries[histPointer] && histEntries[histPointer].snapshot;
    if(cur && hEq(stripVolatile(cur), stripVolatile(snap))) return;
    var changes = diffStates(cur, snap);
    if(!changes.length) return;
    // drop any redo tail, then append
    if(histPointer < histEntries.length - 1) histEntries = histEntries.slice(0, histPointer + 1);
    histEntries.push({ts: Date.now(), author: currentAuthor(), snapshot: snap, summary: summarizeDiff(changes)});
    if(histEntries.length > HIST_CAP) histEntries = histEntries.slice(-HIST_CAP);
    histPointer = histEntries.length - 1;
    histPersist();
    updateHistoryUI();
  }

  function historyCanUndo(){ return histLoaded && histPointer > 0; }
  function historyCanRedo(){ return histLoaded && histPointer < histEntries.length - 1; }
  // Short label of the most recent change — js/share.js uses it as a commit note.
  function lastEditSummary(){ return (histEntries[histPointer] && histEntries[histPointer].summary) || ''; }

  function historyGoto(index){
    if(!histLoaded || index < 0 || index >= histEntries.length || index === histPointer) return;
    histPointer = index;
    clearTimeout(histCaptureTimer); histCaptureTimer = null;
    suppressHistoryCapture = true;
    try{
      applyState(hClone(histEntries[index].snapshot), {keepBinding: true, keepBlobs: true});
    }finally{
      suppressHistoryCapture = false;
    }
    histPersist();
    updateHistoryUI();
  }
  function historyUndo(){ if(historyCanUndo()) historyGoto(histPointer - 1); }
  function historyRedo(){ if(historyCanRedo()) historyGoto(histPointer + 1); }

  /* ---------- author nickname (per browser, editable) ---------- */

  var AUTHOR_KEY = 'aufstellung-author';
  var AUTHOR_ADJ = ['Blaue','Grüne','Rote','Gelbe','Violette','Türkise','Silberne','Goldene','Graue','Kupferne'];
  var AUTHOR_NOUN = ['Eule','Möwe','Amsel','Meise','Drossel','Krähe','Elster','Taube','Schwalbe','Natter','Robbe','Otter'];
  function currentAuthor(){
    var v = null;
    try{ v = localStorage.getItem(AUTHOR_KEY); }catch(e){}
    if(v) return v;
    v = AUTHOR_ADJ[Math.floor(Math.random() * AUTHOR_ADJ.length)] + ' ' + AUTHOR_NOUN[Math.floor(Math.random() * AUTHOR_NOUN.length)];
    try{ localStorage.setItem(AUTHOR_KEY, v); }catch(e){}
    return v;
  }
  function setCurrentAuthor(name){
    name = (name || '').trim().slice(0, 40) || currentAuthor();
    try{ localStorage.setItem(AUTHOR_KEY, name); }catch(e){}
    updateHistoryUI();
    return name;
  }

  /* ============================================================================================
     UI — toolbar buttons + Verlauf panel
     ========================================================================================== */

  var histUndoBtn = document.getElementById('historyUndoBtn');
  var histRedoBtn = document.getElementById('historyRedoBtn');
  var histOpenBtn = document.getElementById('historyBtn');
  var histBackdrop = document.getElementById('historyBackdrop');
  var histCloseBtn = document.getElementById('historyCloseBtn');
  var histListEl = document.getElementById('historyList');
  var histDiffEl = document.getElementById('historyDiff');
  var histRevertBtn = document.getElementById('historyRevertBtn');
  var histAuthorInput = document.getElementById('historyAuthorInput');
  var histBranchArea = document.getElementById('historyBranchArea');

  var histSelected = -1; // which entry the diff view is showing (-1 = none)

  function relTime(ts){
    var s = Math.round((Date.now() - ts) / 1000);
    if(s < 5) return 'gerade eben';
    if(s < 60) return 'vor ' + s + ' s';
    if(s < 3600) return 'vor ' + Math.round(s / 60) + ' min';
    if(s < 86400) return 'vor ' + Math.round(s / 3600) + ' h';
    return 'vor ' + Math.round(s / 86400) + ' Tagen';
  }
  function absTime(ts){ return new Date(ts).toLocaleString('de-DE'); }

  function updateHistoryUI(){
    if(histUndoBtn){ histUndoBtn.disabled = !historyCanUndo(); }
    if(histRedoBtn){ histRedoBtn.disabled = !historyCanRedo(); }
    if(histBackdrop && !histBackdrop.hidden) renderHistoryPanel();
  }

  function openHistoryPanel(){
    if(!histBackdrop) return;
    histSelected = -1;
    if(histAuthorInput) histAuthorInput.value = currentAuthor();
    renderHistoryPanel();
    histBackdrop.hidden = false;
  }
  function closeHistoryPanel(){ if(histBackdrop) histBackdrop.hidden = true; }

  function renderHistoryPanel(){
    renderHistoryList();
    renderHistoryDiff();
    if(histBranchArea){
      histBranchArea.innerHTML = '';
      if(state.sharedId && typeof renderShareBranchArea === 'function') renderShareBranchArea(histBranchArea);
      histBranchArea.hidden = !histBranchArea.innerHTML;
    }
    if(histRevertBtn) histRevertBtn.hidden = !(histSelected >= 0 && histSelected !== histPointer);
  }

  function renderHistoryList(){
    if(!histListEl) return;
    histListEl.innerHTML = '';
    for(var i = histEntries.length - 1; i >= 0; i--){
      (function(i){
        var e = histEntries[i];
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'history-row'
          + (i === histPointer ? ' history-row--current' : '')
          + (i === histSelected ? ' history-row--selected' : '')
          + (i > histPointer ? ' history-row--future' : '');
        var t = document.createElement('span');
        t.className = 'history-when';
        t.textContent = relTime(e.ts);
        t.title = absTime(e.ts);
        var s = document.createElement('span');
        s.className = 'history-summary';
        s.textContent = e.summary || '—';
        var a = document.createElement('span');
        a.className = 'history-who';
        a.textContent = (state.sharedId && e.author) ? e.author : '';
        row.appendChild(t); row.appendChild(s); row.appendChild(a);
        row.addEventListener('click', function(){
          histSelected = i;
          renderHistoryPanel();
        });
        histListEl.appendChild(row);
      })(i);
    }
  }

  var DIFF_GROUPS = [
    ['Allgemein', function(p){ return /^(meta|room|order)\//.test(p); }],
    ['Tänzer & Paare', function(p){ return /^(dancer|pair)\//.test(p); }],
    ['Achsen & Figuren', function(p){ return /^(axis|figure)\//.test(p); }]
  ];

  function renderHistoryDiff(){
    if(!histDiffEl) return;
    histDiffEl.innerHTML = '';
    if(histSelected < 0){
      histDiffEl.innerHTML = '<p class="settings-hint">Einen Eintrag links wählen, um zu sehen, was sich seitdem geändert hat.</p>';
      return;
    }
    var fromSnap = histEntries[histSelected].snapshot;
    var toSnap = serializableState(state);
    var changes = diffStates(fromSnap, toSnap);
    var head = document.createElement('p');
    head.className = 'history-diff-head';
    head.textContent = changes.length
      ? changes.length + (changes.length === 1 ? ' Änderung' : ' Änderungen') + ' seit ' + relTime(histEntries[histSelected].ts)
      : 'Keine Unterschiede zum aktuellen Stand.';
    histDiffEl.appendChild(head);
    if(!changes.length) return;

    var used = {};
    function section(title, list){
      if(!list.length) return;
      var h = document.createElement('h4'); h.textContent = title; h.className = 'history-diff-section';
      histDiffEl.appendChild(h);
      var ul = document.createElement('ul'); ul.className = 'history-diff-list';
      list.forEach(function(c){
        var li = document.createElement('li');
        li.className = 'history-change history-change--' + c.kind;
        li.textContent = c.label;
        ul.appendChild(li);
      });
      histDiffEl.appendChild(ul);
    }
    DIFF_GROUPS.forEach(function(g){
      section(g[0], changes.filter(function(c){ if(used[c.path]) return false; if(g[1](c.path)){ used[c.path] = true; return true; } return false; }));
    });
    // per-Bild groups (in current Bild order)
    (toSnap.formations || []).forEach(function(f, idx){
      var pref = 'bild/' + f.id + '/';
      section('Bild ' + (idx + 1) + (f.name ? ' „' + f.name + '“' : ''),
        changes.filter(function(c){ if(used[c.path]) return false; if(c.path.indexOf(pref) === 0){ used[c.path] = true; return true; } return false; }));
    });
    // leftovers (e.g. bild/* for a deleted Bild)
    section('Sonstiges', changes.filter(function(c){ return !used[c.path]; }));
  }

  if(histUndoBtn) histUndoBtn.addEventListener('click', historyUndo);
  if(histRedoBtn) histRedoBtn.addEventListener('click', historyRedo);
  if(histOpenBtn) histOpenBtn.addEventListener('click', openHistoryPanel);
  if(histCloseBtn) histCloseBtn.addEventListener('click', closeHistoryPanel);
  if(histBackdrop) histBackdrop.addEventListener('click', function(e){ if(e.target === histBackdrop) closeHistoryPanel(); });
  if(histRevertBtn) histRevertBtn.addEventListener('click', function(){
    if(histSelected < 0) return;
    historyGoto(histSelected);
  });
  if(histAuthorInput) histAuthorInput.addEventListener('change', function(){ setCurrentAuthor(histAuthorInput.value); });
