"use strict";

/* ---------- "Schritte": per-dancer/per-pair step export (focused video + printable PDF) ---------- */

  var stepsPrintArea = document.getElementById('stepsPrintArea');

  // Appends the "Wer?" choices of the Exportieren dialog (js/export.js): every dancer ('d:<id>'),
  // then every complete pair ('p:<id>').
  function fillStepsWhoOptions(selectEl){
    state.dancers.forEach(function(d){
      var opt = document.createElement('option');
      opt.value = 'd:' + d.id;
      opt.textContent = d.name;
      selectEl.appendChild(opt);
    });
    state.pairs.forEach(function(p){
      var a = state.dancers.find(function(d){ return d.id === p.memberIds[0]; });
      var b = state.dancers.find(function(d){ return d.id === p.memberIds[1]; });
      if(!a || !b) return;
      var opt = document.createElement('option');
      opt.value = 'p:' + p.id;
      opt.textContent = '⚭ ' + (p.name ? p.name : (a.name + ' & ' + b.name));
      selectEl.appendChild(opt);
    });
  }

  // A couple that's split into Lead & Follow in at least one Bild or Zwischenposition gets one sheet
  // per role: the Follow's sheet follows the Follow's own spot wherever the couple is split (and the
  // couple's dot everywhere else), with the other role's spot alongside for reference.
  function sheetsForDancer(d, partner){
    var split = state.formations.some(function(f){
      return isCoupleSplitIn(f, d.id) || (f.betweens || []).some(function(b){ return isCoupleSplitIn(b, d.id); });
    });
    if(!split) return [{primary: d, secondary: partner, role: null}];
    return [{primary: d, secondary: partner, role: 'lead'}, {primary: d, secondary: partner, role: 'follow'}];
  }
  var ROLE_LABELS = {lead: 'Lead', follow: 'Follow'};

  function sheetsLabel(sheets){
    var names = [];
    sheets.forEach(function(sh){ if(names.indexOf(sh.primary.name) === -1) names.push(sh.primary.name); });
    return names.join(' & ');
  }

  // Resolves a "Wer?" value into the "sheets" to produce — a lone dancer (with their
  // saved partner, if any, along for reference) or, for a pair, one sheet per partner so "für
  // jedes Paar und auch jeden Tänzer einzeln" always comes down to an individual view.
  function getStepsSheets(val){
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
      return sheetsForDancer(d, partner);
    }
    var pair2 = state.pairs.find(function(p){ return p.id === id; });
    if(!pair2) return [];
    var a = state.dancers.find(function(d){ return d.id === pair2.memberIds[0]; });
    var b = state.dancers.find(function(d){ return d.id === pair2.memberIds[1]; });
    if(!a || !b) return [];
    return sheetsForDancer(a, b).concat(sheetsForDancer(b, a));
  }

  function fmtSigned(v){
    var r = Math.round((v||0)*10)/10;
    if(Object.is(r, -0)) r = 0;
    var s = Math.abs(r).toFixed(1).replace('.', ',');
    return (r < 0 ? '−' : '+') + s;
  }

  /* ---------- video: reuses the existing video pipeline, filtered to just this sheet's dancer(s) --------- */

  function stepsFocusIds(sheets){
    var ids = {};
    sheets.forEach(function(sh){ ids[sh.primary.id] = true; if(sh.secondary) ids[sh.secondary.id] = true; });
    return Object.keys(ids);
  }

  /* ---------- PDF: a printable step sheet per dancer, one card per Bild --------- */

  // betweenPositions: primary dancer's Zwischenpositionen for the move leaving this Bild (see
  // js/state.js's interpolateThroughBetweens), in order — drawn as small numbered gray dots, same
  // idea as the "heller Ring = graue Zusatzposition" convention the source choreography PDF this
  // app grew out of already used, just with a number instead of a bare ring since there can be more
  // than one.
  // rolePos: the couple's other role (Lead or Follow) where it's split in this Bild — then both
  // dots are drawn smaller, the Follow dashed, same as on the stage. contextPositions: every other
  // couple's spot in this Bild ("Andere Paare hellgrau einblenden"), drawn as small light-gray dots.
  function buildStepDiagram(primaryPos, secondaryPos, betweenPositions, rolePos, primaryIsFollow, contextPositions){
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
    (contextPositions || []).forEach(function(cp){ addDot(cp, 'step-dot-context'); });
    // Between-dots first so the main/partner dots (added after, further down) paint on top of them
    // where positions happen to overlap.
    (betweenPositions || []).forEach(function(bp, i){ addDot(bp, 'step-dot-between', String(i+1)); });
    addDot(rolePos, 'step-dot-role step-dot-split' + (primaryIsFollow ? '' : ' step-dot-follow'));
    addDot(secondaryPos, 'step-dot-secondary');
    addDot(primaryPos, 'step-dot-primary' + (rolePos ? ' step-dot-split' : '') + (primaryIsFollow ? ' step-dot-follow' : ''));
    diagram.appendChild(room);
    return diagram;
  }

  function buildStepCard(formationIdx, formation, primary, secondary, role, showContext){
    var card = document.createElement('div');
    card.className = 'step-card';
    var fk = followKey(primary.id);
    var split = !!formation.pos[fk];
    var ownIsFollow = role === 'follow' && split;
    var primaryPos = formation.pos[ownIsFollow ? fk : primary.id];
    var rolePos = split ? formation.pos[ownIsFollow ? primary.id : fk] : null;
    var secondaryPos = secondary ? formation.pos[secondary.id] : null;
    var betweens = Array.isArray(formation.betweens) ? formation.betweens : [];
    // This sheet's person at a Zwischenposition: on a Follow's sheet the Follow's own spot there, or
    // the couple's dot where the couple is closed at that one.
    var ownKey = role === 'follow' ? fk : primary.id;
    function ownAt(b){ return b.pos[ownKey] || b.pos[primary.id]; }
    var betweenPositions = betweens.map(ownAt);
    var contextPositions = [];
    if(showContext){
      state.dancers.forEach(function(d){
        if(d.id === primary.id || (secondary && d.id === secondary.id)) return;
        [d.id, followKey(d.id)].forEach(function(k){ if(formation.pos[k]) contextPositions.push(formation.pos[k]); });
      });
    }

    card.appendChild(buildStepDiagram(primaryPos, secondaryPos, betweenPositions, rolePos, ownIsFollow, contextPositions));

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
      var bp = ownAt(b);
      if(!bp) return;
      var line = document.createElement('p');
      line.className = 'step-between-line';
      line.textContent = 'grau x ' + fmtSigned(bp.x) + ' y ' + fmtSigned(bp.y) + ' · ' + (b.name ? b.name : ('Zwischenposition ' + (i+1)));
      info.appendChild(line);
    });

    // Set Drehungen im Paar (keyed by the couple's Lead, see setCoupleTurn in js/stage.js) and
    // Eigendrehungen (by the person's own pos key), leg by leg: out of the Bild, then out of each
    // Zwischenposition.
    var nextF = state.formations[formationIdx+1];
    function addTurnLine(what, deg, toName){
      var turnLine = document.createElement('p');
      turnLine.className = 'step-between-line';
      turnLine.textContent = what + ' bis \u201e' + toName + '\u201c: ' + roundNum(Math.abs(deg)) + '\u00b0 ' + (deg > 0 ? 'im Uhrzeigersinn' : 'gegen den Uhrzeigersinn');
      info.appendChild(turnLine);
    }
    if(nextF) [formation].concat(betweens).forEach(function(stop, i){
      var toName = i < betweens.length ? (betweens[i].name || 'Zwischenposition ' + (i+1)) : nextF.name;
      var turns = sanitizeCoupleTurns(stop.coupleTurns), spins = sanitizeSpins(stop.spins);
      var turn = turns ? (typeof turns[primary.id] === 'number' ? turns[primary.id] : (secondary ? turns[secondary.id] : undefined)) : undefined;
      if(typeof turn === 'number') addTurnLine('Drehung im Paar', turn, toName);
      if(spins && typeof spins[ownKey] === 'number') addTurnLine('Eigendrehung', spins[ownKey], toName);
    });

    if(role){
      var roleLine = document.createElement('p');
      roleLine.className = 'step-secondary';
      roleLine.textContent = rolePos
        ? (ownIsFollow ? 'Lead' : 'Follow') + ': x ' + fmtSigned(rolePos.x) + ' y ' + fmtSigned(rolePos.y)
        : 'Lead & Follow zusammen';
      info.appendChild(roleLine);
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
  // usw." — for "Wer? Alle" in the Exportieren dialog, which puts them all in one print job/document
  // instead of one at a time.
  function getAllStepsSheets(){
    var sheets = [];
    var pairedIds = {};
    state.pairs.forEach(function(pair){
      var a = state.dancers.find(function(d){ return d.id === pair.memberIds[0]; });
      var b = state.dancers.find(function(d){ return d.id === pair.memberIds[1]; });
      if(!a || !b) return;
      pairedIds[a.id] = true; pairedIds[b.id] = true;
      sheets.push.apply(sheets, sheetsForDancer(a, b).concat(sheetsForDancer(b, a)));
    });
    state.dancers.forEach(function(d){
      if(pairedIds[d.id]) return;
      sheets.push.apply(sheets, sheetsForDancer(d, null));
    });
    return sheets;
  }

  function buildStepsPrintDocument(sheets, showContext){
    stepsPrintArea.innerHTML = '';
    sheets.forEach(function(sheet, sheetIdx){
      var title = document.createElement('h2');
      title.className = 'step-sheet-title';
      title.textContent = (state.projectName || 'Aufstellung') + ' — ' + sheet.primary.name +
        (sheet.role ? ' (' + ROLE_LABELS[sheet.role] + ')' : '') +
        (sheet.secondary ? ' (Partner: ' + sheet.secondary.name + ')' : '');
      stepsPrintArea.appendChild(title);
      var lastCategory = null;
      state.formations.forEach(function(f, idx){
        var cat = categoryLabelAt(idx);
        if(cat && cat !== lastCategory){
          stepsPrintArea.appendChild(buildStepSectionHeader(cat));
          lastCategory = cat;
        }
        stepsPrintArea.appendChild(buildStepCard(idx, f, sheet.primary, sheet.secondary, sheet.role, showContext));
      });
    });
  }

  // Builds the print document, swaps in the dialog's filename as document.title (that's what the
  // browser offers as the PDF's name; restored on 'afterprint' rather than right after calling
  // print() — modern Chrome's print dialog is asynchronous, print() returns immediately and the
  // preview renders afterward, so restoring on a fixed timer could win the race and hand the dialog
  // the old title back before it ever reads the new one), and opens the print dialog.
  function printStepsSheets(sheets, title, showContext){
    buildStepsPrintDocument(sheets, showContext);
    var prevTitle = document.title;
    document.title = title;
    window.addEventListener('afterprint', function restoreTitle(){
      window.removeEventListener('afterprint', restoreTitle);
      document.title = prevTitle;
    });
    // Printable view is built into #stepsPrintArea (hidden outside @media print);
    // window.print() is the vanilla, no-dependency way to get to a PDF ("Als PDF
    // speichern" in the browser's print destination picker), no server round-trip needed.
    setTimeout(function(){ window.print(); }, 50);
  }
