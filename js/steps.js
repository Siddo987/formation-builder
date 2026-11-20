"use strict";

/* ---------- "Schritte": per-dancer/per-pair step export (focused video + printable PDF) ---------- */

  var stepsPrintArea = document.getElementById('stepsPrintArea');

  // The "Wer?" choices of the Exportieren dialog (js/export.js): every complete pair ('p:<id>'),
  // then every dancer ('d:<id>') — any number of them can be ticked at once.
  function stepsWhoChoices(){
    var choices = [];
    state.pairs.forEach(function(p){
      var a = state.dancers.find(function(d){ return d.id === p.memberIds[0]; });
      var b = state.dancers.find(function(d){ return d.id === p.memberIds[1]; });
      if(!a || !b) return;
      choices.push({value: 'p:' + p.id, label: '⚭ ' + (p.name ? p.name : (a.name + ' & ' + b.name))});
    });
    state.dancers.forEach(function(d){ choices.push({value: 'd:' + d.id, label: d.name}); });
    return choices;
  }

  // One sheet per couple dot; split marks a couple that's split into Lead & Follow in at least one
  // Bild or Zwischenposition — its cards then show both spots side by side, equally big.
  function sheetsForDancer(d, partner){
    var split = state.formations.some(function(f){
      return isCoupleSplitIn(f, d.id) || (f.betweens || []).some(function(b){ return isCoupleSplitIn(b, d.id); });
    });
    return [{primary: d, secondary: partner, split: split}];
  }

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

  // Several "Wer?" values at once: their sheets without doubles (a dancer ticked on their own and as
  // part of their pair), in the same "erst Paar 1, dann Paar 2" order as getAllStepsSheets().
  function getStepsSheetsFor(vals){
    var wanted = {};
    vals.forEach(function(v){
      getStepsSheets(v).forEach(function(sh){ wanted[sh.primary.id] = true; });
    });
    return getAllStepsSheets().filter(function(sh){ return wanted[sh.primary.id]; });
  }

  // A stored x or y as the chosen Achsen show it (#2199): with a sign, or none where both sides are +.
  function fmtCoord(v, axis){
    var r = Math.round(dispCoord(v||0, axis)*10)/10;
    if(Object.is(r, -0)) r = 0;
    var s = Math.abs(r).toFixed(1).replace('.', ',');
    return (r < 0 ? '−' : coordAxes().abs ? '' : '+') + s;
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
  // rolePos: the couple's Follow where it's split in this Bild — then both dots are drawn smaller
  // and lettered L/F, the Follow dashed, same as the stage's role badges. followBetweens: the
  // Follow's own Zwischenpositionen where the couple is split there (null elsewhere), dashed too.
  // contextPositions: every other couple's spot in this Bild ("Andere Paare hellgrau einblenden"),
  // drawn as small light-gray dots.
  function buildStepDiagram(primaryPos, secondaryPos, betweenPositions, followBetweens, rolePos, contextPositions, paths){
    var diagram = document.createElement('div');
    diagram.className = 'step-diagram';
    // The room (180 px less 22 px all round) in the stage's proportions (#2060), never bigger.
    var ar = stageAspect();
    diagram.style.width = Math.round(136 * Math.min(1, ar) + 44) + 'px';
    diagram.style.height = Math.round(136 / Math.max(1, ar) + 44) + 'px';
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
    function addDot(pos, cls, label, at){
      if(!pos) return;
      var dot = document.createElement('span');
      dot.className = 'step-dot ' + cls;
      dot.style.left = (at ? at.x : gridToPercentX(pos.x)) + '%';
      dot.style.top = (at ? at.y : gridToPercentY(pos.y)) + '%';
      if(label !== undefined) dot.textContent = label;
      room.appendChild(dot);
    }
    // A split couple's Lead and Follow usually stand a step or less apart — closer than two dots
    // are wide at this scale, so one hid half of the other. The Follow's dot is pushed away on
    // paper only, along the line between them (Lead left of Follow where they coincide); the
    // Lead's dot and all printed coordinates stay exact.
    var roleAt = null;
    if(primaryPos && rolePos){
      var MIN_SPLIT_GAP = 13; // % of the room — a little more than one lettered dot
      var px = gridToPercentX(primaryPos.x), py = gridToPercentY(primaryPos.y);
      var dx = gridToPercentX(rolePos.x) - px, dy = gridToPercentY(rolePos.y) - py;
      var dist = Math.sqrt(dx*dx + dy*dy);
      if(dist < MIN_SPLIT_GAP){
        if(dist < 0.01){ dx = 1; dy = 0; dist = 1; }
        roleAt = {x: px + dx/dist*MIN_SPLIT_GAP, y: py + dy/dist*MIN_SPLIT_GAP};
      }
    }
    if(paths && paths.length){
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'step-path');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      paths.forEach(function(p){
        var line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        line.setAttribute('points', p.points);
        if(p.follow) line.setAttribute('class', 'step-path-follow');
        svg.appendChild(line);
      });
      room.appendChild(svg);
      paths.forEach(function(p){ addDot(p.end, 'step-dot-target'); }); // where the walk ends: the next Bild
    }
    (contextPositions || []).forEach(function(cp){ addDot(cp, 'step-dot-context'); });
    // Between-dots first so the main/partner dots (added after, further down) paint on top of them
    // where positions happen to overlap.
    (betweenPositions || []).forEach(function(bp, i){
      addDot(bp, 'step-dot-between', String(i+1));
      if(followBetweens && followBetweens[i]) addDot(followBetweens[i], 'step-dot-between step-dot-follow', String(i+1));
    });
    addDot(secondaryPos, 'step-dot-secondary');
    addDot(rolePos, 'step-dot-role step-dot-split step-dot-follow', 'F', roleAt);
    addDot(primaryPos, 'step-dot-primary' + (rolePos ? ' step-dot-split' : ''), rolePos ? 'L' : undefined);
    diagram.appendChild(room);
    return diagram;
  }

  // The walk to the next Bild of this sheet's dancer (Lead and, split, Follow) in percent of the room.
  var stepPathCache = {};
  function stepPaths(formationIdx, primaryId){
    if(!state.formations[formationIdx + 1]) return null;
    var mv = stepPathCache[formationIdx] || (stepPathCache[formationIdx] = movePaths(formationIdx));
    return [primaryId, followKey(primaryId)].map(function(k, i){
      if(i && !mv.frames.some(function(w){ return w[k]; })) return null;
      var pts = mv.frames.map(function(w){ var p = pathAt(w, k); return p ? gridToPercentX(p.x).toFixed(2) + ',' + gridToPercentY(p.y).toFixed(2) : null; }).filter(Boolean);
      return pts.length ? {points: pts.join(' '), follow: i === 1, end: pathAt(mv.frames[mv.frames.length - 1], k)} : null;
    }).filter(Boolean);
  }

  function buildStepCard(formationIdx, formation, primary, secondary, coupleSplits, showContext, showNotes, showPaths){
    var card = document.createElement('div');
    card.className = 'step-card';
    var fk = followKey(primary.id);
    var primaryPos = formation.pos[primary.id];
    var rolePos = formation.pos[fk] || null;
    var secondaryPos = secondary ? formation.pos[secondary.id] : null;
    var betweens = Array.isArray(formation.betweens) ? formation.betweens : [];
    var betweenPositions = betweens.map(function(b){ return b.pos[primary.id]; });
    var followBetweens = betweens.map(function(b){ return b.pos[fk] || null; });
    var contextPositions = [];
    if(showContext){
      state.dancers.forEach(function(d){
        if(d.id === primary.id || (secondary && d.id === secondary.id)) return;
        [d.id, followKey(d.id)].forEach(function(k){ if(formation.pos[k]) contextPositions.push(formation.pos[k]); });
      });
    }

    card.appendChild(buildStepDiagram(primaryPos, secondaryPos, betweenPositions, followBetweens, rolePos, contextPositions, showPaths ? stepPaths(formationIdx, primary.id) : null));

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

    // Where the couple stands apart, Lead and Follow get the same big readout side by side, tagged in
    // the same words as the L/F letters in the sketch.
    function addCoords(parent, pos, tagText, isFollow){
      var coords = document.createElement('div');
      coords.className = 'step-coords';
      if(tagText){
        var tag = document.createElement('span');
        tag.className = 'step-role-tag' + (isFollow ? ' step-role-tag-follow' : '');
        tag.textContent = tagText;
        coords.appendChild(tag);
      }
      coords.appendChild(document.createTextNode('X ' + fmtCoord(pos.x, 'x') + '   Y ' + fmtCoord(pos.y, 'y')));
      parent.appendChild(coords);
    }
    if(primaryPos && rolePos){
      var both = document.createElement('div');
      both.className = 'step-coords-split';
      addCoords(both, primaryPos, 'Lead', false);
      addCoords(both, rolePos, 'Follow', true);
      info.appendChild(both);
    } else if(primaryPos){
      addCoords(info, primaryPos, coupleSplits ? 'Lead & Follow' : '', false);
    }

    function addNote(text){
      if(!text) return;
      var note = document.createElement('p');
      note.className = 'step-note';
      note.textContent = text;
      info.appendChild(note);
    }
    // The bars up to the next Bild's mark with their Phrasierung and Figur (#2096, js/beats.js).
    var times = syncTimes(), phrasing = barPhrasing(times[formationIdx], formationIdx + 1 < times.length ? times[formationIdx + 1] : null);
    if(phrasing){
      var phraseLine = document.createElement('p');
      phraseLine.className = 'step-between-line';
      phraseLine.textContent = phrasing.head;
      info.appendChild(phraseLine);
      var figs = barPhrasingTable(phrasing, 'step-figs');
      if(figs) info.appendChild(figs);
    }
    if(showNotes) addNote(formation.note);

    // Zwischenpositionen line up right under the main position, in the same order they play in —
    // same "grau x … y … · …" phrasing the source choreography PDF used for its own gray Zusatz-
    // positionen. Uses the between's own name (right-click a chip in the filmstrip to set one) when
    // there is one, falling back to a generic "Zwischenposition N" otherwise.
    betweens.forEach(function(b, i){
      var bp = b.pos[primary.id], fp = followBetweens[i];
      if(!bp) return;
      var line = document.createElement('p');
      line.className = 'step-between-line';
      line.textContent = 'grau ' + (fp ? 'L ' : '') + 'x ' + fmtCoord(bp.x, 'x') + ' y ' + fmtCoord(bp.y, 'y') +
        (fp ? ' · F x ' + fmtCoord(fp.x, 'x') + ' y ' + fmtCoord(fp.y, 'y') : '') +
        ' · ' + (b.name ? b.name : ('Zwischenposition ' + (i+1)));
      info.appendChild(line);
      if(showNotes) addNote(b.note);
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
      if(spins && typeof spins[primary.id] === 'number') addTurnLine(coupleSplits ? 'Eigendrehung Lead' : 'Eigendrehung', spins[primary.id], toName);
      if(spins && typeof spins[fk] === 'number') addTurnLine('Eigendrehung Follow', spins[fk], toName);
      var orbit = (sanitizeOrbits(stop.orbits) || []).find(function(g){ return g.ids.indexOf(primary.id) !== -1 || g.ids.indexOf(fk) !== -1; });
      if(orbit) addTurnLine('Kreisbahn', orbit.turn, toName);
    });

    if(secondary && secondaryPos){
      var sec = document.createElement('p');
      sec.className = 'step-secondary';
      sec.textContent = secondary.name + ': x ' + fmtCoord(secondaryPos.x, 'x') + ' y ' + fmtCoord(secondaryPos.y, 'y');
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

  function buildStepsPrintDocument(sheets, showContext, showNotes, showPaths){
    stepsPrintArea.innerHTML = '';
    stepPathCache = {};
    sheets.forEach(function(sheet, sheetIdx){
      var title = document.createElement('h2');
      title.className = 'step-sheet-title';
      title.textContent = (state.projectName || 'Aufstellung') + ' — ' + sheet.primary.name +
        (sheet.secondary ? ' (Partner: ' + sheet.secondary.name + ')' : '');
      stepsPrintArea.appendChild(title);
      if(sheet.split){
        var legend = document.createElement('p');
        legend.className = 'step-legend';
        legend.textContent = 'Wo Lead und Follow getrennt stehen, stehen beide Positionen nebeneinander. ' +
          'In der Skizze: L = Lead (gefüllt), F = Follow (gestrichelt).';
        stepsPrintArea.appendChild(legend);
      }
      var lastCategory = null;
      state.formations.forEach(function(f, idx){
        var cat = categoryLabelAt(idx);
        if(cat && cat !== lastCategory){
          stepsPrintArea.appendChild(buildStepSectionHeader(cat));
          lastCategory = cat;
        }
        stepsPrintArea.appendChild(buildStepCard(idx, f, sheet.primary, sheet.secondary, sheet.split, showContext, showNotes, showPaths));
      });
    });
  }

  // Builds the print document, swaps in the dialog's filename as document.title (that's what the
  // browser offers as the PDF's name; restored on 'afterprint' rather than right after calling
  // print() — modern Chrome's print dialog is asynchronous, print() returns immediately and the
  // preview renders afterward, so restoring on a fixed timer could win the race and hand the dialog
  // the old title back before it ever reads the new one), and opens the print dialog.
  function printStepsSheets(sheets, title, showContext, showNotes, showPaths){
    buildStepsPrintDocument(sheets, showContext, showNotes, showPaths);
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
