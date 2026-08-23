"use strict";

/* ---------- "Schritte": per-dancer/per-pair step export (focused video + printable PDF) ---------- */

  var stepsBtn = document.getElementById('stepsBtn');
  var stepsBackdrop = document.getElementById('stepsBackdrop');
  var stepsCloseBtn = document.getElementById('stepsCloseBtn');
  var stepsWhoSelect = document.getElementById('stepsWhoSelect');
  var stepsEmptyHint = document.getElementById('stepsEmptyHint');
  var stepsVideoBtn = document.getElementById('stepsVideoBtn');
  var stepsPdfBtn = document.getElementById('stepsPdfBtn');
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
    askFilename('.webm', filenameBase() + '-' + label.replace(/[^\w-]+/g,'_'), function(filename){
      startVideoExport(filename, focusIds);
    });
  });

  /* ---------- PDF: a printable step sheet per dancer, one card per Bild --------- */

  function buildStepDiagram(primaryPos, secondaryPos){
    var diagram = document.createElement('div');
    diagram.className = 'step-diagram';
    var walls = [['WAND','top'],['FENSTER','left'],['SPIEGEL','right'],['EINGANG','bottom']];
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
    function addDot(pos, cls){
      if(!pos) return;
      var dot = document.createElement('span');
      dot.className = 'step-dot ' + cls;
      dot.style.left = gridToPercent(pos.x) + '%';
      dot.style.top = gridToPercent(pos.y) + '%';
      room.appendChild(dot);
    }
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

    card.appendChild(buildStepDiagram(primaryPos, secondaryPos));

    var info = document.createElement('div');
    info.className = 'step-info';
    var h = document.createElement('h3');
    h.textContent = 'BILD ' + (formationIdx+1);
    info.appendChild(h);

    if(primaryPos){
      var coords = document.createElement('div');
      coords.className = 'step-coords';
      coords.textContent = 'X ' + fmtSigned(primaryPos.x) + '   Y ' + fmtSigned(primaryPos.y);
      info.appendChild(coords);
    }

    if(formation.name){
      var desc = document.createElement('p');
      desc.className = 'step-desc';
      desc.textContent = formation.name;
      info.appendChild(desc);
    }

    if(secondary && secondaryPos){
      var sec = document.createElement('p');
      sec.className = 'step-secondary';
      sec.textContent = secondary.name + ': x ' + fmtSigned(secondaryPos.x) + ' y ' + fmtSigned(secondaryPos.y);
      info.appendChild(sec);
    }

    card.appendChild(info);
    return card;
  }

  function buildStepsPrintDocument(){
    stepsPrintArea.innerHTML = '';
    var sheets = getStepsSheets();
    sheets.forEach(function(sheet, sheetIdx){
      var title = document.createElement('h2');
      title.className = 'step-sheet-title';
      title.textContent = (state.projectName || 'Aufstellung') + ' — ' + sheet.primary.name +
        (sheet.secondary ? ' (Partner: ' + sheet.secondary.name + ')' : '');
      stepsPrintArea.appendChild(title);
      state.formations.forEach(function(f, idx){
        stepsPrintArea.appendChild(buildStepCard(idx, f, sheet.primary, sheet.secondary));
      });
    });
  }

  stepsPdfBtn.addEventListener('click', function(){
    var sheets = getStepsSheets();
    if(!sheets.length || !state.formations.length) return;
    buildStepsPrintDocument();
    closeStepsModal();
    // Printable view is built into #stepsPrintArea (hidden outside @media print — see
    // css/modals.css); window.print() is the vanilla, no-dependency way to get to a PDF ("Als PDF
    // speichern" in the browser's print destination picker), no server round-trip needed.
    setTimeout(function(){ window.print(); }, 50);
  });
