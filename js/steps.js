"use strict";

/* ---------- "Schritte": per-dancer/per-pair step export (focused video + printable PDF) ---------- */

  var stepsBtn = document.getElementById('stepsBtn');
  var stepsBackdrop = document.getElementById('stepsBackdrop');
  var stepsCloseBtn = document.getElementById('stepsCloseBtn');
  var stepsWhoSelect = document.getElementById('stepsWhoSelect');
  var stepsEmptyHint = document.getElementById('stepsEmptyHint');
  var stepsVideoBtn = document.getElementById('stepsVideoBtn');
  var stepsPdfBtn = document.getElementById('stepsPdfBtn');
  var stepsAllPdfBtn = document.getElementById('stepsAllPdfBtn');
  var stepsPrintArea = document.getElementById('stepsPrintArea');

  function renderStepsWhoOptions(){
    stepsWhoSelect.innerHTML = '';
    state.dancers.forEach(function(d){
      var opt = document.createElement('option');
      opt.value = 'd:' + d.id;
      opt.textContent = d.name;
      stepsWhoSelect.appendChild(opt);
    });
    state.pairs.forEach(function(p){
      var a = state.dancers.find(function(d){ return d.id === p.memberIds[0]; });
      var b = state.dancers.find(function(d){ return d.id === p.memberIds[1]; });
      if(!a || !b) return;
      var opt = document.createElement('option');
      opt.value = 'p:' + p.id;
      opt.textContent = '⚭ ' + (p.name ? p.name : (a.name + ' & ' + b.name));
      stepsWhoSelect.appendChild(opt);
    });
    var empty = !state.dancers.length;
    stepsEmptyHint.hidden = !empty;
    stepsWhoSelect.hidden = empty;
    stepsVideoBtn.disabled = empty;
    stepsPdfBtn.disabled = empty;
    if(stepsAllPdfBtn) stepsAllPdfBtn.disabled = empty;
  }

  function openStepsModal(){
    renderStepsWhoOptions();
    stepsBackdrop.hidden = false;
  }
  function closeStepsModal(){ stepsBackdrop.hidden = true; }

  stepsBtn.addEventListener('click', openStepsModal);
  stepsCloseBtn.addEventListener('click', closeStepsModal);
  stepsBackdrop.addEventListener('click', function(e){ if(e.target === stepsBackdrop) closeStepsModal(); });

  // Resolves the current dropdown value into one or two "sheets" to produce — a lone dancer
  // (with their saved partner, if any, along for reference) or, for a pair, one sheet per partner
  // so "für jedes Paar und auch jeden Tänzer einzeln" always comes down to an individual view.
  function getStepsSheets(){
    var val = stepsWhoSelect.value;
    if(!val) return [];
    var kind = val.slice(0,1), id = val.slice(2);
    if(kind === 'd'){
      var d = state.dancers.find(function(dd){ return dd.id === id; });
      if(!d) return [];
      var pair = findPairForDancer(d.id);
      var partner = null;
      if(pair){
        var partnerId = pair.memberIds[0] === d.id ? pair.memberIds[1] : pair.memberIds[0];
        partner = state.dancers.find(function(dd){ return dd.id === partnerId; }) || null;
      }
      return [{primary: d, secondary: partner}];
    }
    var pair2 = state.pairs.find(function(p){ return p.id === id; });
    if(!pair2) return [];
    var a = state.dancers.find(function(d){ return d.id === pair2.memberIds[0]; });
    var b = state.dancers.find(function(d){ return d.id === pair2.memberIds[1]; });
    if(!a || !b) return [];
    return [{primary: a, secondary: b}, {primary: b, secondary: a}];
  }

  function fmtSigned(v){
    var r = Math.round((v||0)*10)/10;
    if(Object.is(r, -0)) r = 0;
    var s = Math.abs(r).toFixed(1).replace('.', ',');
    return (r < 0 ? '−' : '+') + s;
  }

  /* ---------- video: reuses the existing video pipeline, filtered to just this sheet's dancer(s) --------- */

  stepsVideoBtn.addEventListener('click', function(){
    if(exportState) return;
    var sheets = getStepsSheets();
    if(!sheets.length || !state.formations.length) return;
    var ids = {};
    sheets.forEach(function(sh){ ids[sh.primary.id] = true; if(sh.secondary) ids[sh.secondary.id] = true; });
    var focusIds = Object.keys(ids);
    var label = sheets.length === 2 ? (sheets[0].primary.name + ' & ' + sheets[1].primary.name) : sheets[0].primary.name;
    closeStepsModal();
    askFilename(bestVideoMime().ext, filenameBase() + '-' + label.replace(/[^\w-]+/g,'_'), function(filename, opts){
      startVideoExport(filename, focusIds, opts && opts.includeGhosts);
    }, true);
  });

  /* ---------- PDF: a printable step sheet per dancer, one card per Bild --------- */

  // betweenPositions: primary dancer's Zwischenpositionen for the move leaving this Bild (see
  // js/state.js's interpolateThroughBetweens), in order — drawn as small numbered gray dots, same
  // idea as the "heller Ring = graue Zusatzposition" convention the source choreography PDF this
  // app grew out of already used, just with a number instead of a bare ring since there can be more
  // than one.
  function buildStepDiagram(primaryPos, secondaryPos, betweenPositions){
    var diagram = document.createElement('div');
    diagram.className = 'step-diagram';
    var labels = state.roomLabels || {};
    var walls = [
      [labels.top || 'WAND', 'top'],
      [labels.left || 'FENSTER', 'left'],
      [labels.right || 'SPIEGEL', 'right'],
      [labels.bottom || 'EINGANG', 'bottom']
    ];
    walls.forEach(function(w){
      var el = document.createElement('span');
      el.className = 'step-wall step-wall-' + w[1];
      el.textContent = w[0];
      diagram.appendChild(el);
    });
    var room = document.createElement('div');
    room.className = 'step-room';
    var cross = document.createElement('span');
    cross.className = 'step-cross';
    room.appendChild(cross);
    function addDot(pos, cls, label){
      if(!pos) return;
      var dot = document.createElement('span');
      dot.className = 'step-dot ' + cls;
      dot.style.left = gridToPercent(pos.x) + '%';
      dot.style.top = gridToPercent(pos.y) + '%';
      if(label !== undefined) dot.textContent = label;
      room.appendChild(dot);
    }
    // Between-dots first so the main/partner dots (added after, further down) paint on top of them
    // where positions happen to overlap.
    (betweenPositions || []).forEach(function(bp, i){ addDot(bp, 'step-dot-between', String(i+1)); });
    addDot(secondaryPos, 'step-dot-secondary');
    addDot(primaryPos, 'step-dot-primary');
    diagram.appendChild(room);
    return diagram;
  }

  function buildStepCard(formationIdx, formation, primary, secondary){
    var card = document.createElement('div');
    card.className = 'step-card';
    var primaryPos = formation.pos[primary.id];
    var secondaryPos = secondary ? formation.pos[secondary.id] : null;
    var betweens = Array.isArray(formation.betweens) ? formation.betweens : [];
    var betweenPositions = betweens.map(function(b){ return b.pos[primary.id]; });

    card.appendChild(buildStepDiagram(primaryPos, secondaryPos, betweenPositions));

    var info = document.createElement('div');
    info.className = 'step-info';
    // "Bild N" and its own name used to be two separate elements — a heading, then the actual
    // giant X/Y readout, then (smaller, further down, easy to miss) which Bild this even is by
    // name. One combined title — same "Bild N — Name" convention as bildLabel() in js/history.js —
    // puts identity first and the coordinates (the actual instruction) right after it, instead of
    // splitting a Bild's number from its name.
    var h = document.createElement('h3');
    h.textContent = 'Bild ' + (formationIdx+1) + (formation.name ? ' — ' + formation.name : '');
    info.appendChild(h);

    if(primaryPos){
      var coords = document.createElement('div');
      coords.className = 'step-coords';
      coords.textContent = 'X ' + fmtSigned(primaryPos.x) + '   Y ' + fmtSigned(primaryPos.y);
      info.appendChild(coords);
    }

    // Zwischenpositionen line up right under the main position, in the same order they play in —
    // same "grau x … y … · …" phrasing the source choreography PDF used for its own gray Zusatz-
    // positionen. Uses the between's own name (right-click a chip in the filmstrip to set one) when
    // there is one, falling back to a generic "Zwischenposition N" otherwise.
    betweens.forEach(function(b, i){
      var bp = b.pos[primary.id];
      if(!bp) return;
      var line = document.createElement('p');
      line.className = 'step-between-line';
      line.textContent = 'grau x ' + fmtSigned(bp.x) + ' y ' + fmtSigned(bp.y) + ' · ' + (b.name ? b.name : ('Zwischenposition ' + (i+1)));
      info.appendChild(line);
    });

    if(secondary && secondaryPos){
      var sec = document.createElement('p');
      sec.className = 'step-secondary';
      sec.textContent = secondary.name + ': x ' + fmtSigned(secondaryPos.x) + ' y ' + fmtSigned(secondaryPos.y);
      info.appendChild(sec);
    }

    card.appendChild(info);
    return card;
  }

  // A section header ("1. Langsamer Walzer" — see js/export.js's categoryLabelAt(), the same
  // Tänze-grouping the video export overlays as a caption) inserted right before the first Bild of
  // each dance section, so a multi-dance choreography's printed sheet reads as its actual sections
  // instead of one undifferentiated run of Bild cards. Blank categories just continue the previous
  // section, same as everywhere else categories show up (filmstrip, video caption).
  function buildStepSectionHeader(label){
    var h = document.createElement('h4');
    h.className = 'step-section-header';
    h.textContent = label;
    return h;
  }

  // Every dancer's own sheet, pair by pair (each getStepsSheets()-style pair still produces one
  // sheet per partner) then any dancer with no saved partner — "erst alles von Paar 1, dann Paar 2
  // usw." — for the "Alle als PDF" button below, which puts them all in one print job/document
  // instead of one at a time.
  function getAllStepsSheets(){
    var sheets = [];
    var pairedIds = {};
    state.pairs.forEach(function(pair){
      var a = state.dancers.find(function(d){ return d.id === pair.memberIds[0]; });
      var b = state.dancers.find(function(d){ return d.id === pair.memberIds[1]; });
      if(!a || !b) return;
      pairedIds[a.id] = true; pairedIds[b.id] = true;
      sheets.push({primary: a, secondary: b});
      sheets.push({primary: b, secondary: a});
    });
    state.dancers.forEach(function(d){
      if(pairedIds[d.id]) return;
      sheets.push({primary: d, secondary: null});
    });
    return sheets;
  }

  function buildStepsPrintDocument(sheets){
    stepsPrintArea.innerHTML = '';
    sheets.forEach(function(sheet, sheetIdx){
      var title = document.createElement('h2');
      title.className = 'step-sheet-title';
      title.textContent = (state.projectName || 'Aufstellung') + ' — ' + sheet.primary.name +
        (sheet.secondary ? ' (Partner: ' + sheet.secondary.name + ')' : '');
      stepsPrintArea.appendChild(title);
      var lastCategory = null;
      state.formations.forEach(function(f, idx){
        var cat = categoryLabelAt(idx);
        if(cat && cat !== lastCategory){
          stepsPrintArea.appendChild(buildStepSectionHeader(cat));
          lastCategory = cat;
        }
        stepsPrintArea.appendChild(buildStepCard(idx, f, sheet.primary, sheet.secondary));
      });
    });
  }

  // Shared by both PDF buttons below: builds the print document, swaps in a filename-friendly
  // document.title (restored on 'afterprint' rather than right after calling print() — modern
  // Chrome's print dialog is asynchronous, print() returns immediately and the preview renders
  // afterward, so restoring on a fixed timer could win the race and hand the dialog the old title
  // back before it ever reads the new one), and opens the print dialog.
  function printStepsSheets(sheets, titleWho){
    buildStepsPrintDocument(sheets);
    closeStepsModal();
    var prevTitle = document.title;
    document.title = (state.projectName || 'Aufstellung') + ' — Schritte — ' + titleWho;
    window.addEventListener('afterprint', function restoreTitle(){
      window.removeEventListener('afterprint', restoreTitle);
      document.title = prevTitle;
    });
    // Printable view is built into #stepsPrintArea (hidden outside @media print — see
    // css/modals.css); window.print() is the vanilla, no-dependency way to get to a PDF ("Als PDF
    // speichern" in the browser's print destination picker), no server round-trip needed.
    setTimeout(function(){ window.print(); }, 50);
  }

  stepsPdfBtn.addEventListener('click', function(){
    var sheets = getStepsSheets();
    if(!sheets.length || !state.formations.length) return;
    var who = sheets.length === 2 ? (sheets[0].primary.name + ' & ' + sheets[1].primary.name) : sheets[0].primary.name;
    printStepsSheets(sheets, who);
  });

  if(stepsAllPdfBtn){
    stepsAllPdfBtn.addEventListener('click', function(){
      var sheets = getAllStepsSheets();
      if(!sheets.length || !state.formations.length) return;
      printStepsSheets(sheets, 'Alle');
    });
  }
