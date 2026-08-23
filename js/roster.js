"use strict";

/* ---------- roster ---------- */

  function renderRoster(){
    rosterListEl.innerHTML = '';
    rosterCoordInputs = {};
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
  }

  // Partners always render together, wherever the first-encountered member sits in
  // state.dancers — a single shared header ("⚭ Paar … trennen") replaces the old per-row
  // badge that used to repeat the same "trennen" action once on each partner's own row.
  function buildPairGroup(pair, a, b, pos){
    var group = document.createElement('div');
    group.className = 'pair-group';

    var header = document.createElement('div');
    header.className = 'pair-group-header';
    var label = document.createElement('span');
    label.className = 'pair-group-label';
    label.textContent = '⚭ Paar';
    var unpairBtn = document.createElement('button');
    unpairBtn.type = 'button';
    unpairBtn.className = 'pair-group-unpair';
    unpairBtn.textContent = 'trennen';
    unpairBtn.setAttribute('aria-label', 'Paarung von ' + a.name + ' und ' + b.name + ' aufheben');
    unpairBtn.addEventListener('click', function(){ dissolvePair(pair.id); });
    header.appendChild(label);
    header.appendChild(unpairBtn);
    group.appendChild(header);

    group.appendChild(buildDancerRow(a, pos, 'lead'));
    group.appendChild(buildDancerRow(b, pos, 'follow'));
    return group;
  }

  function buildDancerRow(d, pos, role){
      var row = document.createElement('div');
      row.className = 'dancer-row';

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
      remove.textContent = '✕';
      armDeleteButton(remove, function(){ removeDancer(d.id); });

      main.appendChild(swatch);
      main.appendChild(input);
      if(role){
        var roleTag = document.createElement('span');
        roleTag.className = 'role-tag';
        roleTag.textContent = roleLabel(role);
        main.appendChild(roleTag);
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
      row.appendChild(coords);
      return row;
  }

  function addDancer(){
    var idx = state.dancers.length;
    var d = { id: uid('d'), name: 'Tänzer ' + (idx+1), color: paletteColor(idx) };
    state.dancers.push(d);
    state.formations.forEach(function(f){ f.pos[d.id] = {x:0, y:5, rot:0}; });
    saveState();
    ensureMarkers();
    positionMarkers(currentFormation().pos);
    renderRoster();
    renderFilmstrip();
  }

  function removeDancer(id){
    state.dancers = state.dancers.filter(function(d){ return d.id !== id; });
    state.formations.forEach(function(f){ delete f.pos[id]; });
    state.pairs = state.pairs.filter(function(p){ return p.memberIds.indexOf(id) === -1; });
    if(selectedDancerId === id) selectedDancerId = null;
    var pairIdx = pairSelection.indexOf(id);
    if(pairIdx !== -1){ pairSelection.splice(pairIdx, 1); updatePairRotateUI(); }
    saveState();
    ensureMarkers();
    renderRoster();
    renderFilmstrip();
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
    if(pairSelection.indexOf(id) !== -1) updatePairRotateUI();
    saveState();
  }
