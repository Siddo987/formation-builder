"use strict";

/* ---------- formations / filmstrip ---------- */

  var dragSourceId = null;

  /* ---------- Figuren (preset movement templates, fetched from api/figures.php) ---------- */

  var figuresCatalog = null; // null until first fetch resolves
  var figuresFetchPromise = null;

  function ensureFiguresLoaded(){
    if(!figuresFetchPromise){
      figuresFetchPromise = fetch('api/figures.php')
        .then(function(res){ return res.ok ? res.json() : {figures:[]}; })
        .then(function(data){ figuresCatalog = Array.isArray(data.figures) ? data.figures : []; })
        .catch(function(){ figuresCatalog = []; })
        .then(function(){ renderFilmstrip(); }); // refreshes an already-built "+"-menu once loaded
    }
    return figuresFetchPromise;
  }

  // Rotates+translates a single point around (px,py) per a {rotateDeg,translateX,translateY}
  // recipe — the same rigid-transform math rotatePairSelection() already uses for the pair-rotate
  // control, generalized to an arbitrary pivot and an additional translation.
  function applyRigidTransform(newPos, id, p, px, py, recipe){
    recipe = recipe || {};
    var deg = recipe.rotateDeg || 0;
    var rad = deg * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var dx = p.x - px, dy = p.y - py;
    var nx = px + dx*cos - dy*sin + (recipe.translateX||0);
    var ny = py + dx*sin + dy*cos + (recipe.translateY||0);
    newPos[id] = { x: clampGrid(nx), y: clampGrid(ny), rot: normAngle((p.rot||0) + deg) };
  }

  // Applies a Figur to the current Bild, producing a new Bild seeded with the transformed
  // positions (so the result is a normal, freely-editable Bild afterward — no separate
  // "editable preset instance" concept needed).
  function applyFigure(figure){
    var t = figure.transform || {};
    var srcPos = currentFormation().pos;
    var newPos = {};
    Object.keys(srcPos).forEach(function(id){
      newPos[id] = {x:srcPos[id].x, y:srcPos[id].y, rot:srcPos[id].rot||0};
    });

    if(t.mode === 'couples'){
      if(!state.pairs.length) return;
      var selPair = pairSelection.length === 2 ? findPairByMembers(pairSelection) : null;
      var targetPairs = selPair ? [selPair] : state.pairs;
      targetPairs.forEach(function(pair){
        var idA = pair.memberIds[0], idB = pair.memberIds[1];
        var posA = srcPos[idA], posB = srcPos[idB];
        if(!posA || !posB) return;
        var mx = (posA.x + posB.x) / 2, my = (posA.y + posB.y) / 2;
        applyRigidTransform(newPos, idA, posA, mx, my, t.partnerA);
        applyRigidTransform(newPos, idB, posB, mx, my, t.partnerB);
      });
    }else{
      var targetIds = pairSelection.length ? pairSelection.slice() : state.dancers.map(function(d){ return d.id; });
      var pivot = {x:0, y:0};
      if(t.pivot === 'selection-centroid'){
        var sx=0, sy=0, n=0;
        targetIds.forEach(function(id){ var p = srcPos[id]; if(p){ sx+=p.x; sy+=p.y; n++; } });
        if(n) pivot = {x: sx/n, y: sy/n};
      }
      targetIds.forEach(function(id){
        var p = srcPos[id];
        if(p) applyRigidTransform(newPos, id, p, pivot.x, pivot.y, t);
      });
    }

    var f = { id: uid('f'), name: 'Bild ' + (state.formations.length+1), pos: newPos, showAxes: currentFormation().showAxes !== false };
    state.formations.push(f);
    state.activeIndex = state.formations.length - 1;
    saveState();
    renderFilmstrip();
    positionMarkers(currentFormation().pos);
    refreshRosterCoords();
    updatePlaybarInfo();
    updatePlayButton();
    renderAxes();
  }

  function closeFilmAddMenu(menuEl){ menuEl.hidden = true; }

  function buildFilmAddMenu(){
    var menu = document.createElement('div');
    menu.className = 'export-menu film-add-menu';
    menu.hidden = true;

    var emptyItem = document.createElement('button');
    emptyItem.type = 'button';
    emptyItem.className = 'export-menu-item';
    emptyItem.innerHTML = '<strong>Leeres Bild</strong><span>Kopie des aktuellen Bilds zum freien Anpassen</span>';
    emptyItem.addEventListener('click', function(){ closeFilmAddMenu(menu); addFormation(); });
    menu.appendChild(emptyItem);

    (figuresCatalog || []).forEach(function(fig){
      var isCouples = fig.transform && fig.transform.mode === 'couples';
      var disabled = isCouples && !state.pairs.length;
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'export-menu-item';
      item.disabled = disabled;
      var desc = fig.description || '';
      if(disabled) desc = 'Keine Paare festgelegt (Strg/Cmd-Klick zwei Tänzer, dann „Als Paar speichern“)';
      item.innerHTML = '<strong>' + fig.name + '</strong><span>' + desc + '</span>';
      if(!disabled) item.addEventListener('click', function(){ closeFilmAddMenu(menu); applyFigure(fig); });
      menu.appendChild(item);
    });

    if(figuresCatalog === null){
      var loading = document.createElement('span');
      loading.className = 'export-menu-item';
      loading.textContent = 'Figuren werden geladen…';
      menu.appendChild(loading);
    }

    return menu;
  }

  // One stable listener (rather than one per renderFilmstrip() call, which would otherwise pile
  // up a fresh document-level listener — and a stale menu reference — every re-render) that
  // closes whichever .film-add-menu is currently open on an outside click.
  document.addEventListener('click', function(e){
    var menu = document.querySelector('.film-add-menu');
    if(menu && !menu.hidden && !menu.contains(e.target) && !e.target.closest('.film-add')) closeFilmAddMenu(menu);
  });

  function autosizeFnameInput(el){
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function renderFilmstrip(){
    filmTrackEl.innerHTML = '';
    state.formations.forEach(function(f, idx){
      var card = document.createElement('div');
      card.className = 'film-card' + (idx === state.activeIndex ? ' active' : '');
      card.draggable = true;
      card.dataset.id = f.id;

      var indexEl = document.createElement('span');
      indexEl.className = 'film-index';
      indexEl.textContent = String(idx+1).padStart(2,'0');

      var removeEl = document.createElement('button');
      removeEl.className = 'film-remove';
      removeEl.type = 'button';
      removeEl.textContent = '✕';
      removeEl.setAttribute('aria-label', 'Bild "' + f.name + '" löschen');
      removeEl.addEventListener('click', function(e){ e.stopPropagation(); deleteFormation(f.id); });

      var preview = document.createElement('div');
      preview.className = 'film-preview';
      state.dancers.forEach(function(d){
        var pos = f.pos[d.id];
        if(!pos) return;
        var dot = document.createElement('span');
        dot.className = 'film-dot';
        dot.style.left = gridToPercent(pos.x) + '%';
        dot.style.top = gridToPercent(pos.y) + '%';
        dot.style.background = d.color;
        dot.dataset.dancer = d.id;
        preview.appendChild(dot);
      });
      preview.addEventListener('click', function(){ selectFormation(idx); });

      var nameInput = document.createElement('textarea');
      nameInput.className = 'fname';
      nameInput.rows = 1;
      nameInput.value = f.name;
      nameInput.setAttribute('aria-label', 'Name des Bildes (mehrere Zeilen möglich, z. B. für mehrere Figuren)');
      nameInput.addEventListener('input', function(){ f.name = nameInput.value; autosizeFnameInput(nameInput); saveState(); if(idx===state.activeIndex) activeNameEl.textContent = f.name; });
      nameInput.addEventListener('blur', function(){ if(!nameInput.value.trim()){ nameInput.value = f.name = 'Bild ' + (idx+1); autosizeFnameInput(nameInput); saveState(); } });

      card.appendChild(indexEl);
      card.appendChild(removeEl);
      card.appendChild(preview);
      card.appendChild(nameInput);

      card.addEventListener('dragstart', function(){ dragSourceId = f.id; card.classList.add('dragging'); });
      card.addEventListener('dragend', function(){ card.classList.remove('dragging'); });
      card.addEventListener('dragover', function(e){ e.preventDefault(); });
      card.addEventListener('drop', function(e){
        e.preventDefault();
        if(dragSourceId && dragSourceId !== f.id) reorderFormations(dragSourceId, f.id);
      });

      filmTrackEl.appendChild(card);
      autosizeFnameInput(nameInput);
    });

    var addWrap = document.createElement('div');
    addWrap.className = 'film-add-wrap';

    var addCard = document.createElement('button');
    addCard.className = 'film-add';
    addCard.type = 'button';
    addCard.textContent = '+';
    addCard.setAttribute('aria-label', 'Neues Bild hinzufügen');
    addCard.setAttribute('aria-haspopup', 'true');

    var addMenu = buildFilmAddMenu();
    addCard.addEventListener('click', function(e){
      e.stopPropagation();
      if(addMenu.hidden){
        // rebuilt fresh on every open, not reused — otherwise a couples-Figur's enabled/disabled
        // state (which depends on state.pairs) would go stale the moment a pair is
        // saved/dissolved without some *other* action happening to trigger a renderFilmstrip()
        var fresh = buildFilmAddMenu();
        fresh.hidden = false;
        addWrap.replaceChild(fresh, addMenu);
        addMenu = fresh;
      }else{
        closeFilmAddMenu(addMenu);
      }
    });

    addWrap.appendChild(addCard);
    addWrap.appendChild(addMenu);
    filmTrackEl.appendChild(addWrap);
  }

  function updateMiniDots(formationIndex){
    var f = state.formations[formationIndex];
    var card = filmTrackEl.querySelector('.film-card[data-id="' + f.id + '"]');
    if(!card) return;
    card.querySelectorAll('.film-dot').forEach(function(dot){
      var pos = f.pos[dot.dataset.dancer];
      if(!pos) return;
      dot.style.left = gridToPercent(pos.x) + '%';
      dot.style.top = gridToPercent(pos.y) + '%';
    });
  }

  function addFormation(){
    var src = currentFormation();
    var copy = {};
    Object.keys(src.pos).forEach(function(k){ copy[k] = {x:src.pos[k].x, y:src.pos[k].y, rot:src.pos[k].rot||0}; });
    var f = { id: uid('f'), name: 'Bild ' + (state.formations.length+1), pos: copy, showAxes: src.showAxes !== false };
    state.formations.push(f);
    state.activeIndex = state.formations.length - 1;
    saveState();
    renderFilmstrip();
    positionMarkers(currentFormation().pos);
    refreshRosterCoords();
    updatePlaybarInfo();
    updatePlayButton();
    renderAxes();
  }

  function deleteFormation(id){
    if(state.formations.length <= 1) return;
    var idx = state.formations.findIndex(function(f){ return f.id === id; });
    if(idx < 0) return;
    var wasActive = idx === state.activeIndex;
    state.formations.splice(idx, 1);
    if(state.activeIndex >= state.formations.length) state.activeIndex = state.formations.length - 1;
    else if(idx < state.activeIndex) state.activeIndex -= 1;
    saveState();
    renderFilmstrip();
    if(wasActive){ positionMarkers(currentFormation().pos); refreshRosterCoords(); renderAxes(); }
    updatePlaybarInfo();
    updatePlayButton();
  }

  function selectFormation(idx){
    pausePlayback();
    state.activeIndex = idx;
    saveState();
    renderFilmstrip();
    positionMarkers(currentFormation().pos);
    refreshRosterCoords();
    updatePlaybarInfo();
    renderAxes();
  }

  function reorderFormations(draggedId, targetId){
    var from = state.formations.findIndex(function(f){ return f.id === draggedId; });
    var to = state.formations.findIndex(function(f){ return f.id === targetId; });
    if(from < 0 || to < 0 || from === to) return;
    var activeId = currentFormation().id;
    var moved = state.formations.splice(from,1)[0];
    state.formations.splice(to,0,moved);
    state.activeIndex = state.formations.findIndex(function(f){ return f.id === activeId; });
    saveState();
    renderFilmstrip();
  }
