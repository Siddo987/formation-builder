"use strict";

/* ---------- markers: formation timestamps in the song ---------- */

  function formationTime(f){
    return (typeof f.time === 'number' && isFinite(f.time) && f.time >= 0) ? f.time : null;
  }

  // The Bilder with a time marker of their own, in song order.
  function markerWaypoints(){
    var pts = [];
    state.formations.forEach(function(f, idx){
      var t = formationTime(f);
      if(t !== null) pts.push({ idx: idx, time: t });
    });
    pts.sort(function(a, b){ return a.time - b.time; });
    return pts;
  }

  // Each Bild's place in the song (seconds) for sync playback: its own time marker, otherwise spread
  // evenly over the stretch it sits in — between the marked Bilder around it, before the first
  // marker from 0:00 (Bild 1 starts with the song), after the last one up to the song's end (the
  // last Bild lands there); without any marker the whole choreo spans the whole song. dur: the
  // song's length, the loaded song's by default; while it is unknown, Bilder after the last marker
  // get null.
  function syncTimes(dur){
    if(dur === undefined) dur = songDurationSec(); // js/playback.js
    var n = state.formations.length, times = [], anchors = [];
    state.formations.forEach(function(f, idx){
      var t = formationTime(f);
      times.push(t);
      if(t !== null) anchors.push(idx);
    });
    if(!n) return times;
    if(times[0] === null){ times[0] = 0; anchors.unshift(0); }
    if(times[n-1] === null && dur > times[anchors[anchors.length-1]]){ times[n-1] = dur; anchors.push(n-1); }
    for(var k = 0; k < anchors.length-1; k++){
      var a = anchors[k], b = anchors[k+1];
      for(var i = a+1; i < b; i++) times[i] = times[a] + (i-a)/(b-a)*(times[b] - times[a]);
    }
    return times;
  }

  // What sync playback follows: every Bild with a place in the song (syncTimes), in song order.
  function syncWaypoints(dur){
    var pts = [];
    syncTimes(dur).forEach(function(t, idx){ if(t !== null) pts.push({ idx: idx, time: t }); });
    pts.sort(function(a, b){ return a.time - b.time || a.idx - b.idx; });
    return pts;
  }

  // With a song loaded, playback follows it as soon as two Bilder have a place in it — once its
  // length is known, or earlier with a time marker after Bild 1.
  function isSyncActive(){
    return !!(state.song && state.song.url) && syncWaypoints().length >= 2;
  }

  // Time markers are expected to climb in Bild order. Returns the Bilder where that breaks — a
  // marked Bild whose time is not strictly after the previous marked Bild's (hand-entered out of
  // sequence, or a filmstrip reorder left them scrambled). Sync playback still runs (syncWaypoints
  // sorts by time), it just visibly jumps around; js/marker.js turns this into a warning.
  function markerOrderIssues(){
    var issues = [], lastT = -Infinity, lastIdx = -1;
    state.formations.forEach(function(f, i){
      var t = formationTime(f);
      if(t === null) return;
      if(t <= lastT) issues.push({idx: i, prevIdx: lastIdx});
      lastT = t; lastIdx = i;
    });
    return issues;
  }

  /* ---------- stage markers ---------- */

  function createMarkerEl(id, isFollow){
    var el = document.createElement('div');
    el.className = isFollow ? 'dancer follow' : 'dancer';
    var label = document.createElement('span');
    label.className = 'label';
    el.appendChild(label);
    var textNode = document.createElement('span');
    textNode.className = 'initials';
    el.appendChild(textNode);
    var rotInd = document.createElement('span');
    rotInd.className = 'rot-indicator';
    el.appendChild(rotInd);
    var badge = document.createElement('span');
    badge.className = 'role-badge';
    badge.textContent = isFollow ? 'F' : 'L';
    el.appendChild(badge);
    if(isFollow) el.hidden = true;
    stageEl.appendChild(el);
    attachDancerEvents(el, id);
    stageMarkers[id] = el;
    return el;
  }

  function ensureMarkers(){
    var seen = {};
    // Only points that exist in this Bild count (a Follow that isn't split off here doesn't).
    var curPos = currentFormation().pos;
    var multi = pairSelection.filter(function(id){ return curPos[id]; }).length >= 2;
    state.dancers.forEach(function(d){
      seen[d.id] = true;
      var el = stageMarkers[d.id];
      if(!el) el = createMarkerEl(d.id, false);
      var fk = followKey(d.id);
      seen[fk] = true;
      var fel = stageMarkers[fk] || createMarkerEl(fk, true);
      fel.querySelector('.initials').textContent = initials(d.name);
      fel.querySelector('.label').textContent = d.name + ' · Follow';
      fel.style.background = d.color;
      fel.classList.toggle('selected', selectedDancerId === fk);
      fel.classList.toggle('pair-selected', multi && pairSelection.indexOf(fk) !== -1);
      el.querySelector('.initials').textContent = initials(d.name);
      el.querySelector('.label').textContent = d.name;
      el.style.background = d.color;
      el.classList.toggle('selected', selectedDancerId === d.id);
      // The teal "grouped" ring only kicks in once there are 2+ (matching dragGroupFor's own
      // threshold) — a lone dancer sitting in pairSelection (e.g. right after a plain click, which
      // now seeds it with just that dancer so a follow-up Ctrl-click has something to add to)
      // still shows as a normal single selection instead of looking like an already-formed pair.
      el.classList.toggle('pair-selected', multi && pairSelection.indexOf(d.id) !== -1);
    });
    Object.keys(stageMarkers).forEach(function(id){
      if(!seen[id]){ stageMarkers[id].remove(); delete stageMarkers[id]; }
    });
    updateRosterSelectionHighlight();
  }

  // Mirrors the stage's current selection into the roster: a gold edge on selectedDancerId's own
  // row (and, separately, on their saved pair's whole group container too, so "wenn ich einen
  // Tänzer auswähle, wird sowohl sein Paar als auch er selber am Rand in der Leiste gehighlighted"
  // holds even while the pair is collapsed) — plus a teal edge on every row/group that's part of
  // the current 2+ multi-selection (pairSelection), mirroring the stage markers' own gold/teal
  // split (.dancer.selected / .dancer.pair-selected above) now that roster rows are click-
  // selectable too (see handleRosterSelectClick/handleRosterPairSelectClick).
  function updateRosterSelectionHighlight(){
    var multi = pairSelection.length >= 2;
    Object.keys(rosterRowEls).forEach(function(id){
      rosterRowEls[id].classList.toggle('roster-row-selected', selectedDancerId === id);
      rosterRowEls[id].classList.toggle('roster-row-pair-selected', multi && pairSelection.indexOf(id) !== -1);
    });
    Object.keys(rosterPairGroupEls).forEach(function(pairId){
      var pair = state.pairs.find(function(p){ return p.id === pairId; });
      var hi = !!pair && pair.memberIds.indexOf(selectedDancerId) !== -1;
      var groupMulti = !!pair && multi && pair.memberIds.some(function(id){ return pairSelection.indexOf(id) !== -1; });
      rosterPairGroupEls[pairId].classList.toggle('roster-pairgroup-selected', hi);
      rosterPairGroupEls[pairId].classList.toggle('roster-pairgroup-pair-selected', groupMulti);
    });
  }

  // The positions the stage shows right now — not always the Bild's own: playback and a held
  // pause/scrub (pausedAt) show in-between positions.
  var shownPosMap = null;

  function positionMarkers(posMap){
    // The stage shows something else now – a held pause (playback.js) can't resume from there.
    if(!playing && pausedAt){ pausedAt = null; updateProgress(idleTimelinePct()); }
    // A couple picked as one dot stays picked whole where it's split into Lead & Follow (#2048).
    var prevPos = shownPosMap;
    var addFollows = (playing || !prevPos) ? [] : pairSelection.map(followKey).filter(function(fk){
      return posMap[fk] && !prevPos[fk] && pairSelection.indexOf(fk) === -1;
    });
    shownPosMap = posMap;
    function place(el, pos){
      el.style.left = gridToPercentX(pos.x) + '%';
      el.style.top = gridToPercentY(pos.y) + '%';
      var ind = el.querySelector('.rot-indicator');
      if(ind) ind.style.transform = 'rotate(' + (pos.rot||0) + 'deg)';
    }
    state.dancers.forEach(function(d){
      var el = stageMarkers[d.id];
      var pos = posMap[d.id];
      var fpos = posMap[followKey(d.id)];
      var fel = stageMarkers[followKey(d.id)];
      if(el) el.classList.toggle('is-split', !!fpos);
      if(fel){
        fel.hidden = !fpos;
        if(fpos) place(fel, fpos);
      }
      if(!el || !pos) return;
      place(el, pos);
    });
    if(addFollows.length){ pairSelection = pairSelection.concat(addFollows); ensureMarkers(); updatePairRotateUI(); }
    updatePairMidpointMarker(posMap);
    // During playback the ghosts only change with the Bild — redrawn then via resetLayoutGhost();
    // rebuilding them every frame made playback stutter (#2038).
    if(!playing) renderOnionSkin();
  }

  // Small crosshair marking the centroid a 2+ selection rotates around (rotatePairSelection's
  // pivot — the midpoint between the two partners for an exactly-2 pair). Tracked against
  // whatever position map is currently being displayed, so it follows along through dragging,
  // Bild switches, and playback interpolation alike, not just live drags.
  function updatePairMidpointMarker(posMap){
    var marker = document.getElementById('pairMidpointMarker');
    if(!marker) return;
    if(pairSelection.length < 2){ marker.hidden = true; return; }
    var sx=0, sy=0, n=0;
    pairSelection.forEach(function(id){
      var p = posMap[id];
      if(p){ sx+=p.x; sy+=p.y; n++; }
    });
    if(n < 2){ marker.hidden = true; return; }
    marker.style.left = gridToPercentX(sx/n) + '%';
    marker.style.top = gridToPercentY(sy/n) + '%';
    marker.hidden = false;
  }

  function buildPairMidpointMarker(){
    var marker = document.createElement('div');
    marker.className = 'pair-midpoint-marker';
    marker.id = 'pairMidpointMarker';
    marker.title = 'Ziehen zum Verschieben der ganzen Auswahl';
    marker.hidden = true;
    attachPairMidpointMarkerDragEvents(marker);
    stageEl.appendChild(marker);
  }

  // Grabbing the crosshair moves the whole selected group together — same delta-from-grabbed-
  // point pattern as dragging a dancer or a Vorlage ghost dot (grid-snap unless Shift, and snaps
  // onto an active Vorlage point too when close enough).
  function attachPairMidpointMarkerDragEvents(marker){
    marker.addEventListener('contextmenu', function(e){
      if(openSelectionMenu(e.clientX, e.clientY)) e.preventDefault();
    });
    marker.addEventListener('pointerdown', function(e){
      if(pairSelection.length < 2 || e.button === 2) return;
      if(playing) pausePlayback();
      e.preventDefault();
      e.stopPropagation();
      try{ marker.setPointerCapture(e.pointerId); }catch(err){}
      var groupIds = pairSelection.filter(function(id){ return currentFormation().pos[id]; });
      var startPositions = {};
      groupIds.forEach(function(id){
        var p = currentFormation().pos[id];
        startPositions[id] = {x: p.x, y: p.y};
      });
      // The group's centroid in the Bild itself (where the cross sits unless a held pause shows
      // in-between positions): the first move then puts that centroid right under the pointer.
      var grabStart = {x: 0, y: 0};
      groupIds.forEach(function(id){ grabStart.x += startPositions[id].x/groupIds.length; grabStart.y += startPositions[id].y/groupIds.length; });
      function onMove(ev){
        var rect = stageEl.getBoundingClientRect();
        var px = ((ev.clientX-rect.left)/rect.width)*100;
        var py = ((ev.clientY-rect.top)/rect.height)*100;
        var gx = percentToX(px);
        var gy = percentToY(py);
        if(!ev.shiftKey){ gx = Math.round(gx); gy = Math.round(gy); }
        var dx = gx - grabStart.x, dy = gy - grabStart.y;
        if(activeLayoutId && !ev.shiftKey){
          var candX = grabStart.x+dx, candY = grabStart.y+dy;
          var snap = nearestLayoutPoint(candX, candY);
          if(snap){ dx += snap.x-candX; dy += snap.y-candY; }
        }
        groupIds.forEach(function(id){
          var sp = startPositions[id];
          setDancerPos(id, sp.x+dx, sp.y+dy);
        });
      }
      function onUp(){
        try{ marker.releasePointerCapture(e.pointerId); }catch(err){}
        marker.removeEventListener('pointermove', onMove);
        marker.removeEventListener('pointerup', onUp);
        saveState();
      }
      marker.addEventListener('pointermove', onMove);
      marker.addEventListener('pointerup', onUp);
    });
  }

  function buildStageLayers(){
    stageEl.parentNode.style.setProperty('--ar', stageAspect()); // width : depth, see .stage-frame
    buildStageLogo();
    buildOnionSkinLayer();
    buildPairMidpointMarker();
    buildGridOverlay();
    buildLayoutGhostLayer();
  }

  // Onion-skin preview around the current Bild. A Bild is a single snapshot; the movement happens
  // *between* Bilder — so we show the neighbouring snapshots as ghosts: a uniform light gray dot
  // per dancer at the Bild *behind* you, and the Bild *ahead* of you in each dancer's own colour,
  // barely visible. "Woher man kommt, wohin man geht."
  //   - editing a Bild:  gray = formations[activeIndex-1].pos,  faint = formations[activeIndex+1].pos
  //   - during playback: state.activeIndex is the Bild the current move *starts from* (see
  //     playback.js tick/syncTick), so gray = that Bild itself (start of the move) and faint =
  //     activeIndex+1 (its destination) — i.e. the two endpoints of the move in progress.
  // Both are shown whenever the neighbour exists — no "only once a dancer has been dragged" gate,
  // and no dependence on the per-Bild startPos field. The first Bild has no gray, the last no faint.
  // Purely visual, no pointer events. Refreshed on every Bild switch (piggybacked on
  // resetLayoutGhost, see its comment for why) and on every position update (positionMarkers),
  // playback included.
  function buildOnionSkinLayer(){
    var layer = document.createElement('div');
    layer.className = 'onion-skin-layer';
    layer.id = 'onionSkinLayer';
    stageEl.appendChild(layer);
    renderOnionSkin();
  }

  function renderOnionSkin(){
    var layer = document.getElementById('onionSkinLayer');
    if(!layer) return;
    layer.innerHTML = '';
    function addDots(posMap, extraClass, useDancerColor){
      if(!posMap) return;
      state.dancers.forEach(function(d){
        [d.id, followKey(d.id)].forEach(function(k){
          var p = posMap[k];
          if(!p) return;
          var dot = document.createElement('span');
          dot.className = 'onion-dot ' + extraClass;
          dot.style.left = gridToPercentX(p.x) + '%';
          dot.style.top = gridToPercentY(p.y) + '%';
          if(useDancerColor) dot.style.background = d.color;
          layer.appendChild(dot);
        });
      });
    }
    // Paused mid-move the ghosts stay as during playback: gray = the Bild the move started from (#2039).
    var prevIdx = playing || pausedMidMove() ? state.activeIndex : state.activeIndex - 1;
    var prev = state.formations[prevIdx];
    addDots(prev ? prev.pos : null, 'onion-dot-prev', false);
    var next = state.formations[state.activeIndex + 1];
    addDots(next ? next.pos : null, 'onion-dot-next', true);
    renderPathLines(layer);
  }

  // Weglinien (#2056) and the too-close warning (#2057), switched per device like the audio delay:
  // the move out of the shown Bild, sampled the way playback runs it — Zwischenpositionen,
  // Drehungen and Kreisbahnen included.
  var PATHS_KEY = 'aufstellung-paths', CLASH_KEY = 'aufstellung-clash';
  var PATH_SAMPLES = 48, CLASH_DIST = 1; // grid units, about a metre
  var pathsToggle = document.getElementById('pathsToggle'), clashToggle = document.getElementById('clashToggle');
  try{
    pathsToggle.checked = localStorage.getItem(PATHS_KEY) === '1';
    clashToggle.checked = localStorage.getItem(CLASH_KEY) === '1';
  }catch(e){}
  [[pathsToggle, PATHS_KEY], [clashToggle, CLASH_KEY]].forEach(function(t){
    t[0].addEventListener('change', function(){
      try{ localStorage.setItem(t[1], t[0].checked ? '1' : '0'); }catch(e){}
      renderOnionSkin();
      scheduleClashBadges();
    });
  });
  function pathAt(w, k){ return w[k] || w[baseDancerId(k)]; }
  // Every dancer key's walk on the move out of Bild fIdx, sampled PATH_SAMPLES times.
  function movePaths(fIdx){
    var f = state.formations[fIdx], next = state.formations[fIdx + 1];
    var frames = [];
    for(var i = 0; i <= PATH_SAMPLES; i++) frames.push(interpolateThroughBetweens(fIdx, fIdx + 1, i / PATH_SAMPLES));
    var keys = [];
    state.dancers.forEach(function(d){
      if(!f.pos[d.id] || !next.pos[d.id]) return;
      keys.push({k: d.id, d: d});
      if(frames.some(function(w){ return w[followKey(d.id)]; })) keys.push({k: followKey(d.id), d: d});
    });
    return {frames: frames, keys: keys};
  }
  // Only what the walk itself causes: two points that get closer on the way than in any of the
  // poses they were placed in (the Bilder and Zwischenpositionen), and closer than CLASH_DIST.
  function moveClashes(fIdx, mv){
    mv = mv || movePaths(fIdx);
    var f = state.formations[fIdx], frames = mv.frames, keys = mv.keys, out = [];
    var stops = [f].concat(f.betweens || [], [state.formations[fIdx + 1]]);
    function partners(a, b){
      return baseDancerId(a) === baseDancerId(b) || (state.pairs || []).some(function(p){
        return p.memberIds.indexOf(baseDancerId(a)) !== -1 && p.memberIds.indexOf(baseDancerId(b)) !== -1;
      });
    }
    function dist(w, a, b){ var p = pathAt(w, a), q = pathAt(w, b); return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : Infinity; }
    keys.forEach(function(ea, i){
      keys.slice(i + 1).forEach(function(eb){
        if(partners(ea.k, eb.k)) return;
        var posed = Math.min.apply(null, stops.map(function(s){ return dist(s.pos || {}, ea.k, eb.k); }));
        var min = Infinity, m = -1;
        frames.forEach(function(w, s){ var d = dist(w, ea.k, eb.k); if(d < min){ min = d; m = s; } });
        if(min >= CLASH_DIST || min >= posed - 1e-6) return;
        var p = pathAt(frames[m], ea.k), q = pathAt(frames[m], eb.k);
        out.push({a: ea.k, b: eb.k, x: (p.x + q.x) / 2, y: (p.y + q.y) / 2});
      });
    });
    return out;
  }
  function renderPathLines(layer){
    var fIdx = state.activeIndex, next = state.formations[fIdx + 1];
    if(!next || (!pathsToggle.checked && !clashToggle.checked)) return;
    var mv = movePaths(fIdx), frames = mv.frames, keys = mv.keys;
    if(pathsToggle.checked){
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'path-lines');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      keys.forEach(function(e){
        var line = document.createElementNS(SVG_NS, 'polyline');
        line.setAttribute('points', frames.map(function(w){ var p = pathAt(w, e.k); return gridToPercentX(p.x).toFixed(2) + ',' + gridToPercentY(p.y).toFixed(2); }).join(' '));
        line.setAttribute('stroke', e.d.color);
        if(isFollowKey(e.k)) line.setAttribute('stroke-dasharray', '4 3');
        svg.appendChild(line);
      });
      layer.appendChild(svg);
    }
    if(!clashToggle.checked) return;
    moveClashes(fIdx, mv).forEach(function(c){
      var mark = document.createElement('span');
      mark.className = 'path-clash';
      mark.style.left = gridToPercentX(c.x) + '%';
      mark.style.top = gridToPercentY(c.y) + '%';
      var label = document.createElement('span');
      label.textContent = markerDisplayName(c.a) + ' · ' + markerDisplayName(c.b);
      mark.appendChild(label);
      layer.appendChild(mark);
    });
  }

  // Filmstrip: a warning on every move with a clash, not only the one on stage (#2057). It walks
  // the whole choreo, so it runs a moment after the last change and only redoes moves that changed.
  var clashBadgeTimer = null, clashCache = {};
  function scheduleClashBadges(){ clearTimeout(clashBadgeTimer); clashBadgeTimer = setTimeout(updateClashBadges, 300); }
  function updateClashBadges(){
    Array.prototype.forEach.call(document.querySelectorAll('.film-connector'), function(wrap){
      var fIdx = +wrap.dataset.f, f = state.formations[fIdx], next = state.formations[fIdx + 1];
      var badge = wrap.querySelector('.film-between-clash'), list = [];
      if(clashToggle.checked && f && next){
        var key = JSON.stringify([f, next, state.pairs, state.dancers.length]), c = clashCache[f.id];
        if(!c || c.key !== key) c = clashCache[f.id] = {key: key, list: moveClashes(fIdx)};
        list = c.list;
      }
      wrap.classList.toggle('clash-set', list.length > 0);
      if(!list.length){ if(badge) badge.remove(); return; }
      if(!badge){
        badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'film-between-clash';
        badge.textContent = '!';
        badge.addEventListener('click', function(){ selectFormation(+wrap.dataset.f); });
        wrap.appendChild(badge);
      }
      badge.title = 'Zu eng auf dem Weg zu „' + next.name + '“: ' + list.map(function(c){ return markerDisplayName(c.a) + ' · ' + markerDisplayName(c.b); }).join(', ') + ' (klicken zeigt die Stelle)';
      badge.setAttribute('aria-label', badge.title);
    });
  }

  // Editable labels around the stage edges (default "WAND"/"SPIEGEL"/"EINGANG"/"FENSTER", matching
  // a typical Saal) — state.roomLabels. Lives outside #stage itself (a sibling in .stage-frame, or
  // in .stage-caption-row/.stage-audience) so fullRerender()'s stageEl.innerHTML='' never touches
  // it. Also read by js/steps.js to label the Schritte-PDF's little room diagram, so renaming a
  // side here (e.g. for a different rehearsal room) updates both places at once.
  function updateRoomLabelInputs(){
    var labels = state.roomLabels || {};
    ['top','right','bottom','left'].forEach(function(side){
      var el = roomLabelInputs[side];
      if(el && document.activeElement !== el) el.value = labels[side] || '';
    });
  }
  ['top','right','bottom','left'].forEach(function(side){
    var el = roomLabelInputs[side];
    if(!el) return;
    el.addEventListener('input', function(){
      state.roomLabels[side] = el.value;
      saveState();
    });
  });

  function buildStageLogo(){
    var img = document.createElement('img');
    img.className = 'stage-logo';
    img.id = 'stageLogoImg';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.hidden = true;
    stageEl.appendChild(img);
    updateStageLogo();
  }

  function updateStageLogo(){
    var img = document.getElementById('stageLogoImg');
    if(!img) return;
    if(state.logo && state.logo.url){
      img.src = state.logo.url;
      img.style.opacity = (state.logo.opacity || 18) / 100;
      img.hidden = false;
    }else{
      img.removeAttribute('src');
      img.hidden = true;
    }
  }

  /* ---------- layout templates ("Vorlagen"): target *shapes* — a Vorlage's
     positions are relative to each other only (no fixed spot on the stage baked in). Shown as a
     transparent, non-interactive-underneath ghost overlay that the user drags into place and
     rotates to taste; dancers then get manually dragged onto the ghost by hand — a positioning
     aid, not an auto-transform like Figuren. Picking one (and any placement/rotation applied to
     it) is per-session/transient, never saved in state, and resets whenever the active Bild
     changes (a fresh reference point for whichever Bild you're now positioning). The shape's
     center is its "Orientierungspunkt" — the rotation pivot, rendered as its own distinct,
     grabbable ghost point (see layoutPointToStage). The Vorlagen are the Grundformen
     (LAYOUT_SHAPES), generated fresh for however many pairs the choreo has, so they always fit
     exactly. ---------- */

  var activeLayoutId = null;
  var activeLayoutOffset = {x:0, y:0}; // where the shape's own Orientierungspunkt currently sits on stage
  var activeLayoutRotateDeg = 0; // rotation around that same Orientierungspunkt, applied before the offset
  var activeLayoutScale = 1; // size factor around that same Orientierungspunkt (#2025)
  var activeLayoutPinIndex = null; // ghost dot tapped to stay put while another one is dragged

  // Grundformen for n pairs, centered around (0,0), +y = front (towards the audience). Spacing
  // shrinks once a shape would leave the stage — W × D is its width and depth (#2060).
  var W = 14, D = 14;
  function rowPoints(n, len){
    var s = n > 1 ? Math.min(3, len/(n-1)) : 0, pts = [];
    for(var i=0; i<n; i++) pts.push({x: (i-(n-1)/2)*s, y: 0});
    return pts;
  }
  function ringPoints(n, cx, r){
    var pts = [];
    for(var i=0; i<n; i++){
      var a = -Math.PI/2 + i/n*Math.PI*2;
      pts.push(n === 1 ? {x: cx, y: 0} : {x: cx + Math.cos(a)*r, y: Math.sin(a)*r});
    }
    return pts;
  }
  function gridRows(counts, s, rowGap){ // rows from front to back, each centered
    var pts = [];
    counts.forEach(function(c, r){
      for(var i=0; i<c; i++) pts.push({x: (i-(c-1)/2)*s, y: -r*rowGap});
    });
    return pts;
  }
  var LAYOUT_SHAPES = [
    {id:'form-reihe', name:'Reihe', points: function(n){ return rowPoints(n, W); }},
    {id:'form-doppelreihe', name:'Doppelreihe (versetzt)', points: function(n){
      var f = Math.ceil(n/2), b = n-f, s = f > 1 ? Math.min(3, (W-2)/(f-1)) : 3, pts = [];
      for(var i=0; i<f; i++) pts.push({x: (i-(f-1)/2)*s, y: 1.5});
      for(var j=0; j<b; j++) pts.push({x: (j-(b-1)/2)*s + (b === f ? s/2 : 0), y: -1.5});
      return pts;
    }},
    {id:'form-block', name:'Block', points: function(n){
      var cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n/cols), counts = [];
      for(var r=0; r<rows; r++) counts.push(Math.min(cols, n - r*cols));
      var s = Math.min(3, cols > 1 ? (W-2)/(cols-1) : 3, rows > 1 ? (D-2)/(rows-1) : 3);
      return gridRows(counts, s, s);
    }},
    {id:'form-keil', name:'Keil (Spitze vorn)', points: function(n){
      var counts = [];
      for(var k=1, left=n; left > 0; k++){ counts.push(Math.min(k, left)); left -= k; }
      var s = Math.min(2.5, counts.length > 1 ? (W-2)/(counts.length-1) : 2.5);
      return gridRows(counts, s, Math.min(2, (D-2)/Math.max(1, counts.length-1)));
    }},
    {id:'form-v', name:'V-Form (Spitze vorn)', points: function(n){
      // odd: one pair on the tip; even: the V stays open at the front (first pair at x=±1)
      var pts = [], odd = n % 2, steps = Math.max(1, Math.ceil(n/2)-1), x0 = odd ? 0 : 1;
      var dx = Math.min(2, (W/2-0.5-x0)/steps), dy = Math.min(2, (D-2)/steps);
      if(odd) pts.push({x: 0, y: 0});
      for(var j=odd; pts.length < n; j++){
        pts.push({x: -(x0 + j*dx), y: -j*dy}, {x: x0 + j*dx, y: -j*dy});
      }
      return pts;
    }},
    {id:'form-kreis', name:'Kreis', points: function(n){
      return ringPoints(n, 0, Math.max(2.5, Math.min(Math.min(W, D)/2-1, n*3/(2*Math.PI))));
    }},
    {id:'form-halbkreis', name:'Halbkreis (vorn offen)', points: function(n){
      var r = Math.max(3, Math.min(W/2-0.5, D-1, (n-1)*3/Math.PI)), pts = [];
      for(var i=0; i<n; i++){
        var a = Math.PI + (n > 1 ? i/(n-1) : 0.5)*Math.PI;
        pts.push({x: Math.cos(a)*r, y: Math.sin(a)*r});
      }
      return pts;
    }},
    {id:'form-zwei-kreise', name:'Zwei Kreise', points: function(n){
      var a = Math.ceil(n/2), r = function(c){ return Math.max(1.5, Math.min(W/4-0.5, D/2-1, c*2.5/(2*Math.PI))); };
      return ringPoints(a, -W/4, r(a)).concat(ringPoints(n-a, W/4, r(n-a)));
    }},
    {id:'form-diagonale', name:'Diagonale', points: function(n){
      return rowPoints(n, (Math.min(W, D)-2)*Math.SQRT2).map(function(p){ return {x: p.x/Math.SQRT2, y: p.x/Math.SQRT2}; });
    }},
    {id:'form-kolonne', name:'Kolonne (hintereinander)', points: function(n){
      return rowPoints(n, D).map(function(p){ return {x: 0, y: -p.x}; });
    }},
    {id:'form-gasse', name:'Gasse', points: function(n){
      var a = Math.ceil(n/2);
      return rowPoints(a, D).map(function(p){ return {x: -3, y: -p.x}; })
        .concat(rowPoints(n-a, D).map(function(p){ return {x: 3, y: -p.x}; }));
    }},
    {id:'form-zickzack', name:'Zickzack', points: function(n){
      return rowPoints(n, W).map(function(p, i){ return {x: p.x, y: i % 2 ? -1.5 : 1.5}; });
    }}
  ];
  // One ghost point per pair: every dot is a couple, except the Follow of an older saved pair.
  function layoutUnits(){
    return state.dancers.filter(function(d){ return dancerRole(d.id) !== 'follow'; });
  }

  // The active Vorlage as {positions, origin}: a Grundform generated for the current pair count
  // (bounding box centered on its origin). null when none is picked.
  function activeLayout(){
    var shape = activeLayoutId && LAYOUT_SHAPES.find(function(l){ return l.id === activeLayoutId; });
    if(!shape) return null;
    W = stageSize().w; D = stageSize().d;
    var pts = shape.points(layoutUnits().length);
    var xs = pts.map(function(p){ return p.x; }), ys = pts.map(function(p){ return p.y; });
    var cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs))/2 || 0;
    var cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys))/2 || 0;
    return {positions: pts.map(function(p){ return {x: roundNum(p.x-cx), y: roundNum(p.y-cy)}; }), origin: {x:0, y:0}};
  }

  function renderLayoutSelectOptions(){
    var wrap = document.getElementById('layoutSelectWrap');
    var select = document.getElementById('layoutSelect');
    if(!wrap || !select) return;
    wrap.hidden = false;
    select.innerHTML = '';
    var noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— Vorlage einblenden —';
    select.appendChild(noneOpt);
    function addGroup(label, layouts){
      if(!layouts.length) return;
      var group = document.createElement('optgroup');
      group.label = label;
      layouts.forEach(function(layout){
        var opt = document.createElement('option');
        opt.value = layout.id;
        opt.textContent = layout.name;
        group.appendChild(opt);
      });
      select.appendChild(group);
    }
    addGroup('Formen (passend zur Paarzahl)', LAYOUT_SHAPES);
    select.value = activeLayoutId || '';
    updateLayoutRotateFieldVisibility();
  }

  function updateLayoutRotateFieldVisibility(){
    var field = document.getElementById('layoutRotateField');
    if(field) field.hidden = !activeLayoutId;
  }

  function buildLayoutGhostLayer(){
    var layer = document.createElement('div');
    layer.className = 'layout-ghost-layer';
    layer.id = 'layoutGhostLayer';
    stageEl.appendChild(layer);
  }

  // The "Orientierungspunkt" — the rotation pivot for the active layout.
  function activeLayoutOrigin(){
    var layout = activeLayout();
    return layout ? layout.origin : {x:0, y:0};
  }

  // Rotates a relative point around the shape's own Orientierungspunkt, then places it at
  // activeLayoutOffset — i.e. rotation always happens "in place" around wherever the shape has
  // been dragged to, not around the stage's own center. Passing the origin itself in as `p`
  // returns its own screen position (dx/dy both zero) — that's what renders/drags its ghost dot.
  function layoutPointToStage(p){
    var r = layoutPointRaw(p);
    return {x: clampX(r.x), y: clampY(r.y)};
  }

  // Same without the stage clamp — the pin math below needs the exact, unclamped position.
  function layoutPointRaw(p){
    var rad = activeLayoutRotateDeg * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var origin = activeLayoutOrigin();
    var dx = ((p.x||0) - origin.x) * activeLayoutScale, dy = ((p.y||0) - origin.y) * activeLayoutScale;
    return {x: origin.x + dx*cos - dy*sin + activeLayoutOffset.x, y: origin.y + dx*sin + dy*cos + activeLayoutOffset.y};
  }

  // Shifts the shape so layout point q sits exactly at stagePos (rotation/size unchanged).
  function placeLayoutPointAt(q, stagePos){
    var at = layoutPointRaw(q);
    activeLayoutOffset = {x: activeLayoutOffset.x + stagePos.x - at.x, y: activeLayoutOffset.y + stagePos.y - at.y};
  }

  // Rotates and scales the shape so the pinned point qp stays at pinStage and qj lands on target.
  // False when qp and qj are the same layout point (nothing to turn by) — the caller just moves then.
  function scaleLayoutAroundPin(qp, pinStage, qj, target){
    var ox = qj.x - qp.x, oy = qj.y - qp.y;
    var tx = target.x - pinStage.x, ty = target.y - pinStage.y;
    var from = Math.hypot(ox, oy), to = Math.hypot(tx, ty);
    if(from < 1e-6) return false;
    if(to < 1e-6) return true; // dragged onto the pin itself: keep the last shape
    activeLayoutScale = to / from;
    activeLayoutRotateDeg = (((Math.atan2(ty, tx) - Math.atan2(oy, ox)) * 180 / Math.PI) + 540) % 360 - 180;
    placeLayoutPointAt(qp, pinStage);
    syncLayoutTransformInputs();
    return true;
  }

  function syncLayoutTransformInputs(){
    if(layoutRotateInputEl) layoutRotateInputEl.value = Math.round(activeLayoutRotateDeg);
    if(layoutScaleInputEl) layoutScaleInputEl.value = Math.round(activeLayoutScale * 100);
  }

  // Typed rotation/size turns around the pinned dot when there is one, else around the
  // Orientierungspunkt as before.
  function applyLayoutTransform(change){
    var layout = activeLayout();
    var pinned = layout && activeLayoutPinIndex != null ? layout.positions[activeLayoutPinIndex] : null;
    var pinStage = pinned && layoutPointRaw(pinned);
    change();
    if(pinned) placeLayoutPointAt(pinned, pinStage);
    renderLayoutGhost();
  }

  // How close (in grid units) a dancer/pair reference point must get to a Vorlage ghost point
  // before it snaps onto it. Used by attachDancerEvents' drag handler below.
  var LAYOUT_SNAP_RADIUS = 0.75;

  function activeLayoutGhostPoints(){
    var layout = activeLayout();
    if(!layout) return [];
    var n = Math.min(layout.positions.length, layoutUnits().length);
    var pts = [];
    for(var i=0; i<n; i++) pts.push(layoutPointToStage(layout.positions[i]));
    return pts;
  }

  // Nearest active ghost point to (gx,gy), only if within LAYOUT_SNAP_RADIUS — else null.
  function nearestLayoutPoint(gx, gy){
    var pts = activeLayoutGhostPoints();
    var best = null, bestDist = Infinity;
    pts.forEach(function(p){
      var d = Math.hypot(p.x - gx, p.y - gy);
      if(d < bestDist){ bestDist = d; best = p; }
    });
    return (best && bestDist <= LAYOUT_SNAP_RADIUS) ? best : null;
  }

  // Full rebuild — safe to call any time EXCEPT during an active ghost-dot drag (see
  // repositionLayoutGhostDots below for why: recreating the dragged node mid-drag breaks its
  // pointer capture after the very first move).
  function renderLayoutGhost(){
    var layer = document.getElementById('layoutGhostLayer');
    if(!layer) return;
    layer.innerHTML = '';
    var layout = activeLayout();
    if(!layout) return;
    var units = layoutUnits();
    var n = Math.min(layout.positions.length, units.length);
    for(var i=0; i<n; i++){
      var stagePos = layoutPointToStage(layout.positions[i]);
      var dot = document.createElement('span');
      var pinned = i === activeLayoutPinIndex;
      dot.className = 'layout-ghost-dot' + (pinned ? ' pinned' : '');
      dot.style.left = gridToPercentX(stagePos.x) + '%';
      dot.style.top = gridToPercentY(stagePos.y) + '%';
      dot.style.borderColor = units[i].color;
      dot.title = pinned
        ? 'Fixiert — einen anderen Punkt ziehen dreht und skaliert die Vorlage um diesen · Antippen löst'
        : 'Ziehen verschiebt die ganze Vorlage · Antippen fixiert diesen Punkt';
      attachLayoutGhostDragEvents(dot, i);
      layer.appendChild(dot);
    }
    // Orientierungspunkt — the rotation pivot, its own distinct grabbable marker
    // alongside the per-dancer dots (dragging it moves the whole shape too, same as any other dot
    // — they all just update the shared activeLayoutOffset).
    var originPos = layoutPointToStage(activeLayoutOrigin());
    var originDot = document.createElement('span');
    originDot.className = 'layout-ghost-origin';
    originDot.style.left = gridToPercentX(originPos.x) + '%';
    originDot.style.top = gridToPercentY(originPos.y) + '%';
    originDot.title = 'Orientierungspunkt — auch greifbar, verschiebt die ganze Vorlage';
    attachLayoutGhostDragEvents(originDot, null);
    layer.appendChild(originDot);
  }

  // Cheap in-place reposition (no DOM node recreation) for use *during* a drag — this is what
  // fixes "can only ever move a minimal distance": the previous code called the full
  // renderLayoutGhost() on every pointermove, which wipes and recreates every dot, including the
  // one that currently holds pointer capture. The instant that node is detached, the browser
  // drops its capture, so only the very first tiny move before the first re-render ever registered.
  function repositionLayoutGhostDots(){
    var layer = document.getElementById('layoutGhostLayer');
    var layout = activeLayout();
    if(!layer || !layout) return;
    var dots = layer.querySelectorAll('.layout-ghost-dot');
    for(var i=0; i<dots.length; i++){
      var stagePos = layoutPointToStage(layout.positions[i]);
      dots[i].style.left = gridToPercentX(stagePos.x) + '%';
      dots[i].style.top = gridToPercentY(stagePos.y) + '%';
    }
    var originDot = layer.querySelector('.layout-ghost-origin');
    if(originDot){
      var originPos = layoutPointToStage(activeLayoutOrigin());
      originDot.style.left = gridToPercentX(originPos.x) + '%';
      originDot.style.top = gridToPercentY(originPos.y) + '%';
    }
  }

  // Dragging any ghost dot moves the whole shape together (updates the shared offset, not just
  // that one point) — same pointer-capture pattern as attachDancerEvents' drag handling.
  // A tap pins a dot instead (#2025); dragging another dot then rotates/scales around the pin.
  function attachLayoutGhostDragEvents(dot, index){
    dot.addEventListener('pointerdown', function(e){
      e.preventDefault();
      e.stopPropagation();
      try{ dot.setPointerCapture(e.pointerId); }catch(err){}
      var startOffset = {x: activeLayoutOffset.x, y: activeLayoutOffset.y};
      // The grabbed dot's own current grid position (read back from its rendered style, so it's
      // right regardless of the shape's rotation) — snapping should land THIS specific point
      // exactly on an integer grid coordinate, same as dragging a dancer does. Rounding the
      // incremental *movement* instead (the previous approach) still left the shape off-grid
      // whenever it had last been placed with Shift (fractional offset).
      var grabStart = {
        x: percentToX(parseFloat(dot.style.left)),
        y: percentToY(parseFloat(dot.style.top))
      };
      var layout = activeLayout();
      var pinned = layout && index != null && activeLayoutPinIndex != null && index !== activeLayoutPinIndex
        ? layout.positions[activeLayoutPinIndex] : null;
      var pinStage = pinned && layoutPointRaw(pinned);
      var moved = false;
      function onMove(ev){
        if(!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return; // still a tap
        moved = true;
        var rect = stageEl.getBoundingClientRect();
        var px = ((ev.clientX-rect.left)/rect.width)*100;
        var py = ((ev.clientY-rect.top)/rect.height)*100;
        var gx = percentToX(px);
        var gy = percentToY(py);
        if(!ev.shiftKey){ gx = Math.round(gx); gy = Math.round(gy); }
        if(pinned && scaleLayoutAroundPin(pinned, pinStage, layout.positions[index], {x:gx, y:gy})){
          repositionLayoutGhostDots();
          return;
        }
        var dx = gx - grabStart.x, dy = gy - grabStart.y;
        activeLayoutOffset = {
          x: clampX(startOffset.x + dx),
          y: clampY(startOffset.y + dy)
        };
        repositionLayoutGhostDots();
      }
      function onUp(){
        try{ dot.releasePointerCapture(e.pointerId); }catch(err){}
        dot.removeEventListener('pointermove', onMove);
        dot.removeEventListener('pointerup', onUp);
        if(!moved && index != null){
          activeLayoutPinIndex = activeLayoutPinIndex === index ? null : index;
          renderLayoutGhost();
        }
      }
      dot.addEventListener('pointermove', onMove);
      dot.addEventListener('pointerup', onUp);
    });
  }

  // Called wherever the active Bild actually changes (never from e.g. a mere re-render,
  // which also touches the stage but isn't a Bild switch) — a chosen Vorlage, and any placement
  // applied to it, is a reference for the Bild you were just positioning, not something that
  // should silently carry over. Doubles as the one shared "Bild switch happened" hook already
  // wired into every relevant call site, so the onion-skin overlay (renderOnionSkin — a different
  // concern, but needs the exact same trigger) piggybacks on it too, ahead of the
  // Vorlage-specific early return below.
  function resetLayoutGhost(){
    renderOnionSkin();
    if(!activeLayoutId) return;
    activeLayoutId = null;
    activeLayoutOffset = {x:0, y:0};
    activeLayoutRotateDeg = 0;
    activeLayoutScale = 1;
    activeLayoutPinIndex = null;
    syncLayoutTransformInputs();
    renderLayoutSelectOptions();
    renderLayoutGhost();
  }

  var layoutSelectEl = document.getElementById('layoutSelect');
  var layoutRotateInputEl = document.getElementById('layoutRotateInput');
  var layoutScaleInputEl = document.getElementById('layoutScaleInput');
  if(layoutSelectEl){
    layoutSelectEl.addEventListener('change', function(){
      activeLayoutId = layoutSelectEl.value || null;
      activeLayoutOffset = {x:0, y:0};
      activeLayoutRotateDeg = 0;
      activeLayoutScale = 1;
      activeLayoutPinIndex = null;
      syncLayoutTransformInputs();
      updateLayoutRotateFieldVisibility();
      renderLayoutGhost();
    });
  }
  if(layoutRotateInputEl){
    layoutRotateInputEl.addEventListener('input', function(){
      var deg = parseFloat(layoutRotateInputEl.value);
      applyLayoutTransform(function(){ activeLayoutRotateDeg = isFinite(deg) ? deg : 0; });
    });
  }
  if(layoutScaleInputEl){
    layoutScaleInputEl.addEventListener('input', function(){
      var pct = parseFloat(layoutScaleInputEl.value);
      applyLayoutTransform(function(){ activeLayoutScale = isFinite(pct) && pct > 0 ? pct / 100 : 1; });
    });
  }

  // A line every metre across the width and the depth (#2060); on a big stage only every second
  // one gets a number, so they don't run into each other.
  function buildGridOverlay(){
    var overlay = document.createElement('div');
    overlay.className = 'stage-grid';
    var s = stageSize(), step = Math.max(s.w, s.d) > 20 ? 2 : 1;
    function lines(half, toPct, lineCls, labelCls, prop){
      for(var v = Math.ceil(-half); v <= half; v++){
        var pct = toPct(v), isZero = v === 0;
        var line = document.createElement('div');
        line.className = 'grid-line ' + lineCls + (isZero ? ' zero' : '');
        line.style[prop] = pct + '%';
        overlay.appendChild(line);
        if(v % step) continue;
        var label = document.createElement('span');
        label.className = 'grid-label ' + labelCls + (isZero ? ' zero' : '');
        label.style[prop] = pct + '%';
        label.textContent = v;
        overlay.appendChild(label);
      }
    }
    lines(s.w / 2, gridToPercentX, 'vertical', 'x-label', 'left');
    lines(s.d / 2, gridToPercentY, 'horizontal', 'y-label', 'top');
    stageEl.appendChild(overlay);
  }

  // The group a plain drag/nudge on `dancerId` should move together — the whole current
  // pairSelection if that dancer is part of one with 2+ members, otherwise just itself. Ctrl/Cmd-
  // click (see pointerdown below) is how you pare a saved pair's auto-selection down to just one.
  // A selected Follow that isn't split off in this Bild has no point here, so it stays out.
  function dragGroupFor(dancerId){
    if(pairSelection.length < 2 || pairSelection.indexOf(dancerId) === -1) return [dancerId];
    var pos = currentFormation().pos;
    return pairSelection.filter(function(id){ return id === dancerId || pos[id]; });
  }

  // What a plain click selects: the dancer's saved pair (unless split in this Bild), else just them.
  function defaultSelectionFor(dancerId){
    var pair = findPairForDancer(dancerId);
    return (pair && !isPairSplitHere(pair)) ? pair.memberIds.slice() : [dancerId];
  }

  function attachDancerEvents(el, dancerId){
    el.tabIndex = 0;
    el.addEventListener('contextmenu', function(e){
      openSelectionMenuFromEvent(e, el, defaultSelectionFor(dancerId), [dancerId], dancerId);
    });
    el.addEventListener('pointerdown', function(e){
      // The right button selects and opens the menu on its own (contextmenu above), without a drag.
      if(e.button === 2) return;
      if(playing) pausePlayback();
      // Ctrl/Cmd-held is "isolate": toggles this one dancer in/out of the ad hoc selection like
      // before, but — unlike before — the drag that follows still moves just this one dancer,
      // even if they're part of a pair or a larger selection. That's the way to pull one dancer
      // out of formation for a moment without disturbing the group's auto-follow.
      var isolate = e.ctrlKey || e.metaKey;
      var keepGroup = false;
      if(isolate){
        e.preventDefault();
        var idx = pairSelection.indexOf(dancerId);
        if(idx !== -1) pairSelection.splice(idx, 1); else pairSelection.push(dancerId);
      }else if(e.shiftKey){
        // Shift-click adds what a plain click would select (the pair, too) or takes it out again;
        // unlike Strg the drag that follows moves the whole selection (#2043).
        var add = defaultSelectionFor(dancerId);
        if(pairSelection.indexOf(dancerId) !== -1) pairSelection = pairSelection.filter(function(id){ return add.indexOf(id) === -1; });
        else add.forEach(function(id){ if(pairSelection.indexOf(id) === -1) pairSelection.push(id); });
      }else{
        // Plain click on a dancer with a saved partner selects — and now drags — both together.
        // An unpaired dancer starts a fresh single-dancer selection (not an empty one — a plain
        // click used to clear pairSelection to [] entirely here, so it never actually registered
        // the clicked dancer; pairing two unpaired dancers then took an extra, confusing Ctrl-click
        // to even reach length 2, and could end up pairing the wrong two if a stray plain click
        // landed in between).
        // …unless that pair is split in this Bild ("Paar lösen"): then only the clicked partner.
        // Pressing a dancer that already belongs to a 2+ selection keeps that selection, so the
        // whole group can be grabbed and dragged without holding Strg/Cmd; a plain click on it
        // without moving still narrows down to the clicked dancer (see onUp).
        keepGroup = pairSelection.length >= 2 && pairSelection.indexOf(dancerId) !== -1;
        if(!keepGroup) pairSelection = defaultSelectionFor(dancerId);
      }
      try{ el.setPointerCapture(e.pointerId); }catch(err){}
      selectedDancerId = dancerId;
      ensureMarkers();
      updatePairRotateUI();
      var groupIds = isolate ? [dancerId] : dragGroupFor(dancerId);
      var startPositions = {};
      groupIds.forEach(function(id){
        var p = currentFormation().pos[id];
        startPositions[id] = {x: p ? p.x : 0, y: p ? p.y : 0};
      });
      var grabStart = startPositions[dancerId];
      var moved = false;
      // Touch has no right button: holding a finger still on the dancer opens the menu instead.
      var longPressed = false;
      var longPressTimer = e.pointerType === 'mouse' ? null : setTimeout(function(){
        longPressed = true;
        openSelectionMenu(e.clientX, e.clientY);
      }, LONG_PRESS_MS);
      function onMove(ev){
        if(longPressed || !moved && Math.abs(ev.clientX-e.clientX) + Math.abs(ev.clientY-e.clientY) < 4) return;
        moved = true;
        clearTimeout(longPressTimer);
        var rect = stageEl.getBoundingClientRect();
        var px = ((ev.clientX-rect.left)/rect.width)*100;
        var py = ((ev.clientY-rect.top)/rect.height)*100;
        var gx = percentToX(px);
        var gy = percentToY(py);
        if(!ev.shiftKey){ gx = Math.round(gx); gy = Math.round(gy); }
        var dx = gx - grabStart.x, dy = gy - grabStart.y;
        // Snap onto an active Vorlage's nearest point: for a solo drag the reference is the
        // dragged dancer's own tentative position; for a pair/group drag it's the group's
        // centroid (for exactly 2 that's the midpoint between the partners) — matching "der
        // Mittelpunkt des Paars soll auf den Punkt der Vorlage einrasten". Shift disables it,
        // same as it disables plain grid snapping.
        if(activeLayoutId && !ev.shiftKey){
          var refX, refY;
          if(groupIds.length >= 2){
            var sumX = 0, sumY = 0;
            groupIds.forEach(function(id){ var sp = startPositions[id]; sumX += sp.x+dx; sumY += sp.y+dy; });
            refX = sumX/groupIds.length; refY = sumY/groupIds.length;
          }else{
            refX = grabStart.x+dx; refY = grabStart.y+dy;
          }
          var snap = nearestLayoutPoint(refX, refY);
          if(snap){ dx += snap.x-refX; dy += snap.y-refY; }
        }
        groupIds.forEach(function(id){
          var sp = startPositions[id];
          setDancerPos(id, sp.x+dx, sp.y+dy);
        });
      }
      function onUp(ev){
        clearTimeout(longPressTimer);
        try{ el.releasePointerCapture(e.pointerId); }catch(err){}
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        if(keepGroup && !moved && !longPressed){
          pairSelection = defaultSelectionFor(dancerId);
          ensureMarkers();
          updatePairRotateUI();
        }
        saveState();
      }
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    });
    // Double-click / "T" splits a couple into Lead & Follow for this Bild (or merges it back).
    el.addEventListener('dblclick', function(e){
      e.preventDefault();
      if(canCoupleSplit(dancerId)) toggleCoupleSplit(dancerId);
    });
    el.addEventListener('keydown', function(e){
      if((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey && !e.altKey){
        if(canCoupleSplit(dancerId) && !(typeof isBildLocked === 'function' && isBildLocked())){ e.preventDefault(); toggleCoupleSplit(dancerId); }
        return;
      }
    });
  }

  /* ---------- pair rotation ---------- */

  // No length cap any more — Ctrl/Cmd-click is a general toggle-in-selection gesture now, used
  // both to pare an auto-selected pair down to one dancer and to build up an arbitrary multi-
  // selection (e.g. several same-role dancers from different pairs, see updatePairRotateUI).
  function togglePairSelection(dancerId){
    var idx = pairSelection.indexOf(dancerId);
    if(idx !== -1) pairSelection.splice(idx, 1);
    else pairSelection.push(dancerId);
    ensureMarkers();
    updatePairRotateUI();
  }

  function updatePairRotateUI(){
    updatePairRotateControls();
    fitPairBar();
  }

  // Too little room for „Paardrehung bis …“ next to the rest: show the icons instead, as on phones.
  function fitPairBar(){
    var bar = pairRotateEl.parentNode;
    pairRotateEl.classList.remove('compact');
    if(!pairRotateEl.hidden && !selectionMenuAt && bar.scrollWidth > bar.clientWidth) pairRotateEl.classList.add('compact');
  }

  function updatePairRotateControls(){
    if(typeof noteHistoryView === 'function') noteHistoryView(); // a new Bild or selection is an undo step (js/history.js)
    // While paused mid-move the markers stand between two Bilder — the cross has to sit between
    // them there too, not at the Bild's own positions.
    updatePairMidpointMarker(pausedAt && shownPosMap || currentFormation().pos);
    updatePairTurnUI();
    updatePairSpinUI();
    updateOrbitUI();
    // "Paar lösen/koppeln" is offered for exactly one saved pair, or one partner of a split pair.
    var splitPair = null;
    if(pairSelection.length === 2) splitPair = findPairByMembers(pairSelection);
    else if(pairSelection.length === 1){
      var single = findPairForDancer(pairSelection[0]);
      if(single && isPairSplitHere(single)) splitPair = single;
    }
    if(splitPair){
      var isSplit = isPairSplitHere(splitPair);
      pairSplitBtn.hidden = false;
      delete pairSplitBtn.dataset.couple;
      pairSplitBtn.dataset.pairId = splitPair.id;
      pairSplitBtn.textContent = isSplit ? 'Paar wieder koppeln' : 'Paar lösen (nur dieses Bild)';
      pairSplitBtn.classList.toggle('active', isSplit);
    }else{
      pairSplitBtn.hidden = true;
    }
    // Lead & Follow of one couple (both stay selected after „In Lead & Follow aufteilen“). In a
    // Bild where that couple isn't split, it's just the couple's dot again.
    var coupleBase = pairSelection.length === 2 && baseDancerId(pairSelection[0]) === baseDancerId(pairSelection[1]) &&
      canCoupleSplit(pairSelection[0]) ? baseDancerId(pairSelection[0]) : null;
    var coupleBoth = !!coupleBase && isCoupleSplitIn(currentFormation(), coupleBase);
    var single = pairSelection.length < 2 || (!!coupleBase && !coupleBoth);
    pairRotateEl.classList.toggle('single', single);
    if(single){
      if(splitPair){
        var me = state.dancers.find(function(dd){ return dd.id === pairSelection[0]; });
        pairRotateLabelEl.textContent = (me ? me.name : '?') + ' · ' + roleLabel(dancerRole(pairSelection[0]), false) + ' (Paar in diesem Bild gelöst)';
        pairSameRoleBtn.hidden = true;
        pairRotateEl.hidden = false;
      }else if(coupleBase || (pairSelection.length === 1 && canCoupleSplit(pairSelection[0]))){
        var sid = coupleBase || pairSelection[0], base = baseDancerId(sid);
        var coupleSplit = showCoupleSplitBtn(base);
        pairRotateLabelEl.textContent = markerDisplayName(base) + (coupleSplit ? (isFollowKey(sid) ? ' · Follow' : ' · Lead') : '');
        pairSameRoleBtn.hidden = true;
        pairRotateEl.hidden = false;
      }else{
        pairRotateEl.hidden = true;
        closeSelectionMenu();
      }
      return;
    }
    var names = pairSelection.map(markerDisplayName);
    var savedPair = pairSelection.length === 2 && findPairByMembers(pairSelection);
    if(coupleBoth) showCoupleSplitBtn(coupleBase);
    pairRotateLabelEl.textContent = savedPair ? 'Paar: ' + names[0] + ' & ' + names[1]
      : coupleBoth ? markerDisplayName(coupleBase) + ' · Lead & Follow'
      : 'Auswahl: ' + names.join(', ');
    // Offer to expand to every dancer sharing the same role (Lead/Follow), whenever the current
    // selection is all one role — most useful for 2+ dancers picked from *different* pairs, but
    // also fires for a single already-selected pair (harmless: "alle Leads" then just includes
    // this one pair's Lead too if it's the only pair, and grows the selection if there are more).
    var roles = pairSelection.map(dancerRole);
    var allSameRole = roles[0] && roles.every(function(r){ return r === roles[0]; });
    if(allSameRole){
      var roleCount = allDancersWithRole(roles[0]).length;
      pairSameRoleBtn.hidden = roleCount <= pairSelection.length;
      pairSameRoleBtn.textContent = 'Alle ' + roleLabel(roles[0], true) + ' auswählen (' + roleCount + ')';
      pairSameRoleBtn.dataset.role = roles[0];
    }else{
      pairSameRoleBtn.hidden = true;
    }
    pairRotateEl.hidden = false;
  }

  // „In Lead & Follow aufteilen“ / „zusammenführen“ for a couple dot; returns whether it's split here.
  function showCoupleSplitBtn(base){
    var coupleSplit = isCoupleSplitIn(currentFormation(), base);
    pairSplitBtn.hidden = false;
    delete pairSplitBtn.dataset.pairId;
    pairSplitBtn.dataset.couple = base;
    pairSplitBtn.textContent = coupleSplit ? 'Lead & Follow zusammenführen' : 'In Lead & Follow aufteilen';
    pairSplitBtn.title = coupleSplit
      ? 'Follow geht zurück in den Punkt des Paares (nur in diesem Bild).'
      : 'Teilt das Paar nur in diesem Bild in zwei Punkte, die du einzeln ziehen kannst. Auch per Doppelklick oder Taste T.';
    pairSplitBtn.classList.toggle('active', coupleSplit);
    return coupleSplit;
  }

  /* ---------- saved dancer pairs (nur noch aus älteren Projekten — neue werden nicht mehr angelegt;
     getrennte Lead/Follow gibt es über „In Lead & Follow aufteilen“) ---------- */

  function findPairForDancer(dancerId){
    return state.pairs.find(function(p){ return p.memberIds.indexOf(dancerId) !== -1; }) || null;
  }

  function findPairByMembers(memberIds){
    return state.pairs.find(function(p){
      return p.memberIds.length === 2 && memberIds.length === 2 &&
        p.memberIds.indexOf(memberIds[0]) !== -1 && p.memberIds.indexOf(memberIds[1]) !== -1;
    }) || null;
  }

  // Role is derived purely from position within a saved pair's memberIds — no separate field:
  // memberIds[0] is "Lead" (also Partner A for couples-Figuren), memberIds[1] is "Follow"
  // (Partner B). Unpaired dancers have no role.
  function dancerRole(dancerId){
    var pair = findPairForDancer(dancerId);
    if(!pair) return null;
    return pair.memberIds[0] === dancerId ? 'lead' : 'follow';
  }

  function roleLabel(role, plural){
    if(role === 'lead') return plural ? 'Leads' : 'Lead';
    if(role === 'follow') return plural ? 'Follows' : 'Follow';
    return '';
  }

  function allDancersWithRole(role){
    return state.pairs.map(function(p){ return role === 'lead' ? p.memberIds[0] : p.memberIds[1]; }).filter(Boolean);
  }

  // Live midpoint of a pair's two current positions — "die Koordinate des Mittelpunkts des
  // Tanzpaars", shown/edited in the roster's collapsed pair view.
  function pairMidpoint(pair){
    var pos = currentFormation().pos;
    var a = pos[pair.memberIds[0]], b = pos[pair.memberIds[1]];
    if(!a || !b) return {x:0, y:0};
    return {x: (a.x+b.x)/2, y: (a.y+b.y)/2};
  }

  // Shifts both partners by the same delta, preserving their relative offset — used when the
  // roster's collapsed-pair midpoint X/Y is edited directly.
  function setPairMidpoint(pair, mx, my){
    var pos = currentFormation().pos;
    var idA = pair.memberIds[0], idB = pair.memberIds[1];
    var a = pos[idA], b = pos[idB];
    if(!a || !b) return;
    var curMx = (a.x+b.x)/2, curMy = (a.y+b.y)/2;
    var dx = mx - curMx, dy = my - curMy;
    setDancerPos(idA, a.x+dx, a.y+dy, true);
    setDancerPos(idB, b.x+dx, b.y+dy, true);
  }

  function dissolvePair(pairId){
    state.pairs = state.pairs.filter(function(p){ return p.id !== pairId; });
    state.formations.forEach(function(f){
      if(Array.isArray(f.splitPairs)) f.splitPairs = f.splitPairs.filter(function(id){ return id !== pairId; });
    });
    saveState();
    renderRoster();
    updatePairRotateUI();
  }

  // Accepts either a fraction of a full turn ("1/4") or a plain degree value ("90").
  function parseAngleInput(str){
    str = (str || '').trim();
    if(!str) return null;
    var frac = str.match(/^(-?\d+(?:[.,]\d+)?)\s*\/\s*(-?\d+(?:[.,]\d+)?)$/);
    if(frac){
      var num = parseFloat(frac[1].replace(',', '.'));
      var den = parseFloat(frac[2].replace(',', '.'));
      if(!den) return null;
      return (num / den) * 360;
    }
    var n = parseFloat(str.replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  // Generalized from the original exactly-2 (midpoint) version to N selected dancers, rotated
  // together around their shared centroid — a strict generalization, since the centroid of 2
  // points is their midpoint, so the original 2-person behavior is unchanged. A single dancer
  // (from the right-click menu) is its own centroid, so it just turns on the spot.
  function rotatePairSelection(deg){
    if(!pairSelection.length || !deg) return;
    var pos = currentFormation().pos;
    var ids = pairSelection.filter(function(id){ return pos[id]; });
    if(!ids.length) return;
    var mx = 0, my = 0;
    ids.forEach(function(id){ mx += pos[id].x; my += pos[id].y; });
    mx /= ids.length; my /= ids.length;
    var rad = deg * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    ids.forEach(function(id){
      var p = pos[id];
      var dx = p.x - mx, dy = p.y - my;
      p.x = clampX(mx + dx*cos - dy*sin);
      p.y = clampY(my + dx*sin + dy*cos);
      p.rot = normAngle((p.rot || 0) + deg);
    });
    positionMarkers(pos);
    updateMiniDots(state.activeIndex);
    refreshRosterCoords();
    saveState();
  }

  pairRotateBtn.addEventListener('click', function(){
    var deg = parseAngleInput(pairRotateAngleInput.value);
    if(deg === null){ pairRotateAngleInput.focus(); return; }
    rotatePairSelection(deg);
  });
  pairRotateAngleInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); pairRotateBtn.click(); }
  });

  /* ---------- Drehung im Paar und Eigendrehung bis zur nächsten Station ----------
     Stored on the stop the move leaves from — the Bild, or the Zwischenposition being edited
     (coupleTurns / spins, see interpolateThroughBetweens in state.js). Drehung: on the way to the
     next stop, Lead and Follow turn around their shared midpoint by exactly this angle while the
     midpoint itself walks its path; a closed couple's arrow turns by it instead. Eigendrehung: one
     person's arrow turns by it on the spot, on top of anything else. */

  // The leg the stage shows the start of: from the active Bild, or from the Zwischenposition being
  // edited, to whatever comes next on the way there (the next Zwischenposition or the next Bild).
  function currentLeg(){
    var fIdx = editingBetween ? editingBetween.fIdx : state.activeIndex;
    var f = state.formations[fIdx], nextF = state.formations[fIdx + 1];
    if(!f || !nextF) return null;
    var bs = Array.isArray(f.betweens) ? f.betweens : [];
    var i = editingBetween ? editingBetween.bIdx : -1;
    var cur = i < 0 ? f : bs[i];
    if(!cur || !cur.pos) return null;
    var next = bs[i + 1];
    var nextName = next ? 'Zwischenposition ' + (i + 2) + (next.name ? ' — ' + next.name : '') : nextF.name;
    return {cur: cur, next: next || nextF, nextName: nextName};
  }

  // The one couple the selection stands for: a couple dot — closed, or one or both of its points
  // when split — or a saved pair from an older project.
  function selectedCouple(){
    if(state.shareReadOnly) return null;
    var leg = currentLeg();
    if(!leg || !pairSelection.length || pairSelection.length > 2) return null;
    var cur = leg.cur, next = leg.next;
    var lk = null, fk = null;
    var base = baseDancerId(pairSelection[0]);
    if(pairSelection.every(function(id){ return baseDancerId(id) === base; })){
      if(canCoupleSplit(base)){ lk = base; fk = followKey(base); }
    }else{
      var pair = findPairByMembers(pairSelection);
      if(pair && !isPairSplitHere(pair) && !pair.memberIds.some(function(id){ return cur.pos[followKey(id)] || next.pos[followKey(id)]; })){
        lk = pair.memberIds[0]; fk = pair.memberIds[1];
        if(!cur.pos[fk] || !next.pos[fk]) return null;
      }
    }
    if(!lk || !cur.pos[lk] || !next.pos[lk]) return null;
    return {lk: lk, fk: fk, cur: cur, next: next, nextName: leg.nextName};
  }

  function coupleTurnOf(c){
    var turns = sanitizeCoupleTurns(c.cur.coupleTurns);
    return turns && typeof turns[c.lk] === 'number' ? turns[c.lk] : null;
  }

  function updatePairTurnUI(){
    var c = selectedCouple();
    pairTurnEl.hidden = !c;
    if(!c) return;
    pairTurnLabelEl.textContent = 'Paardrehung bis „' + c.nextName + '“';
    var turn = coupleTurnOf(c);
    if(document.activeElement !== pairTurnInput) pairTurnInput.value = turn === null ? '' : roundNum(turn) + '°';
    pairTurnClearBtn.hidden = turn === null;
  }

  // Setting a turn also poses the couple at the next stop: same distance apart, turned by that
  // angle around the midpoint they arrive at there (the couple's dot, if it isn't split there yet)
  // — so Lead and Follow don't have to be posed by hand. Facing turns along with them. A couple
  // that is closed at both ends just arrives with its arrow turned that far; one that only opens
  // up on the way keeps the spots it was posed in.
  function setCoupleTurn(turn){
    var c = selectedCouple();
    if(!c) return;
    turn = Math.max(-MAX_COUPLE_TURN, Math.min(MAX_COUPLE_TURN, turn));
    var la = c.cur.pos[c.lk], fa = c.cur.pos[c.fk];
    var lb = c.next.pos[c.lk], fb = c.next.pos[c.fk] || lb;
    if(fa){
      var hx = (la.x - fa.x)/2, hy = (la.y - fa.y)/2;
      var mx = (lb.x + fb.x)/2, my = (lb.y + fb.y)/2;
      var rad = turn * Math.PI / 180;
      var cos = Math.cos(rad), sin = Math.sin(rad);
      var rx = hx*cos - hy*sin, ry = hx*sin + hy*cos;
      c.next.pos[c.lk] = {x: clampX(mx + rx), y: clampY(my + ry), rot: normAngle((la.rot||0) + turn)};
      c.next.pos[c.fk] = {x: clampX(mx - rx), y: clampY(my - ry), rot: normAngle((fa.rot||0) + turn)};
    }else if(!c.next.pos[c.fk]){
      c.next.pos[c.lk] = {x: lb.x, y: lb.y, rot: normAngle((la.rot||0) + turn)};
    }
    var turns = sanitizeCoupleTurns(c.cur.coupleTurns) || {};
    turns[c.lk] = turn;
    c.cur.coupleTurns = sanitizeCoupleTurns(turns);
    afterCoupleTurnChange();
  }

  // Back to the short way; the next stop keeps where the couple stands.
  function clearCoupleTurn(){
    var c = selectedCouple();
    if(!c) return;
    var turns = sanitizeCoupleTurns(c.cur.coupleTurns) || {};
    delete turns[c.lk];
    c.cur.coupleTurns = sanitizeCoupleTurns(turns);
    afterCoupleTurnChange();
  }

  // The one person an Eigendrehung is for: a single selected point that is one person here — Lead
  // or Follow of a split couple, or a dancer of a saved pair. A closed couple turns via Drehung.
  function selectedSpinner(){
    if(state.shareReadOnly || pairSelection.length !== 1) return null;
    var leg = currentLeg();
    var k = pairSelection[0];
    if(!leg || !leg.cur.pos[k]) return null;
    if(!isFollowKey(k) && !leg.cur.pos[followKey(k)] && !findPairForDancer(k)) return null;
    return {k: k, cur: leg.cur, next: leg.next, nextName: leg.nextName};
  }

  function spinOf(s){
    var spins = sanitizeSpins(s.cur.spins);
    return spins && typeof spins[s.k] === 'number' ? spins[s.k] : null;
  }

  function updatePairSpinUI(){
    var s = selectedSpinner();
    pairSpinEl.hidden = !s;
    if(!s) return;
    pairSpinLabelEl.textContent = 'Eigendrehung bis „' + s.nextName + '“';
    var spin = spinOf(s);
    if(document.activeElement !== pairSpinInput) pairSpinInput.value = spin === null ? '' : roundNum(spin) + '°';
    pairSpinClearBtn.hidden = spin === null;
  }

  // Like a Drehung, setting it also turns the person's arrow at the next stop by that much (where
  // they have a spot of their own there — a Follow closing into the dot ends up facing its way).
  function setSpin(spin){
    var s = selectedSpinner();
    if(!s) return;
    spin = Math.max(-MAX_COUPLE_TURN, Math.min(MAX_COUPLE_TURN, spin));
    var spins = sanitizeSpins(s.cur.spins) || {};
    spins[s.k] = spin;
    s.cur.spins = sanitizeSpins(spins);
    var nb = s.next.pos[s.k];
    if(nb) s.next.pos[s.k] = {x: nb.x, y: nb.y, rot: normAngle((s.cur.pos[s.k].rot||0) + spin)};
    afterCoupleTurnChange();
  }

  function clearSpin(){
    var s = selectedSpinner();
    if(!s) return;
    var spins = sanitizeSpins(s.cur.spins) || {};
    delete spins[s.k];
    s.cur.spins = sanitizeSpins(spins);
    afterCoupleTurnChange();
  }

  // Kreisbahn (#2067): three or more points with a spot of their own here and at the next stop.
  function selectedOrbit(){
    if(state.shareReadOnly || pairSelection.length < 3) return null;
    var leg = currentLeg();
    if(!leg || pairSelection.some(function(k){ return !leg.cur.pos[k] || !leg.next.pos[k]; })) return null;
    return {ids: pairSelection.slice(), cur: leg.cur, next: leg.next, nextName: leg.nextName};
  }

  // The selection's other Kreisbahnen on this stop, without its points.
  function orbitsWithout(o){
    return (sanitizeOrbits(o.cur.orbits) || []).map(function(g){
      return {ids: g.ids.filter(function(k){ return o.ids.indexOf(k) === -1; }), turn: g.turn};
    });
  }

  // Shown only when the selection is exactly one set group.
  function orbitOf(o){
    var key = o.ids.slice().sort().join();
    var g = (sanitizeOrbits(o.cur.orbits) || []).find(function(g){ return g.ids.slice().sort().join() === key; });
    return g ? g.turn : null;
  }

  function updateOrbitUI(){
    var o = selectedOrbit();
    pairOrbitEl.hidden = !o;
    if(!o) return;
    pairOrbitLabelEl.textContent = 'Kreisbahn bis „' + o.nextName + '“';
    var turn = orbitOf(o);
    if(document.activeElement !== pairOrbitInput) pairOrbitInput.value = turn === null ? '' : roundNum(turn) + '°';
    pairOrbitClearBtn.hidden = turn === null;
  }

  // Like a Drehung, setting it also poses the selection at the next stop: its shape here, turned by
  // that angle around the middle it arrives at there.
  function setOrbit(turn){
    var o = selectedOrbit();
    if(!o) return;
    turn = Math.max(-MAX_COUPLE_TURN, Math.min(MAX_COUPLE_TURN, turn));
    function mid(pos){
      var x = 0, y = 0;
      o.ids.forEach(function(k){ x += pos[k].x; y += pos[k].y; });
      return {x: x / o.ids.length, y: y / o.ids.length};
    }
    var ca = mid(o.cur.pos), cb = mid(o.next.pos), rad = turn * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    o.ids.forEach(function(k){
      var p = o.cur.pos[k], dx = p.x - ca.x, dy = p.y - ca.y;
      o.next.pos[k] = {x: clampX(cb.x + dx*cos - dy*sin), y: clampY(cb.y + dx*sin + dy*cos), rot: normAngle((p.rot||0) + turn)};
    });
    o.cur.orbits = sanitizeOrbits(orbitsWithout(o).concat([{ids: o.ids, turn: turn}]));
    afterCoupleTurnChange();
  }

  // Back to straight paths; the next stop keeps where everyone stands.
  function clearOrbit(){
    var o = selectedOrbit();
    if(!o) return;
    o.cur.orbits = sanitizeOrbits(orbitsWithout(o));
    afterCoupleTurnChange();
  }

  function afterCoupleTurnChange(){
    saveState();
    renderFilmstrip();
    renderOnionSkin();
    updatePairRotateUI();
  }

  pairTurnBtn.addEventListener('click', function(){
    var deg = parseAngleInput(pairTurnInput.value);
    if(deg === null){ pairTurnInput.focus(); return; }
    setCoupleTurn(deg);
  });
  pairTurnInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); pairTurnBtn.click(); }
  });
  armDeleteButton(pairTurnClearBtn, clearCoupleTurn);
  pairSpinBtn.addEventListener('click', function(){
    var deg = parseAngleInput(pairSpinInput.value);
    if(deg === null){ pairSpinInput.focus(); return; }
    setSpin(deg);
  });
  pairSpinInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); pairSpinBtn.click(); }
  });
  armDeleteButton(pairSpinClearBtn, clearSpin);
  pairOrbitBtn.addEventListener('click', function(){
    var deg = parseAngleInput(pairOrbitInput.value);
    if(deg === null){ pairOrbitInput.focus(); return; }
    setOrbit(deg);
  });
  pairOrbitInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); pairOrbitBtn.click(); }
  });
  armDeleteButton(pairOrbitClearBtn, clearOrbit);
  pairSplitBtn.addEventListener('click', function(){
    if(pairSplitBtn.dataset.couple){ toggleCoupleSplit(pairSplitBtn.dataset.couple); return; }
    var pairId = pairSplitBtn.dataset.pairId;
    if(pairId) togglePairSplit(pairId);
  });
  pairSameRoleBtn.addEventListener('click', function(){
    var role = pairSameRoleBtn.dataset.role;
    if(!role) return;
    pairSelection = allDancersWithRole(role);
    ensureMarkers();
    updatePairRotateUI();
  });
  function clearSelection(){
    pairSelection = [];
    selectedDancerId = null;
    ensureMarkers();
    updatePairRotateUI();
  }
  pairRotateClearBtn.addEventListener('click', clearSelection);
  // Ein Klick auf leere Bühne (oder ihren Rand) hebt die Auswahl auf; Tänzer & Co. liegen darüber (#2046).
  stageEl.parentNode.addEventListener('pointerdown', function(e){
    if(e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if(e.target !== stageEl && e.target !== stageEl.parentNode) return;
    if(pairSelection.length || selectedDancerId != null) clearSelection();
  });
  // Esc hebt die Auswahl auf – aber nur, wenn kein Dialog/Menü/Popover offen ist (die schließen dann
  // zuerst) und nicht gerade in ein Feld getippt wird. Capture-Phase, damit der Zustand vor den
  // Schließen-Handlern geprüft wird, sonst würde ein Esc Dialog und Auswahl zugleich wegnehmen.
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    // An open right-click menu closes first, the selection stays — also while typing in it.
    if(selectionMenuAt){
      if(pairRotateEl.contains(document.activeElement)) document.activeElement.blur();
      closeSelectionMenu();
      return;
    }
    if(!pairSelection.length && selectedDancerId == null) return;
    if(!selectionKeysFree()) return;
    var ae = document.activeElement;
    if(ae && ae.classList && ae.classList.contains('dancer')) ae.blur();
    clearSelection();
  }, true);
  function selectionKeysFree(){
    if(document.querySelector('.modal-backdrop:not([hidden])')) return false;
    if(document.body.classList.contains('menu-open')) return false;
    if(document.querySelector('.speed-curve-popover')) return false;
    var ae = document.activeElement;
    return !(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable));
  }

  // Pfeiltasten schieben die Auswahl, auch wenn kein Punkt den Fokus hat – nach Strg-Klick (der
  // den Fokus nicht setzt), Rollen- oder Leisten-Auswahl (#2064); ohne Auswahl den fokussierten
  // Punkt. Strg/Cmd+A wählt alle Punkte dieses Bilds (#2063), Strg/Cmd+C/V kopiert die Plätze der
  // Auswahl in ein anderes Bild (#2069).
  var posClipboard = null;
  document.addEventListener('keydown', function(e){
    if(e.defaultPrevented || e.altKey || !selectionKeysFree()) return;
    if(typeof isBildLocked === 'function' && isBildLocked() && !((e.ctrlKey || e.metaKey) && /^[ac]$/i.test(e.key))) return; // someone else edits this Bild (#2076)
    var pos = currentFormation().pos;
    if((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')){
      e.preventDefault();
      pairSelection = Object.keys(pos).filter(function(id){ return stageMarkers[id]; });
      if(pairSelection.indexOf(selectedDancerId) === -1) selectedDancerId = pairSelection[0] || null;
      ensureMarkers();
      updatePairRotateUI();
      return;
    }
    if((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')){
      var sel = pairSelection.length > 1 ? pairSelection : [selectedDancerId];
      var copied = {};
      sel.forEach(function(id){ if(pos[id]) copied[id] = {x: pos[id].x, y: pos[id].y, rot: pos[id].rot || 0}; });
      if(!Object.keys(copied).length) return;
      e.preventDefault();
      posClipboard = copied;
      return;
    }
    if((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')){
      // Only dancers this Bild has (anyone deleted since the copy is skipped).
      var ids2 = posClipboard ? Object.keys(posClipboard).filter(function(id){ return pos[id]; }) : [];
      if(!ids2.length) return;
      e.preventDefault();
      if(playing) pausePlayback();
      ids2.forEach(function(id){ var c = posClipboard[id]; pos[id] = {x: c.x, y: c.y, rot: c.rot}; });
      pairSelection = ids2.length > 1 ? ids2 : [];
      selectedDancerId = ids2[0];
      positionMarkers(pos);
      updateMiniDots(state.activeIndex);
      refreshRosterCoords();
      ensureMarkers();
      updatePairRotateUI();
      saveState();
      return;
    }
    if(e.ctrlKey || e.metaKey) return;
    var step = e.shiftKey ? 0.5 : 1;
    var dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    var dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if(!dx && !dy) return;
    var ids = pairSelection.filter(function(id){ return pos[id]; });
    if(ids.length < 2) ids = pos[selectedDancerId] ? [selectedDancerId] : ids;
    var ae = document.activeElement;
    if(!ids.length && ae && ae.classList && ae.classList.contains('dancer')){
      for(var k in stageMarkers) if(stageMarkers[k] === ae && pos[k]) ids = [k];
    }
    if(!ids.length) return;
    e.preventDefault();
    if(playing) pausePlayback();
    ids.forEach(function(id){
      var p = currentFormation().pos[id];
      setDancerPos(id, p.x+dx, p.y+dy);
    });
    ensureMarkers();
    saveState();
  });

  /* ---------- Rechtsklick-Menü ----------
     A right-click (or long press) on a dancer, a pair or the selection's cross selects like a plain
     click and then floats the selection bar right there as a menu — the same controls, so it always
     offers exactly what the bar does (Drehen, Drehung bis …, Eigendrehung, Paar lösen …). */

  var LONG_PRESS_MS = 500;
  var selectionMenuAt = null;

  function openSelectionMenu(x, y){
    if(pairRotateEl.hidden) return false;
    selectionMenuAt = {x: x, y: y};
    pairRotateEl.classList.add('floating');
    placeSelectionMenu();
    return true;
  }

  function closeSelectionMenu(){
    if(!selectionMenuAt) return;
    selectionMenuAt = null;
    pairRotateEl.classList.remove('floating');
    pairRotateEl.style.left = pairRotateEl.style.top = '';
    fitPairBar();
  }

  // Below/right of the pointer; flipped to the other side where that would run off screen.
  function placeSelectionMenu(){
    if(!selectionMenuAt) return;
    var m = 8, w = pairRotateEl.offsetWidth, h = pairRotateEl.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    var x = selectionMenuAt.x, y = selectionMenuAt.y;
    if(x + w > vw - m) x -= w;
    if(y + h > vh - m) y -= h;
    pairRotateEl.style.left = Math.max(m, Math.min(x, vw - m - w)) + 'px';
    pairRotateEl.style.top = Math.max(m, Math.min(y, vh - m - h)) + 'px';
  }

  // `select` is what a plain click on the thing would select; a 2+ selection that already holds
  // `keepIfIn` stays, so the menu is for the whole group. With Strg/Cmd held (on a Mac, Ctrl-click
  // is the right-click) the selection isn't touched — the pointerdown already toggled it.
  function openSelectionMenuFromEvent(e, el, select, keepIfIn, primaryId){
    if(playing) pausePlayback();
    if(!(e.ctrlKey || e.metaKey)){
      var keep = pairSelection.length >= 2 && keepIfIn.every(function(id){ return pairSelection.indexOf(id) !== -1; });
      if(!keep) pairSelection = select.slice();
      selectedDancerId = primaryId;
      ensureMarkers();
      updatePairRotateUI();
    }
    // Menu key / Shift+F10 come without a pointer position — open it at the element instead.
    var x = e.clientX, y = e.clientY;
    if(!x && !y){
      var r = el.getBoundingClientRect();
      x = r.left + r.width/2; y = r.bottom;
    }
    if(openSelectionMenu(x, y)) e.preventDefault();
  }

  // Anything pressed outside the menu closes it (and then does what it does anyway).
  document.addEventListener('pointerdown', function(e){
    if(selectionMenuAt && !pairRotateEl.contains(e.target)) closeSelectionMenu();
  }, true);
  // A different set of controls (e.g. after „Paar lösen“) changes its size — keep it on screen.
  if(window.ResizeObserver) new ResizeObserver(placeSelectionMenu).observe(pairRotateEl);
  window.addEventListener('resize', placeSelectionMenu);
  if(window.ResizeObserver) new ResizeObserver(fitPairBar).observe(pairRotateEl.parentNode);

  function setDancerPos(dancerId, x, y, skipRosterUpdate){
    x = clampX(x); y = clampY(y);
    var existing = currentFormation().pos[dancerId];
    var rot = existing ? existing.rot||0 : 0;
    currentFormation().pos[dancerId] = {x:x, y:y, rot:rot};
    positionMarkers(currentFormation().pos);
    updateMiniDots(state.activeIndex);
    if(!skipRosterUpdate) updateRosterCoords(dancerId, x, y, rot);
  }

  function setDancerRot(dancerId, rot){
    rot = normAngle(rot);
    var entry = currentFormation().pos[dancerId];
    if(!entry) return;
    entry.rot = rot;
    var el = stageMarkers[dancerId];
    if(el){
      var ind = el.querySelector('.rot-indicator');
      if(ind) ind.style.transform = 'rotate(' + rot + 'deg)';
    }
    saveState();
  }

  function updateRosterCoords(dancerId, x, y, rot){
    var refs = rosterCoordInputs[dancerId];
    if(refs){
      if(document.activeElement !== refs.x) refs.x.value = roundNum(x);
      if(document.activeElement !== refs.y) refs.y.value = roundNum(y);
      if(refs.rot && document.activeElement !== refs.rot) refs.rot.value = roundNum(rot||0);
    }
    // A collapsed pair shows its midpoint instead of per-dancer rows — keep that live too (e.g.
    // while dragging either partner on the stage).
    var pair = findPairForDancer(dancerId);
    if(pair && pair.collapsed){
      var midRefs = rosterPairMidpointInputs[pair.id];
      if(midRefs){
        var mid = pairMidpoint(pair);
        if(document.activeElement !== midRefs.x) midRefs.x.value = roundNum(mid.x);
        if(document.activeElement !== midRefs.y) midRefs.y.value = roundNum(mid.y);
      }
    }
  }

  // Toggles "Paar lösen" for the current Bild only (see isPairSplitHere in state.js). Re-coupling
  // keeps the partners wherever they were moved to — it only links their dragging again.
  function togglePairSplit(pairId){
    var host = splitHostFormation();
    if(!host) return;
    if(!Array.isArray(host.splitPairs)) host.splitPairs = [];
    var i = host.splitPairs.indexOf(pairId);
    if(i === -1) host.splitPairs.push(pairId); else host.splitPairs.splice(i, 1);
    var pair = state.pairs.find(function(p){ return p.id === pairId; });
    if(i !== -1 && pair && pairSelection.length === 1 && pair.memberIds.indexOf(pairSelection[0]) !== -1){
      pairSelection = pair.memberIds.slice(); // re-coupled: select the whole pair again
    }
    saveState();
    renderRoster();
    ensureMarkers();
    updatePairRotateUI();
  }

  // A couple dot (no saved pair) can be split into Lead & Follow — in a Bild or in the
  // Zwischenposition being edited, each on its own.
  function canCoupleSplit(id){
    var base = baseDancerId(id);
    if(state.shareReadOnly) return false;
    if(!state.dancers.some(function(d){ return d.id === base; })) return false;
    return !findPairForDancer(base);
  }

  function toggleCoupleSplit(id){
    if(!canCoupleSplit(id)) return;
    var did = baseDancerId(id);
    var f = currentFormation();
    if(!f || !f.pos[did]) return;
    var fk = followKey(did);
    if(f.pos[fk]){
      delete f.pos[fk];
      pairSelection = [did];
      selectedDancerId = did;
    }else{
      var p = f.pos[did];
      var r = (p.rot||0) * Math.PI/180;
      var ox = Math.round(Math.cos(r)), oy = Math.round(Math.sin(r));
      if(!ox && !oy) ox = 1;
      var nx = p.x + ox, ny = p.y + oy;
      if(clampX(nx) !== nx || clampY(ny) !== ny){ nx = p.x - ox; ny = p.y - oy; }
      f.pos[fk] = {x: clampX(nx), y: clampY(ny), rot: p.rot||0};
      pairSelection = [did, fk]; // both stay selected: move or turn them as one right away
      selectedDancerId = fk;
    }
    saveState();
    ensureMarkers();
    positionMarkers(f.pos);
    renderRoster();
    renderFilmstrip();
    updatePairRotateUI();
  }

  function refreshRosterCoords(){
    updatePairRotateUI(); // the selection bar also depends on the Bild (split here? a next Bild?)
    // Switching Bilder can change which pairs are split — the roster layout depends on that.
    if(splitSignature() !== rosterSplitSignature){ renderRoster(); return; }
    var pos = currentFormation().pos;
    state.dancers.forEach(function(d){
      [d.id, followKey(d.id)].forEach(function(k){
        var p = pos[k];
        if(p) updateRosterCoords(k, p.x, p.y, p.rot);
      });
    });
  }
