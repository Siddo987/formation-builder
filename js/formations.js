"use strict";

/* ---------- formations / filmstrip ---------- */

  var dragSourceId = null;
  var betweenDragEl = null; // the chip wrap being dragged to reorder Zwischenpositionen (#2062, #2070)

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
    newPos[id] = { x: clampX(nx), y: clampY(ny), rot: normAngle((p.rot||0) + deg) };
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
    var paused = pausedMidMove(); // js/playback.js — paused mid-move: applies to the pose shown there
    var srcPos = paused ? roundedPoseAt(paused.fromIdx, paused.t) : currentFormation().pos;
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
    placeNewBild(f, paused);
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
    var next = state.formations[idx + 1];
    var turns = next ? moveTurnSummary(f) : null;
    wrap.className = 'film-connector' + (sanitizeSpeedCurve(f.speedCurve) ? ' speed-set' : '') + (turns ? ' turn-set' : '');
    wrap.dataset.f = idx;

    var chips = document.createElement('div');
    chips.className = 'film-between-chips';
    (f.betweens || []).forEach(function(between, bIdx){
      var chipWrap = document.createElement('div');
      chipWrap.className = 'film-between-chip-wrap';
      chipWrap.draggable = true;
      chipWrap.dataset.f = idx; chipWrap.dataset.b = bIdx;
      chipWrap.addEventListener('dragstart', function(e){
        betweenDragEl = chipWrap;
        chipWrap.classList.add('dragging');
        if(e.dataTransfer){
          e.dataTransfer.effectAllowed = 'move';
          try{ e.dataTransfer.setData('text/plain', 'bw'); }catch(err){}
        }
      });
      // Like the Bild cards: the DOM previews the new place while dragging, the data follows once.
      chipWrap.addEventListener('dragend', function(){
        chipWrap.classList.remove('dragging');
        betweenDragEl = null;
        var to = chipWrap.closest('.film-connector');
        if(!to) return;
        moveBetween(idx, bIdx, +to.dataset.f, Array.prototype.indexOf.call(chipWrap.parentNode.children, chipWrap));
      });

      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'film-between-chip' + (editingBetween && editingBetween.fIdx === idx && editingBetween.bIdx === bIdx ? ' active' : '');
      chip.dataset.f = idx; chip.dataset.b = bIdx; // renderFilmstripActiveOnly (playback.js)
      chip.textContent = String(bIdx + 1);
      chip.title = 'Zwischenposition ' + (bIdx + 1) + (between.name ? ' — ' + between.name : '')
        + ' bearbeiten — zwischen „' + f.name + '“ und „' + (next ? next.name : '?') + '“ (umbenennen per Rechtsklick oder mit dem Stift in der Leiste über der Bühne, verschieben per Ziehen — auch in eine andere Lücke)';
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

    // Dropping a dragged Zwischenposition here — between its chips, or into an empty gap.
    wrap.addEventListener('dragover', function(e){
      if(!betweenDragEl) return;
      e.preventDefault();
      var over = e.target.closest && e.target.closest('.film-between-chip-wrap');
      if(over === betweenDragEl) return;
      if(!over || over.parentNode !== chips){ if(betweenDragEl.parentNode !== chips) chips.appendChild(betweenDragEl); return; }
      var rect = over.getBoundingClientRect();
      var before = getComputedStyle(chips).flexDirection === 'column' ? (e.clientY - rect.top) < rect.height / 2 : (e.clientX - rect.left) < rect.width / 2;
      chips.insertBefore(betweenDragEl, before ? over : over.nextSibling);
    });
    wrap.addEventListener('drop', function(e){ if(betweenDragEl) e.preventDefault(); });

    wrap.appendChild(chips);
    wrap.appendChild(addBtn);
    wrap.appendChild(buildSpeedCurveButton(f, next));
    if(turns) wrap.appendChild(buildCoupleTurnBadge(turns, idx));
    return wrap;
  }

  // Every Drehung im Paar and Eigendrehung set anywhere on the move out of Bild `f` — on the Bild
  // itself (its first leg) or on one of its Zwischenpositionen (the leg after it) — as one line per
  // stop that has any, or null if none does.
  function moveTurnSummary(f){
    var lines = [];
    [f].concat(f.betweens || []).forEach(function(stop, i){
      var parts = [];
      var turns = sanitizeCoupleTurns(stop.coupleTurns), spins = sanitizeSpins(stop.spins);
      if(turns) Object.keys(turns).forEach(function(k){ parts.push(markerDisplayName(k) + ' ' + roundNum(turns[k]) + '°'); });
      if(spins) Object.keys(spins).forEach(function(k){ parts.push(markerDisplayName(k) + ' Eigendrehung ' + roundNum(spins[k]) + '°'); });
      (sanitizeOrbits(stop.orbits) || []).forEach(function(g){ parts.push('Kreisbahn ' + roundNum(g.turn) + '° (' + g.ids.length + ' Punkte)'); });
      if(parts.length) lines.push((i ? 'ab Zwischenposition ' + i : 'ab „' + f.name + '“') + ': ' + parts.join(', '));
    });
    return lines.length ? lines : null;
  }

  // Marks a move with a set Drehung im Paar, Eigendrehung or Kreisbahn (set in the selection bar under the
  // stage, in the Bild or in one of its Zwischenpositionen).
  function buildCoupleTurnBadge(lines, fIdx){
    var badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'film-between-turn';
    badge.dataset.f = fIdx;
    badge.setAttribute('aria-label', 'Übersicht der Drehungen');
    badge.setAttribute('aria-haspopup', 'dialog');
    badge.appendChild(svgIcon('turn', 12));
    badge.title = 'Drehungen auf dem Weg zu „' + state.formations[fIdx + 1].name + '“ — ' + lines.join('; ') + ' (klicken für die Übersicht)';
    badge.addEventListener('click', function(){
      if(turnOverviewEl && turnOverviewEl.dataset.f === String(fIdx)){ closeTurnOverview(); return; }
      openTurnOverview(badge, fIdx);
    });
    return badge;
  }

  // Übersicht der Drehungen (#2050): everything set on the move out of Bild fIdx, leg by leg —
  // every Drehung runs to the next stop, Bild or Zwischenposition. First each couple's Paardrehung,
  // then each person's Eigendrehung, then the Kreisbahnen.
  var turnOverviewEl = null;
  function closeTurnOverview(){
    if(!turnOverviewEl) return;
    turnOverviewEl.remove();
    turnOverviewEl = null;
    document.removeEventListener('pointerdown', onTurnOverviewOutside, true);
    document.removeEventListener('keydown', onTurnOverviewKey);
  }
  function onTurnOverviewOutside(e){
    if(turnOverviewEl.contains(e.target) || (e.target.closest && e.target.closest('.film-between-turn'))) return;
    closeTurnOverview();
  }
  function onTurnOverviewKey(e){ if(e.key === 'Escape') closeTurnOverview(); }
  function openTurnOverview(anchorEl, fIdx){
    closeTurnOverview();
    var f = state.formations[fIdx], next = state.formations[fIdx + 1];
    var stops = [f].concat(f.betweens || []);
    function toName(i){ var b = (f.betweens || [])[i]; return b ? (b.name || 'Zwischenposition ' + (i + 1)) : next.name; }
    function part(v, i){ return roundNum(Math.abs(v)) + '° ' + (v > 0 ? '↻' : '↺') + (stops.length > 1 ? ' bis „' + toName(i) + '“' : ''); }
    function order(k){ return state.dancers.findIndex(function(d){ return d.id === baseDancerId(k); }) * 2 + (isFollowKey(k) ? 1 : 0); }
    var pop = document.createElement('div');
    pop.className = 'between-rename-popover turn-overview';
    pop.dataset.f = fIdx;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Drehungen bis „' + next.name + '“');
    var head = document.createElement('h4');
    head.textContent = 'Drehungen bis „' + next.name + '“';
    pop.appendChild(head);
    function section(title, rows){
      if(!rows.length) return;
      var h = document.createElement('h5');
      h.textContent = title;
      pop.appendChild(h);
      rows.forEach(function(r){
        var row = document.createElement('p');
        var who = document.createElement('b');
        who.textContent = r.who;
        row.appendChild(who);
        row.appendChild(document.createTextNode(' ' + r.parts.join(' · ')));
        pop.appendChild(row);
      });
    }
    ['coupleTurns', 'spins'].forEach(function(field){
      var byKey = {};
      stops.forEach(function(s, i){
        var set = sanitizeCoupleTurns(s[field]);
        if(set) Object.keys(set).forEach(function(k){ (byKey[k] = byKey[k] || []).push(part(set[k], i)); });
      });
      section(field === 'spins' ? 'Eigendrehung' : 'Paardrehung', Object.keys(byKey).sort(function(a, b){ return order(a) - order(b); }).map(function(k){
        return {who: markerDisplayName(k), parts: byKey[k]};
      }));
    });
    var orbits = [];
    stops.forEach(function(s, i){
      (sanitizeOrbits(s.orbits) || []).forEach(function(g){ orbits.push({who: g.ids.map(markerDisplayName).join(', ') + ':', parts: [part(g.turn, i)]}); });
    });
    section('Kreisbahn', orbits);
    var legend = document.createElement('p');
    legend.className = 'turn-overview-legend';
    legend.textContent = '↻ im Uhrzeigersinn, ↺ dagegen';
    pop.appendChild(legend);
    document.body.appendChild(pop);
    turnOverviewEl = pop;
    var rect = anchorEl.getBoundingClientRect(), pr = pop.getBoundingClientRect();
    pop.style.left = Math.min(Math.max(rect.left + rect.width / 2, pr.width / 2 + 8), window.innerWidth - pr.width / 2 - 8) + 'px';
    var top = rect.bottom + 8;
    if(top + pr.height > window.innerHeight - 8) top = Math.max(8, rect.top - pr.height - 8);
    pop.style.top = top + 'px';
    document.addEventListener('pointerdown', onTurnOverviewOutside, true);
    document.addEventListener('keydown', onTurnOverviewKey);
  }

  // Opens the Geschwindigkeitsverlauf graph for the move out of this Bild (see speedEase in
  // state.js). Like the "+", it only shows on hover while the move uses the standard profile;
  // once a curve is drawn it stays visible, highlighted, so the gap shows that it's not standard.
  function buildSpeedCurveButton(f, next){
    var custom = !!sanitizeSpeedCurve(f.speedCurve);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'film-between-speed' + (custom ? ' custom' : '');
    btn.dataset.fid = f.id;
    btn.setAttribute('aria-label', 'Geschwindigkeitsverlauf');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.appendChild(svgIcon('speed', 14));
    btn.title = 'Geschwindigkeitsverlauf auf dem Weg zu „' + (next ? next.name : '?') + '“ — '
      + (custom ? 'eigener Verlauf' : 'Standard') + ' (klicken zum Bearbeiten)';
    btn.addEventListener('click', function(){
      if(speedPopover && speedPopover.fid === f.id){ closeSpeedCurvePopover(); return; }
      openSpeedCurvePopover(btn, f.id);
    });
    return btn;
  }

  /* ---------- Geschwindigkeitsverlauf: speed over the course of one move, drawn as a graph ----------
     SPEED_SAMPLES handles from Start to Ziel; dragging sets the one nearest the pointer to its height
     (and fills any skipped in between, so a sweep draws the whole curve). Edits go straight into the
     Bild — looked up by id each time, so an undo while the popover is open can't strand it on a
     stale object — and are saved once the pointer is released. */
  var SPEED_PRESETS = [
    {label: 'Standard', curve: null},
    {label: 'Gleichmäßig', curve: [1, 1, 1, 1, 1]},
    {label: 'Sanft', curve: [0.1, 0.7, 1, 0.7, 0.1]},
    {label: 'Beschleunigen', curve: [0.1, 0.35, 0.6, 0.85, 1]},
    {label: 'Abbremsen', curve: [1, 0.85, 0.6, 0.35, 0.1]}
  ];
  var speedPopover = null;
  function closeSpeedCurvePopover(){
    if(!speedPopover) return;
    document.removeEventListener('pointerdown', speedPopover.onOutside, true);
    document.removeEventListener('keydown', speedPopover.onKey);
    speedPopover.el.remove();
    speedPopover = null;
  }
  function openSpeedCurvePopover(anchorEl, fid){
    closeSpeedCurvePopover();
    function bild(){ return state.formations.find(function(ff){ return ff.id === fid; }); }
    function nextBild(){ var i = state.formations.indexOf(bild()); return i >= 0 ? state.formations[i + 1] : null; }
    if(!bild() || !nextBild()) return;

    var W = 240, H = 120, PAD = 8, n = SPEED_SAMPLES;
    var pop = document.createElement('div');
    pop.className = 'speed-curve-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Geschwindigkeitsverlauf');

    var head = document.createElement('div');
    head.className = 'speed-curve-head';
    var title = document.createElement('div');
    title.className = 'speed-curve-title';
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'speed-curve-close';
    closeBtn.setAttribute('aria-label', 'Schließen');
    closeBtn.appendChild(svgIcon('x', 12));
    closeBtn.addEventListener('click', closeSpeedCurvePopover);
    head.appendChild(title);
    head.appendChild(closeBtn);

    var plot = document.createElement('div');
    plot.className = 'speed-curve-plot';
    var yLab = document.createElement('div');
    yLab.className = 'speed-curve-ylab';
    yLab.innerHTML = '<span>schnell</span><span>langsam</span>';
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'speed-curve-graph');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-label', 'Geschwindigkeitsverlauf — Pfeiltasten links/rechts wählen einen Punkt, hoch/runter ändern das Tempo');
    function svgEl(tag, cls){ var el = document.createElementNS(SVG_NS, tag); if(cls) el.setAttribute('class', cls); svg.appendChild(el); return el; }
    for(var g = 1; g < n - 1; g++){
      var gl = svgEl('line', 'speed-curve-grid');
      gl.setAttribute('x1', px(g)); gl.setAttribute('x2', px(g)); gl.setAttribute('y1', PAD); gl.setAttribute('y2', H - PAD);
    }
    var area = svgEl('path', 'speed-curve-area');
    var line = svgEl('path', 'speed-curve-line');
    var dots = [];
    for(var d = 0; d < n; d++) dots.push(svgEl('circle', 'speed-curve-dot'));
    plot.appendChild(yLab);
    plot.appendChild(svg);
    var xLab = document.createElement('div');
    xLab.className = 'speed-curve-xlab';
    xLab.innerHTML = '<span>Start</span><span>Ziel</span>';

    var presets = document.createElement('div');
    presets.className = 'speed-curve-presets';
    var presetBtns = SPEED_PRESETS.map(function(pr){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'speed-curve-preset';
      b.textContent = pr.label;
      b.addEventListener('click', function(){ commit(pr.curve ? pr.curve.slice() : null); });
      presets.appendChild(b);
      return b;
    });

    var hint = document.createElement('p');
    hint.className = 'speed-curve-hint';
    hint.textContent = 'Die Form zählt, nicht die Höhe – die Kurve wird auf Strecke und Dauer der Bewegung skaliert.';

    pop.appendChild(head);
    pop.appendChild(plot);
    pop.appendChild(xLab);
    pop.appendChild(presets);
    pop.appendChild(hint);
    document.body.appendChild(pop);

    function px(i){ return PAD + (W - 2*PAD) * i / (n - 1); }
    function py(v){ return H - PAD - (H - 2*PAD) * v; }
    var focusIdx = 0;
    function shown(){ return sanitizeSpeedCurve(bild() && bild().speedCurve) || STANDARD_SPEED_CURVE; }
    function redraw(){
      var f = bild(), nx = nextBild();
      if(!f || !nx){ closeSpeedCurvePopover(); return; }
      var custom = !!sanitizeSpeedCurve(f.speedCurve), c = shown();
      title.textContent = '„' + f.name + '“ → „' + nx.name + '“';
      pop.classList.toggle('custom', custom);
      var pts = c.map(function(v, i){ return px(i).toFixed(1) + ',' + py(v).toFixed(1); });
      line.setAttribute('d', 'M' + pts.join('L'));
      area.setAttribute('d', 'M' + px(0) + ',' + py(0) + 'L' + pts.join('L') + 'L' + px(n - 1) + ',' + py(0) + 'Z');
      dots.forEach(function(dot, i){
        dot.setAttribute('cx', px(i)); dot.setAttribute('cy', py(c[i])); dot.setAttribute('r', i === focusIdx && svg === document.activeElement ? 6 : 4.5);
        dot.classList.toggle('focus', i === focusIdx && svg === document.activeElement);
      });
      presetBtns.forEach(function(b, i){
        var pc = SPEED_PRESETS[i].curve;
        b.classList.toggle('active', custom ? !!pc && pc.every(function(v, k){ return Math.abs(v - c[k]) < 0.005; }) : !pc);
      });
    }
    // Live edits only touch the Bild; the save (history snapshot, persistence) and the filmstrip
    // refresh happen once per gesture, in commit().
    function setCurve(c){
      var f = bild();
      if(!f) return;
      if(c && Math.max.apply(null, c) < 0.05) c[focusIdx] = 0.05;
      f.speedCurve = sanitizeSpeedCurve(c);
      redraw();
    }
    function commit(c){
      if(arguments.length) setCurve(c);
      saveState();
      renderFilmstrip();
    }

    var dragging = false, lastIdx = null;
    function applyPointer(e){
      var r = svg.getBoundingClientRect();
      var fx = ((e.clientX - r.left) / r.width * W - PAD) / (W - 2*PAD);
      var fy = ((e.clientY - r.top) / r.height * H - PAD) / (H - 2*PAD);
      var i = Math.max(0, Math.min(n - 1, Math.round(fx * (n - 1))));
      var v = Math.max(0, Math.min(1, 1 - fy));
      var c = shown().slice();
      if(lastIdx !== null && Math.abs(i - lastIdx) > 1){
        var step = i > lastIdx ? 1 : -1, v0 = c[lastIdx];
        for(var k = lastIdx + step; k !== i; k += step) c[k] = v0 + (v - v0) * (k - lastIdx) / (i - lastIdx);
      }
      c[i] = v;
      focusIdx = lastIdx = i;
      setCurve(c);
    }
    svg.addEventListener('pointerdown', function(e){
      e.preventDefault();
      svg.focus();
      dragging = true; lastIdx = null;
      svg.setPointerCapture(e.pointerId);
      applyPointer(e);
    });
    svg.addEventListener('pointermove', function(e){ if(dragging) applyPointer(e); });
    function endDrag(){ if(!dragging) return; dragging = false; commit(); }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('focus', redraw);
    svg.addEventListener('blur', redraw);
    svg.addEventListener('keydown', function(e){
      if(e.key === 'ArrowLeft' || e.key === 'ArrowRight'){
        e.preventDefault();
        focusIdx = Math.max(0, Math.min(n - 1, focusIdx + (e.key === 'ArrowLeft' ? -1 : 1)));
        redraw();
      }else if(e.key === 'ArrowUp' || e.key === 'ArrowDown'){
        e.preventDefault();
        var c = shown().slice(), delta = (e.shiftKey ? 0.2 : 0.05) * (e.key === 'ArrowUp' ? 1 : -1);
        c[focusIdx] = Math.max(0, Math.min(1, Math.round((c[focusIdx] + delta) * 100) / 100));
        commit(c);
      }
    });

    // Right of the button if the filmstrip column leaves room (desktop), otherwise above it (the
    // phone's horizontal filmstrip sits at the bottom) — clamped into the viewport either way.
    var rect = anchorEl.getBoundingClientRect(), popRect = pop.getBoundingClientRect();
    var left, top;
    if(rect.right + 12 + popRect.width <= window.innerWidth - 8){
      left = rect.right + 12;
      top = rect.top + rect.height / 2 - popRect.height / 2;
    }else{
      left = rect.left + rect.width / 2 - popRect.width / 2;
      top = rect.top - popRect.height - 12;
    }
    pop.style.left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(top, window.innerHeight - popRect.height - 8)) + 'px';

    speedPopover = {
      el: pop, fid: fid,
      onOutside: function(e){
        if(pop.contains(e.target)) return;
        var b = e.target.closest && e.target.closest('.film-between-speed');
        if(b && b.dataset.fid === fid) return; // its own click handler toggles it closed
        closeSpeedCurvePopover();
      },
      onKey: function(e){ if(e.key === 'Escape') closeSpeedCurvePopover(); }
    };
    document.addEventListener('pointerdown', speedPopover.onOutside, true);
    document.addEventListener('keydown', speedPopover.onKey);
    redraw();
  }

  // What playback shows `t` (share of the move's time) into the move out of Bild fIdx, split
  // couples and speed curve included, rounded like a hand-placed pose.
  function roundedPoseAt(fIdx, t){
    var seen = interpolateThroughBetweens(fIdx, fIdx + 1, t);
    var pos = {};
    Object.keys(seen).forEach(function(k){
      var p = seen[k];
      pos[k] = {x: Math.round(p.x*100)/100, y: Math.round(p.y*100)/100, rot: normAngle(Math.round(p.rot*10)/10)};
    });
    return pos;
  }

  // A new stop `into` splits the leg `leaving` starts: a Drehung im Paar, Eigendrehung or Kreisbahn set on it
  // is shared out — `share` stays on `leaving`, the rest moves on with `into` — so the move still
  // turns as far in total.
  function splitLegTurns(leaving, into, share){
    ['coupleTurns', 'spins'].forEach(function(field){
      var set = sanitizeCoupleTurns(leaving[field]);
      if(!set) return;
      var first = {}, rest = {};
      Object.keys(set).forEach(function(k){
        first[k] = Math.round(set[k] * share * 10) / 10;
        rest[k] = Math.round((set[k] - first[k]) * 10) / 10;
      });
      if(sanitizeCoupleTurns(first)) leaving[field] = sanitizeCoupleTurns(first); else delete leaving[field];
      if(sanitizeCoupleTurns(rest)) into[field] = sanitizeCoupleTurns(rest);
    });
    var orbits = sanitizeOrbits(leaving.orbits);
    if(!orbits) return;
    var firstTurns = orbits.map(function(g){ return Math.round(g.turn * share * 10) / 10; });
    leaving.orbits = sanitizeOrbits(orbits.map(function(g, i){ return {ids: g.ids, turn: firstTurns[i]}; }));
    into.orbits = sanitizeOrbits(orbits.map(function(g, i){ return {ids: g.ids.slice(), turn: g.turn - firstTurns[i]}; }));
    if(!leaving.orbits) delete leaving.orbits;
    if(!into.orbits) delete into.orbits;
  }

  // New Zwischenposition's starting pose: a plain copy of the selected Bild (or Zwischenposition),
  // like a freshly duplicated Bild — not the half-way pose of the move. Paused in this move: timed
  // to that moment (#2031); otherwise after the last one so far, untimed, so spread like the
  // others (see betweenAnchors).
  function addBetween(fIdx){
    var f = state.formations[fIdx];
    var next = state.formations[fIdx + 1];
    if(!f || !next) return;
    if(!Array.isArray(f.betweens)) f.betweens = [];
    var paused = pausedMidMove(); // js/playback.js
    var before = betweenAnchors(fIdx, fIdx + 1);
    var between = {id: uid('bw'), name: '', pos: {}};
    var at, idx, target;
    if(paused && paused.fromIdx === fIdx){
      at = paused.t;
      between.at = sanitizeBetweenAt(at);
      idx = betweenTimes(fIdx).filter(function(bt){ return bt < at; }).length;
      target = moveEase(fIdx, fIdx + 1, at);
    }else{
      idx = f.betweens.length;
      f.betweens.push({pos: {}});
      target = betweenAnchors(fIdx, fIdx + 1)[idx + 1];
      f.betweens.pop();
      var lo = 0, hi = 1;
      for(var i = 0; i < 40; i++){
        var mid = (lo + hi) / 2;
        if(moveEase(fIdx, fIdx + 1, mid) < target) lo = mid; else hi = mid;
      }
      at = (lo + hi) / 2;
    }
    var src = currentFormation().pos;
    Object.keys(src).forEach(function(k){ between.pos[k] = {x: src[k].x, y: src[k].y, rot: src[k].rot || 0}; });
    var legStart = before[idx], legEnd = before[idx + 1];
    splitLegTurns(idx ? f.betweens[idx - 1] : f, between, legEnd > legStart ? Math.min(1, Math.max(0, (target - legStart) / (legEnd - legStart))) : 0.5);
    f.betweens.splice(idx, 0, between);
    saveState();
    renderFilmstrip();
    enterBetweenEdit(fIdx, idx);
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

  // Within its own move it takes the new place but the times stay where they were (the 2nd
  // Zwischenposition stays at the 2nd one's time); into another move it goes untimed, spread like
  // the others there.
  function moveBetween(fromF, fromB, toF, toB){
    var src = (state.formations[fromF] || {}).betweens, dst = state.formations[toF];
    var b = src && src[fromB];
    if(!b || !dst || toF >= state.formations.length - 1 || (fromF === toF && fromB === toB)){ renderFilmstrip(); return; }
    var edited = editingBetween ? (state.formations[editingBetween.fIdx].betweens || [])[editingBetween.bIdx] : null;
    var ats = src.map(function(x){ return x.at; });
    src.splice(fromB, 1);
    if(fromF === toF){
      src.splice(toB, 0, b);
      src.forEach(function(x, i){ if(ats[i] === undefined) delete x.at; else x.at = ats[i]; });
    }else{
      delete b.at;
      if(!Array.isArray(dst.betweens)) dst.betweens = [];
      dst.betweens.splice(toB, 0, b);
    }
    if(edited){
      var fIdx = state.formations.findIndex(function(f){ return (f.betweens || []).indexOf(edited) >= 0; });
      enterBetweenEdit(fIdx, state.formations[fIdx].betweens.indexOf(edited)); // saves and re-renders
      return;
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
      textEl.title = textEl.textContent; // the text is cut off with "…" when the toolbar is narrow
    }
    updateBetweenTimeInput();
    banner.hidden = false;
  }

  // When the edited Zwischenposition is reached: a time in the song (m:ss.s) when both Bilder
  // around it have a time marker, otherwise a share of the move in %. Empty = spread evenly with the
  // other untimed ones, and the placeholder shows where that puts it. Stored as `at`, a share of the
  // move's time either way (see sanitizeBetweenAt in state.js), so it follows when the markers move.
  var betweenEditTimeInput = document.getElementById('betweenEditTime');
  function betweenTimeSpan(fIdx){
    var t0 = formationTime(state.formations[fIdx]), t1 = formationTime(state.formations[fIdx + 1]);
    return t0 !== null && t1 !== null && t1 > t0 ? {t0: t0, t1: t1} : null;
  }
  function formatBetweenAt(fIdx, at){
    var span = betweenTimeSpan(fIdx);
    if(span) return formatTime(span.t0 + (span.t1 - span.t0) * at);
    return roundNum(Math.round(at * 1000) / 10) + ' %';
  }
  function updateBetweenTimeInput(){
    if(!betweenEditTimeInput || !editingBetween) return;
    var fIdx = editingBetween.fIdx, between = (state.formations[fIdx].betweens || [])[editingBetween.bIdx];
    if(!between) return;
    var span = betweenTimeSpan(fIdx), at = sanitizeBetweenAt(between.at);
    var auto = betweenTimes(fIdx)[editingBetween.bIdx];
    betweenEditTimeInput.value = at === null ? '' : formatBetweenAt(fIdx, at);
    betweenEditTimeInput.placeholder = typeof auto === 'number' ? formatBetweenAt(fIdx, auto) : '';
    betweenEditTimeInput.title = 'Wann diese Zwischenposition erreicht wird — '
      + (span ? 'Zeit im Lied (m:ss.s)' : 'Anteil der Bewegung in % (mit Zeitmarkern an beiden Bildern als Zeit im Lied)')
      + '. Leer = gleichmäßig verteilt.';
  }
  // Also used by the Marker dialog (js/marker.js, #2068).
  function setBetweenAt(fIdx, bIdx, at){
    var list = state.formations[fIdx].betweens || [], between = list[bIdx];
    if(!between) return;
    if(at === null) delete between.at;
    else {
      // Stays between the nearest timed Zwischenpositionen before and after it.
      var lo = 0, hi = 1;
      for(var i = bIdx - 1; i >= 0; i--){ var a = sanitizeBetweenAt(list[i].at); if(a !== null){ lo = a; break; } }
      for(var j = bIdx + 1; j < list.length; j++){ var b = sanitizeBetweenAt(list[j].at); if(b !== null){ hi = b; break; } }
      between.at = sanitizeBetweenAt(Math.min(hi - 0.001, Math.max(lo + 0.001, at)));
      if(between.at === null) delete between.at;
    }
    saveState();
    updateBetweenTimeInput();
    updatePlaybarInfo();
  }
  if(betweenEditTimeInput) betweenEditTimeInput.addEventListener('change', function(){
    if(!editingBetween) return;
    var fIdx = editingBetween.fIdx, bIdx = editingBetween.bIdx;
    if(!(state.formations[fIdx].betweens || [])[bIdx]) return;
    var raw = betweenEditTimeInput.value.trim(), span = betweenTimeSpan(fIdx), at = null;
    if(raw){
      if(span){
        var sec = parseTimeInput(raw);
        if(sec !== null) at = (sec - span.t0) / (span.t1 - span.t0);
      } else {
        var pct = parseFloat(raw.replace('%', '').replace(',', '.'));
        if(isFinite(pct)) at = pct / 100;
      }
    }
    setBetweenAt(fIdx, bIdx, at);
  });

  // Notiz (#2055) on what the stage shows — the Zwischenposition being edited, else the Bild — opened
  // from the toolbar button, which is marked while there is one. Goes into the Schritte-PDF.
  var noteBtn = document.getElementById('noteBtn');
  var notePopoverEl = null;
  function noteStop(){
    if(editingBetween) return (state.formations[editingBetween.fIdx].betweens || [])[editingBetween.bIdx] || null;
    return state.formations[state.activeIndex] || null;
  }
  function updateNoteBtn(){
    var note = (noteStop() || {}).note;
    noteBtn.classList.toggle('active', !!note);
    noteBtn.title = note || 'Notiz zu diesem Bild – erscheint auf Wunsch in der Schritte-PDF';
  }
  function closeNotePopover(){
    if(notePopoverEl){ notePopoverEl.remove(); notePopoverEl = null; }
  }
  // Keeps the textarea focused, so a click on the button while it's open closes it instead of
  // closing (blur) and reopening.
  noteBtn.addEventListener('mousedown', function(e){ if(notePopoverEl) e.preventDefault(); });
  noteBtn.addEventListener('click', function(){
    if(notePopoverEl){ notePopoverEl.querySelector('textarea').blur(); return; }
    var stop = noteStop();
    if(!stop) return;
    var pop = document.createElement('div');
    pop.className = 'between-rename-popover note-popover';
    var area = document.createElement('textarea');
    area.className = 'note-input';
    area.maxLength = NOTE_MAX;
    area.rows = 4;
    area.value = stop.note || '';
    area.placeholder = 'Notiz zu „' + currentFormation().name + '“';
    area.setAttribute('aria-label', area.placeholder);
    area.readOnly = !!state.shareReadOnly;
    pop.appendChild(area);
    document.body.appendChild(pop);
    notePopoverEl = pop;
    var rect = noteBtn.getBoundingClientRect(), w = pop.getBoundingClientRect().width;
    pop.style.left = Math.min(Math.max(rect.left + rect.width / 2, w / 2 + 8), window.innerWidth - w / 2 - 8) + 'px';
    pop.style.top = (rect.bottom + 8) + 'px';
    area.focus();
    area.addEventListener('input', function(){
      if(area.value.trim()) stop.note = area.value; else delete stop.note;
      saveState();
      updateNoteBtn();
    });
    area.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); area.blur(); }
    });
    area.addEventListener('blur', closeNotePopover);
  });

  var betweenEditDoneBtn = document.getElementById('betweenEditDoneBtn');
  if(betweenEditDoneBtn) betweenEditDoneBtn.addEventListener('click', exitBetweenEdit);
  // The pencil in the banner — renaming without a right-click, which touch devices don't have.
  var betweenEditRenameBtn = document.getElementById('betweenEditRenameBtn');
  if(betweenEditRenameBtn) betweenEditRenameBtn.addEventListener('click', function(){
    if(editingBetween) openBetweenRenamePopover(betweenEditRenameBtn, editingBetween.fIdx, editingBetween.bIdx, true);
  });

  // Right-click a between chip (or the banner's pencil) to rename it — a floating popover rather
  // than swapping the tiny 22px chip itself into a text field, which has no room for typing. Follows
  // this app's existing "commit as you type" convention (pair/dancer/Bild names all save on every
  // 'input' event, not on blur/Enter) — blur just closes the popover and refreshes the chip's
  // tooltip/banner text with whatever's already been saved.
  var betweenRenamePopoverEl = null;
  function closeBetweenRenamePopover(){
    if(betweenRenamePopoverEl){ betweenRenamePopoverEl.remove(); betweenRenamePopoverEl = null; }
  }
  function openBetweenRenamePopover(anchorEl, fIdx, bIdx, below){
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
    // The banner's pencil (below = true) sits right under the top bar — open downward there.
    var top = rect.top - popRect.height - 14;
    if(below || top < 8) top = rect.bottom + 8;
    pop.style.top = top + 'px';

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
      card.className = 'film-card' + (idx === state.activeIndex && !editingBetween ? ' active' : ''); // while posing a Zwischenposition only its chip is marked (#2078)
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
      preview.style.aspectRatio = stageAspect();
      preview.appendChild(removeEl);
      state.dancers.forEach(function(d){
        [d.id, followKey(d.id)].forEach(function(k){
          var pos = f.pos[k];
          if(!pos) return;
          var dot = document.createElement('span');
          dot.className = k === d.id ? (f.pos[followKey(d.id)] ? 'film-dot film-dot-split' : 'film-dot') : 'film-dot film-dot-split film-dot-follow';
          dot.style.left = gridToPercentX(pos.x) + '%';
          dot.style.top = gridToPercentY(pos.y) + '%';
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
      dot.style.left = gridToPercentX(pos.x) + '%';
      dot.style.top = gridToPercentY(pos.y) + '%';
    });
  }

  // Where a new Bild goes: to the end — or, paused in the middle of a move (pausedMidMove,
  // js/playback.js), right there between its two Bilder (#2031). The Zwischenpositionen of that
  // move after the spot, and the rest of a Drehung on the leg it splits, move on with the new
  // Bild; with a song in sync it gets that spot in the song as its time marker, and the two Bilder
  // around it keep theirs, so nothing else in the song shifts.
  function placeNewBild(f, paused){
    if(!paused){
      state.formations.push(f);
      state.activeIndex = state.formations.length - 1;
      return;
    }
    var i = paused.fromIdx, t = paused.t, prev = state.formations[i], next = state.formations[i + 1];
    var anchors = betweenAnchors(i, i + 1), times = betweenTimes(i), keep = [], moved = [];
    (prev.betweens || []).forEach(function(b, k){
      var own = sanitizeBetweenAt(b.at) !== null;
      if(times[k] < t){ if(own) b.at = sanitizeBetweenAt(times[k] / t); keep.push(b); }
      else{ if(own) b.at = sanitizeBetweenAt((times[k] - t) / (1 - t)); moved.push(b); }
      if(b.at === null) delete b.at;
    });
    var legStart = anchors[keep.length], legEnd = anchors[keep.length + 1], target = moveEase(i, i + 1, t);
    splitLegTurns(keep.length ? keep[keep.length - 1] : prev, f, legEnd > legStart ? Math.min(1, Math.max(0, (target - legStart) / (legEnd - legStart))) : 0.5);
    prev.betweens = keep;
    f.betweens = moved;
    if(paused.sync){
      var songTimes = syncTimes(), n = state.formations.length;
      if(i > 0 && formationTime(prev) === null) prev.time = snapTime(songTimes[i]);
      if(i + 1 < n - 1 && formationTime(next) === null) next.time = snapTime(songTimes[i + 1]);
      f.time = snapTime(paused.songTime);
    }
    // Default names follow the position: the new one is "Bild i+2", the untouched "Bild N" after it move up one
    state.formations.forEach(function(g, k){ if(k > i && g.name === 'Bild ' + (k + 1)) g.name = 'Bild ' + (k + 2); });
    f.name = 'Bild ' + (i + 2);
    state.formations.splice(i + 1, 0, f);
    state.activeIndex = i + 1;
  }

  function addFormation(){
    if(editingBetween){ editingBetween = null; updateBetweenEditBanner(); }
    var paused = pausedMidMove(); // js/playback.js
    var src = currentFormation(), srcPos = paused ? roundedPoseAt(paused.fromIdx, paused.t) : src.pos;
    var copy = {};
    Object.keys(srcPos).forEach(function(k){ copy[k] = {x:srcPos[k].x, y:srcPos[k].y, rot:srcPos[k].rot||0}; });
    // startPos freezes the position this new Bild starts from (identical to `copy` right now, but
    // kept as an independent object — see snapshotPos — so later dragging dancers within this new
    // Bild, or editing the Bild before it, never changes what this Bild remembers as its own start).
    var f = { id: uid('f'), name: 'Bild ' + (state.formations.length+1), pos: copy, showAxes: src.showAxes !== false, localAxes: copyLocalAxes(src), category: '', startPos: snapshotPos(srcPos), splitPairs: [] };
    placeNewBild(f, paused);
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
