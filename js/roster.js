"use strict";

/* ---------- roster ---------- */

  // Clicking a roster row/pair selects it exactly like clicking its marker on the stage would
  // (attachDancerEvents in stage.js) — same plain-click-selects-the-saved-pair and Ctrl/Cmd-click-
  // toggles-into-the-multi-selection rules, just without the drag that follows a stage pointerdown.
  // Bails out of anything that started on an actual control (name/coord input, remove/collapse/
  // unpair button) so those keep working as plain form controls instead of also re-selecting.
  function handleRosterSelectClick(e, dancerId){
    if(e.target.closest('input, button, textarea, select')) return;
    if(playing) pausePlayback();
    var isolate = e.ctrlKey || e.metaKey || e.shiftKey; // Shift adds too (#2043)
    if(isolate){
      var idx = pairSelection.indexOf(dancerId);
      if(idx !== -1) pairSelection.splice(idx, 1); else pairSelection.push(dancerId);
    }else{
      var pair = findPairForDancer(dancerId);
      pairSelection = (pair && !isPairSplitHere(pair)) ? pair.memberIds.slice() : [dancerId];
    }
    selectedDancerId = dancerId;
    ensureMarkers();
    updatePairRotateUI();
  }

  // Same idea for clicking a pair as a whole (its header, or its collapsed midpoint row) — plain
  // click selects both members; Ctrl/Cmd-click toggles the whole pair in/out of the multi-selection
  // together rather than just one member of it.
  function handleRosterPairSelectClick(e, pair){
    if(e.target.closest('input, button, textarea, select')) return;
    if(playing) pausePlayback();
    var isolate = e.ctrlKey || e.metaKey || e.shiftKey; // Shift adds too (#2043)
    if(isolate){
      var allIn = pair.memberIds.every(function(id){ return pairSelection.indexOf(id) !== -1; });
      if(allIn){
        pairSelection = pairSelection.filter(function(id){ return pair.memberIds.indexOf(id) === -1; });
      }else{
        pair.memberIds.forEach(function(id){ if(pairSelection.indexOf(id) === -1) pairSelection.push(id); });
      }
    }else{
      pairSelection = pair.memberIds.slice();
    }
    selectedDancerId = pair.memberIds[0];
    ensureMarkers();
    updatePairRotateUI();
  }

  // Right-click on a row or pair header: select like a plain click (a 2+ selection already holding
  // it stays), then the selection bar floats right there as a menu — see openSelectionMenuFromEvent.
  // Fields keep the browser's own menu (copy/paste).
  function handleRosterContextMenu(e, select, primaryId){
    if(e.target.closest('input, button, textarea, select')) return;
    e.stopPropagation();
    openSelectionMenuFromEvent(e, e.currentTarget, select, select, primaryId);
  }

  var rosterSplitSignature = '';

  function renderRoster(){
    rosterSplitSignature = splitSignature();
    rosterListEl.innerHTML = '';
    rosterCoordInputs = {};
    rosterPairMidpointInputs = {};
    rosterRowEls = {};
    rosterPairGroupEls = {};
    var pos = currentFormation().pos;
    var rendered = {};
    state.dancers.forEach(function(d){
      if(rendered[d.id]) return;
      rendered[d.id] = true;
      var pair = findPairForDancer(d.id);
      if(pair){
        var partnerId = pair.memberIds[0] === d.id ? pair.memberIds[1] : pair.memberIds[0];
        var partner = state.dancers.find(function(pd){ return pd.id === partnerId; });
        if(partner){
          rendered[partnerId] = true;
          rosterListEl.appendChild(buildPairGroup(pair, d, partner, pos));
          return;
        }
      }
      rosterListEl.appendChild(buildDancerRow(d, pos, null));
    });
    dancerCountEl.textContent = state.dancers.length;
    updateRosterSelectionHighlight();
  }

  // Partners always render together, wherever the first-encountered member sits in
  // state.dancers — a single shared header ("Paar … trennen") replaces the old per-row badge
  // that used to repeat the same "trennen" action once on each partner's own row. The pair can be
  // given a name/number and collapsed down to just its midpoint coordinate (the point exactly
  // between the two partners) instead of showing both full dancer rows.
  function buildPairGroup(pair, a, b, pos){
    var group = document.createElement('div');
    var split = isPairSplitHere(pair);
    group.className = 'pair-group' + (split ? ' is-split' : '');

    var header = document.createElement('div');
    header.className = 'pair-group-header';

    var collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'pair-group-collapse';
    collapseBtn.appendChild(svgIcon(pair.collapsed ? 'chevron-right' : 'chevron-down', 14));
    collapseBtn.title = pair.collapsed ? 'Paar ausklappen' : 'Paar einklappen';
    collapseBtn.setAttribute('aria-label', (pair.collapsed ? 'Paar ausklappen: ' : 'Paar einklappen: ') + a.name + ' & ' + b.name);
    collapseBtn.addEventListener('click', function(){
      pair.collapsed = !pair.collapsed;
      saveState();
      renderRoster();
    });

    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'pair-group-name';
    nameInput.value = pair.name || '';
    nameInput.placeholder = '⚭ Paar';
    nameInput.maxLength = 40;
    nameInput.setAttribute('aria-label', 'Name/Nummer des Paares ' + a.name + ' & ' + b.name);
    nameInput.addEventListener('input', function(){ pair.name = nameInput.value; saveState(); });

    var unpairBtn = document.createElement('button');
    unpairBtn.type = 'button';
    unpairBtn.className = 'pair-group-unpair';
    unpairBtn.textContent = 'trennen';
    unpairBtn.setAttribute('aria-label', 'Paarung von ' + a.name + ' und ' + b.name + ' aufheben');
    unpairBtn.addEventListener('click', function(){ dissolvePair(pair.id); });

    var splitBtn = document.createElement('button');
    splitBtn.type = 'button';
    splitBtn.className = 'pair-group-split' + (split ? ' active' : '');
    splitBtn.textContent = split ? 'koppeln' : 'lösen';
    splitBtn.title = split
      ? 'Paar in diesem Bild wieder koppeln'
      : 'Lead und Follow nur in diesem Bild unabhängig bewegen';
    splitBtn.setAttribute('aria-pressed', split ? 'true' : 'false');
    splitBtn.addEventListener('click', function(){ togglePairSplit(pair.id); });

    header.appendChild(collapseBtn);
    header.appendChild(nameInput);
    header.appendChild(splitBtn);
    header.appendChild(unpairBtn);
    header.addEventListener('click', function(e){ handleRosterPairSelectClick(e, pair); });
    header.addEventListener('contextmenu', function(e){ handleRosterContextMenu(e, pair.memberIds, pair.memberIds[0]); });
    group.appendChild(header);

    if(pair.collapsed && !split){
      group.appendChild(buildPairMidpointRow(pair, a, b));
    }else{
      group.appendChild(buildDancerRow(a, pos, 'lead'));
      group.appendChild(buildDancerRow(b, pos, 'follow'));
    }
    rosterPairGroupEls[pair.id] = group;
    return group;
  }

  // Collapsed view: one row showing just the pair's midpoint (the point exactly between the two
  // partners), editable — dragging it moves both partners together by the same delta, preserving
  // whatever offset they already had from each other.
  function buildPairMidpointRow(pair, a, b){
    var row = document.createElement('div');
    row.className = 'pair-group-midpoint';
    row.addEventListener('click', function(e){ handleRosterPairSelectClick(e, pair); });
    row.addEventListener('contextmenu', function(e){ handleRosterContextMenu(e, pair.memberIds, pair.memberIds[0]); });
    var mid = pairMidpoint(pair);

    var xLabel = document.createElement('span');
    xLabel.className = 'coord-label';
    xLabel.textContent = 'X';
    var xInput = document.createElement('input');
    xInput.type = 'number';
    xInput.className = 'coord-input';
    xInput.min = GRID_MIN; xInput.max = GRID_MAX; xInput.step = '0.5';
    xInput.value = roundNum(mid.x);
    xInput.setAttribute('aria-label', 'X-Position des Mittelpunkts von ' + a.name + ' & ' + b.name);
    xInput.addEventListener('input', function(){
      var cur = pairMidpoint(pair);
      setPairMidpoint(pair, parseFloat(xInput.value)||0, cur.y);
    });

    var yLabel = document.createElement('span');
    yLabel.className = 'coord-label';
    yLabel.textContent = 'Y';
    var yInput = document.createElement('input');
    yInput.type = 'number';
    yInput.className = 'coord-input';
    yInput.min = GRID_MIN; yInput.max = GRID_MAX; yInput.step = '0.5';
    yInput.value = roundNum(mid.y);
    yInput.setAttribute('aria-label', 'Y-Position des Mittelpunkts von ' + a.name + ' & ' + b.name);
    yInput.addEventListener('input', function(){
      var cur = pairMidpoint(pair);
      setPairMidpoint(pair, cur.x, parseFloat(yInput.value)||0);
    });

    row.appendChild(xLabel);
    row.appendChild(yLabel);
    row.appendChild(xInput);
    row.appendChild(yInput);
    rosterPairMidpointInputs[pair.id] = {x:xInput, y:yInput};
    return row;
  }

  function buildDancerRow(d, pos, role){
      var row = document.createElement('div');
      row.className = 'dancer-row';
      row.addEventListener('click', function(e){ handleRosterSelectClick(e, d.id); });
      row.addEventListener('contextmenu', function(e){ handleRosterContextMenu(e, defaultSelectionFor(d.id), d.id); });

      var main = document.createElement('div');
      main.className = 'dancer-row-main';

      var swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = d.color;

      var input = document.createElement('input');
      input.className = 'name';
      input.value = d.name;
      input.setAttribute('aria-label', 'Name des Tänzers');
      input.addEventListener('input', function(){ renameDancer(d.id, input.value); });
      input.addEventListener('blur', function(){ if(!input.value.trim()) { input.value = d.name; } });

      var remove = document.createElement('button');
      remove.className = 'remove-btn';
      remove.type = 'button';
      remove.setAttribute('aria-label', d.name + ' entfernen');
      remove.appendChild(svgIcon('x', 14));
      armDeleteButton(remove, function(){ removeDancer(d.id); });

      main.appendChild(swatch);
      main.appendChild(input);
      if(role){
        var roleTag = document.createElement('span');
        roleTag.className = 'role-tag';
        roleTag.textContent = roleLabel(role);
        main.appendChild(roleTag);
      }
      var coupleSplit = !role && isCoupleSplitIn(currentFormation(), d.id);
      if(!role){
        var splitBtn = document.createElement('button');
        splitBtn.type = 'button';
        splitBtn.className = 'split-btn' + (coupleSplit ? ' active' : '');
        if(coupleSplit){ splitBtn.textContent = 'Zusammen'; }
        else {
          // „L | F" mit echtem Trennstrich — der Text-Strich sieht in der Schrift wie ein I aus
          splitBtn.setAttribute('aria-label', 'L | F');
          splitBtn.append('L', Object.assign(document.createElement('span'), { className: 'split-sep' }), 'F');
        }
        splitBtn.title = coupleSplit
          ? 'Lead & Follow hier wieder zu einem Punkt zusammenführen (nur in diesem Bild bzw. dieser Zwischenposition)'
          : 'Paar nur hier in Lead & Follow aufteilen (nur in diesem Bild bzw. dieser Zwischenposition)';
        splitBtn.setAttribute('aria-pressed', coupleSplit ? 'true' : 'false');
        splitBtn.addEventListener('click', function(e){ e.stopPropagation(); toggleCoupleSplit(d.id); });
        main.appendChild(splitBtn);
      }
      main.appendChild(remove);

      var coords = document.createElement('div');
      coords.className = 'dancer-row-coords';
      var p = pos[d.id] || {x:0,y:0,rot:0};

      var xLabel = document.createElement('span');
      xLabel.className = 'coord-label';
      xLabel.textContent = 'X';
      var xInput = document.createElement('input');
      xInput.type = 'number';
      xInput.className = 'coord-input';
      xInput.min = GRID_MIN; xInput.max = GRID_MAX; xInput.step = '0.5';
      xInput.value = roundNum(p.x);
      xInput.setAttribute('aria-label', 'X-Position von ' + d.name);
      xInput.addEventListener('input', function(){
        var yy = (currentFormation().pos[d.id]||{y:0}).y;
        setDancerPos(d.id, parseFloat(xInput.value)||0, yy, true);
      });

      var yLabel = document.createElement('span');
      yLabel.className = 'coord-label';
      yLabel.textContent = 'Y';
      var yInput = document.createElement('input');
      yInput.type = 'number';
      yInput.className = 'coord-input';
      yInput.min = GRID_MIN; yInput.max = GRID_MAX; yInput.step = '0.5';
      yInput.value = roundNum(p.y);
      yInput.setAttribute('aria-label', 'Y-Position von ' + d.name);
      yInput.addEventListener('input', function(){
        var xx = (currentFormation().pos[d.id]||{x:0}).x;
        setDancerPos(d.id, xx, parseFloat(yInput.value)||0, true);
      });

      var rotLabel = document.createElement('span');
      rotLabel.className = 'coord-label';
      rotLabel.textContent = '°';
      var rotInput = document.createElement('input');
      rotInput.type = 'number';
      rotInput.className = 'coord-input';
      rotInput.min = 0; rotInput.max = 359; rotInput.step = '5';
      rotInput.value = roundNum(p.rot||0);
      rotInput.setAttribute('aria-label', 'Drehung von ' + d.name + ' in Grad (0° = nach hinten, im Uhrzeigersinn)');
      rotInput.addEventListener('input', function(){
        var newRot = parseFloat(rotInput.value)||0;
        var before = currentFormation().pos[d.id];
        var oldRot = before ? (before.rot||0) : 0;
        var delta = newRot - oldRot;
        setDancerRot(d.id, newRot);
        // Same "moves/selects/rotates together" group as dragging on the stage — a saved partner
        // (or a broader same-role selection) turns by the same delta, keeping whatever relative
        // facing they already had rather than snapping to the exact same angle.
        if(delta){
          dragGroupFor(d.id).forEach(function(otherId){
            if(otherId === d.id) return;
            var op = currentFormation().pos[otherId];
            if(op) setDancerRot(otherId, (op.rot||0) + delta);
          });
          refreshRosterCoords();
        }
      });

      // Labels first, then inputs — with .dancer-row-coords as a 3-column grid (see stage.css)
      // this lines up X/Y/° labels in row 1 directly above their inputs in row 2, instead of the
      // old single-row flex layout that could split a label from its input onto separate lines.
      coords.appendChild(xLabel);
      coords.appendChild(yLabel);
      coords.appendChild(rotLabel);
      coords.appendChild(xInput);
      coords.appendChild(yInput);
      coords.appendChild(rotInput);

      rosterCoordInputs[d.id] = {x:xInput, y:yInput, rot:rotInput};

      row.appendChild(main);
      if(coupleSplit){
        row.classList.add('is-split');
        var leadTag = document.createElement('span');
        leadTag.className = 'split-sub-label';
        leadTag.textContent = 'Lead';
        row.appendChild(leadTag);
      }
      row.appendChild(coords);
      if(coupleSplit) row.appendChild(buildFollowCoords(d, pos));
      rosterRowEls[d.id] = row;
      return row;
  }

  // X/Y/° for the Follow half of a couple split in this Bild (pos key <id>~f).
  function buildFollowCoords(d, pos){
    var fk = followKey(d.id);
    var wrap = document.createElement('div');
    wrap.className = 'dancer-row-follow';
    var tag = document.createElement('span');
    tag.className = 'split-sub-label';
    tag.textContent = 'Follow';
    wrap.appendChild(tag);
    var coords = document.createElement('div');
    coords.className = 'dancer-row-coords';
    var p = pos[fk] || {x:0,y:0,rot:0};
    function mk(lbl, val, min, max, step, aria){
      var l = document.createElement('span');
      l.className = 'coord-label';
      l.textContent = lbl;
      var i = document.createElement('input');
      i.type = 'number';
      i.className = 'coord-input';
      i.min = min; i.max = max; i.step = step;
      i.value = roundNum(val);
      i.setAttribute('aria-label', aria);
      return {l: l, i: i};
    }
    var x = mk('X', p.x, GRID_MIN, GRID_MAX, '0.5', 'X-Position Follow von ' + d.name);
    var y = mk('Y', p.y, GRID_MIN, GRID_MAX, '0.5', 'Y-Position Follow von ' + d.name);
    var r = mk('°', p.rot||0, 0, 359, '5', 'Drehung Follow von ' + d.name);
    x.i.addEventListener('input', function(){
      var cur = currentFormation().pos[fk]; if(!cur) return;
      setDancerPos(fk, parseFloat(x.i.value)||0, cur.y, true); saveStateDebounced();
    });
    y.i.addEventListener('input', function(){
      var cur = currentFormation().pos[fk]; if(!cur) return;
      setDancerPos(fk, cur.x, parseFloat(y.i.value)||0, true); saveStateDebounced();
    });
    r.i.addEventListener('input', function(){ setDancerRot(fk, parseFloat(r.i.value)||0); });
    [x.l, y.l, r.l, x.i, y.i, r.i].forEach(function(n){ coords.appendChild(n); });
    rosterCoordInputs[fk] = {x: x.i, y: y.i, rot: r.i};
    wrap.appendChild(coords);
    wrap.addEventListener('click', function(e){ handleRosterSelectClick(e, fk); });
    wrap.addEventListener('contextmenu', function(e){ handleRosterContextMenu(e, [fk], fk); });
    return wrap;
  }

  function addDancer(){
    var idx = state.dancers.length;
    var d = { id: uid('d'), name: String(idx+1), color: paletteColor(idx) };
    state.dancers.push(d);
    state.formations.forEach(function(f){ f.pos[d.id] = {x:0, y:5, rot:0}; });
    saveState();
    ensureMarkers();
    positionMarkers(currentFormation().pos);
    renderRoster();
    renderFilmstrip();
    renderLayoutGhost(); // a Grundform is regenerated for the new pair count
  }

  function removeDancer(id){
    state.dancers = state.dancers.filter(function(d){ return d.id !== id; });
    var goneKeys = [id, followKey(id)];
    state.formations.forEach(function(f){
      goneKeys.forEach(function(k){ delete f.pos[k]; });
      (f.betweens || []).forEach(function(b){ if(b.pos) goneKeys.forEach(function(k){ delete b.pos[k]; }); });
    });
    var gonePairs = state.pairs.filter(function(p){ return p.memberIds.indexOf(id) !== -1; });
    var gonePairIds = gonePairs.map(function(p){ return p.id; });
    // Drehungen im Paar are keyed by the Lead: the dancer's own couple and any pair it was part of
    var goneTurnKeys = [id].concat(gonePairs.map(function(p){ return p.memberIds[0]; }));
    state.pairs = state.pairs.filter(function(p){ return p.memberIds.indexOf(id) === -1; });
    // … and Eigendrehungen by pos key — on every Bild and Zwischenposition a leg leaves from.
    function dropTurns(stop){
      if(stop.coupleTurns){
        goneTurnKeys.forEach(function(k){ delete stop.coupleTurns[k]; });
        stop.coupleTurns = sanitizeCoupleTurns(stop.coupleTurns);
      }
      if(stop.spins){
        goneKeys.forEach(function(k){ delete stop.spins[k]; });
        stop.spins = sanitizeSpins(stop.spins);
      }
      if(stop.orbits) stop.orbits = sanitizeOrbits(stop.orbits.map(function(g){
        return {ids: g.ids.filter(function(k){ return goneKeys.indexOf(k) === -1; }), turn: g.turn};
      }));
    }
    state.formations.forEach(function(f){
      if(Array.isArray(f.splitPairs)) f.splitPairs = f.splitPairs.filter(function(pid){ return gonePairIds.indexOf(pid) === -1; });
      dropTurns(f);
      (f.betweens || []).forEach(dropTurns);
    });
    if(selectedDancerId === id) selectedDancerId = null;
    var pairIdx = pairSelection.indexOf(id);
    if(pairIdx !== -1){ pairSelection.splice(pairIdx, 1); updatePairRotateUI(); }
    saveState();
    ensureMarkers();
    renderRoster();
    renderFilmstrip();
    renderLayoutGhost();
  }

  function renameDancer(id, name){
    var d = state.dancers.find(function(d){ return d.id === id; });
    if(!d) return;
    d.name = name;
    var el = stageMarkers[id];
    if(el){
      el.querySelector('.label').textContent = name;
      el.querySelector('.initials').textContent = initials(name || '?');
    }
    var fel = stageMarkers[followKey(id)];
    if(fel){
      fel.querySelector('.label').textContent = name + ' · Follow';
      fel.querySelector('.initials').textContent = initials(name || '?');
    }
    if(pairSelection.indexOf(id) !== -1) updatePairRotateUI();
    saveState();
  }
