"use strict";

/* ---------- Video-Layout (#2095, #2075): arrange what the exported video frame shows ----------
   Opened from the Exportieren dialog (video). The preview is drawn by renderCanvasFrame
   (js/export.js), the same function that draws every exported frame, so it shows exactly what the
   export produces; over it lies one box per element to select, drag and resize — with mouse, touch
   or keyboard. Every change goes straight into state.videoLayout and is saved like any other edit,
   so the project's Rückgängig/Wiederholen (js/history.js), reload, the .stg file and share links
   carry it. Inside the dialog its own Rückgängig/Wiederholen step only through the layout (#2170). */

  var vlBackdrop = document.getElementById('videoLayoutBackdrop');
  var vlFrameWrap = document.getElementById('vlFrameWrap');
  var vlFrame = document.getElementById('vlFrame');
  var vlCanvas = document.getElementById('vlCanvas');
  var vlBoxes = document.getElementById('vlBoxes');
  var vlMoment = document.getElementById('vlMoment');
  var vlMomentText = document.getElementById('vlMomentText');
  var vlList = document.getElementById('vlList');
  var vlProps = document.getElementById('vlProps');
  var vlNarrow = window.matchMedia('(max-width:899.98px)');
  var vlSelected = null;             // id of the selected element
  var vlOpts = {focus: null, who: ''};
  var vlLogo = {url: null, img: null};
  var vlDrag = null;                 // the pointer drag in progress
  var vlRenderQueued = false;
  var vlFromExport = false;
  var VL_MIN = 16;                   // smallest box side, in frame units
  var vlFormat = document.getElementById('vlFormat');
  var vlBg = document.getElementById('vlBg');
  var vlSnapToggle = document.getElementById('vlSnap');
  var vlGuides = ['is-x', 'is-y'].map(function(c){
    var g = document.createElement('div');
    g.className = 'vl-guide ' + c;
    g.hidden = true;
    vlFrame.appendChild(g);
    return g;
  });

  function vlLayout(){ return currentVideoLayout(); }
  function vlSize(){ return VIDEO_FORMATS[vlLayout().format]; }
  function vlFind(id){ return vlLayout().els.filter(function(el){ return el.id === id; })[0] || null; }
  // The first edit turns the standard layout into the project's own.
  function vlEditable(id){
    if(!state.videoLayout) state.videoLayout = defaultVideoLayout('quer');
    return id === undefined ? state.videoLayout : vlFind(id);
  }
  // The dialog's own steps (#2170): the layout (as JSON) before each edit made here, so its buttons
  // and Strg+Z in here never touch the rest of the project. Edits less than a second apart are one step.
  var vlPast = [], vlFuture = [], vlShown = 'null', vlEditAt = 0;
  var vlUndoBtn = document.getElementById('vlUndoBtn'), vlRedoBtn = document.getElementById('vlRedoBtn');
  function vlResetSteps(){ vlPast = []; vlFuture = []; vlShown = JSON.stringify(state.videoLayout || null); vlEditAt = 0; vlSyncSteps(); }
  function vlSyncSteps(){ vlUndoBtn.disabled = !vlPast.length; vlRedoBtn.disabled = !vlFuture.length; }
  function vlSave(now){
    var json = JSON.stringify(state.videoLayout || null), t = Date.now();
    if(json !== vlShown){
      if(t - vlEditAt > 1000){ vlPast.push(vlShown); vlFuture = []; }
      vlShown = json; vlEditAt = t;
      vlSyncSteps();
    }
    if(now) saveState(); else saveStateDebounced();
  }
  // dir -1: Rückgängig, 1: Wiederholen. false while the dialog is closed (js/main.js: the project's then).
  function videoLayoutStep(dir){
    if(vlBackdrop.hidden) return false;
    var from = dir < 0 ? vlPast : vlFuture, to = dir < 0 ? vlFuture : vlPast;
    if(!from.length) return true;
    to.push(JSON.stringify(state.videoLayout || null));
    vlShown = from.pop(); vlEditAt = 0;
    state.videoLayout = JSON.parse(vlShown);
    vlDrag = null;
    saveState();
    vlRefresh();
    vlSyncSteps();
    return true;
  }
  function vlKeepsAspect(el){ return el.type === 'logo' || el.type === 'image'; }

  function vlName(el){
    if(el.type === 'stage') return 'Bühne';
    if(el.type === 'logo') return 'Logo';
    if(el.type === 'bilder') return 'Bild-Namen';
    if(el.type === 'text') return 'Text „' + (el.text.replace(/\s+/g, ' ').trim().slice(0, 24) || '…') + '“';
    return 'Grafik „' + (el.name || 'ohne Namen') + '“';
  }

  // The export dialog's choices the frame depends on: Wer?, Herkunfts-/Zielpunkte, Weglinien,
  // andere Paare hellgrau. The preview shows them as set there; they stay controls of that dialog.
  function vlExportOptions(){
    var sheets = exportWho.length ? getStepsSheetsFor(exportWho) : null;
    var focus = sheets && sheets.length ? stepsFocusIds(sheets) : null;
    exportIncludeGhosts = exportGhostToggle.checked;
    exportIncludePaths = exportPathsToggle.checked;
    exportPathCache = {};
    exportShowContext = !!focus && exportContextToggle.checked;
    return {focus: focus, who: focus ? exportWhoLabel() : ''};
  }

  // The preview's moment on the slider: a whole number holds that Bild, anything between is the way
  // to the next one. tMs is where that moment lies in the video, for the {zeit} placeholder.
  function vlMomentFrame(){
    var n = state.formations.length, c = Math.max(0, Math.min(n - 1, parseFloat(vlMoment.value) || 0));
    var i = Math.floor(c), t = c - i, seg, at;
    if(t < 0.005 || t > 0.995 || i >= n - 1){
      i = Math.round(c); t = 0;
      seg = {type: 'hold', idx: i};
      at = videoFrameAt(seg, 0);
    }else{
      seg = {type: 'move', from: i, to: i + 1, dur: 1000};
      at = videoFrameAt(seg, t * 1000);
    }
    var dur = state.song && state.song.url ? songDurationSec() : 0, pts = dur ? syncWaypoints(dur) : [];
    var segs = buildVideoSegments(pts.length >= 2 ? pts : null, dur), tMs = 0;
    for(var j = 0; j < segs.length; j++){
      var s = segs[j];
      if(s.type === 'move' ? s.from === i : (!t && s.idx === i)){ if(s.type === 'move') tMs += t * s.dur; break; }
      tMs += s.dur;
    }
    var f = state.formations[i], sec = Math.floor(tMs / 1000);
    var label = (t ? 'Weg von Bild ' + (i + 1) + ' zu Bild ' + (i + 2) + ' (' + Math.round(t * 100) + ' %)' : 'Bild ' + (i + 1) + ' „' + (f.name || '') + '“') +
      ' · ' + Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60);
    return {seg: seg, at: at, tMs: tMs, label: label};
  }

  function vlRender(){
    vlRenderQueued = false;
    if(vlBackdrop.hidden) return;
    var F = vlSize(), aw = vlFrameWrap.clientWidth;
    // On a phone the preview sits above the controls and takes only what the frame needs.
    vlFrameWrap.style.height = vlNarrow.matches ? Math.round(Math.min(window.innerHeight * 0.42, aw * F.h / F.w)) + 'px' : '';
    var sc = Math.min(aw / F.w, vlFrameWrap.clientHeight / F.h);
    if(!(sc > 0)) return;
    var dw = Math.floor(F.w * sc), dh = Math.floor(F.h * sc), dpr = window.devicePixelRatio || 1;
    vlFrame.style.width = dw + 'px';
    vlFrame.style.height = dh + 'px';
    vlCanvas.width = Math.round(dw * dpr);
    vlCanvas.height = Math.round(dh * dpr);
    var ctx = vlCanvas.getContext('2d');
    ctx.setTransform(vlCanvas.width / F.w, 0, 0, vlCanvas.height / F.h, 0, 0);
    var m = vlMomentFrame();
    renderCanvasFrame(ctx, F.w, F.h, m.at.pos, vlLogo.img, vlOpts.focus, ghostsFor(m.seg), m.at.cursor, {tMs: m.tMs, who: vlOpts.who});
    vlMomentText.textContent = m.label;
  }
  function vlQueueRender(){
    if(vlRenderQueued) return;
    vlRenderQueued = true;
    requestAnimationFrame(vlRender);
  }

  /* ---------- boxes over the preview ---------- */

  function vlPlaceBox(box, el){
    var F = vlSize();
    box.style.left = (el.x / F.w * 100) + '%';
    box.style.top = (el.y / F.h * 100) + '%';
    box.style.width = (el.w / F.w * 100) + '%';
    box.style.height = (el.h / F.h * 100) + '%';
  }
  function vlBoxFor(id){ return vlBoxes.querySelector('.vl-box[data-id="' + id + '"]'); }
  function vlLabelBox(box, el){ box.setAttribute('aria-label', vlName(el) + (el.hidden ? ' (ausgeblendet)' : '') + ' – ziehen oder mit den Pfeiltasten verschieben'); }

  // A box per shown element, in drawing order (so the topmost catches the tap); a hidden element
  // gets a striped one while it is selected, so it can still be placed.
  function vlRenderBoxes(){
    vlBoxes.textContent = '';
    vlLayout().els.forEach(function(el){
      if(el.hidden && el.id !== vlSelected) return;
      var box = document.createElement('div');
      box.className = 'vl-box' + (el.hidden ? ' is-off' : '');
      box.dataset.id = el.id;
      // An image this device doesn't have (shared choreo): a placeholder here, nothing in the video.
      if(el.type === 'image' && vlImageMissing(el.img)){
        box.classList.add('is-missing');
        box.dataset.missing = 'Grafik fehlt auf diesem Gerät';
      }
      box.tabIndex = 0;
      box.setAttribute('role', 'button');
      vlLabelBox(box, el);
      vlPlaceBox(box, el);
      vlBoxes.appendChild(box);
    });
    vlSyncSelection();
  }
  // Marks the selected box and gives it the corner handles, without rebuilding the others (a drag
  // may just have started on one of them).
  function vlSyncSelection(){
    Array.prototype.slice.call(vlBoxes.children).forEach(function(box){
      var on = box.dataset.id === vlSelected;
      if(!on && box.classList.contains('is-off')){ box.remove(); return; }
      box.classList.toggle('is-selected', on);
      box.setAttribute('aria-pressed', on ? 'true' : 'false');
      if(on && !box.firstChild){
        ['nw', 'ne', 'sw', 'se'].forEach(function(c){
          var h = document.createElement('div');
          h.className = 'vl-handle';
          h.dataset.corner = c;
          box.appendChild(h);
        });
      }
      if(!on) box.textContent = '';
    });
  }

  function vlSelect(id){
    vlSelected = id;
    var el = vlFind(id);
    if(el && el.hidden && !vlBoxFor(id)) vlRenderBoxes(); else vlSyncSelection();
    vlRenderList();
    vlRenderProps();
  }

  // Box after a corner drag: the opposite corner stays put; logo and images keep their proportion.
  function vlResize(s, corner, dx, dy, keepAspect){
    var west = corner.indexOf('w') !== -1, north = corner.indexOf('n') !== -1;
    var w = Math.max(VL_MIN, s.w + (west ? -dx : dx)), h = Math.max(VL_MIN, s.h + (north ? -dy : dy));
    if(keepAspect){ if(w / s.w > h / s.h) h = w * s.h / s.w; else w = h * s.w / s.h; }
    return {x: west ? s.x + s.w - w : s.x, y: north ? s.y + s.h - h : s.y, w: w, h: h};
  }

  function vlContains(el, px, py){ return px >= el.x && px <= el.x + el.w && py >= el.y && py <= el.y + el.h; }
  // Elements under a frame point, topmost first.
  function vlElementsAt(px, py){
    return vlLayout().els.filter(function(el){ return !el.hidden && vlContains(el, px, py); }).reverse();
  }

  // Hit-testing goes by the frame, not by which box the browser hit: a press inside the selected
  // element drags it even where others lie on top (like design tools); anywhere else it takes the
  // topmost element there. A tap without dragging is handled in vlEndDrag.
  vlBoxes.addEventListener('pointerdown', function(e){
    if(e.button > 0 || vlDrag) return;
    var r = vlBoxes.getBoundingClientRect(), F = vlSize();
    var px = (e.clientX - r.left) / r.width * F.w, py = (e.clientY - r.top) / r.height * F.h;
    var handle = e.target.closest('.vl-handle'), sel = vlFind(vlSelected), under = vlElementsAt(px, py);
    var el = (handle || (sel && vlContains(sel, px, py))) ? sel : under[0];
    if(!el) return;
    e.preventDefault();
    var wasSelected = vlSelected === el.id;
    if(!wasSelected) vlSelect(el.id);
    var box = vlBoxFor(el.id);
    if(box) box.focus({preventScroll: true});
    vlDrag = {
      id: el.id, box: box, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, kx: F.w / r.width, ky: F.h / r.height,
      under: under, start: {x: el.x, y: el.y, w: el.w, h: el.h}, corner: handle ? handle.dataset.corner : null, moved: false, wasSelected: wasSelected
    };
    vlBoxes.setPointerCapture(e.pointerId);
  });
  vlBoxes.addEventListener('pointermove', function(e){
    var d = vlDrag;
    if(!d || e.pointerId !== d.pointerId) return;
    if(!d.moved && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 4) return; // a tap, not a drag
    d.moved = true;
    var el = vlEditable(d.id);
    if(!el){ vlDrag = null; return; }
    var dx = (e.clientX - d.x0) * d.kx, dy = (e.clientY - d.y0) * d.ky, s = d.start;
    var b = d.corner ? vlResize(s, d.corner, dx, dy, vlKeepsAspect(el)) : {x: s.x + dx, y: s.y + dy, w: s.w, h: s.h};
    vlSnap(el, b, 8 * d.kx, d.corner, vlKeepsAspect(el));
    el.x = Math.round(b.x); el.y = Math.round(b.y); el.w = Math.round(b.w); el.h = Math.round(b.h);
    if(d.corner && el.type === 'text'){
      // A text's width sets its line breaks and so its height; with a background it may be taller.
      var dragged = el.h;
      vlFitText(el);
      if(el.bg) el.h = Math.max(el.h, dragged);
      if(d.corner.indexOf('n') !== -1) el.y = s.y + s.h - el.h;
    }
    vlPlaceBox(d.box, el);
    vlSyncGeomInputs(el);
    vlQueueRender();
  });
  // Snapping while moving: the box's left edge, middle or right edge (and top, middle, bottom) catches
  // on the frame's and every other shown element's within tol; while resizing, the dragged edges do
  // (#2166). A guide line shows where.
  function vlSnap(el, b, tol, corner, keepAspect){
    var F = vlSize(), xs = [0, F.w / 2, F.w], ys = [0, F.h / 2, F.h];
    vlLayout().els.forEach(function(o){
      if(o.id === el.id || o.hidden) return;
      xs.push(o.x, o.x + o.w / 2, o.x + o.w);
      ys.push(o.y, o.y + o.h / 2, o.y + o.h);
    });
    function best(pos, size, lines){
      var r = null;
      [0, size / 2, size].forEach(function(off){
        lines.forEach(function(l){ var dd = l - pos - off; if(Math.abs(dd) <= tol && (!r || Math.abs(dd) < Math.abs(r.d))) r = {d: dd, at: l}; });
      });
      return r;
    }
    var on = vlSnapToggle.checked, sx = null, sy = null;
    if(on && !corner){
      sx = best(b.x, b.w, xs); sy = best(b.y, b.h, ys);
      if(sx) b.x += sx.d;
      if(sy) b.y += sy.d;
    }else if(on){
      var west = corner.indexOf('w') !== -1, north = corner.indexOf('n') !== -1, b0 = {x: b.x, y: b.y, w: b.w, h: b.h};
      sx = best(west ? b.x : b.x + b.w, 0, xs); sy = best(north ? b.y : b.y + b.h, 0, ys);
      // Logo and images: the nearer catch drives, the proportion sets the other side.
      if(keepAspect && sx && sy){ if(Math.abs(sx.d) <= Math.abs(sy.d)) sy = null; else sx = null; }
      if(sx){ if(west){ b.x += sx.d; b.w -= sx.d; } else b.w += sx.d; }
      if(sy){ if(north){ b.y += sy.d; b.h -= sy.d; } else b.h += sy.d; }
      if(keepAspect && sx){ var h = b.w * b0.h / b0.w; if(north) b.y += b.h - h; b.h = h; }
      if(keepAspect && sy){ var w = b.h * b0.w / b0.h; if(west) b.x += b.w - w; b.w = w; }
      if(b.w < VL_MIN || b.h < VL_MIN){ b.x = b0.x; b.y = b0.y; b.w = b0.w; b.h = b0.h; sx = sy = null; }
    }
    vlGuides[0].hidden = !sx;
    vlGuides[1].hidden = !sy;
    if(sx) vlGuides[0].style.left = (sx.at / F.w * 100) + '%';
    if(sy) vlGuides[1].style.top = (sy.at / F.h * 100) + '%';
  }

  function vlEndDrag(e){
    var d = vlDrag;
    if(!d || e.pointerId !== d.pointerId) return;
    vlDrag = null;
    vlGuides.forEach(function(g){ g.hidden = true; });
    if(d.moved){ vlSave(true); return; }
    // A tap on the selected element: where it is the topmost one, the next tap goes to the one
    // underneath (and round again); where others cover it, to the topmost one there.
    if(!d.wasSelected || d.corner || e.type === 'pointercancel' || !d.under.length) return;
    var i = d.under.map(function(el){ return el.id; }).indexOf(d.id);
    var next = (i === 0 ? d.under[1 % d.under.length] : d.under[0]).id;
    if(next === d.id) return;
    vlSelect(next);
    var box = vlBoxFor(next);
    if(box) box.focus({preventScroll: true});
  }
  vlBoxes.addEventListener('pointerup', vlEndDrag);
  vlBoxes.addEventListener('pointercancel', vlEndDrag);
  vlBoxes.addEventListener('focusin', function(e){
    var box = e.target.closest('.vl-box');
    if(box && box.dataset.id !== vlSelected && !vlDrag) vlSelect(box.dataset.id);
  });
  // Arrow keys move the focused element by 10, with Shift by 1; Entf deletes a text or image.
  vlBoxes.addEventListener('keydown', function(e){
    var box = e.target.closest('.vl-box');
    if(box && (e.key === 'Delete' || e.key === 'Backspace')){ e.preventDefault(); vlDelete(box.dataset.id); return; }
    var d = box && {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[e.key];
    if(!d || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    var el = vlEditable(box.dataset.id), step = e.shiftKey ? 1 : 10;
    el.x = Math.round(el.x + d[0] * step);
    el.y = Math.round(el.y + d[1] * step);
    vlPlaceBox(box, el);
    vlSyncGeomInputs(el);
    vlQueueRender();
    vlSave(false);
  });

  /* ---------- element list ---------- */

  function vlRenderList(){
    vlList.textContent = '';
    // Topmost first, like layers.
    vlLayout().els.slice().reverse().forEach(function(el){
      var row = document.createElement('div');
      row.className = 'vl-row' + (el.id === vlSelected ? ' is-selected' : '') + (el.hidden ? ' is-off' : '');
      row.setAttribute('role', 'listitem');
      row.dataset.id = el.id;
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !el.hidden;
      cb.title = 'Im Video zeigen';
      cb.setAttribute('aria-label', vlName(el) + ' im Video zeigen');
      cb.addEventListener('change', function(){
        var e2 = vlEditable(el.id);
        if(!e2) return;
        if(cb.checked) delete e2.hidden; else e2.hidden = true;
        vlSave(true);
        vlRenderBoxes();
        vlRenderList();
        vlQueueRender();
        var again = vlList.querySelector('.vl-row[data-id="' + el.id + '"] input');
        if(again) again.focus();
      });
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vl-row-name';
      btn.textContent = vlName(el);
      btn.setAttribute('aria-pressed', el.id === vlSelected ? 'true' : 'false');
      btn.addEventListener('click', function(){
        vlSelect(el.id);
        var again = vlList.querySelector('.vl-row[data-id="' + el.id + '"] .vl-row-name');
        if(again) again.focus();
      });
      row.appendChild(cb);
      row.appendChild(btn);
      vlList.appendChild(row);
    });
  }

  /* ---------- properties of the selected element ---------- */

  function vlColorHex(c){
    if(VIDEO_HEX_RE.test(c)) return c;
    var m = /^rgba\((\d+),(\d+),(\d+)/.exec(c || '');
    return m ? '#' + [m[1], m[2], m[3]].map(function(n){ return ('0' + (+n).toString(16)).slice(-2); }).join('') : '#ffffff';
  }

  // Small builders for the property controls; each writes its key on the element and saves.
  function vlSet(id, key, value, now){
    var el = vlEditable(id);
    if(!el) return;
    el[key] = value;
    vlQueueRender();
    vlSave(now);
  }
  function vlCheck(el, key, label, onChange){
    var lab = document.createElement('label');
    lab.className = 'toggle-label';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!el[key];
    cb.addEventListener('change', function(){ if(onChange) onChange(cb.checked); else vlSet(el.id, key, cb.checked, true); });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(' ' + label));
    return lab;
  }
  function vlRange(el, key, label, min, max, step, unit){
    var lab = document.createElement('label');
    lab.className = 'vl-range';
    var text = document.createElement('span');
    text.textContent = label;
    var inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = el[key];
    var out = document.createElement('output');
    function show(){ out.textContent = String(+inp.value).replace('.', ',') + ' ' + unit; }
    show();
    inp.addEventListener('input', function(){ show(); vlSet(el.id, key, +inp.value, false); });
    lab.appendChild(text); lab.appendChild(inp); lab.appendChild(out);
    return lab;
  }
  function vlColor(el, key, label){
    var lab = document.createElement('label');
    lab.className = 'vl-color';
    var inp = document.createElement('input');
    inp.type = 'color';
    inp.value = vlColorHex(el[key]);
    inp.addEventListener('input', function(){ vlSet(el.id, key, inp.value, false); });
    lab.appendChild(inp);
    lab.appendChild(document.createTextNode(label));
    return lab;
  }
  function vlSelectCtl(el, key, label, options, onChange){
    var row = document.createElement('label');
    row.className = 'settings-row';
    var text = document.createElement('span');
    text.className = 'caption';
    text.textContent = label;
    var sel = document.createElement('select');
    options.forEach(function(o){
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      sel.appendChild(opt);
    });
    sel.value = el[key];
    sel.addEventListener('change', function(){ if(onChange) onChange(sel.value); else vlSet(el.id, key, sel.value, true); });
    row.appendChild(text); row.appendChild(sel);
    return row;
  }
  function vlHint(text){
    var p = document.createElement('p');
    p.className = 'settings-hint';
    p.textContent = text;
    return p;
  }

  /* ---------- texts (and later images): add, duplicate, delete ---------- */

  var VL_PLACEHOLDERS = [
    ['{choreo}', 'Name der Choreo'], ['{bild}', 'Name des Bilds'], ['{nr}', 'Nummer des Bilds'], ['{anzahl}', 'Anzahl der Bilder'],
    ['{abschnitt}', 'Abschnitt'], ['{zeit}', 'Zeit im Video'], ['{notiz}', 'Notiz zum Bild'], ['{wer}', 'Wer im Schritte-Video zu sehen ist'],
    ['{takt}', 'Nummer des Takts'], ['{rhythmus}', 'Phrasierung des Takts'], ['{figur}', 'Figur des Takts'],
    ['{uebergang}', 'Name des Übergangs, der gerade getanzt wird']
  ];
  var vlMeasureCtx = document.createElement('canvas').getContext('2d');

  // A text box is as high as its lines at the preview's moment (the box then frames what is drawn).
  function vlFitText(el){
    var m = vlBackdrop.hidden ? null : vlMomentFrame();
    var text = videoTextFor(el, m ? m.at.cursor : 0, {tMs: m ? m.tMs : 0, who: vlOpts.who}) || el.text;
    if(el.upper) text = text.toUpperCase();
    var font = (el.bold ? '700 ' : '500 ') + el.size + 'px ' + (el.font === 'mono' ? '"JetBrains Mono", monospace' : '"Manrope",sans-serif');
    var pad = el.bg ? Math.round(el.size * 0.5) : 0, lines = 0;
    text.split('\n').forEach(function(p){ lines += wrapCanvasText(vlMeasureCtx, p, el.w - pad * 2, font).length; });
    el.h = Math.max(VL_MIN, Math.round(lines * el.size * 4 / 3 + pad * 2));
  }

  function vlDeletable(el){ return el.type === 'text' || el.type === 'image'; }

  function vlAddElement(el, index){
    var layout = vlEditable();
    layout.els.splice(index === undefined ? layout.els.length : index, 0, el);
    vlSelected = el.id;
    vlSave(true);
    vlRefresh();
    var box = vlBoxFor(el.id);
    if(box) box.focus({preventScroll: true});
  }
  function vlDuplicate(id){
    var layout = vlEditable(), i = layout.els.map(function(el){ return el.id; }).indexOf(id);
    if(i === -1) return;
    var copy = JSON.parse(JSON.stringify(layout.els[i]));
    copy.id = uid('ve');
    copy.x += 20;
    copy.y += 20;
    vlAddElement(copy, i + 1);
  }
  function vlDelete(id){
    var layout = vlEditable(), i = layout.els.map(function(el){ return el.id; }).indexOf(id);
    if(i === -1 || !vlDeletable(layout.els[i])) return;
    layout.els.splice(i, 1);
    vlSelected = (layout.els[i - 1] || layout.els[0] || {}).id || null;
    vlSave(true);
    vlRefresh();
    var box = vlBoxFor(vlSelected);
    if(box) box.focus({preventScroll: true});
  }

  function vlAddText(text, box, size){
    var F = vlSize();
    box = box || {x: F.w * 0.25, y: F.h * 0.06, w: F.w * 0.5};
    var el = {id: uid('ve'), type: 'text', x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: 54,
      text: text, font: 'sans', size: size || 40, bold: true, upper: false, color: '#ffffff', align: 'center', bg: ''};
    vlFitText(el);
    vlAddElement(el);
  }
  document.getElementById('vlAddTextBtn').addEventListener('click', function(){ vlAddText('Neuer Text'); });
  // The bar heard in each moment (Musik & Takte, js/beats.js): at the foot of the Bild names, where
  // the standard layouts have room, else of the frame's middle.
  document.getElementById('vlAddBarBtn').addEventListener('click', function(){
    var F = vlSize(), n = currentVideoLayout().els.filter(function(e){ return e.type === 'bilder'; })[0] || {x: F.w * 0.25, y: 0, w: F.w * 0.5, h: F.h};
    vlAddText('Takt {takt}  {rhythmus}\n{figur}', {x: n.x + n.w * 0.08, y: n.y + n.h * 0.8, w: n.w * 0.84}, Math.round(Math.min(48, Math.max(24, n.w * 0.08))));
  });

  function vlTextProps(el){
    var field = document.createElement('label');
    field.className = 'vl-field';
    field.appendChild(document.createTextNode('Text'));
    var ta = document.createElement('textarea');
    ta.value = el.text;
    ta.maxLength = 500;
    ta.rows = 3;
    function changed(now){
      var e2 = vlEditable(el.id);
      if(!e2) return;
      e2.text = ta.value;
      vlProps.querySelector('h3').textContent = vlName(e2);
      var rowName = vlList.querySelector('.vl-row[data-id="' + el.id + '"] .vl-row-name');
      if(rowName){
        rowName.textContent = vlName(e2);
        rowName.parentNode.querySelector('input').setAttribute('aria-label', vlName(e2) + ' im Video zeigen');
      }
      vlFitText(e2);
      var box = vlBoxFor(el.id);
      if(box){ vlPlaceBox(box, e2); vlLabelBox(box, e2); }
      vlSyncGeomInputs(e2);
      vlQueueRender();
      vlSave(now);
    }
    ta.addEventListener('input', function(){ changed(false); });
    field.appendChild(ta);
    vlProps.appendChild(field);

    // Placeholders: a tap puts one in at the cursor.
    var chips = document.createElement('div');
    chips.className = 'video-sections';
    VL_PLACEHOLDERS.forEach(function(p){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'video-chip';
      b.textContent = p[0];
      b.title = p[1];
      b.setAttribute('aria-label', 'Platzhalter ' + p[0] + ' einfügen: ' + p[1]);
      b.addEventListener('click', function(){
        var s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = (ta.value.slice(0, s) + p[0] + ta.value.slice(e)).slice(0, 500);
        ta.focus();
        ta.setSelectionRange(s + p[0].length, s + p[0].length);
        changed(true);
        vlRenderList();
      });
      chips.appendChild(b);
    });
    vlProps.appendChild(chips);
    vlProps.appendChild(vlHint('Platzhalter werden in jedem Moment des Videos ersetzt: ' + VL_PLACEHOLDERS.map(function(p){ return p[0] + ' ' + p[1]; }).join(', ') +
      '. Sind alle Platzhalter eines Texts gerade leer – etwa noch kein Abschnitt –, bleibt er weg.'));

    // Look: every change refits the box height.
    function refit(){ var e2 = vlEditable(el.id); if(e2){ vlFitText(e2); var box = vlBoxFor(el.id); if(box) vlPlaceBox(box, e2); vlSyncGeomInputs(e2); } }
    var size = vlRange(el, 'size', 'Schriftgröße', 10, 160, 1, 'px');
    size.querySelector('input').addEventListener('input', refit);
    vlProps.appendChild(size);
    vlProps.appendChild(vlSelectCtl(el, 'font', 'Schrift', [['sans', 'Manrope'], ['mono', 'JetBrains Mono']], function(v){ vlSet(el.id, 'font', v, true); refit(); }));
    vlProps.appendChild(vlSelectCtl(el, 'align', 'Ausrichtung', [['left', 'Links'], ['center', 'Mitte'], ['right', 'Rechts']]));
    [['bold', 'Fett'], ['upper', 'Großbuchstaben']].forEach(function(c){
      var lab = vlCheck(el, c[0], c[1]);
      lab.querySelector('input').addEventListener('change', refit);
      vlProps.appendChild(lab);
    });
    vlProps.appendChild(vlColor(el, 'color', 'Schriftfarbe'));
    vlProps.appendChild(vlCheck({id: el.id, on: !!el.bg}, 'on', 'Hintergrund hinter dem Text', function(on){
      vlSet(el.id, 'bg', on ? '#150f1c' : '', true);
      refit();
      vlRenderProps();
    }));
    if(el.bg) vlProps.appendChild(vlColor(el, 'bg', 'Hintergrundfarbe'));
  }

  // Layer order: one step up or down in els (drawing order). The focus stays on the button pressed,
  // or moves to the other one once the element reached the top or bottom.
  function vlMoveLayer(id, by){
    var els = vlEditable().els, i = els.map(function(el){ return el.id; }).indexOf(id), j = i + by;
    if(i === -1 || j < 0 || j >= els.length) return;
    els.splice(j, 0, els.splice(i, 1)[0]);
    vlSave(true);
    vlRefresh();
    var btns = vlProps.querySelectorAll('[data-layer]'), b = btns[by > 0 ? 0 : 1];
    if(b && b.disabled) b = btns[by > 0 ? 1 : 0];
    if(b) b.focus();
  }

  function vlElementActions(el){
    var row = document.createElement('div');
    row.className = 'vl-actions';
    var els = vlLayout().els, i = els.map(function(e){ return e.id; }).indexOf(el.id);
    function button(text, cls, onClick){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = text;
      b.addEventListener('click', onClick);
      row.appendChild(b);
      return b;
    }
    var up = button('Nach vorn', 'btn-ghost', function(){ vlMoveLayer(el.id, 1); });
    up.dataset.layer = '1';
    up.disabled = i === els.length - 1;
    var down = button('Nach hinten', 'btn-ghost', function(){ vlMoveLayer(el.id, -1); });
    down.dataset.layer = '-1';
    down.disabled = i === 0;
    if(vlDeletable(el)){
      button('Duplizieren', 'btn-ghost', function(){ vlDuplicate(el.id); });
      button('Löschen', 'btn-ghost danger', function(){ vlDelete(el.id); });
    }
    vlProps.appendChild(row);
  }

  function vlSyncGeomInputs(el, except){
    Array.prototype.forEach.call(vlProps.querySelectorAll('[data-geom]'), function(inp){
      if(inp !== except && document.activeElement !== inp) inp.value = Math.round(el[inp.dataset.geom]);
    });
  }

  function vlRenderProps(){
    vlProps.textContent = '';
    var el = vlFind(vlSelected);
    vlProps.hidden = !el;
    if(!el) return;
    var F = vlSize();
    var h3 = document.createElement('h3');
    h3.textContent = vlName(el);
    vlProps.appendChild(h3);

    var geom = document.createElement('div');
    geom.className = 'vl-geom';
    [['x', 'X'], ['y', 'Y'], ['w', 'Breite'], ['h', 'Höhe']].forEach(function(g){
      var lab = document.createElement('label');
      lab.textContent = g[1];
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.step = '1';
      inp.value = Math.round(el[g[0]]);
      inp.dataset.geom = g[0];
      inp.addEventListener('input', function(){
        var v = parseFloat(inp.value), e2 = vlEditable(el.id);
        if(!isFinite(v) || !e2) return;
        var key = g[0], ratio = e2.w / e2.h;
        if(key === 'w' || key === 'h') v = Math.max(VL_MIN, v);
        e2[key] = v;
        if(vlKeepsAspect(e2) && key === 'w') e2.h = Math.round(v / ratio);
        if(vlKeepsAspect(e2) && key === 'h') e2.w = Math.round(v * ratio);
        vlSyncGeomInputs(e2, inp);
        var box = vlBoxFor(el.id);
        if(box) vlPlaceBox(box, e2);
        vlQueueRender();
        vlSave(false);
      });
      lab.appendChild(inp);
      geom.appendChild(lab);
    });
    vlProps.appendChild(geom);
    vlProps.appendChild(vlHint('In Pixeln des Video-Bilds (' + F.w + ' × ' + F.h + ').'));

    if(el.type === 'stage'){
      vlProps.appendChild(vlCheck(el, 'grid', 'Raster'));
      vlProps.appendChild(vlRange(el, 'line', 'Linienstärke', 0.5, 6, 0.5, 'px'));
      vlProps.appendChild(vlCheck(el, 'nums', 'Meterzahlen am Raster'));
      vlProps.appendChild(vlRange(el, 'dot', 'Punktgröße', 50, 200, 5, '%'));
      vlProps.appendChild(vlCheck(el, 'initials', 'Kürzel in den Punkten'));
      vlProps.appendChild(vlCheck(el, 'names', 'Namen über den Punkten'));
      vlProps.appendChild(vlCheck(el, 'room', 'Raumseiten (Wand, Spiegel …)'));
      var floorMode = el.floor === 'none' ? 'none' : el.floor ? 'color' : '';
      vlProps.appendChild(vlSelectCtl({id: el.id, mode: floorMode}, 'mode', 'Boden', [['', 'Standard-Verlauf'], ['color', 'Eigene Farbe'], ['none', 'Keiner']], function(v){
        vlSet(el.id, 'floor', v === 'color' ? '#241a30' : v, true);
        vlRenderProps();
      }));
      if(floorMode === 'color') vlProps.appendChild(vlColor(el, 'floor', 'Bodenfarbe'));
      vlProps.appendChild(vlHint('Weglinien, Herkunfts- und Zielpunkte und das Hellgrau anderer Paare wählst du im Exportieren-Dialog, die Blickrichtungs-Pfeile in den Einstellungen – die Vorschau zeigt sie, wie sie dort stehen.'));
    }else if(el.type === 'bilder'){
      vlProps.appendChild(vlRange(el, 'size', 'Schriftgröße', 50, 250, 5, '%'));
      vlProps.appendChild(vlColor(el, 'color', 'Schriftfarbe'));
      vlProps.appendChild(vlCheck(el, 'divider', 'Trennlinie rechts'));
      vlProps.appendChild(vlHint('Die Namen der Bilder laufen mit dem Video durch, das aktuelle groß in der Mitte.'));
    }else if(el.type === 'logo'){
      vlProps.appendChild(vlHint(state.logo ? 'Bild und Deckkraft des Logos stellst du in den Einstellungen ein.' : 'Noch kein Logo – du lädst es in den Einstellungen hoch.'));
    }else if(el.type === 'text'){
      vlTextProps(el);
    }else if(el.type === 'image'){
      vlProps.appendChild(vlRange(el, 'opacity', 'Deckkraft', 5, 100, 5, '%'));
      if(vlImageMissing(el.img)) vlProps.appendChild(vlHint('Diese Grafik ist auf diesem Gerät nicht gespeichert – Grafiken reisen mit der .stg-Datei, aber nicht mit einem Teilen-Link. Das Video lässt sie weg.'));
      else vlProps.appendChild(vlHint('Grafiken bleiben auf diesem Gerät und in der .stg-Datei; über einen Teilen-Link sehen andere nur einen Platzhalter.'));
    }
    vlElementActions(el);
  }

  /* ---------- open / close ---------- */

  function vlLoadLogo(){
    var url = state.logo && state.logo.url ? state.logo.url : null;
    if(url === vlLogo.url) return;
    vlLogo = {url: url, img: null};
    if(url) loadImage(url).then(function(img){ if(vlLogo.url === url){ vlLogo.img = img; vlQueueRender(); } }, function(){});
  }

  function vlSyncMoment(keep){
    var n = state.formations.length;
    vlMoment.max = Math.max(0, n - 1);
    vlMoment.disabled = n < 2;
    if(!keep) vlMoment.value = state.activeIndex;
  }

  // Another format: the built-in elements take that format's standard place; texts and graphics keep
  // their spot relative to the frame and their size (by area, so switching back and forth doesn't
  // shrink them), only made smaller where they wouldn't fit.
  function vlSetFormat(format){
    var layout = vlEditable(), F0 = VIDEO_FORMATS[layout.format], F1 = VIDEO_FORMATS[format];
    if(!F1 || format === layout.format) return;
    var def = defaultVideoLayout(format), k = Math.sqrt(F1.w * F1.h / (F0.w * F0.h));
    layout.format = format;
    layout.els.forEach(function(el){
      var d = def.els.filter(function(x){ return x.id === el.id; })[0];
      if(d){ ['x', 'y', 'w', 'h', 'size', 'divider'].forEach(function(key){ if(key in d) el[key] = d[key]; }); return; }
      var cx = (el.x + el.w / 2) / F0.w * F1.w, cy = (el.y + el.h / 2) / F0.h * F1.h;
      if(el.type === 'text'){
        var dragged = el.h * k;
        el.size = Math.max(6, Math.round(el.size * k));
        el.w = Math.round(Math.min(el.w * k, F1.w));
        vlFitText(el);
        if(el.bg) el.h = Math.round(Math.min(Math.max(el.h, dragged), F1.h));
      }else{
        var s = Math.min(k, F1.w / el.w, F1.h / el.h);
        el.w = Math.round(el.w * s);
        el.h = Math.round(el.h * s);
      }
      el.x = Math.round(Math.max(0, Math.min(F1.w - el.w, cx - el.w / 2)));
      el.y = Math.round(Math.max(0, Math.min(F1.h - el.h, cy - el.h / 2)));
    });
    vlSave(true);
    vlRefresh();
  }

  function vlRefresh(){
    vlFormat.value = vlLayout().format;
    vlBg.value = vlLayout().bg;
    if(!vlFind(vlSelected)) vlSelected = vlFind('stage') ? 'stage' : null;
    vlRenderBoxes();
    vlRenderList();
    vlRenderProps();
    vlQueueRender();
  }

  function openVideoLayout(){
    if(!state.formations.length) return;
    vlFromExport = !exportBackdrop.hidden;
    exportBackdrop.hidden = true;
    vlBackdrop.hidden = false;
    vlOpts = vlExportOptions();
    vlSyncMoment(false);
    vlLoadLogo();
    vlRefresh();
    vlResetSteps();
    requestAnimationFrame(function(){
      var box = vlBoxFor(vlSelected);
      if(box) box.focus({preventScroll: true});
    });
  }
  function closeVideoLayout(){
    vlDrag = null;
    saveStateDebounced.flush();
    vlBackdrop.hidden = true;
    if(vlFromExport){
      exportBackdrop.hidden = false;
      syncExportDialog();
      document.getElementById('exportLayoutBtn').focus();
    }
  }

  // After the whole state was swapped (Rückgängig, a share update, an import — fullRerender).
  function refreshVideoLayoutBuilder(){
    if(vlBackdrop.hidden) return;
    vlDrag = null;
    exportPathCache = {};
    vlSyncMoment(true);
    vlLoadLogo();
    vlRefresh();
    vlResetSteps(); // the old steps may undo what came in
  }

  // .stg import: the layout from the file's header JSON. parseStg itself builds its state from a
  // fixed list of fields, so this reads it next to it (same "STG1 | headerLen | header" start).
  // The layout's images come from the trailer appendStgVideoImages() wrote; a damaged trailer only
  // costs the images (their elements show the placeholder), never the import.
  function readStgVideoExtras(buf, parsed){
    var len = new DataView(buf).getUint32(4, true);
    var header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, len)));
    parsed.videoLayout = sanitizeVideoLayout(header.videoLayout);
    var n = buf.byteLength;
    if(!parsed.videoLayout || n < 12 || String.fromCharCode.apply(null, new Uint8Array(buf, n - 4, 4)) !== 'VIMG') return parsed;
    try{
      var jsonLen = new DataView(buf).getUint32(n - 8, true);
      var meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, n - 8 - jsonLen, jsonLen)));
      var off = n - 8 - jsonLen - meta.reduce(function(sum, m){ return sum + m.size; }, 0), newIds = {};
      if(!(off >= 0)) return parsed;
      meta.forEach(function(m){
        var size = m.size;
        if(!(size >= 0 && size === Math.floor(size)) || typeof m.id !== 'string') throw new Error('bad image entry');
        var mime = typeof m.mime === 'string' && /^image\/[\w.+-]+$/.test(m.mime) ? m.mime : 'image/png';
        // Fresh ids, so a file can never overwrite a picture another project on this device uses.
        newIds[m.id] = uid('vimg');
        vlStoreImage(newIds[m.id], {name: String(m.name || '').slice(0, 80), mime: mime, blob: new Blob([buf.slice(off, off + size)], {type: mime})});
        off += size;
      });
      parsed.videoLayout.els.forEach(function(el){ if(el.type === 'image' && newIds[el.img]) el.img = newIds[el.img]; });
    }catch(e){ console.error(e); }
    return parsed;
  }

  /* ---------- images: bytes in IndexedDB, only their id in the layout ----------
     Each picture is its own record 'vimg:<id>' in the blobs store (js/state.js) — never in the
     localStorage save, history snapshots or the share payload, which carry the layout with ids only.
     Ids are unique across projects, so a copied project („Neue Choreo → Kopie“) simply shares them;
     vlCollectImages() drops the ones no saved project uses any more.
     shortcut: images are not uploaded with share links (the share API has no storage for them), so
     on other devices an image element shows the „fehlt“ placeholder and the video leaves it out;
     upgrade by adding them to the share upload (attachShareMedia in js/share.js + api/share) once
     shared choreos need them. */
  var vlImages = {}; // id -> {img: HTMLImageElement|null, missing: bool, promise}

  function vlStoreImage(id, rec){
    rec.addedAt = Date.now();
    idbPut('vimg:' + id, rec);
    vlImages[id] = {img: null, missing: false, promise: loadImage(URL.createObjectURL(rec.blob)).then(function(img){ vlImages[id].img = img; }, function(){ vlImages[id].missing = true; })};
    return vlImages[id].promise;
  }
  // Resolves once the image is ready or known to be missing (never rejects).
  function vlLoadImage(id){
    if(vlImages[id]) return vlImages[id].promise;
    var entry = vlImages[id] = {img: null, missing: false, promise: null};
    entry.promise = idbGet('vimg:' + id).then(function(rec){
      if(!rec || !rec.blob) throw new Error('missing');
      return loadImage(URL.createObjectURL(rec.blob));
    }).then(function(img){ entry.img = img; }, function(){ entry.missing = true; }).then(function(){
      vlQueueRender();
      if(entry.missing && !vlBackdrop.hidden) vlRenderBoxes();
    });
    return entry.promise;
  }
  // For renderCanvasFrame (js/export.js): the image if it is loaded, else null (and it starts loading).
  function videoImageFor(id){
    if(!id) return null;
    if(!vlImages[id]) vlLoadImage(id);
    return vlImages[id].img;
  }
  function vlImageMissing(id){ return !id || !!(vlImages[id] && vlImages[id].missing); }
  function videoLayoutImageIds(layout){
    var ids = [];
    ((layout && layout.els) || []).forEach(function(el){ if(el.type === 'image' && el.img && ids.indexOf(el.img) === -1) ids.push(el.img); });
    return ids;
  }
  // Before an export starts: every image of the layout loaded (or found missing).
  function loadVideoImages(){ return Promise.all(videoLayoutImageIds(state.videoLayout).map(vlLoadImage)); }

  // .stg: the layout's images ride at the very end of the file, after everything parseStg reads:
  //   … | image bytes, one after the other | JSON [{id, name, mime, size}] | uint32LE JSON length | "VIMG"
  // Older app versions stop reading before it; readStgVideoExtras() reads it from the end, so the
  // sections in front of it can change without touching this.
  function appendStgVideoImages(blob){
    var ids = videoLayoutImageIds(state.videoLayout);
    if(!ids.length) return blob;
    return Promise.all(ids.map(function(id){ return idbGet('vimg:' + id); })).then(function(recs){
      var meta = [], parts = [blob];
      recs.forEach(function(rec, i){
        if(!rec || !rec.blob) return;
        meta.push({id: ids[i], name: rec.name || '', mime: rec.mime || rec.blob.type, size: rec.blob.size});
        parts.push(rec.blob);
      });
      if(!meta.length) return blob;
      var json = new TextEncoder().encode(JSON.stringify(meta));
      parts.push(json, uint32LE(json.byteLength), new TextEncoder().encode('VIMG'));
      return new Blob(parts, {type: 'application/octet-stream'});
    });
  }

  // Deletes image records no project saved on this device refers to any more. Records younger than a
  // day stay: another tab may have just added one whose layout isn't saved yet, and undo may want it.
  function vlCollectImages(){
    var keep = {};
    function mark(layout){ videoLayoutImageIds(layout).forEach(function(id){ keep[id] = true; }); }
    mark(state.videoLayout);
    readProjectIndex().map(projectStorageKey).concat([STORAGE_KEY]).forEach(function(key){
      try{ mark((JSON.parse(localStorage.getItem(key)) || {}).videoLayout); }catch(e){}
    });
    idbOpen().then(function(db){
      var req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).openCursor();
      req.onsuccess = function(){
        var cur = req.result;
        if(!cur) return;
        var key = String(cur.key);
        if(key.indexOf('vimg:') === 0 && !keep[key.slice(5)] && !(cur.value && cur.value.addedAt > Date.now() - 864e5)) cur.delete();
        cur.continue();
      };
    }).catch(function(){});
  }
  setTimeout(vlCollectImages, 15000);

  var vlImageInput = document.getElementById('vlImageInput');
  document.getElementById('vlAddImageBtn').addEventListener('click', function(){ vlImageInput.click(); });
  vlImageInput.addEventListener('change', function(){
    var file = vlImageInput.files[0];
    vlImageInput.value = '';
    if(!file) return;
    var id = uid('vimg');
    var err = document.getElementById('vlImageError');
    err.hidden = true;
    vlStoreImage(id, {name: file.name.slice(0, 80), mime: file.type || 'image/png', blob: file}).then(function(){
      var img = vlImages[id].img, F = vlSize();
      if(!img){ err.hidden = false; idbDelete('vimg:' + id); return; }
      // As large as fits 40 % of the frame, in proportion, in the middle.
      var s = Math.min(F.w * 0.4 / img.width, F.h * 0.4 / img.height), w = Math.round(img.width * s), h = Math.round(img.height * s);
      vlAddElement({id: uid('ve'), type: 'image', x: Math.round((F.w - w) / 2), y: Math.round((F.h - h) / 2), w: w, h: h, img: id, name: file.name.slice(0, 80), opacity: 100});
    });
  });

  document.getElementById('exportLayoutBtn').addEventListener('click', openVideoLayout);
  document.getElementById('videoLayoutCloseBtn').addEventListener('click', closeVideoLayout);
  document.getElementById('vlDoneBtn').addEventListener('click', closeVideoLayout);
  vlUndoBtn.addEventListener('click', function(){ videoLayoutStep(-1); });
  vlRedoBtn.addEventListener('click', function(){ videoLayoutStep(1); });
  document.getElementById('vlResetBtn').addEventListener('click', function(){
    var format = vlLayout().format;
    state.videoLayout = format === 'quer' ? null : defaultVideoLayout(format);
    vlSelected = 'stage';
    vlSave(true);
    vlRefresh();
  });
  vlFormat.addEventListener('change', function(){ vlSetFormat(vlFormat.value); });
  vlBg.addEventListener('input', function(){
    vlEditable().bg = vlBg.value;
    vlQueueRender();
    vlSave(false);
  });
  vlMoment.addEventListener('input', vlQueueRender);
  var vlBackdropDown = false; // a drag that ends outside the dialog is not a click on the backdrop
  vlBackdrop.addEventListener('pointerdown', function(e){ vlBackdropDown = e.target === vlBackdrop; });
  vlBackdrop.addEventListener('click', function(e){ if(e.target === vlBackdrop && vlBackdropDown) closeVideoLayout(); });
  vlBackdrop.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    e.stopPropagation(); // only this dialog, not the Exportieren dialog it returns to (js/main.js)
    closeVideoLayout();
  });
  if(window.ResizeObserver) new ResizeObserver(vlQueueRender).observe(vlFrameWrap);
  window.addEventListener('resize', vlQueueRender);
