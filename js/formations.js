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

  // Partner pairs a couples-Figur acts on, as [Lead/A, Follow/B] pos keys: saved pairs from older
  // projects plus every dot split into Lead & Follow in the current Bild.
  function figureCouples(){
    var cf = currentFormation();
    var list = state.pairs.map(function(p){ return p.memberIds; });
    state.dancers.forEach(function(d){ if(isCoupleSplitIn(cf, d.id)) list.push([d.id, followKey(d.id)]); });
    return list;
  }

  // Applies a Figur to the current Bild, producing a new Bild seeded with the transformed
  // positions (so the result is a normal, freely-editable Bild afterward — no separate
  // "editable preset instance" concept needed).
  function applyFigure(figure){
    if(editingBetween){ editingBetween = null; updateBetweenEditBanner(); } // a new Bild always applies to the real timeline, not whatever Zwischenposition was being posed
    var t = figure.transform || {};
    var srcPos = currentFormation().pos;
    var newPos = {};
    Object.keys(srcPos).forEach(function(id){
      newPos[id] = {x:srcPos[id].x, y:srcPos[id].y, rot:srcPos[id].rot||0};
    });

    if(t.mode === 'couples'){
      var couples = figureCouples();
      if(!couples.length) return;
      var selCouple = couples.find(function(m){ return pairSelection.length === 2 && pairSelection.indexOf(m[0]) !== -1 && pairSelection.indexOf(m[1]) !== -1; });
      var targetPairs = selCouple ? [selCouple] : couples;
      targetPairs.forEach(function(members){
        var idA = members[0], idB = members[1];
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

    // startPos freezes exactly where the dancers stood right before this Figur was applied — the
    // Bild's own fixed "came from here" reference (see renderOnionSkin()), independent of whatever
    // Bild ends up sitting before this one later (reordering, deletes, further edits to srcPos).
    var f = { id: uid('f'), name: 'Bild ' + (state.formations.length+1), pos: newPos, showAxes: currentFormation().showAxes !== false, localAxes: copyLocalAxes(currentFormation()), category: '', startPos: snapshotPos(srcPos), splitPairs: [] };
    state.formations.push(f);
    state.activeIndex = state.formations.length - 1;
    saveState();
    renderFilmstrip();
    positionMarkers(currentFormation().pos);
    refreshRosterCoords();
    updatePlaybarInfo();
    updatePlayButton();
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
    var disabled = isCouples && !figureCouples().length;
    var row = document.createElement('div');
    row.className = 'figure-row';

    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'export-menu-item';
    item.disabled = disabled;
    var desc = fig.description || '';
    if(disabled) desc = 'Kein Paar in Lead & Follow aufgeteilt (Doppelklick auf einen Punkt teilt ihn)';
    item.innerHTML = '<strong></strong><span></span>';
    item.querySelector('strong').textContent = fig.name;
    item.querySelector('span').textContent = desc;
    if(!disabled) item.addEventListener('click', function(){ closeAddBildModal(); applyFigure(fig); });
    row.appendChild(item);

    if(opts.onDelete){
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'figure-delete';
      del.appendChild(svgIcon('x', 16));
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

  /* ---------- Zwischenpositionen: poses along a move that don't get their own Bild ----------
     Sit in the filmstrip's gap between the Bild they leave from and the next one (see
     renderFilmstrip()'s buildBetweenConnector call) rather than as cards of their own — no section
     number, no onion-skin ghost, nothing in the "NN / NN" counter. Posing one reuses the exact same
     stage/roster editing code a real Bild uses, via currentFormation()'s editingBetween override
     (state.js) — see interpolateThroughBetweens() there for how they play back. */

  function buildBetweenConnector(f, idx){
    var wrap = document.createElement('div');
    wrap.className = 'film-connector';
    var next = state.formations[idx + 1];

    var chips = document.createElement('div');
    chips.className = 'film-between-chips';
    (f.betweens || []).forEach(function(between, bIdx){
      var chipWrap = document.createElement('div');
      chipWrap.className = 'film-between-chip-wrap';

      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'film-between-chip' + (editingBetween && editingBetween.fIdx === idx && editingBetween.bIdx === bIdx ? ' active' : '');
      chip.textContent = String(bIdx + 1);
      chip.title = 'Zwischenposition ' + (bIdx + 1) + (between.name ? ' — ' + between.name : '')
        + ' bearbeiten — zwischen „' + f.name + '“ und „' + (next ? next.name : '?') + '“ (Rechtsklick zum Umbenennen)';
      chip.addEventListener('click', function(){ enterBetweenEdit(idx, bIdx); });
      chip.addEventListener('contextmenu', function(e){ e.preventDefault(); openBetweenRenamePopover(chip, idx, bIdx); });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'film-between-chip-remove';
      del.setAttribute('aria-label', 'Zwischenposition ' + (bIdx + 1) + ' entfernen');
      del.appendChild(svgIcon('x', 9, 3));
      armDeleteButton(del, function(){ removeBetween(idx, bIdx); });

      chipWrap.appendChild(chip);
      chipWrap.appendChild(del);
      chips.appendChild(chipWrap);
    });

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'film-between-add';
    addBtn.appendChild(svgIcon('plus', 12));
    addBtn.title = 'Zwischenposition hinzufügen — eine zusätzliche Pose auf dem Weg zu „' + (next ? next.name : '?') + '“, ohne eigenes Bild';
    addBtn.addEventListener('click', function(){ addBetween(idx); });

    wrap.appendChild(chips);
    if((f.betweens || []).length) wrap.appendChild(buildBetweenPathToggle(f, next));
    wrap.appendChild(addBtn);
    return wrap;
  }

  // Eckig ↔ abgerundet: whether the move runs in straight legs through its Zwischenpositionen or
  // in one flowing curve (see betweenPath / smoothLeg in state.js). Only shown once there is at
  // least one Zwischenposition — without any, the move is a single straight leg either way.
  function buildBetweenPathToggle(f, next){
    var smooth = sanitizeBetweenPath(f.betweenPath) === 'smooth';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'film-between-path' + (smooth ? ' smooth' : '');
    btn.setAttribute('aria-pressed', smooth ? 'true' : 'false');
    btn.setAttribute('aria-label', 'Weg abgerundet');
    btn.appendChild(svgIcon(smooth ? 'path-smooth' : 'path-corner', 14));
    btn.title = (smooth
      ? 'Weg abgerundet — fließend durch die Zwischenpositionen'
      : 'Weg eckig — direkt von Punkt zu Punkt durch die Zwischenpositionen')
      + ' auf dem Weg zu „' + (next ? next.name : '?') + '“ (klicken zum Umschalten)';
    btn.addEventListener('click', function(){
      f.betweenPath = smooth ? 'corner' : 'smooth';
      saveState();
      renderFilmstrip();
    });
    return btn;
  }

  // New Zwischenposition's starting pose: linearly interpolated between the two Bilder it sits
  // between, at whatever fraction its position among any existing ones implies — just a seed the
  // user then poses properly by dragging on the stage, same as a freshly duplicated Bild's pos.
  function addBetween(fIdx){
    var f = state.formations[fIdx];
    var next = state.formations[fIdx + 1];
    if(!f || !next) return;
    if(!Array.isArray(f.betweens)) f.betweens = [];
    var frac = (f.betweens.length + 1) / (f.betweens.length + 2);
    var pos = {};
    state.dancers.forEach(function(d){
      var a = f.pos[d.id] || {x:0, y:0, rot:0};
      var b = next.pos[d.id] || {x:0, y:0, rot:0};
      pos[d.id] = { x: a.x + (b.x-a.x)*frac, y: a.y + (b.y-a.y)*frac, rot: lerpAngle(a.rot||0, b.rot||0, frac) };
    });
    f.betweens.push({id: uid('bw'), name: '', pos: pos});
    saveState();
    renderFilmstrip();
    enterBetweenEdit(fIdx, f.betweens.length - 1);
  }

  function removeBetween(fIdx, bIdx){
    var f = state.formations[fIdx];
    if(!f || !Array.isArray(f.betweens)) return;
    f.betweens.splice(bIdx, 1);
    if(editingBetween && editingBetween.fIdx === fIdx){
      if(editingBetween.bIdx === bIdx){ exitBetweenEdit(); return; }
      if(editingBetween.bIdx > bIdx) editingBetween.bIdx -= 1;
    }
    saveState();
    renderFilmstrip();
  }

  function enterBetweenEdit(fIdx, bIdx){
    pausePlayback();
    // Also adopts fIdx as the active Bild — otherwise clicking a between chip on a connector
    // elsewhere in the filmstrip would pose that Zwischenposition while onion-skin, the "NN / NN"
    // counter and the gold active-card highlight all kept pointing at some unrelated Bild.
    state.activeIndex = fIdx;
    editingBetween = {fIdx: fIdx, bIdx: bIdx};
    renderFilmstrip(); // refreshes the chips' .active state (and the active-card highlight)
    positionMarkers(currentFormation().pos);
    refreshRosterCoords();
    updatePlaybarInfo();
    resetLayoutGhost();
    updateBetweenEditBanner();
    saveState();
  }

  function exitBetweenEdit(){
    if(!editingBetween) return;
    editingBetween = null;
    renderFilmstrip();
    positionMarkers(currentFormation().pos);
    refreshRosterCoords();
    updatePlaybarInfo();
    resetLayoutGhost();
    updateBetweenEditBanner();
  }

  function updateBetweenEditBanner(){
    var banner = document.getElementById('betweenEditBanner');
    if(!banner) return;
    if(!editingBetween){ banner.hidden = true; return; }
    var anchor = state.formations[editingBetween.fIdx];
    var next = state.formations[editingBetween.fIdx + 1];
    if(!anchor || !next){ banner.hidden = true; return; }
    var between = (anchor.betweens || [])[editingBetween.bIdx];
    var textEl = document.getElementById('betweenEditBannerText');
    if(textEl){
      textEl.textContent = 'Zwischenposition ' + (editingBetween.bIdx + 1) + (between && between.name ? ' — ' + between.name : '')
        + ' wird bearbeitet — zwischen „' + anchor.name + '“ und „' + next.name + '“';
    }
    banner.hidden = false;
  }

  var betweenEditDoneBtn = document.getElementById('betweenEditDoneBtn');
  if(betweenEditDoneBtn) betweenEditDoneBtn.addEventListener('click', exitBetweenEdit);

  // Right-click a between chip to rename it (see buildBetweenConnector) — a floating popover rather
  // than swapping the tiny 22px chip itself into a text field, which has no room for typing. Follows
  // this app's existing "commit as you type" convention (pair/dancer/Bild names all save on every
  // 'input' event, not on blur/Enter) — blur just closes the popover and refreshes the chip's
  // tooltip/banner text with whatever's already been saved.
  var betweenRenamePopoverEl = null;
  function closeBetweenRenamePopover(){
    if(betweenRenamePopoverEl){ betweenRenamePopoverEl.remove(); betweenRenamePopoverEl = null; }
  }
  function openBetweenRenamePopover(anchorEl, fIdx, bIdx){
    closeBetweenRenamePopover();
    var f = state.formations[fIdx];
    var between = f && f.betweens && f.betweens[bIdx];
    if(!between) return;

    var rect = anchorEl.getBoundingClientRect();
    var pop = document.createElement('div');
    pop.className = 'between-rename-popover';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'between-rename-input';
    input.maxLength = 40;
    input.placeholder = 'Zwischenposition ' + (bIdx + 1);
    input.value = between.name || '';
    input.setAttribute('aria-label', 'Name der Zwischenposition ' + (bIdx + 1));

    pop.appendChild(input);
    document.body.appendChild(pop);
    betweenRenamePopoverEl = pop;

    // Chips sit low in the filmstrip row, at roughly the same height as the Bild name fields either
    // side of them — anchoring the popover *below* the chip (like a normal dropdown) landed it right
    // on top of "Startlinie"/"Kreis" etc. Above the chip is clear space instead (the card previews
    // end well before the chip's own height), so open upward; only measurable once it's in the DOM.
    // The horizontal centering is also clamped so it can't run off either edge of the viewport for a
    // chip near the start/end of a scrolled filmstrip.
    var popRect = pop.getBoundingClientRect();
    var left = rect.left + rect.width / 2;
    left = Math.min(Math.max(left, popRect.width / 2 + 8), window.innerWidth - popRect.width / 2 - 8);
    pop.style.left = left + 'px';
    pop.style.top = (rect.top - popRect.height - 14) + 'px';

    input.focus();
    input.select();

    input.addEventListener('input', function(){
      between.name = input.value;
      saveState();
    });
    input.addEventListener('keydown', function(e){
      if(e.key === 'Enter' || e.key === 'Escape'){ e.preventDefault(); input.blur(); }
    });
    input.addEventListener('blur', function(){
      renderFilmstrip();
      if(editingBetween){
        updateBetweenEditBanner();
        updatePlaybarInfo(); // the playbar's Bild-name readout also carries a between's own name
      }
      closeBetweenRenamePopover();
    });
  }

  function renderFilmstrip(){
    // Keep the list where it was: clearing the track would otherwise jump it back to Bild 1.
    var keepTop = filmTrackEl.scrollTop, keepLeft = filmTrackEl.scrollLeft;
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
      categoryInput.spellcheck = false;
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
      categoryWrap.insertBefore(indexEl, categoryWrap.firstChild);

      var removeEl = document.createElement('button');
      removeEl.className = 'film-remove';
      removeEl.type = 'button';
      removeEl.appendChild(svgIcon('x', 12, 2.5));
      removeEl.setAttribute('aria-label', 'Bild "' + f.name + '" löschen');
      armDeleteButton(removeEl, function(){ deleteFormation(f.id); });

      var preview = document.createElement('div');
      preview.className = 'film-preview';
      preview.appendChild(removeEl);
      state.dancers.forEach(function(d){
        [d.id, followKey(d.id)].forEach(function(k){
          var pos = f.pos[k];
          if(!pos) return;
          var dot = document.createElement('span');
          dot.className = k === d.id ? 'film-dot' : 'film-dot film-dot-follow';
          dot.style.left = gridToPercent(pos.x) + '%';
          dot.style.top = gridToPercent(pos.y) + '%';
          dot.style.background = d.color;
          dot.dataset.dancer = k;
          preview.appendChild(dot);
        });
      });
      preview.addEventListener('click', function(){ selectFormation(idx); });

      var nameInput = document.createElement('textarea');
      nameInput.className = 'fname';
      nameInput.rows = 1;
      nameInput.spellcheck = false;
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
        // The Bilder list runs top-to-bottom on desktop and left-to-right on phones.
      var vertical = getComputedStyle(filmTrackEl).flexDirection === 'column';
      var before = vertical ? (e.clientY - rect.top) < rect.height / 2 : (e.clientX - rect.left) < rect.width / 2;
        filmTrackEl.insertBefore(dragEl, before ? card : card.nextSibling);
      });
      card.addEventListener('drop', function(e){ e.preventDefault(); });

      filmTrackEl.appendChild(card);
      autosizeFnameInput(nameInput);
      // Zwischenpositionen (see enterBetweenEdit() below) live in the gap after this Bild, so the
      // connector only makes sense while there's a next Bild to move to — never after the last one.
      if(idx < state.formations.length - 1) filmTrackEl.appendChild(buildBetweenConnector(f, idx));
    });

    var addWrap = document.createElement('div');
    addWrap.className = 'film-add-wrap';

    var addCard = document.createElement('button');
    addCard.className = 'film-add';
    addCard.type = 'button';
    addCard.appendChild(svgIcon('plus', 18));
    addCard.setAttribute('aria-label', 'Neues Bild hinzufügen');
    addCard.setAttribute('aria-haspopup', 'dialog');
    addCard.addEventListener('click', openAddBildModal);

    addWrap.appendChild(addCard);
    filmTrackEl.appendChild(addWrap);
    filmTrackEl.scrollTop = keepTop; filmTrackEl.scrollLeft = keepLeft;
    renumberFilmCategories();
    // Reordering/adding/deleting Bilder can leave the song time markers out of Bild order — keep the
    // toolbar Marker button's warning dot in sync (js/marker.js, loaded after this file).
    if(typeof updateMarkerWarnings === 'function') updateMarkerWarnings();
  }

  // Recomputes each section-start badge's running number without touching the
  // .film-category-input elements themselves — called after a full renderFilmstrip() and also
  // directly from a category input's own 'input' handler, so retyping a section name never loses
  // focus/cursor position the way a full re-render would.
  //
  // The number is per distinct section name, not a flat running count: typing "Langsamer Walzer"
  // gets "1." the first time it starts a section; a "Tango" section elsewhere in the sequence gets
  // its own "1."; a later section again named "Langsamer Walzer" automatically becomes "2." — so
  // the user only ever types the dance name itself ("Langsamer Walzer"), never a number.
  //
  // Consecutive Bilder sharing the same name (nothing of a different name between them) still
  // count as one run of the same dance and get the same number — a bump only happens the moment
  // the name actually changes to something else, not just because the field was typed again
  // instead of left blank.
  function renumberFilmCategories(){
    var wraps = filmTrackEl.querySelectorAll('.film-category');
    var counts = {}; // normalized section name -> how many separate runs of that name seen so far
    var prevKey = null; // the previous Bild's own effective (non-blank) category, normalized
    wraps.forEach(function(wrap, i){
      var f = state.formations[i];
      var numEl = wrap.querySelector('.film-category-num');
      var text = f && f.category ? f.category.trim() : '';
      if(text){
        var key = text.toLowerCase();
        if(key !== prevKey) counts[key] = (counts[key] || 0) + 1;
        numEl.textContent = counts[key] + '.';
        numEl.hidden = false;
        prevKey = key;
      }else{
        numEl.hidden = true;
        // blank continues whatever the previous Bild's name was — prevKey stays as-is
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
    if(editingBetween){ editingBetween = null; updateBetweenEditBanner(); }
    var src = currentFormation();
    var copy = {};
    Object.keys(src.pos).forEach(function(k){ copy[k] = {x:src.pos[k].x, y:src.pos[k].y, rot:src.pos[k].rot||0}; });
    // startPos freezes the position this new Bild starts from (identical to `copy` right now, but
    // kept as an independent object — see snapshotPos — so later dragging dancers within this new
    // Bild, or editing the Bild before it, never changes what this Bild remembers as its own start).
    var f = { id: uid('f'), name: 'Bild ' + (state.formations.length+1), pos: copy, showAxes: src.showAxes !== false, localAxes: copyLocalAxes(src), category: '', startPos: snapshotPos(src.pos), splitPairs: [] };
    state.formations.push(f);
    state.activeIndex = state.formations.length - 1;
    saveState();
    renderFilmstrip();
    positionMarkers(currentFormation().pos);
    refreshRosterCoords();
    updatePlaybarInfo();
    updatePlayButton();
    resetLayoutGhost();
  }

  function deleteFormation(id){
    if(state.formations.length <= 1) return;
    var idx = state.formations.findIndex(function(f){ return f.id === id; });
    if(idx < 0) return;
    if(editingBetween){ editingBetween = null; updateBetweenEditBanner(); } // deleting a Bild can shift every fIdx after it — simplest to just drop out
    var wasActive = idx === state.activeIndex;
    state.formations.splice(idx, 1);
    if(state.activeIndex >= state.formations.length) state.activeIndex = state.formations.length - 1;
    else if(idx < state.activeIndex) state.activeIndex -= 1;
    saveState();
    renderFilmstrip();
    if(wasActive){ positionMarkers(currentFormation().pos); refreshRosterCoords(); resetLayoutGhost(); }
    updatePlaybarInfo();
    updatePlayButton();
  }

  function selectFormation(idx){
    pausePlayback();
    if(editingBetween){ editingBetween = null; updateBetweenEditBanner(); }
    state.activeIndex = idx;
    saveState();
    renderFilmstrip();
    positionMarkers(currentFormation().pos);
    refreshRosterCoords();
    updatePlaybarInfo();
    resetLayoutGhost();
  }

  // Reconciles state.formations to match whatever order the drag-hover live-preview (see the
  // dragover handler in renderFilmstrip) already put the DOM cards in, then does one clean
  // re-render to normalize index badges/listeners. Called once on dragend, never mid-drag.
  function commitFilmstripOrder(){
    if(editingBetween){ editingBetween = null; updateBetweenEditBanner(); } // reordering changes what every fIdx even refers to
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
