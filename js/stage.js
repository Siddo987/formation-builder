"use strict";

/* ---------- markers: formation timestamps in the song ---------- */

  function formationTime(f){
    return (typeof f.time === 'number' && isFinite(f.time) && f.time >= 0) ? f.time : null;
  }

  function syncWaypoints(){
    var pts = [];
    state.formations.forEach(function(f, idx){
      var t = formationTime(f);
      if(t !== null) pts.push({ idx: idx, time: t });
    });
    pts.sort(function(a, b){ return a.time - b.time; });
    return pts;
  }

  function isSyncActive(){
    return !!(state.song && state.song.url) && syncWaypoints().length >= 2;
  }

  /* ---------- stage markers ---------- */

  function ensureMarkers(){
    var seen = {};
    state.dancers.forEach(function(d){
      seen[d.id] = true;
      var el = stageMarkers[d.id];
      if(!el){
        el = document.createElement('div');
        el.className = 'dancer';
        el.style.background = d.color;
        var label = document.createElement('span');
        label.className = 'label';
        el.appendChild(label);
        var textNode = document.createElement('span');
        textNode.className = 'initials';
        el.appendChild(textNode);
        var rotInd = document.createElement('span');
        rotInd.className = 'rot-indicator';
        el.appendChild(rotInd);
        stageEl.appendChild(el);
        attachDancerEvents(el, d.id);
        stageMarkers[d.id] = el;
      }
      el.querySelector('.initials').textContent = initials(d.name);
      el.querySelector('.label').textContent = d.name;
      el.style.background = d.color;
      el.classList.toggle('selected', selectedDancerId === d.id);
      // The teal "grouped" ring only kicks in once there are 2+ (matching dragGroupFor's own
      // threshold) — a lone dancer sitting in pairSelection (e.g. right after a plain click, which
      // now seeds it with just that dancer so a follow-up Ctrl-click has something to add to)
      // still shows as a normal single selection instead of looking like an already-formed pair.
      el.classList.toggle('pair-selected', pairSelection.length >= 2 && pairSelection.indexOf(d.id) !== -1);
    });
    Object.keys(stageMarkers).forEach(function(id){
      if(!seen[id]){ stageMarkers[id].remove(); delete stageMarkers[id]; }
    });
    updateRosterSelectionHighlight();
  }

  // Mirrors the stage's current single selection (selectedDancerId) into the roster: an edge
  // highlight on that dancer's own row, and — separately — on their saved pair's whole group
  // container too, so "wenn ich einen Tänzer auswähle, wird sowohl sein Paar als auch er selber
  // am Rand in der Leiste gehighlighted" holds even while the pair is collapsed (no per-dancer
  // row to highlight in that case — the group container carries it instead).
  function updateRosterSelectionHighlight(){
    Object.keys(rosterRowEls).forEach(function(id){
      rosterRowEls[id].classList.toggle('roster-row-selected', selectedDancerId === id);
    });
    Object.keys(rosterPairGroupEls).forEach(function(pairId){
      var pair = state.pairs.find(function(p){ return p.id === pairId; });
      var hi = !!pair && pair.memberIds.indexOf(selectedDancerId) !== -1;
      rosterPairGroupEls[pairId].classList.toggle('roster-pairgroup-selected', hi);
    });
  }

  function positionMarkers(posMap){
    state.dancers.forEach(function(d){
      var el = stageMarkers[d.id];
      var pos = posMap[d.id];
      if(!el || !pos) return;
      el.style.left = gridToPercent(pos.x) + '%';
      el.style.top = gridToPercent(pos.y) + '%';
      var ind = el.querySelector('.rot-indicator');
      if(ind) ind.style.transform = 'rotate(' + (pos.rot||0) + 'deg)';
    });
    updatePairMidpointMarker(posMap);
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
    if(!n){ marker.hidden = true; return; }
    marker.style.left = gridToPercent(sx/n) + '%';
    marker.style.top = gridToPercent(sy/n) + '%';
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
    marker.addEventListener('pointerdown', function(e){
      if(pairSelection.length < 2) return;
      if(playing) pausePlayback();
      e.preventDefault();
      e.stopPropagation();
      try{ marker.setPointerCapture(e.pointerId); }catch(err){}
      var groupIds = pairSelection.slice();
      var startPositions = {};
      groupIds.forEach(function(id){
        var p = currentFormation().pos[id];
        startPositions[id] = {x: p ? p.x : 0, y: p ? p.y : 0};
      });
      var grabStart = {
        x: percentToGrid(parseFloat(marker.style.left)),
        y: percentToGrid(parseFloat(marker.style.top))
      };
      function onMove(ev){
        var rect = stageEl.getBoundingClientRect();
        var px = ((ev.clientX-rect.left)/rect.width)*100;
        var py = ((ev.clientY-rect.top)/rect.height)*100;
        var gx = percentToGrid(px);
        var gy = percentToGrid(py);
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
    buildStageLogo();
    buildOnionSkinLayer();
    buildPairMidpointMarker();
    buildGridOverlay();
    buildAxesOverlay();
    buildLayoutGhostLayer();
  }

  // Faint preview of the adjacent Bilder while positioning the current one: the next Bild's
  // dancers in their own colors (barely visible), the previous Bild's in a uniform light gray —
  // purely visual, no pointer events. Refreshed whenever the active Bild changes (piggybacked on
  // resetLayoutGhost, see its comment for why).
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
    function addDots(formation, extraClass, useDancerColor){
      if(!formation) return;
      state.dancers.forEach(function(d){
        var p = formation.pos[d.id];
        if(!p) return;
        var dot = document.createElement('span');
        dot.className = 'onion-dot ' + extraClass;
        dot.style.left = gridToPercent(p.x) + '%';
        dot.style.top = gridToPercent(p.y) + '%';
        if(useDancerColor) dot.style.background = d.color;
        layer.appendChild(dot);
      });
    }
    addDots(state.formations[state.activeIndex-1], 'onion-dot-prev', false);
    addDots(state.formations[state.activeIndex+1], 'onion-dot-next', true);
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

  function buildAxesOverlay(){
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'axes-overlay');
    svg.setAttribute('id', 'axesOverlay');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    stageEl.appendChild(svg);
    var labelLayer = document.createElement('div');
    labelLayer.className = 'axes-label-layer';
    labelLayer.id = 'axesLabelLayer';
    stageEl.appendChild(labelLayer);
    renderAxes();
  }

  // Draws the global axes (state.axes — available on every Bild) plus this Bild's own local-only
  // axes (currentFormation().localAxes), sharing one visibility toggle: "Achsen für dieses Bild"
  // hides/shows both kinds together. Local axes get a distinct dash pattern (see .axis-line-local)
  // so the two are visually distinguishable on the stage.
  function renderAxes(){
    var svg = document.getElementById('axesOverlay');
    var labelLayer = document.getElementById('axesLabelLayer');
    var toggleWrap = document.getElementById('axesBildToggleWrap');
    var toggle = document.getElementById('axesBildToggle');
    var localAxes = currentFormation().localAxes || [];
    var formationShowsAxes = currentFormation().showAxes !== false;
    if(toggleWrap && toggle){
      toggleWrap.hidden = state.axes.length === 0 && localAxes.length === 0;
      toggle.checked = formationShowsAxes;
    }
    if(!svg || !labelLayer) return;
    svg.innerHTML = '';
    labelLayer.innerHTML = '';
    var show = formationShowsAxes && (state.axes.length || localAxes.length);
    svg.style.display = show ? '' : 'none';
    labelLayer.style.display = show ? '' : 'none';
    if(!show) return;
    function drawAxis(ax, extraClass){
      var x1 = gridToPercent(clampGrid(ax.x1)), y1 = gridToPercent(clampGrid(ax.y1));
      var x2 = gridToPercent(clampGrid(ax.x2)), y2 = gridToPercent(clampGrid(ax.y2));
      var line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('class', 'axis-line' + (extraClass ? ' ' + extraClass : ''));
      svg.appendChild(line);
      if(ax.label){
        var lbl = document.createElement('span');
        lbl.className = 'axis-label';
        lbl.style.left = ((x1+x2)/2) + '%';
        lbl.style.top = ((y1+y2)/2) + '%';
        lbl.textContent = ax.label;
        labelLayer.appendChild(lbl);
      }
    }
    state.axes.forEach(function(ax){ drawAxis(ax); });
    localAxes.forEach(function(ax){ drawAxis(ax, 'axis-line-local'); });
  }

  /* ---------- layout templates ("Vorlagen"): admin-presettable target *shapes* — a Vorlage's
     positions are relative to each other only (no fixed spot on the stage baked in). Shown as a
     transparent, non-interactive-underneath ghost overlay that the user drags into place and
     rotates to taste; dancers then get manually dragged onto the ghost by hand — a positioning
     aid, not an auto-transform like Figuren. Picking one (and any placement/rotation applied to
     it) is per-session/transient, never saved in state, and resets whenever the active Bild
     changes (a fresh reference point for whichever Bild you're now positioning). Each layout also
     carries an admin-settable "Orientierungspunkt" (origin) — the rotation pivot, rendered as its
     own distinct, grabbable ghost point (see activeLayoutOrigin/layoutPointToStage). ---------- */

  var layoutsCatalog = null; // null until first fetch resolves
  var layoutsFetchPromise = null;
  var activeLayoutId = null;
  var activeLayoutOffset = {x:0, y:0}; // where the shape's own Orientierungspunkt currently sits on stage
  var activeLayoutRotateDeg = 0; // rotation around that same Orientierungspunkt, applied before the offset

  function ensureLayoutsLoaded(){
    if(!layoutsFetchPromise){
      layoutsFetchPromise = fetch('api/layouts.php')
        .then(function(res){ return res.ok ? res.json() : {layouts:[]}; })
        .then(function(data){ layoutsCatalog = Array.isArray(data.layouts) ? data.layouts : []; })
        .catch(function(){ layoutsCatalog = []; })
        .then(function(){ renderLayoutSelectOptions(); });
    }
    return layoutsFetchPromise;
  }

  function renderLayoutSelectOptions(){
    var wrap = document.getElementById('layoutSelectWrap');
    var select = document.getElementById('layoutSelect');
    if(!wrap || !select) return;
    wrap.hidden = !(layoutsCatalog && layoutsCatalog.length);
    select.innerHTML = '';
    var noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— Keine Vorlage —';
    select.appendChild(noneOpt);
    (layoutsCatalog || []).forEach(function(layout){
      var opt = document.createElement('option');
      opt.value = layout.id;
      opt.textContent = layout.name;
      select.appendChild(opt);
    });
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

  // The admin-settable "Orientierungspunkt" — the rotation pivot for the active layout, defaults
  // to (0,0) for layouts saved before this field existed (see api/layouts.php).
  function activeLayoutOrigin(){
    if(!activeLayoutId || !layoutsCatalog) return {x:0, y:0};
    var layout = layoutsCatalog.find(function(l){ return l.id === activeLayoutId; });
    if(!layout || !layout.origin) return {x:0, y:0};
    return {x: layout.origin.x||0, y: layout.origin.y||0};
  }

  // Rotates a relative point around the shape's own Orientierungspunkt, then places it at
  // activeLayoutOffset — i.e. rotation always happens "in place" around wherever the shape has
  // been dragged to, not around the stage's own center. Passing the origin itself in as `p`
  // returns its own screen position (dx/dy both zero) — that's what renders/drags its ghost dot.
  function layoutPointToStage(p){
    var rad = activeLayoutRotateDeg * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var origin = activeLayoutOrigin();
    var dx = (p.x||0) - origin.x, dy = (p.y||0) - origin.y;
    var x = origin.x + dx*cos - dy*sin + activeLayoutOffset.x;
    var y = origin.y + dx*sin + dy*cos + activeLayoutOffset.y;
    return {x: clampGrid(x), y: clampGrid(y)};
  }

  // How close (in grid units) a dancer/pair reference point must get to a Vorlage ghost point
  // before it snaps onto it. Used by attachDancerEvents' drag handler below.
  var LAYOUT_SNAP_RADIUS = 0.75;

  function activeLayoutGhostPoints(){
    if(!activeLayoutId || !layoutsCatalog) return [];
    var layout = layoutsCatalog.find(function(l){ return l.id === activeLayoutId; });
    if(!layout || !Array.isArray(layout.positions)) return [];
    var n = Math.min(layout.positions.length, state.dancers.length);
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
    if(!activeLayoutId || !layoutsCatalog) return;
    var layout = layoutsCatalog.find(function(l){ return l.id === activeLayoutId; });
    if(!layout || !Array.isArray(layout.positions)) return;
    var n = Math.min(layout.positions.length, state.dancers.length);
    for(var i=0; i<n; i++){
      var stagePos = layoutPointToStage(layout.positions[i]);
      var dot = document.createElement('span');
      dot.className = 'layout-ghost-dot';
      dot.style.left = gridToPercent(stagePos.x) + '%';
      dot.style.top = gridToPercent(stagePos.y) + '%';
      dot.style.borderColor = state.dancers[i].color;
      dot.title = 'Ziehen zum Verschieben der ganzen Vorlage';
      attachLayoutGhostDragEvents(dot);
      layer.appendChild(dot);
    }
    // Orientierungspunkt — the admin-set rotation pivot, its own distinct grabbable marker
    // alongside the per-dancer dots (dragging it moves the whole shape too, same as any other dot
    // — they all just update the shared activeLayoutOffset).
    var originPos = layoutPointToStage(activeLayoutOrigin());
    var originDot = document.createElement('span');
    originDot.className = 'layout-ghost-origin';
    originDot.style.left = gridToPercent(originPos.x) + '%';
    originDot.style.top = gridToPercent(originPos.y) + '%';
    originDot.title = 'Orientierungspunkt — auch greifbar, verschiebt die ganze Vorlage';
    attachLayoutGhostDragEvents(originDot);
    layer.appendChild(originDot);
  }

  // Cheap in-place reposition (no DOM node recreation) for use *during* a drag — this is what
  // fixes "can only ever move a minimal distance": the previous code called the full
  // renderLayoutGhost() on every pointermove, which wipes and recreates every dot, including the
  // one that currently holds pointer capture. The instant that node is detached, the browser
  // drops its capture, so only the very first tiny move before the first re-render ever registered.
  function repositionLayoutGhostDots(){
    var layer = document.getElementById('layoutGhostLayer');
    if(!layer || !activeLayoutId || !layoutsCatalog) return;
    var layout = layoutsCatalog.find(function(l){ return l.id === activeLayoutId; });
    if(!layout || !Array.isArray(layout.positions)) return;
    var dots = layer.querySelectorAll('.layout-ghost-dot');
    for(var i=0; i<dots.length; i++){
      var stagePos = layoutPointToStage(layout.positions[i]);
      dots[i].style.left = gridToPercent(stagePos.x) + '%';
      dots[i].style.top = gridToPercent(stagePos.y) + '%';
    }
    var originDot = layer.querySelector('.layout-ghost-origin');
    if(originDot){
      var originPos = layoutPointToStage(activeLayoutOrigin());
      originDot.style.left = gridToPercent(originPos.x) + '%';
      originDot.style.top = gridToPercent(originPos.y) + '%';
    }
  }

  // Dragging any ghost dot moves the whole shape together (updates the shared offset, not just
  // that one point) — same pointer-capture pattern as attachDancerEvents' drag handling.
  function attachLayoutGhostDragEvents(dot){
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
        x: percentToGrid(parseFloat(dot.style.left)),
        y: percentToGrid(parseFloat(dot.style.top))
      };
      function onMove(ev){
        var rect = stageEl.getBoundingClientRect();
        var px = ((ev.clientX-rect.left)/rect.width)*100;
        var py = ((ev.clientY-rect.top)/rect.height)*100;
        var gx = percentToGrid(px);
        var gy = percentToGrid(py);
        if(!ev.shiftKey){ gx = Math.round(gx); gy = Math.round(gy); }
        var dx = gx - grabStart.x, dy = gy - grabStart.y;
        activeLayoutOffset = {
          x: clampGrid(startOffset.x + dx),
          y: clampGrid(startOffset.y + dy)
        };
        repositionLayoutGhostDots();
      }
      function onUp(){
        try{ dot.releasePointerCapture(e.pointerId); }catch(err){}
        dot.removeEventListener('pointermove', onMove);
        dot.removeEventListener('pointerup', onUp);
      }
      dot.addEventListener('pointermove', onMove);
      dot.addEventListener('pointerup', onUp);
    });
  }

  // Called wherever the active Bild actually changes (never from e.g. the axes-visibility toggle,
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
    var rotateInput = document.getElementById('layoutRotateInput');
    if(rotateInput) rotateInput.value = 0;
    renderLayoutSelectOptions();
    renderLayoutGhost();
  }

  var layoutSelectEl = document.getElementById('layoutSelect');
  var layoutRotateInputEl = document.getElementById('layoutRotateInput');
  if(layoutSelectEl){
    layoutSelectEl.addEventListener('change', function(){
      activeLayoutId = layoutSelectEl.value || null;
      activeLayoutOffset = {x:0, y:0};
      activeLayoutRotateDeg = 0;
      if(layoutRotateInputEl) layoutRotateInputEl.value = 0;
      updateLayoutRotateFieldVisibility();
      renderLayoutGhost();
    });
  }
  if(layoutRotateInputEl){
    layoutRotateInputEl.addEventListener('input', function(){
      var deg = parseFloat(layoutRotateInputEl.value);
      activeLayoutRotateDeg = isFinite(deg) ? deg : 0;
      renderLayoutGhost();
    });
  }

  function buildGridOverlay(){
    var overlay = document.createElement('div');
    overlay.className = 'stage-grid';
    for(var v = GRID_MIN; v <= GRID_MAX; v++){
      var pct = gridToPercent(v);
      var isZero = v === 0;

      var vline = document.createElement('div');
      vline.className = 'grid-line vertical' + (isZero ? ' zero' : '');
      vline.style.left = pct + '%';
      overlay.appendChild(vline);

      var hline = document.createElement('div');
      hline.className = 'grid-line horizontal' + (isZero ? ' zero' : '');
      hline.style.top = pct + '%';
      overlay.appendChild(hline);

      var xlabel = document.createElement('span');
      xlabel.className = 'grid-label x-label' + (isZero ? ' zero' : '');
      xlabel.style.left = pct + '%';
      xlabel.textContent = v;
      overlay.appendChild(xlabel);

      var ylabel = document.createElement('span');
      ylabel.className = 'grid-label y-label' + (isZero ? ' zero' : '');
      ylabel.style.top = pct + '%';
      ylabel.textContent = v;
      overlay.appendChild(ylabel);
    }
    stageEl.appendChild(overlay);
  }

  // The group a plain drag/nudge on `dancerId` should move together — the whole current
  // pairSelection if that dancer is part of one with 2+ members, otherwise just itself. Ctrl/Cmd-
  // click (see pointerdown below) is how you pare a saved pair's auto-selection down to just one.
  function dragGroupFor(dancerId){
    return (pairSelection.length >= 2 && pairSelection.indexOf(dancerId) !== -1) ? pairSelection.slice() : [dancerId];
  }

  function attachDancerEvents(el, dancerId){
    el.tabIndex = 0;
    el.addEventListener('pointerdown', function(e){
      if(playing) pausePlayback();
      // Ctrl/Cmd-held is "isolate": toggles this one dancer in/out of the ad hoc selection like
      // before, but — unlike before — the drag that follows still moves just this one dancer,
      // even if they're part of a pair or a larger selection. That's the way to pull one dancer
      // out of formation for a moment without disturbing the group's auto-follow.
      var isolate = e.ctrlKey || e.metaKey;
      if(isolate){
        e.preventDefault();
        var idx = pairSelection.indexOf(dancerId);
        if(idx !== -1) pairSelection.splice(idx, 1); else pairSelection.push(dancerId);
      }else{
        // Plain click on a dancer with a saved partner selects — and now drags — both together.
        // An unpaired dancer starts a fresh single-dancer selection (not an empty one — a plain
        // click used to clear pairSelection to [] entirely here, so it never actually registered
        // the clicked dancer; pairing two unpaired dancers then took an extra, confusing Ctrl-click
        // to even reach length 2, and could end up pairing the wrong two if a stray plain click
        // landed in between).
        var pair = findPairForDancer(dancerId);
        pairSelection = pair ? pair.memberIds.slice() : [dancerId];
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
      function onMove(ev){
        var rect = stageEl.getBoundingClientRect();
        var px = ((ev.clientX-rect.left)/rect.width)*100;
        var py = ((ev.clientY-rect.top)/rect.height)*100;
        var gx = percentToGrid(px);
        var gy = percentToGrid(py);
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
        try{ el.releasePointerCapture(e.pointerId); }catch(err){}
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        saveState();
      }
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    });
    el.addEventListener('keydown', function(e){
      var pos = currentFormation().pos[dancerId];
      if(!pos) return;
      var step = e.shiftKey ? 0.5 : 1;
      var dx = 0, dy = 0, handled = true;
      if(e.key === 'ArrowLeft') dx = -step;
      else if(e.key === 'ArrowRight') dx = step;
      else if(e.key === 'ArrowUp') dy = -step;
      else if(e.key === 'ArrowDown') dy = step;
      else handled = false;
      if(!handled) return;
      e.preventDefault();
      dragGroupFor(dancerId).forEach(function(id){
        var p = currentFormation().pos[id];
        if(p) setDancerPos(id, p.x+dx, p.y+dy);
      });
      selectedDancerId = dancerId;
      ensureMarkers();
      saveState();
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
    updatePairMidpointMarker(currentFormation().pos);
    if(pairSelection.length < 2){
      pairRotateEl.hidden = true;
      return;
    }
    var names = pairSelection.map(function(id){
      var d = state.dancers.find(function(dd){ return dd.id === id; });
      return d ? d.name : '?';
    });
    if(pairSelection.length === 2){
      var alreadySaved = !!findPairByMembers(pairSelection);
      pairRotateLabelEl.textContent = 'Paar: ' + names[0] + ' & ' + names[1] + (alreadySaved ? ' (gespeichert)' : '');
      pairSaveBtn.hidden = false;
    }else{
      pairRotateLabelEl.textContent = 'Auswahl: ' + names.join(', ');
      pairSaveBtn.hidden = true; // "als Paar speichern" only makes sense for exactly 2
    }
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

  /* ---------- permanent dancer pairs (Strg/Cmd-Klick-Auswahl dauerhaft merken, u. a. für Figuren) ---------- */

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

  // A dancer belongs to at most one saved pair — saving a new pair silently dissolves any
  // previous pairing either member had.
  function upsertPair(memberIds){
    state.pairs = state.pairs.filter(function(p){
      return p.memberIds.indexOf(memberIds[0]) === -1 && p.memberIds.indexOf(memberIds[1]) === -1;
    });
    state.pairs.push({ id: uid('pr'), memberIds: memberIds.slice(), name: '', collapsed: false });
    saveState();
    renderRoster();
    updatePairRotateUI();
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
  // points is their midpoint, so the original 2-person behavior is unchanged.
  function rotatePairSelection(deg){
    if(pairSelection.length < 2 || !deg) return;
    var pos = currentFormation().pos;
    var ids = pairSelection.filter(function(id){ return pos[id]; });
    if(ids.length < 2) return;
    var mx = 0, my = 0;
    ids.forEach(function(id){ mx += pos[id].x; my += pos[id].y; });
    mx /= ids.length; my /= ids.length;
    var rad = deg * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    ids.forEach(function(id){
      var p = pos[id];
      var dx = p.x - mx, dy = p.y - my;
      p.x = clampGrid(mx + dx*cos - dy*sin);
      p.y = clampGrid(my + dx*sin + dy*cos);
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
  pairSaveBtn.addEventListener('click', function(){
    if(pairSelection.length !== 2) return;
    upsertPair(pairSelection);
  });
  pairSameRoleBtn.addEventListener('click', function(){
    var role = pairSameRoleBtn.dataset.role;
    if(!role) return;
    pairSelection = allDancersWithRole(role);
    ensureMarkers();
    updatePairRotateUI();
  });
  pairRotateClearBtn.addEventListener('click', function(){
    pairSelection = [];
    ensureMarkers();
    updatePairRotateUI();
  });

  function setDancerPos(dancerId, x, y, skipRosterUpdate){
    x = clampGrid(x); y = clampGrid(y);
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

  function refreshRosterCoords(){
    var pos = currentFormation().pos;
    state.dancers.forEach(function(d){
      var p = pos[d.id];
      if(p) updateRosterCoords(d.id, p.x, p.y, p.rot);
    });
  }
