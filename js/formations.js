"use strict";

/* ---------- formations / filmstrip ---------- */

  var dragSourceId = null;

  // A new Bild created from an existing one (addFormation, applyFigure) inherits its per-Bild-only
  // axes as a starting point, same as it inherits positions/showAxes — copied per-object so editing
  // one Bild's local axes afterward never mutates the source Bild's.
  function copyLocalAxes(src){
    return (src.localAxes || []).map(function(ax){
      return {id: uid('ax'), x1:ax.x1, y1:ax.y1, x2:ax.x2, y2:ax.y2, label:ax.label||''};
    });
  }

  /* ---------- Figuren (preset movement templates, fetched from api/figures.php) ---------- */

  var figuresCatalog = null; // null until first fetch resolves
  var figuresFetchPromise = null;

  function ensureFiguresLoaded(){
    if(!figuresFetchPromise){
      figuresFetchPromise = fetch('api/figures.php')
        .then(function(res){ return res.ok ? res.json() : {figures:[]}; })
        .then(function(data){ figuresCatalog = Array.isArray(data.figures) ? data.figures : []; })
        .catch(function(){ figuresCatalog = []; })
        .then(function(){ if(!addBildBackdrop.hidden) renderAddBildModal(); }); // refresh if already open
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

    var f = { id: uid('f'), name: 'Bild ' + (state.formations.length+1), pos: newPos, showAxes: currentFormation().showAxes !== false, localAxes: copyLocalAxes(currentFormation()), category: '' };
    state.formations.push(f);
    state.activeIndex = state.formations.length - 1;
    saveState();
    renderFilmstrip();
    positionMarkers(currentFormation().pos);
    refreshRosterCoords();
    updatePlaybarInfo();
    updatePlayButton();
    renderAxes();
    resetLayoutGhost();
  }

  // ---------- "Neues Bild" modal: empty copy, admin Figuren-Katalog, per-project custom Figuren ----------
  // A real modal (not a corner popover) on purpose: the popover this replaced opened *above* the
  // "+" card, but the filmstrip track it lived in scrolls horizontally (overflow-x:auto), which —
  // per the CSS overflow spec — forces overflow-y to 'auto' too, silently clipping almost the
  // entire popover out of view. A modal sidesteps that class of bug entirely and has room to grow
  // (it now also hosts the custom-Figuren list + creation form).

  var addBildBackdrop = document.getElementById('addBildBackdrop');
  var addBildCloseBtn = document.getElementById('addBildCloseBtn');
  var addEmptyBildBtn = document.getElementById('addEmptyBildBtn');
  var catalogFiguresListEl = document.getElementById('catalogFiguresList');
  var catalogFiguresEmptyHint = document.getElementById('catalogFiguresEmptyHint');
  var customFiguresListEl = document.getElementById('customFiguresList');
  var customFiguresEmptyHint = document.getElementById('customFiguresEmptyHint');
  var newCustomFigureBtn = document.getElementById('newCustomFigureBtn');
  var customFigureForm = document.getElementById('customFigureForm');
  var cfNameInput = document.getElementById('cfName');
  var cfModeSelect = document.getElementById('cfMode');
  var cfSoloFields = document.getElementById('cfSoloFields');
  var cfCouplesFields = document.getElementById('cfCouplesFields');
  var cfPivotSelect = document.getElementById('cfPivot');
  var cfRotateInput = document.getElementById('cfRotate');
  var cfTxInput = document.getElementById('cfTx');
  var cfTyInput = document.getElementById('cfTy');
  var cfCoupleTogetherCheckbox = document.getElementById('cfCoupleTogether');
  var cfARotateInput = document.getElementById('cfARotate');
  var cfARotateLabel = document.getElementById('cfARotateLabel');
  var cfATxInput = document.getElementById('cfATx');
  var cfATyInput = document.getElementById('cfATy');
  var cfBRotateField = document.getElementById('cfBRotateField');
  var cfBRotateInput = document.getElementById('cfBRotate');
  var cfBTxInput = document.getElementById('cfBTx');
  var cfBTyInput = document.getElementById('cfBTy');
  var cfCancelBtn = document.getElementById('cfCancelBtn');
  var cfSaveBtn = document.getElementById('cfSaveBtn');

  function figureItem(fig, opts){
    opts = opts || {};
    var isCouples = fig.transform && fig.transform.mode === 'couples';
    var disabled = isCouples && !state.pairs.length;
    var row = document.createElement('div');
    row.className = 'figure-row';

    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'export-menu-item';
    item.disabled = disabled;
    var desc = fig.description || '';
    if(disabled) desc = 'Keine Paare festgelegt (Strg/Cmd-Klick zwei Tänzer, dann „Als Paar speichern“)';
    item.innerHTML = '<strong></strong><span></span>';
    item.querySelector('strong').textContent = fig.name;
    item.querySelector('span').textContent = desc;
    if(!disabled) item.addEventListener('click', function(){ closeAddBildModal(); applyFigure(fig); });
    row.appendChild(item);

    if(opts.onDelete){
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'figure-delete';
      del.textContent = '✕';
      del.setAttribute('aria-label', 'Figur "' + fig.name + '" löschen');
      armDeleteButton(del, opts.onDelete);
      row.appendChild(del);
    }

    return row;
  }

  function renderAddBildModal(){
    catalogFiguresListEl.innerHTML = '';
    if(figuresCatalog === null){
      var loading = document.createElement('p');
      loading.className = 'settings-hint';
      loading.textContent = 'Figuren werden geladen…';
      catalogFiguresListEl.appendChild(loading);
      catalogFiguresEmptyHint.hidden = true;
    }else{
      (figuresCatalog || []).forEach(function(fig){ catalogFiguresListEl.appendChild(figureItem(fig)); });
      catalogFiguresEmptyHint.hidden = !!(figuresCatalog && figuresCatalog.length);
    }

    customFiguresListEl.innerHTML = '';
    (state.customFigures || []).forEach(function(fig){
      customFiguresListEl.appendChild(figureItem(fig, { onDelete: function(){ deleteCustomFigure(fig.id); } }));
    });
    customFiguresEmptyHint.hidden = !!(state.customFigures && state.customFigures.length);
  }

  function openAddBildModal(){
    hideCustomFigureForm();
    renderAddBildModal();
    addBildBackdrop.hidden = false;
  }
  function closeAddBildModal(){ addBildBackdrop.hidden = true; hideCustomFigureForm(); }

  addBildCloseBtn.addEventListener('click', closeAddBildModal);
  addBildBackdrop.addEventListener('click', function(e){ if(e.target === addBildBackdrop) closeAddBildModal(); });
  addEmptyBildBtn.addEventListener('click', function(){ closeAddBildModal(); addFormation(); });

  function updateCfModeFields(){
    var isCouples = cfModeSelect.value === 'couples';
    cfSoloFields.hidden = isCouples;
    cfCouplesFields.hidden = !isCouples;
  }
  cfModeSelect.addEventListener('change', updateCfModeFields);

  // "Paar dreht sich als Ganzes um seinen Mittelpunkt" is just the couples transform's existing
  // per-partner rotateDeg with the same value on both sides (applyRigidTransform already rotates
  // each partner around their pair's shared midpoint) — this checkbox is only a convenience so you
  // don't have to type the same angle into both Lead and Follow by hand and keep them in sync.
  // Follow's own rotate field is hidden and mirrors Lead's while it's checked.
  function updateCfCoupleTogetherUI(){
    var together = cfCoupleTogetherCheckbox.checked;
    cfBRotateField.hidden = together;
    cfARotateLabel.textContent = together ? 'Drehung ° (für beide)' : 'Drehung °';
    if(together) cfBRotateInput.value = cfARotateInput.value;
  }
  cfCoupleTogetherCheckbox.addEventListener('change', updateCfCoupleTogetherUI);
  cfARotateInput.addEventListener('input', function(){
    if(cfCoupleTogetherCheckbox.checked) cfBRotateInput.value = cfARotateInput.value;
  });

  function showCustomFigureForm(){
    cfNameInput.value = '';
    cfModeSelect.value = 'solo';
    cfPivotSelect.value = 'stage-center';
    cfCoupleTogetherCheckbox.checked = false;
    [cfRotateInput,cfTxInput,cfTyInput,cfARotateInput,cfATxInput,cfATyInput,cfBRotateInput,cfBTxInput,cfBTyInput].forEach(function(el){ el.value = 0; });
    updateCfModeFields();
    updateCfCoupleTogetherUI();
    customFigureForm.hidden = false;
    cfNameInput.focus();
  }
  function hideCustomFigureForm(){ customFigureForm.hidden = true; }

  newCustomFigureBtn.addEventListener('click', showCustomFigureForm);
  cfCancelBtn.addEventListener('click', hideCustomFigureForm);

  function num(el){ var v = parseFloat(el.value); return isFinite(v) ? v : 0; }

  cfSaveBtn.addEventListener('click', function(){
    var name = cfNameInput.value.trim();
    if(!name){ cfNameInput.focus(); return; }
    var transform;
    if(cfModeSelect.value === 'couples'){
      // "Together" always writes the same rotateDeg into both partners regardless of whatever's
      // sitting in the (hidden) Follow rotate field, so it can't drift out of sync with Lead's.
      var bRotate = cfCoupleTogetherCheckbox.checked ? num(cfARotateInput) : num(cfBRotateInput);
      transform = {
        mode: 'couples',
        partnerA: { rotateDeg: num(cfARotateInput), translateX: num(cfATxInput), translateY: num(cfATyInput) },
        partnerB: { rotateDeg: bRotate, translateX: num(cfBTxInput), translateY: num(cfBTyInput) }
      };
    }else{
      transform = {
        mode: 'solo',
        pivot: cfPivotSelect.value,
        rotateDeg: num(cfRotateInput), translateX: num(cfTxInput), translateY: num(cfTyInput)
      };
    }
    state.customFigures.push({ id: uid('cf'), name: name, transform: transform });
    saveState();
    hideCustomFigureForm();
    renderAddBildModal();
  });

  function deleteCustomFigure(id){
    state.customFigures = state.customFigures.filter(function(fig){ return fig.id !== id; });
    saveState();
    renderAddBildModal();
  }

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

      // Setting a Bild's own category text marks it as the START of a new named section (e.g.
      // "1. Langsamer Walzer") that visually continues through however many following Bilder are
      // left blank — not a per-card tag every Bild needs, just where each section begins. The
      // running number is recomputed by renumberFilmCategories() (a lightweight pass over just
      // the number badges, never rebuilding the inputs) so typing isn't interrupted by losing
      // focus mid-edit.
      var categoryWrap = document.createElement('div');
      categoryWrap.className = 'film-category';
      var categoryNumEl = document.createElement('span');
      categoryNumEl.className = 'film-category-num';
      var categoryInput = document.createElement('input');
      categoryInput.type = 'text';
      categoryInput.className = 'film-category-input';
      categoryInput.placeholder = '+ Abschnitt';
      categoryInput.maxLength = 40;
      categoryInput.value = f.category || '';
      categoryInput.setAttribute('aria-label', 'Abschnitt ab Bild "' + f.name + '" (leer = gehört noch zum vorherigen Abschnitt)');
      categoryInput.addEventListener('input', function(){
        f.category = categoryInput.value;
        categoryWrap.classList.toggle('has-category', !!f.category);
        saveState();
        renumberFilmCategories();
      });
      categoryWrap.classList.toggle('has-category', !!f.category);
      categoryWrap.appendChild(categoryNumEl);
      categoryWrap.appendChild(categoryInput);

      var indexEl = document.createElement('span');
      indexEl.className = 'film-index';
      indexEl.textContent = String(idx+1).padStart(2,'0');

      var removeEl = document.createElement('button');
      removeEl.className = 'film-remove';
      removeEl.type = 'button';
      removeEl.textContent = '✕';
      removeEl.setAttribute('aria-label', 'Bild "' + f.name + '" löschen');
      armDeleteButton(removeEl, function(){ deleteFormation(f.id); });

      var preview = document.createElement('div');
      preview.className = 'film-preview';
      preview.appendChild(indexEl);
      preview.appendChild(removeEl);
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

      card.appendChild(categoryWrap);
      card.appendChild(preview);
      card.appendChild(nameInput);

      card.addEventListener('dragstart', function(e){
        dragSourceId = f.id;
        card.classList.add('dragging');
        if(e.dataTransfer){
          e.dataTransfer.effectAllowed = 'move';
          try{ e.dataTransfer.setData('text/plain', f.id); }catch(err){}
        }
      });
      card.addEventListener('dragend', function(){
        card.classList.remove('dragging');
        dragSourceId = null;
        commitFilmstripOrder();
      });
      // Live-previews the reorder as you hover: moves the actual dragged card in the DOM right
      // away (rather than waiting for drop), so the filmstrip visibly shifts around it while
      // you're still dragging. The array itself is only reconciled once on dragend (see
      // commitFilmstripOrder) — re-rendering mid-drag would tear out the dragged element and
      // kill the browser's drag session.
      card.addEventListener('dragover', function(e){
        e.preventDefault();
        if(!dragSourceId || dragSourceId === f.id) return;
        var dragEl = filmTrackEl.querySelector('.film-card.dragging');
        if(!dragEl || dragEl === card) return;
        var rect = card.getBoundingClientRect();
        var before = (e.clientX - rect.left) < rect.width / 2;
        filmTrackEl.insertBefore(dragEl, before ? card : card.nextSibling);
      });
      card.addEventListener('drop', function(e){ e.preventDefault(); });

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
    addCard.setAttribute('aria-haspopup', 'dialog');
    addCard.addEventListener('click', openAddBildModal);

    addWrap.appendChild(addCard);
    filmTrackEl.appendChild(addWrap);
    renumberFilmCategories();
  }

  // Recomputes each section-start badge's running number ("1.", "2.", …) without touching the
  // .film-category-input elements themselves — called after a full renderFilmstrip() and also
  // directly from a category input's own 'input' handler, so retyping a section name never loses
  // focus/cursor position the way a full re-render would.
  function renumberFilmCategories(){
    var wraps = filmTrackEl.querySelectorAll('.film-category');
    var n = 0;
    wraps.forEach(function(wrap, i){
      var f = state.formations[i];
      var numEl = wrap.querySelector('.film-category-num');
      if(f && f.category){
        n++;
        numEl.textContent = n + '.';
        numEl.hidden = false;
      }else{
        numEl.hidden = true;
      }
    });
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
    var f = { id: uid('f'), name: 'Bild ' + (state.formations.length+1), pos: copy, showAxes: src.showAxes !== false, localAxes: copyLocalAxes(src), category: '' };
    state.formations.push(f);
    state.activeIndex = state.formations.length - 1;
    saveState();
    renderFilmstrip();
    positionMarkers(currentFormation().pos);
    refreshRosterCoords();
    updatePlaybarInfo();
    updatePlayButton();
    renderAxes();
    resetLayoutGhost();
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
    if(wasActive){ positionMarkers(currentFormation().pos); refreshRosterCoords(); renderAxes(); resetLayoutGhost(); }
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
    resetLayoutGhost();
  }

  // Reconciles state.formations to match whatever order the drag-hover live-preview (see the
  // dragover handler in renderFilmstrip) already put the DOM cards in, then does one clean
  // re-render to normalize index badges/listeners. Called once on dragend, never mid-drag.
  function commitFilmstripOrder(){
    var ids = Array.prototype.map.call(filmTrackEl.querySelectorAll('.film-card'), function(el){ return el.dataset.id; });
    var activeId = currentFormation() ? currentFormation().id : null;
    var byId = {};
    state.formations.forEach(function(f){ byId[f.id] = f; });
    var reordered = ids.map(function(id){ return byId[id]; }).filter(Boolean);
    if(reordered.length !== state.formations.length) return; // safety: never drop/duplicate a Bild
    state.formations = reordered;
    if(activeId) state.activeIndex = state.formations.findIndex(function(f){ return f.id === activeId; });
    saveState();
    renderFilmstrip();
  }
