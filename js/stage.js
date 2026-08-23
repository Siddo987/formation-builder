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
      el.classList.toggle('pair-selected', pairSelection.indexOf(d.id) !== -1);
    });
    Object.keys(stageMarkers).forEach(function(id){
      if(!seen[id]){ stageMarkers[id].remove(); delete stageMarkers[id]; }
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
  }

  function buildStageLayers(){
    buildStageLogo();
    buildGridOverlay();
    buildAxesOverlay();
    buildLayoutGhostLayer();
  }

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
     changes (a fresh reference point for whichever Bild you're now positioning). ---------- */

  var layoutsCatalog = null; // null until first fetch resolves
  var layoutsFetchPromise = null;
  var activeLayoutId = null;
  var activeLayoutOffset = {x:0, y:0}; // where the shape's own local origin currently sits on stage
  var activeLayoutRotateDeg = 0; // rotation around that same local origin, applied before the offset

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

  // Rotates a relative point around the shape's own local origin (0,0), then places it at
  // activeLayoutOffset — i.e. rotation always happens "in place" around wherever the shape has
  // been dragged to, not around the stage's own center.
  function layoutPointToStage(p){
    var rad = activeLayoutRotateDeg * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var x = (p.x||0)*cos - (p.y||0)*sin + activeLayoutOffset.x;
    var y = (p.x||0)*sin + (p.y||0)*cos + activeLayoutOffset.y;
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
  }

  // Dragging any ghost dot moves the whole shape together (updates the shared offset, not just
  // that one point) — same pointer-capture pattern as attachDancerEvents' drag handling.
  function attachLayoutGhostDragEvents(dot){
    dot.addEventListener('pointerdown', function(e){
      e.preventDefault();
      e.stopPropagation();
      try{ dot.setPointerCapture(e.pointerId); }catch(err){}
      var startX = e.clientX, startY = e.clientY;
      var startOffset = {x: activeLayoutOffset.x, y: activeLayoutOffset.y};
      function onMove(ev){
        var rect = stageEl.getBoundingClientRect();
        var dxPct = ((ev.clientX-startX)/rect.width)*100;
        var dyPct = ((ev.clientY-startY)/rect.height)*100;
        var scale = 100 - 2*GRID_INSET;
        var dx = (dxPct/scale)*GRID_SPAN;
        var dy = (dyPct/scale)*GRID_SPAN;
        // Same snap-to-grid-unless-Shift behavior as dragging a dancer, applied to the whole
        // shape's movement rather than to one point.
        if(!ev.shiftKey){ dx = Math.round(dx); dy = Math.round(dy); }
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
  // should silently carry over.
  function resetLayoutGhost(){
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
      if(e.ctrlKey || e.metaKey){
        e.preventDefault();
        togglePairSelection(dancerId);
        return;
      }
      // Plain click on a dancer with a saved partner selects — and now drags — both together;
      // an unpaired dancer (or clicking to start a fresh drag elsewhere) behaves as before.
      var pair = findPairForDancer(dancerId);
      pairSelection = pair ? pair.memberIds.slice() : [];
      updatePairRotateUI();
      try{ el.setPointerCapture(e.pointerId); }catch(err){}
      selectedDancerId = dancerId;
      ensureMarkers();
      var groupIds = dragGroupFor(dancerId);
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
    state.pairs.push({ id: uid('pr'), memberIds: memberIds.slice() });
    saveState();
    renderRoster();
    updatePairRotateUI();
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
    if(!refs) return;
    if(document.activeElement !== refs.x) refs.x.value = roundNum(x);
    if(document.activeElement !== refs.y) refs.y.value = roundNum(y);
    if(refs.rot && document.activeElement !== refs.rot) refs.rot.value = roundNum(rot||0);
  }

  function refreshRosterCoords(){
    var pos = currentFormation().pos;
    state.dancers.forEach(function(d){
      var p = pos[d.id];
      if(p) updateRosterCoords(d.id, p.x, p.y, p.rot);
    });
  }
