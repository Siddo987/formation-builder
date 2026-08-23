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

  function renderAxes(){
    var svg = document.getElementById('axesOverlay');
    var labelLayer = document.getElementById('axesLabelLayer');
    var toggleWrap = document.getElementById('axesBildToggleWrap');
    var toggle = document.getElementById('axesBildToggle');
    var formationShowsAxes = currentFormation().showAxes !== false;
    if(toggleWrap && toggle){
      toggleWrap.hidden = state.axes.length === 0;
      toggle.checked = formationShowsAxes;
    }
    if(!svg || !labelLayer) return;
    svg.innerHTML = '';
    labelLayer.innerHTML = '';
    var show = formationShowsAxes && state.axes.length;
    svg.style.display = show ? '' : 'none';
    labelLayer.style.display = show ? '' : 'none';
    if(!show) return;
    state.axes.forEach(function(ax){
      var x1 = gridToPercent(clampGrid(ax.x1)), y1 = gridToPercent(clampGrid(ax.y1));
      var x2 = gridToPercent(clampGrid(ax.x2)), y2 = gridToPercent(clampGrid(ax.y2));
      var line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('class', 'axis-line');
      svg.appendChild(line);
      if(ax.label){
        var lbl = document.createElement('span');
        lbl.className = 'axis-label';
        lbl.style.left = ((x1+x2)/2) + '%';
        lbl.style.top = ((y1+y2)/2) + '%';
        lbl.textContent = ax.label;
        labelLayer.appendChild(lbl);
      }
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

  function attachDancerEvents(el, dancerId){
    el.tabIndex = 0;
    el.addEventListener('pointerdown', function(e){
      if(playing) pausePlayback();
      if(e.ctrlKey || e.metaKey){
        e.preventDefault();
        togglePairSelection(dancerId);
        return;
      }
      if(pairSelection.length){ pairSelection = []; updatePairRotateUI(); }
      try{ el.setPointerCapture(e.pointerId); }catch(err){}
      selectedDancerId = dancerId;
      ensureMarkers();
      function onMove(ev){
        var rect = stageEl.getBoundingClientRect();
        var px = ((ev.clientX-rect.left)/rect.width)*100;
        var py = ((ev.clientY-rect.top)/rect.height)*100;
        var gx = percentToGrid(px);
        var gy = percentToGrid(py);
        if(!ev.shiftKey){ gx = Math.round(gx); gy = Math.round(gy); }
        setDancerPos(dancerId, gx, gy);
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
      var handled = true;
      if(e.key === 'ArrowLeft') setDancerPos(dancerId, pos.x-step, pos.y);
      else if(e.key === 'ArrowRight') setDancerPos(dancerId, pos.x+step, pos.y);
      else if(e.key === 'ArrowUp') setDancerPos(dancerId, pos.x, pos.y-step);
      else if(e.key === 'ArrowDown') setDancerPos(dancerId, pos.x, pos.y+step);
      else handled = false;
      if(handled){ e.preventDefault(); selectedDancerId = dancerId; ensureMarkers(); saveState(); }
    });
  }

  /* ---------- pair rotation ---------- */

  function togglePairSelection(dancerId){
    var idx = pairSelection.indexOf(dancerId);
    if(idx !== -1){
      pairSelection.splice(idx, 1);
    }else{
      pairSelection.push(dancerId);
      if(pairSelection.length > 2) pairSelection.shift();
    }
    ensureMarkers();
    updatePairRotateUI();
  }

  function updatePairRotateUI(){
    if(pairSelection.length === 2){
      var a = state.dancers.find(function(d){ return d.id === pairSelection[0]; });
      var b = state.dancers.find(function(d){ return d.id === pairSelection[1]; });
      if(!a || !b){ pairSelection = []; pairRotateEl.hidden = true; return; }
      var alreadySaved = !!findPairByMembers(pairSelection);
      pairRotateLabelEl.textContent = 'Paar: ' + a.name + ' & ' + b.name + (alreadySaved ? ' (gespeichert)' : '');
      pairRotateEl.hidden = false;
    }else{
      pairRotateEl.hidden = true;
    }
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

  function rotatePairSelection(deg){
    if(pairSelection.length !== 2 || !deg) return;
    var pos = currentFormation().pos;
    var idA = pairSelection[0], idB = pairSelection[1];
    var posA = pos[idA], posB = pos[idB];
    if(!posA || !posB) return;
    var mx = (posA.x + posB.x) / 2;
    var my = (posA.y + posB.y) / 2;
    var rad = deg * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    [idA, idB].forEach(function(id){
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
