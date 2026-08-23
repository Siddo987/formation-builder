"use strict";

/* ---------- roster ---------- */

  function renderRoster(){
    rosterListEl.innerHTML = '';
    rosterCoordInputs = {};
    var pos = currentFormation().pos;
    state.dancers.forEach(function(d){
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
        setDancerRot(d.id, parseFloat(rotInput.value)||0);
      });

      coords.appendChild(xLabel);
      coords.appendChild(xInput);
      coords.appendChild(yLabel);
      coords.appendChild(yInput);
      coords.appendChild(rotLabel);
      coords.appendChild(rotInput);

      rosterCoordInputs[d.id] = {x:xInput, y:yInput, rot:rotInput};

      row.appendChild(main);
      row.appendChild(coords);

      var pair = findPairForDancer(d.id);
      if(pair){
        var partnerId = pair.memberIds[0] === d.id ? pair.memberIds[1] : pair.memberIds[0];
        var partner = state.dancers.find(function(pd){ return pd.id === partnerId; });
        var badge = document.createElement('div');
        badge.className = 'pair-badge';
        var badgeLabel = document.createElement('span');
        badgeLabel.textContent = '⚭ Paar mit ' + (partner ? partner.name : '?');
        var unpairBtn = document.createElement('button');
        unpairBtn.type = 'button';
        unpairBtn.className = 'pair-badge-unpair';
        unpairBtn.textContent = 'trennen';
        unpairBtn.setAttribute('aria-label', 'Paarung von ' + d.name + ' und ' + (partner ? partner.name : '') + ' aufheben');
        unpairBtn.addEventListener('click', function(){ dissolvePair(pair.id); });
        badge.appendChild(badgeLabel);
        badge.appendChild(unpairBtn);
        row.appendChild(badge);
      }

      rosterListEl.appendChild(row);
    });
    dancerCountEl.textContent = state.dancers.length;
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
