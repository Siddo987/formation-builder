"use strict";

var PALETTE = ['#e0a336','#4fa3a0','#8d79d1','#d1637d','#5b93c4','#8fae4f','#c96b3f','#a688c9'];
  var STORAGE_KEY = 'aufstellung-choreo-v2';
  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Blickrichtungs-Pfeile an den Punkten (Bühne und Video) are state.showFacing, saved with the
  // project. They used to be a per-device choice under this key, which now only seeds projects
  // saved before that (see loadState()).
  var LEGACY_FACING_KEY = 'aufstellung.showFacing';

  // Bühnengröße (#2060): width (x, left–right) × depth (y, front–back) in metres — the grid unit —
  // around the middle, so x runs -w/2..w/2 and y -d/2..d/2. Older choreos are 14 × 14. The floor
  // around it is GRID_INSET % of the longer side on every edge.
  var STAGE_DEFAULT = 14, STAGE_MIN = 4, STAGE_MAX = 40, GRID_INSET = 6;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  // Video frame formats (#2095), in the frame's own units: what state.videoLayout's positions are
  // measured in; the export scales them to the chosen quality. 'quer' is the original 1500 × 800.
  // The sizes stay within the pixel count the H.264 level probed in js/export.js allows at „Hoch“.
  var VIDEO_FORMATS = {quer: {w: 1500, h: 800}, breit: {w: 1440, h: 810}, hoch: {w: 810, h: 1440}, quadrat: {w: 1080, h: 1080}};

  function uid(prefix){ return prefix + '-' + Math.random().toString(36).slice(2,9); }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function normAngle(a){ return ((a % 360) + 360) % 360; }
  function lerpAngle(a,b,t){ var diff = (((b-a) % 360) + 540) % 360 - 180; return normAngle(a + diff*t); }
  function sanitizeStage(v){
    function side(n){ return typeof n === 'number' && isFinite(n) ? Math.min(STAGE_MAX, Math.max(STAGE_MIN, Math.round(n * 2) / 2)) : STAGE_DEFAULT; }
    return {w: side(v && v.w), d: side(v && v.d)};
  }
  // While a project is still being loaded (`state` not assigned yet) it's the default size.
  // Schläge im Lied (#2041, js/beats.js): every beat, sorted seconds, or null — as detected and then
  // corrected by hand. Belong to the song — a new or removed song clears them (js/main.js).
  function sanitizeBeats(v){
    if(!Array.isArray(v)) return null;
    var out = v.filter(function(t){ return typeof t === 'number' && isFinite(t) && t >= 0 && t < 36000; })
      .map(function(t){ return Math.round(t * 1000) / 1000; })
      .sort(function(a, b){ return a - b; }).slice(0, 20000);
    return out.length ? out : null;
  }
  // Tournament tempi (WDSF) in beats per minute and beats per bar. key: the word that names the dance
  // in an Abschnitt's name ("2. Rumba"), and what state.music keeps.
  var BEAT_DANCES = [
    ['langsam', 'Langsamer Walzer', 84, 90, 3], ['wiener', 'Wiener Walzer', 174, 180, 3], ['tango', 'Tango', 124, 132, 4],
    ['slow', 'Slowfox', 112, 120, 4], ['quick', 'Quickstep', 200, 208, 4], ['samba', 'Samba', 100, 104, 2],
    ['cha', 'Cha-Cha-Cha', 120, 128, 4], ['rumba', 'Rumba', 100, 108, 4], ['paso', 'Paso Doble', 120, 124, 2], ['jive', 'Jive', 168, 176, 4]
  ].map(function(d){ return {key: d[0], name: d[1], lo: d[2], hi: d[3], per: d[4]}; });
  var DANCE_OTHER = 'andere'; // „anderer Tanz“: any tempo, 4 beats per bar unless set
  function danceOfName(name){
    var n = (name || '').toLowerCase();
    return BEAT_DANCES.filter(function(d){ return n.indexOf(d.key) !== -1; })[0] || null;
  }
  function danceByKey(key){ return BEAT_DANCES.filter(function(d){ return d.key === key; })[0] || null; }
  // The Abschnitte (Bild categories) whose Bild has a mark of its own, as sections of the song:
  // [{t, name}] from 0, the way js/beats.js once cut the song (an Abschnitt within the first second
  // names the first section).
  function abschnittSections(formations){
    var cuts = [], out = [{t: 0, name: ''}];
    (formations || []).forEach(function(f){
      if(f && typeof f.category === 'string' && f.category.trim() && typeof f.time === 'number' && isFinite(f.time) && f.time >= 0) cuts.push({t: f.time, name: f.category.trim()});
    });
    cuts.sort(function(a, b){ return a.t - b.t; }).forEach(function(c){
      var last = out[out.length - 1];
      if(c.t - last.t >= 1) out.push({t: Math.round(c.t * 1000) / 1000, name: c.name}); else last.name = c.name;
    });
    return out;
  }
  /* Musik & Takte (#2096, #2081, js/beats.js): state.music = {sections, ones, phrases} or null.
     sections: [{t, dance?, per?}] sorted, the first at 0 — the dances of the song from where each
       starts. They describe the music, so they are kept here and not taken from the Bild Abschnitte
       (whose marks move with the choreography); the view fills them from those once. dance: a
       BEAT_DANCES key or DANCE_OTHER (none: not chosen yet); per: beats per bar where not the dance's.
     A cut counts as a beat too, the first of its section (beatsWithCuts), once that section has beats.
     ones: the beats the user made a 1 (seconds, each one of those beats). From each, every per-th beat
       of its section starts a bar — back to the section's start before the first, on to the next 1 or
       the section's end after it.
     phrases: {time of a bar's 1: its Phrasierung ("QQS+")}, so it moves along when the beats do.
     figures: the same for the bar's Figur ("Natural Turn"); left out while there is none.
     sanitizeMusic(src) reads beats and music from a project (localStorage, .stg, share payload,
     history snapshot) and returns them checked: {beats, music}; 1s and Phrasierung that are not on a
     beat (a merge paired them with other beats) are dropped. Projects from before keep src.bars
     instead and are converted (musicFromBars). */
  var BAR_PHRASE_MAX = 16;
  // The texts a bar can have, by their key in state.music, with their longest length.
  var BAR_TEXTS = {phrases: BAR_PHRASE_MAX, figures: 80};
  // The beats with every cut as one: stored beats closer than CUT_BEAT_GAP to a cut give way to it
  // (they come back when the cut moves away). A section without beats of its own gets none.
  var CUT_BEAT_GAP = 0.12;
  function beatsWithCuts(beats, sections){
    if(!beats || !sections || sections.length < 2) return beats;
    var out = beats;
    sections.forEach(function(s, k){
      var next = k + 1 < sections.length ? sections[k + 1].t : Infinity;
      if(!k || !beats.some(function(b){ return b >= s.t && b < next; })) return;
      out = out.filter(function(b){ return Math.abs(b - s.t) >= CUT_BEAT_GAP; }).concat([s.t]);
    });
    return out === beats ? beats : out.sort(function(a, b){ return a - b; });
  }
  function sanitizeMusic(src){
    src = src || {};
    var beats = sanitizeBeats(src.beats), m = src.music;
    if(!(m && typeof m === 'object') && Array.isArray(src.bars) && src.bars.length) return musicFromBars(beats, src.bars, src.formations);
    if(!m || typeof m !== 'object' || !Array.isArray(m.sections)) return {beats: beats, music: null};
    var secs = [], on, ones = [], out;
    m.sections.filter(function(s){ return s && typeof s.t === 'number' && isFinite(s.t) && s.t >= 0 && s.t < 36000; })
      .sort(function(a, b){ return a.t - b.t; }).forEach(function(s){
        var t = secs.length ? Math.round(s.t * 1000) / 1000 : 0, out = {t: t};
        if(secs.length && t - secs[secs.length - 1].t < 0.5) return;
        if(s.dance === DANCE_OTHER || danceByKey(s.dance)) out.dance = s.dance;
        if(typeof s.per === 'number' && s.per >= 1 && s.per <= 12) out.per = Math.round(s.per);
        secs.push(out);
      });
    if(!secs.length) secs.push({t: 0});
    on = new Set(beatsWithCuts(beats, secs) || []);
    // A 1 or Phrasierung on a beat that gave way to a cut goes onto the cut.
    function onBeat(t){
      if(on.has(t)) return t;
      var c = secs.filter(function(s, k){ return k && Math.abs(s.t - t) < CUT_BEAT_GAP && on.has(s.t); })[0];
      return c ? c.t : null;
    }
    (Array.isArray(m.ones) ? m.ones : []).forEach(function(t){
      t = onBeat(typeof t === 'number' ? Math.round(t * 1000) / 1000 : NaN);
      if(t !== null && ones.indexOf(t) === -1) ones.push(t);
    });
    out = {sections: secs.slice(0, 200), ones: ones.sort(function(a, b){ return a - b; })};
    Object.keys(BAR_TEXTS).forEach(function(key){
      var src = m[key], texts = {};
      if(src && typeof src === 'object') Object.keys(src).forEach(function(k){
        var t = onBeat(Math.round(parseFloat(k) * 1000) / 1000), p = typeof src[k] === 'string' ? src[k].trim().slice(0, BAR_TEXTS[key]) : '';
        if(p && t !== null && !texts[t]) texts[t] = p;
      });
      if(key === 'phrases' || Object.keys(texts).length) out[key] = texts;
    });
    return {beats: beats, music: out};
  }
  /* Bars from before: [{t, p}] on the beats (the first version), or [{t, p, n, fill}] from the „Nur
     Takte“ version, whose beats followed from the bars. The Abschnitte with marks become the sections
     (that version cut the song there too). A section whose bars don't all sit on stored beats gets the
     beats that version played: each bar divided evenly into its beats, the last as long as the one
     before. Every old bar start the count from the 1 before misses becomes a 1, so each stays a bar
     start and keeps its Phrasierung.
     shortcut: an Abschnitt whose Bild had no mark of its own (placed by spreading) is no section here,
     its bars count to the one before; upgrade by passing the song length and using syncTimes(). */
  function musicFromBars(beats, bars, formations){
    var list = [], seen = new Set(), secs = abschnittSections(formations);
    bars.forEach(function(b){
      var t = b && typeof b.t === 'number' && isFinite(b.t) && b.t >= 0 && b.t < 36000 ? Math.round(b.t * 1000) / 1000 : null;
      if(t === null || seen.has(t)) return;
      seen.add(t);
      list.push({t: t, p: typeof b.p === 'string' ? b.p.trim().slice(0, BAR_PHRASE_MAX) : '', n: typeof b.n === 'number' && b.n >= 1 && b.n <= 12 ? Math.round(b.n) : 0});
    });
    list.sort(function(a, b){ return a.t - b.t; });
    function lenAt(k){ return k + 1 < list.length ? list[k + 1].t - list[k].t : k > 0 ? list[k].t - list[k - 1].t : 0; }
    secs.forEach(function(sec, i){ sec.end = i + 1 < secs.length ? secs[i + 1].t : Infinity; sec.bars = []; sec.dance = danceOfName(sec.name); });
    // A bar starting less than a quarter bar before a cut is the next section's.
    list.forEach(function(b, k){ secs.filter(function(s){ return s.t <= b.t + 0.25 * lenAt(k); }).pop().bars.push(k); });
    var stored = beats || [], on = new Set(stored), all = [];
    secs.forEach(function(sec){
      sec.per = (sec.bars.map(function(k){ return list[k].n; }).filter(Boolean)[0]) || (sec.dance ? sec.dance.per : 4);
      if(!sec.bars.length || sec.bars.every(function(k){ return on.has(list[k].t); })){
        stored.forEach(function(t){ if(t >= sec.t && t < sec.end) all.push(t); });
        return;
      }
      var len = 0;
      sec.bars.forEach(function(k, j){
        var next = sec.bars[j + 1], n = list[k].n || sec.per, stop = k + 1 < list.length ? list[k + 1].t - 0.03 : Infinity;
        if(next !== undefined) len = list[next].t - list[k].t;
        for(var x = 0; x < n; x++){
          var t = Math.round((list[k].t + x * len / n) * 1000) / 1000;
          if(x && (!len || t >= stop)) break;
          all.push(t);
        }
      });
    });
    all.sort(function(a, b){ return a - b; });
    all = all.filter(function(t, i){ return !i || t - all[i - 1] > 0.08; });
    var ones = [], phrases = {};
    secs.forEach(function(sec){
      var own = all.filter(function(t){ return t >= sec.t && t < sec.end; }), one = null;
      sec.bars.forEach(function(k){
        var i = own.indexOf(list[k].t);
        if(i < 0) own.forEach(function(t, x){ if(i < 0 || Math.abs(t - list[k].t) < Math.abs(own[i] - list[k].t)) i = x; });
        if(i < 0) return;
        if(one === null || (i - one) % sec.per){ ones.push(own[i]); one = i; }
        if(list[k].p) phrases[own[i]] = list[k].p;
      });
    });
    return sanitizeMusic({beats: all, music: {sections: secs.map(function(s){
      var out = {t: s.t};
      if(s.dance) out.dance = s.dance.key;
      if(s.per !== (s.dance ? s.dance.per : 4)) out.per = s.per;
      return out;
    }), ones: ones, phrases: phrases}});
  }
  // Video-Layout (#2095): null = the standard layout (defaultVideoLayout in js/export.js), else
  // {format, bg, els: [{id, type, x, y, w, h, hidden?, …type options}]}, built in js/videolayout.js.
  // Files and share links are untrusted, so every field is checked; this also returns a fresh copy.
  var VIDEO_COLOR_RE = /^(#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(0|1|0?\.\d{1,3})\))$/i, VIDEO_HEX_RE = /^#[0-9a-f]{6}$/i;
  function sanitizeVideoLayout(v){
    if(!v || typeof v !== 'object' || !Array.isArray(v.els)) return null;
    var format = VIDEO_FORMATS.hasOwnProperty(v.format) ? v.format : 'quer', F = VIDEO_FORMATS[format], seen = {}, ids = {};
    function num(n, lo, hi, d){ return typeof n === 'number' && isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; }
    function color(c, d){ return typeof c === 'string' && VIDEO_COLOR_RE.test(c) ? c : d; }
    function oneOf(s, list){ return list.indexOf(s) !== -1 ? s : list[0]; }
    function safeId(s){ return typeof s === 'string' && /^[\w-]{1,40}$/.test(s) ? s : ''; }
    var els = v.els.slice(0, 60).map(function(e){
      if(!e || typeof e !== 'object') return null;
      var type = oneOf(e.type, ['stage', 'logo', 'bilder', 'figuren', 'text', 'image']);
      // One stage, logo, Bild-name and Figuren list each; texts and images as many as wanted.
      if(e.type !== type || (type !== 'text' && type !== 'image' && seen[type])) return null;
      seen[type] = true;
      var id = safeId(e.id);
      if(!id || ids[id]) id = uid('ve');
      ids[id] = true;
      var out = {id: id, type: type, x: num(e.x, -F.w, 2 * F.w, 0), y: num(e.y, -F.h, 2 * F.h, 0), w: num(e.w, 10, 4 * F.w, F.w / 2), h: num(e.h, 10, 4 * F.h, F.h / 2)};
      if(e.hidden === true) out.hidden = true;
      if(type === 'stage'){
        out.grid = e.grid !== false; out.nums = e.nums === true; out.line = num(e.line, 0.5, 8, 1); out.dot = num(e.dot, 40, 250, 100);
        out.initials = e.initials !== false; out.names = e.names !== false; out.room = e.room !== false;
        out.floor = e.floor === 'none' ? 'none' : color(e.floor, '');
      }else if(type === 'bilder' || type === 'figuren'){
        out.size = num(e.size, 40, 300, 100); out.color = VIDEO_HEX_RE.test(e.color) ? e.color : '#ffffff'; out.divider = e.divider === true;
      }else if(type === 'text'){
        out.text = typeof e.text === 'string' ? e.text.slice(0, 500) : ''; out.font = oneOf(e.font, ['sans', 'mono']); out.size = num(e.size, 6, 200, 32);
        out.bold = e.bold === true; out.upper = e.upper === true; out.color = color(e.color, '#ffffff'); out.align = oneOf(e.align, ['left', 'center', 'right']); out.bg = color(e.bg, '');
      }else if(type === 'image'){
        out.img = safeId(e.img); out.name = typeof e.name === 'string' ? e.name.slice(0, 80) : ''; out.opacity = num(e.opacity, 0, 100, 100);
      }
      return out;
    }).filter(Boolean);
    return {format: format, bg: VIDEO_HEX_RE.test(v.bg) ? v.bg : '#150f1c', els: els};
  }
  function stageSize(){ return (state && state.stage) || {w: STAGE_DEFAULT, d: STAGE_DEFAULT}; }
  function stageMargin(){ var s = stageSize(); return Math.max(s.w, s.d) * GRID_INSET / (100 - 2 * GRID_INSET); }
  // Width : height of the stage with its floor margin — the stage element, thumbnails, PDF and video.
  function stageAspect(){ var s = stageSize(), m = stageMargin(); return (s.w + 2 * m) / (s.d + 2 * m); }
  // Guards stored/imported coordinates against garbage; edits keep dancers on the stage (clampX/Y).
  function clampGrid(v){ return Math.min(STAGE_MAX / 2, Math.max(-STAGE_MAX / 2, v)); }
  function clampX(v){ var h = stageSize().w / 2; return Math.min(h, Math.max(-h, v)); }
  function clampY(v){ var h = stageSize().d / 2; return Math.min(h, Math.max(-h, v)); }
  function gridToPercentX(v){ var w = stageSize().w, m = stageMargin(); return (v + w / 2 + m) / (w + 2 * m) * 100; }
  function gridToPercentY(v){ var d = stageSize().d, m = stageMargin(); return (v + d / 2 + m) / (d + 2 * m) * 100; }
  function percentToX(p){ var w = stageSize().w, m = stageMargin(); return p / 100 * (w + 2 * m) - w / 2 - m; }
  function percentToY(p){ var d = stageSize().d, m = stageMargin(); return p / 100 * (d + 2 * m) - d / 2 - m; }
  function roundNum(v){ return Math.round(v*10)/10; }
  // A plain {dancerId:{x,y}} copy of a pos map, detached from the source object — used to freeze a
  // Bild's own startPos (see addFormation/applyFigure) so later edits to the position it was
  // copied from never leak into it.
  function snapshotPos(pos){
    var out = {};
    Object.keys(pos || {}).forEach(function(id){ out[id] = {x: pos[id].x, y: pos[id].y}; });
    return out;
  }
  // Validates/repairs a formation's Zwischenpositionen (see interpolateThroughBetweens below) after
  // loading from anywhere untrusted (localStorage, an imported file, a share link) — same idea as
  // the per-Bild startPos/localAxes migrations around loadState(), just shared across the three
  // call sites (loadState here, parseStg in export.js, reconstructSharedState in share.js) since a
  // between's pos is a full per-dancer map rather than a single flat field. A between keeps a
  // couple's Follow key where the couple is split there, its own time (`at`) and the Drehungen /
  // Eigendrehungen for the leg after it, all optional.
  function sanitizeBetweens(betweens, dancers){
    if(!Array.isArray(betweens)) return [];
    var validIds = (dancers||[]).map(function(d){ return d.id; });
    function point(p){
      return {
        x: clampGrid(p && typeof p.x === 'number' ? p.x : 0),
        y: clampGrid(p && typeof p.y === 'number' ? p.y : 0),
        rot: normAngle(p && typeof p.rot === 'number' ? p.rot : 0)
      };
    }
    return betweens.filter(function(b){ return b && typeof b === 'object' && b.pos && typeof b.pos === 'object'; }).map(function(b){
      var pos = {};
      validIds.forEach(function(id){
        pos[id] = point(b.pos[id]);
        var fp = b.pos[followKey(id)];
        if(fp && typeof fp === 'object') pos[followKey(id)] = point(fp);
      });
      var out = {id: b.id || uid('bw'), name: typeof b.name === 'string' ? b.name.slice(0, 40) : '', pos: pos};
      var at = sanitizeBetweenAt(b.at);
      if(at !== null) out.at = at;
      var turns = sanitizeCoupleTurns(b.coupleTurns);
      if(turns) out.coupleTurns = turns;
      var spins = sanitizeSpins(b.spins);
      if(spins) out.spins = spins;
      var orbits = sanitizeOrbits(b.orbits);
      if(orbits) out.orbits = orbits;
      var paths = sanitizePaths(b.paths);
      if(paths) out.paths = paths;
      var note = sanitizeNote(b.note);
      if(note) out.note = note;
      return out;
    });
  }
  // When a Zwischenposition is reached, as a share of its move's time (strictly between 0 and 1) —
  // e.g. on a beat of the song. null = not set: it's spread evenly between its neighbours instead
  // (see betweenAnchors).
  function sanitizeBetweenAt(v){
    if(typeof v !== 'number' || !isFinite(v) || v <= 0 || v >= 1) return null;
    return Math.min(0.9999, Math.max(0.0001, Math.round(v * 10000) / 10000));
  }
  // Geschwindigkeitsverlauf (a per-Bild setting for the move *out of* this Bild, like betweens):
  // SPEED_SAMPLES relative speeds at evenly spaced points from start to finish of the move, drawn in
  // the graph popover (see formations.js). Only the shape counts — speedEase normalizes it, so the
  // same curve fits any distance and any move duration. null = the standard easeMove profile.
  var SPEED_SAMPLES = 5;
  function sanitizeSpeedCurve(v){
    if(!Array.isArray(v) || v.length !== SPEED_SAMPLES) return null;
    var out = v.map(function(x){ return typeof x === 'number' && isFinite(x) ? Math.round(Math.max(0, Math.min(1, x))*100)/100 : NaN; });
    if(out.some(isNaN) || Math.max.apply(null, out) < 0.01) return null;
    return out;
  }
  // Drehung im Paar (a per-Bild setting for the move *out of* this Bild, like betweens): couple key
  // (the Lead's pos key — the dancer id of a couple, memberIds[0] of an older saved pair) ->
  // degrees the couple turns around its middle on the way to the next stop. Positive = clockwise
  // on stage, more than one full turn allowed. Unset = the short way, as before (see turnCouple).
  // With Zwischenpositionen the Bild's own setting covers the first leg only, and every
  // Zwischenposition carries its own for the leg after it (see interpolateThroughBetweens).
  var MAX_COUPLE_TURN = 3600;
  function sanitizeCoupleTurns(v){
    if(!v || typeof v !== 'object' || Array.isArray(v)) return null;
    var out = {}, any = false;
    Object.keys(v).forEach(function(k){
      var n = v[k];
      if(!k || typeof n !== 'number' || !isFinite(n)) return;
      n = Math.round(Math.max(-MAX_COUPLE_TURN, Math.min(MAX_COUPLE_TURN, n)) * 10) / 10;
      if(n){ out[k] = n; any = true; }
    });
    return any ? out : null;
  }
  // Eigendrehung, stored next to coupleTurns (on a Bild for the move — or first leg — out of it, on
  // a Zwischenposition for the leg after it): pos key (a dancer, or a split couple's Lead or
  // Follow) -> degrees that person turns around their own axis on the way, same sign and limits as
  // a Drehung im Paar. Unset = the facing turns the short way to the next arrow.
  function sanitizeSpins(v){ return sanitizeCoupleTurns(v); }
  // Kreisbahn (#2067), stored next to coupleTurns: groups of pos keys — e.g. a circle that turns —
  // that walk round their shared middle on the way to the next stop instead of straight, by `turn`
  // degrees (same sign and limits as a Drehung im Paar), while the middle itself walks straight.
  // A pos key belongs to one group at most.
  // Notiz (#2055) on a Bild or a Zwischenposition, for the Schritte-PDF. '' = none.
  var NOTE_MAX = 500;
  function sanitizeNote(v){ return typeof v === 'string' && v.trim() ? v.slice(0, NOTE_MAX) : ''; }
  // The name of the move from a Bild to the next (#2161) — the figure danced there, kept on the Bild
  // it leaves from like its Zwischenpositionen and Geschwindigkeitsverlauf.
  function sanitizeMoveName(v){ return typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : ''; }
  // Gezeichneter Weg (#2192), stored next to spins: pos key -> the drawn points [[x, y], …] the leg
  // out of this stop runs through, between the key's spot here and its spot at the next stop.
  var PATH_POINTS_MAX = 40, PATH_SEG = 10;
  function sanitizePaths(v){
    if(!v || typeof v !== 'object' || Array.isArray(v)) return null;
    var out = null;
    Object.keys(v).forEach(function(k){
      var pts = (Array.isArray(v[k]) ? v[k] : []).filter(function(p){
        return Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' && Math.abs(p[0]) < 1000 && Math.abs(p[1]) < 1000;
      }).slice(0, PATH_POINTS_MAX);
      if(k && pts.length) (out = out || {})[k] = pts.map(function(p){ return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]; });
    });
    return out;
  }
  function stopSpot(w, k){ return w && (w[k] || w[baseDancerId(k)]) || null; }
  // A drawn way as a smooth curve (Catmull-Rom) from spot a through its points to spot b, in short
  // straight pieces: pts, len (the running length at each) and knots (the running length at each
  // drawn point).
  function pathCurve(a, drawn, b){
    var c = [a].concat(drawn.map(function(p){ return {x: p[0], y: p[1]}; }), [b]);
    var pts = [{x: a.x, y: a.y}], len = [0], knots = [];
    for(var i = 0; i < c.length - 1; i++){
      var p0 = c[Math.max(0, i - 1)], p1 = c[i], p2 = c[i + 1], p3 = c[Math.min(c.length - 1, i + 2)];
      for(var s = 1; s <= PATH_SEG; s++){
        var t = s / PATH_SEG, t2 = t * t, t3 = t2 * t;
        var q = {
          x: 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3)
        }, last = pts[pts.length - 1];
        len.push(len[len.length - 1] + Math.hypot(q.x - last.x, q.y - last.y));
        pts.push(q);
      }
      if(i < c.length - 2) knots.push(len[len.length - 1]);
    }
    return {pts: pts, len: len, knots: knots};
  }
  // The spot a share t (0..1) of the way along a pathCurve.
  function pointOnPath(curve, t){
    var len = curve.len, want = Math.min(1, Math.max(0, t)) * len[len.length - 1], i = 1;
    if(t >= 1) return curve.pts[curve.pts.length - 1]; // exactly on the next stop's spot
    while(i < len.length - 1 && len[i] < want) i++;
    var f = len[i] > len[i - 1] ? (want - len[i - 1]) / (len[i] - len[i - 1]) : 1, p = curve.pts[i - 1], q = curve.pts[i];
    return {x: lerp(p.x, q.x, f), y: lerp(p.y, q.y, f)};
  }
  function sanitizeOrbits(v){
    if(!Array.isArray(v)) return null;
    var seen = {}, out = [];
    v.forEach(function(g){
      if(!g || !Array.isArray(g.ids) || typeof g.turn !== 'number' || !isFinite(g.turn)) return;
      var turn = Math.round(Math.max(-MAX_COUPLE_TURN, Math.min(MAX_COUPLE_TURN, g.turn)) * 10) / 10;
      var ids = g.ids.filter(function(k){ return typeof k === 'string' && k && !seen[k]; });
      if(!turn || ids.length < 2) return;
      ids.forEach(function(k){ seen[k] = true; });
      out.push({ids: ids, turn: turn});
    });
    return out.length ? out : null;
  }
  // A move between two Bilder normally interpolates in one straight leg (fromPos -> toPos). If the
  // *from* Bild has Zwischenpositionen — poses along the way that don't get their own Bild/filmstrip
  // card, added via the "+" between filmstrip cards (see formations.js) — the same move instead
  // chains through each of them in turn, without changing the move's total duration. A
  // Zwischenposition with its own time (`at`, e.g. on a beat of the song) is reached exactly then;
  // the ones without are spread evenly between their neighbours (see betweenAnchors), which with no
  // times set at all is the old even split, "Gesamtlänge der Bewegung/(Anzahl der
  // Zwischenpositionen + 1)". Used by every playback path (playback.js tick() and syncTick(), the
  // video export), each of which already has its own overall progress `overallT` (0..1) for the
  // whole move — this eases that once for the whole move and then resolves it into the right leg,
  // so the dancers keep going through each Zwischenposition instead of stopping there.
  // Every stop — the from-Bild and each Zwischenposition — also says how the leg *out of* it runs:
  // its Drehungen im Paar (coupleTurns) and Eigendrehungen (spins), and whether a couple is split
  // there (it has a Follow key) or closed (none: the Follow stands on the couple's dot).
  // Betweens only apply when `toIdx` is literally the next Bild after `fromIdx` (fromIdx+1) — sync
  // playback can skip over Bilder with no time marker of their own, and a between belongs to a
  // specific gap, not to whatever pair of Bilder happen to be interpolating at the moment.
  function moveBetweens(fromIdx, toIdx){
    var f = state.formations[fromIdx];
    return toIdx === fromIdx + 1 && f && Array.isArray(f.betweens) ? f.betweens : [];
  }
  // Eased progress (moveEase's 0..1 scale) at every stop of the move: 0 at the from-Bild, 1 at the
  // to-Bild, moveEase(at) at a timed Zwischenposition. They never run backwards — one timed earlier
  // than a Zwischenposition before it is reached right after that one — and runs without a time are
  // filled in evenly between the anchors around them.
  function betweenAnchors(fromIdx, toIdx){
    var anchors = [0], last = 0;
    moveBetweens(fromIdx, toIdx).forEach(function(b){
      var at = sanitizeBetweenAt(b.at);
      if(at === null){ anchors.push(null); return; }
      last = Math.max(last, moveEase(fromIdx, toIdx, at));
      anchors.push(last);
    });
    anchors.push(1);
    for(var i = 1; i < anchors.length - 1; i++){
      if(anchors[i] !== null) continue;
      var j = i;
      while(anchors[j] === null) j++;
      for(var k = i; k < j; k++) anchors[k] = lerp(anchors[i-1], anchors[j], (k - i + 1) / (j - i + 1));
      i = j;
    }
    return anchors;
  }
  // The share of its move's time (0..1) at which each Zwischenposition after Bild `fromIdx` is
  // reached — its own `at`, or wherever betweenAnchors spread it — for showing in the editor.
  function betweenTimes(fromIdx){
    var toIdx = fromIdx + 1;
    return betweenAnchors(fromIdx, toIdx).slice(1, -1).map(function(target){
      var lo = 0, hi = 1;
      for(var i = 0; i < 40; i++){
        var mid = (lo + hi) / 2;
        if(moveEase(fromIdx, toIdx, mid) < target) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    });
  }
  function interpolateThroughBetweens(fromIdx, toIdx, overallT){
    var fromF = state.formations[fromIdx], toF = state.formations[toIdx];
    var stops = [fromF].concat(moveBetweens(fromIdx, toIdx), [toF]);
    var pts = stops.map(function(s){ return s.pos || {}; });
    var anchors = betweenAnchors(fromIdx, toIdx);
    var legCount = stops.length - 1;
    var eAll = moveEase(fromIdx, toIdx, overallT >= 1 ? 1 : Math.max(0, overallT));
    var legIdx = 0, e = 0;
    if(overallT >= 1){ legIdx = legCount - 1; e = 1; }
    else if(overallT > 0){
      while(legIdx < legCount - 1 && anchors[legIdx + 1] <= eAll) legIdx++;
      var span = anchors[legIdx + 1] - anchors[legIdx];
      e = span < 1e-9 ? 1 : Math.min(1, Math.max(0, (eAll - anchors[legIdx]) / span));
    }
    var a = pts[legIdx], b = pts[legIdx + 1];
    var ZERO = {x:0, y:0, rot:0};
    // Where pos key `k` is at a stop — a Follow whose couple is closed there is on the couple's dot.
    function spot(w, k){ return w[k] || w[baseDancerId(k)] || ZERO; }
    var interp = {};
    function place(k){
      var pa = spot(a, k), pb = spot(b, k);
      interp[k] = { x: lerp(pa.x, pb.x, e), y: lerp(pa.y, pb.y, e), rot: lerpAngle(pa.rot||0, pb.rot||0, e) };
    }
    // Every dot, plus the Follow of a couple that is split at either end of this leg — stepping out
    // of the dot, back into it, or from one spot of its own to the next.
    state.dancers.forEach(function(dd){
      place(dd.id);
      var k = followKey(dd.id);
      if(a[k] || b[k]) place(k);
    });
    // Turning within a couple, with the settings of the stop this leg leaves from. Split at both
    // ends: Lead and Follow don't walk straight (and possibly right through each other) but turn
    // around their middle — see turnCouple below — the short way, or as far round as a set Drehung
    // says. Split at one end only: they open out of / close into the dot that way only with a set
    // Drehung. Closed at both ends: a set Drehung turns the dot's arrow.
    var leaving = stops[legIdx];
    var turns = sanitizeCoupleTurns(leaving.coupleTurns), spins = sanitizeSpins(leaving.spins);
    function turnOf(lk){ return turns && typeof turns[lk] === 'number' ? turns[lk] : null; }
    function centre(lk, fk){
      var la = spot(a, lk), fa = spot(a, fk), lb = spot(b, lk), fb = spot(b, fk);
      return {x: lerp((la.x+fa.x)/2, (lb.x+fb.x)/2, e), y: lerp((la.y+fa.y)/2, (lb.y+fb.y)/2, e)};
    }
    state.dancers.forEach(function(dd){
      var lk = dd.id, fk = followKey(lk);
      if(!a[lk] || !b[lk]) return;
      var turn = turnOf(lk);
      if(a[fk] && b[fk]) turnCouple(interp, lk, fk, a[lk], a[fk], b[lk], b[fk], e, turn, centre(lk, fk));
      else if(turn === null) return;
      else if(a[fk] || b[fk]) turnCouple(interp, lk, fk, a[lk], spot(a, fk), b[lk], spot(b, fk), e, turn, centre(lk, fk));
      else interp[lk].rot = normAngle((a[lk].rot||0) + turnSweep((b[lk].rot||0) - (a[lk].rot||0), turn) * e);
    });
    // Legacy linked pairs (two separate dots, memberIds = [lead, follow]) turn the same way —
    // unless one of them is itself split at either end, which the loop above already handled.
    (state.pairs || []).forEach(function(pr){
      var ids = pr.memberIds || [];
      if(ids.length !== 2 || ids.some(function(id){ return !a[id] || !b[id] || a[followKey(id)] || b[followKey(id)]; })) return;
      turnCouple(interp, ids[0], ids[1], a[ids[0]], a[ids[1]], b[ids[0]], b[ids[1]], e, turnOf(ids[0]), centre(ids[0], ids[1]));
    });
    // Kreisbahnen: each group's middle walks straight while every member's offset from it turns by
    // the set amount (its length easing to the new one) — the way round that comes closest to it,
    // like a Drehung — and their facing turns along.
    (sanitizeOrbits(leaving.orbits) || []).forEach(function(g){
      var ids = g.ids.filter(function(k){ return interp[k]; });
      if(ids.length < 2) return;
      function mid(w){
        var x = 0, y = 0;
        ids.forEach(function(k){ var s = spot(w, k); x += s.x; y += s.y; });
        return {x: x / ids.length, y: y / ids.length};
      }
      var ca = mid(a), cb = mid(b), cx = lerp(ca.x, cb.x, e), cy = lerp(ca.y, cb.y, e);
      ids.forEach(function(k){
        var pa = spot(a, k), pb = spot(b, k);
        var ra = Math.hypot(pa.x - ca.x, pa.y - ca.y), rb = Math.hypot(pb.x - cb.x, pb.y - cb.y);
        var angA = Math.atan2(pa.y - ca.y, pa.x - ca.x) * 180/Math.PI, angB = Math.atan2(pb.y - cb.y, pb.x - cb.x) * 180/Math.PI;
        if(ra < 1e-6) angA = angB;
        if(rb < 1e-6) angB = angA;
        var ang = (angA + turnSweep(angB - angA, g.turn) * e) * Math.PI/180, r = lerp(ra, rb, e);
        interp[k].x = cx + Math.cos(ang) * r;
        interp[k].y = cy + Math.sin(ang) * r;
        interp[k].rot = normAngle((pa.rot || 0) + turnSweep((pb.rot || 0) - (pa.rot || 0), g.turn) * e);
      });
    });
    // Gezeichnete Wege (#2192): a point with a way drawn for this leg walks along it, at the leg's
    // progress measured along the way, instead of the straight line or a turn's arc; its facing stays.
    var drawn = sanitizePaths(leaving.paths);
    if(drawn) Object.keys(drawn).forEach(function(k){
      if(!interp[k]) return;
      var p = pointOnPath(pathCurve(spot(a, k), drawn[k], spot(b, k)), e);
      interp[k].x = p.x; interp[k].y = p.y;
    });
    // Eigendrehungen last, so they win over a Drehung's facing: that one person's arrow turns by
    // the set amount over the leg, wherever they're walking.
    if(spins) Object.keys(spins).forEach(function(k){
      if(!interp[k]) return;
      var ra = spot(a, k).rot || 0;
      interp[k].rot = normAngle(ra + turnSweep((spot(b, k).rot || 0) - ra, spins[k]) * e);
    });
    return interp;
  }
  // The couple's midpoint `c` — the axis they turn around, already worked out for this moment by
  // the caller (straight between the two ends' middles) — while the Follow→Lead vector rotates
  // around it the short way and its length eases from the old spacing (la/fa) to the new one (lb/fb). A couple that only moves (no change of direction
  // between them) ends up exactly on the straight lines; one that swaps sides turns around its
  // moving middle instead of running through each other.
  // With a set Drehung (`turn`, see sanitizeCoupleTurns) the axis — and both partners' facing —
  // sweeps the way round that comes closest to it instead: 360 is a full turn back to the same
  // spots, -180 swaps sides anticlockwise.
  function turnCouple(interp, lk, fk, la, fa, lb, fb, t, turn, c){
    var distA = Math.hypot(la.x-fa.x, la.y-fa.y), distB = Math.hypot(lb.x-fb.x, lb.y-fb.y);
    var angA = Math.atan2(la.y-fa.y, la.x-fa.x) * 180/Math.PI, angB = Math.atan2(lb.y-fb.y, lb.x-fb.x) * 180/Math.PI;
    // On top of each other on one side: no direction to turn from/to, just open up or close.
    if(distA < 1e-6) angA = angB;
    if(distB < 1e-6) angB = angA;
    var ang = (angA + turnSweep(angB - angA, turn) * t) * Math.PI/180;
    var half = lerp(distA, distB, t) / 2;
    var dx = Math.cos(ang)*half, dy = Math.sin(ang)*half;
    interp[lk].x = c.x + dx; interp[lk].y = c.y + dy;
    interp[fk].x = c.x - dx; interp[fk].y = c.y - dy;
    if(turn !== null && turn !== undefined){
      [[lk, la, lb], [fk, fa, fb]].forEach(function(r){
        var ra = r[1].rot || 0;
        interp[r[0]].rot = normAngle(ra + turnSweep((r[2].rot || 0) - ra, turn) * t);
      });
    }
  }
  // Degrees to sweep for an angle change of `diff`: the short way (-180..180), or with a set turn
  // the same end angle plus however many full turns, either direction, land closest to it.
  function turnSweep(diff, turn){
    var d = (((diff % 360) + 540) % 360) - 180;
    return typeof turn === 'number' ? d + 360 * Math.round((turn - d) / 360) : d;
  }
  // "Punkt = Paar aufspalten": every dot is a couple by default. In a Bild or a Zwischenposition it
  // can be split into Lead (the dot's own pos key) and Follow, stored in the same pos map under
  // `<dancerId>~f`; where that key is missing the couple is closed and the Follow is on the dot
  // (see interpolateThroughBetweens). Every serializer (.stg/.auf/share/Verlauf) already
  // round-trips arbitrary pos keys.
  var FOLLOW_SUFFIX = '~f';
  function followKey(did){ return did + FOLLOW_SUFFIX; }
  function isFollowKey(id){ return typeof id === 'string' && id.slice(-FOLLOW_SUFFIX.length) === FOLLOW_SUFFIX; }
  function baseDancerId(id){ return isFollowKey(id) ? id.slice(0, -FOLLOW_SUFFIX.length) : id; }
  function isCoupleSplitIn(f, did){ return !!(f && f.pos && f.pos[followKey(did)]); }
  function markerDisplayName(id){
    var base = baseDancerId(id);
    var d = state.dancers.find(function(dd){ return dd.id === base; });
    var n = d ? d.name : '?';
    return isFollowKey(id) ? n + ' (Follow)' : n;
  }
  // Nearly constant speed: mostly linear, with just enough smoothstep mixed in that a move doesn't
  // start or end with a jolt (speed 0.8 at the ends, 1.1 in the middle — not the 0→3→0 of a cubic).
  function easeMove(t){ return 0.8*t + 0.2*t*t*(3 - 2*t); }
  // easeMove's speed (0.8 + 1.2t(1-t)) at the SPEED_SAMPLES points, scaled to a peak of 1 — what
  // the graph shows while a Bild still uses the standard profile.
  var STANDARD_SPEED_CURVE = [0.73, 0.93, 1, 0.93, 0.73];
  // Progress (0..1) after time fraction t for a drawn speed curve: the speed runs piecewise linearly
  // between the samples, progress is its integral up to t divided by the whole integral — so the
  // move still ends exactly on time and on the spot, however high or low the curve was drawn.
  function speedEase(curve, t){
    if(!curve) return easeMove(t);
    if(t <= 0) return 0;
    if(t >= 1) return 1;
    var n = curve.length - 1, total = 0, done = 0;
    for(var i = 0; i < n; i++){
      var v0 = curve[i], v1 = curve[i+1], area = (v0 + v1) / 2, lo = i / n, hi = (i + 1) / n;
      if(t >= hi) done += area;
      else if(t > lo){ var u = (t - lo) * n; done += v0*u + (v1 - v0)*u*u/2; }
      total += area;
    }
    return total > 0 ? done / total : t;
  }
  // The from-Bild's curve applies to the move into the very next Bild only — same rule as its
  // betweens, since sync playback may interpolate across Bilder without a time marker of their own.
  function moveEase(fromIdx, toIdx, t){
    var f = state.formations[fromIdx];
    return speedEase(toIdx === fromIdx + 1 && f ? sanitizeSpeedCurve(f.speedCurve) : null, t);
  }
  function paletteColor(i){
    if(i < PALETTE.length) return PALETTE[i];
    var hue = (i*137.508) % 360;
    return 'hsl(' + hue.toFixed(0) + ',48%,54%)';
  }
  // Every delete asks first in one shared popup (#2065). The ok button has focus, so Enter confirms
  // and Escape / Abbrechen / a backdrop click cancel. `btn` (optional) stays highlighted (.armed)
  // while the popup is open, so it's clear what goes.
  var confirmBackdrop = document.getElementById('confirmBackdrop');
  var confirmOkBtn = document.getElementById('confirmOkBtn');
  var confirmPending = null;
  // detail: an optional line under the question (what else the action touches).
  function confirmDelete(title, onConfirm, btn, okLabel, detail){
    closeConfirm();
    document.getElementById('confirmTitle').textContent = title;
    var detailEl = document.getElementById('confirmDetail');
    detailEl.textContent = detail || '';
    detailEl.hidden = !detail;
    confirmOkBtn.textContent = okLabel || 'Löschen';
    confirmPending = {run:onConfirm, btn:btn || null};
    if(btn) btn.classList.add('armed');
    confirmBackdrop.hidden = false;
    confirmOkBtn.focus();
  }
  function closeConfirm(){
    if(confirmPending && confirmPending.btn) confirmPending.btn.classList.remove('armed');
    confirmPending = null;
    confirmBackdrop.hidden = true;
  }
  confirmOkBtn.addEventListener('click', function(){ var p = confirmPending; closeConfirm(); if(p) p.run(); });
  document.getElementById('confirmCancelBtn').addEventListener('click', closeConfirm);
  document.getElementById('confirmCloseBtn').addEventListener('click', closeConfirm);
  confirmBackdrop.addEventListener('click', function(e){ if(e.target === confirmBackdrop) closeConfirm(); });
  // For the small icon-only delete buttons: the button's aria-label ("Bild „X“ löschen") is the question.
  function armDeleteButton(btn, onConfirm){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      confirmDelete(btn.getAttribute('aria-label') + '?', onConfirm, btn);
    });
  }

  // Shared line icons (same 24-unit grid and 2px round stroke as the topbar SVGs in index.html),
  // so icon buttons built in JS look identical to the static ones instead of relying on text
  // glyphs like ✕/+/▶ whose size and baseline differ per font.
  var ICON_PATHS = {
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    play: '<path d="M7 4.5v15l12.5-7.5Z" fill="currentColor"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    speed: '<path d="M3 20h18"/><path d="M3 16c4 0 5-10 9-10s5 10 9 10"/>',
    turn: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'
  };
  function svgIcon(name, size, strokeWidth){
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('width', size || 16);
    svg.setAttribute('height', size || 16);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', strokeWidth || 2);
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML = ICON_PATHS[name];
    return svg;
  }
  // Icon followed by a text label, for buttons like "▶ Ab hier".
  function setIconLabel(btn, name, size, label){
    btn.textContent = '';
    btn.appendChild(svgIcon(name, size));
    var span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
  }

  function initials(name){
    var parts = name.trim().split(/\s+/).filter(Boolean);
    if(!parts.length) return '?';
    if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function defaultState(){
    var names = ['1','2','3','4','5'];
    var dancers = names.map(function(name,i){ return {id:uid('d'), name:name, color:paletteColor(i)}; });

    var startlinie = {};
    dancers.forEach(function(d,i){
      var t = dancers.length>1 ? i/(dancers.length-1) : 0.5;
      startlinie[d.id] = {x: roundNum(-6 + t*12), y: 5, rot: 0};
    });

    var kreis = {};
    dancers.forEach(function(d,i){
      var angle = (i/dancers.length)*Math.PI*2 - Math.PI/2;
      kreis[d.id] = {x: roundNum(Math.cos(angle)*4.5), y: roundNum(Math.sin(angle)*4), rot: 0};
    });

    var diagonale = {};
    dancers.forEach(function(d,i){
      var t = dancers.length>1 ? i/(dancers.length-1) : 0.5;
      diagonale[d.id] = {x: roundNum(-6 + t*12), y: roundNum(-6 + t*12), rot: 0};
    });

    return {
      projectName: 'Meine Formation',
      dancers: dancers,
      formations: [
        // startPos is this Bild's *own* frozen starting position — snapshotted once, equal to `pos`
        // until a dancer is actually dragged within this Bild, at which point their gray "came from
        // here" dot appears (see renderOnionSkin()). It is never a pointer at the previous Bild:
        // landing on an untouched Bild shows only the dancers, no gray ghost.
        {id:uid('f'), name:'Startlinie', pos: startlinie, showAxes:true, localAxes:[], category:'', startPos: snapshotPos(startlinie), betweens: []},
        {id:uid('f'), name:'Kreis', pos: kreis, showAxes:true, localAxes:[], category:'', startPos: snapshotPos(kreis), betweens: []},
        {id:uid('f'), name:'Diagonale', pos: diagonale, showAxes:true, localAxes:[], category:'', startPos: snapshotPos(diagonale), betweens: []}
      ],
      axes: [],
      showAxes: true,
      showFacing: true,
      roomLabels: {top:'WAND', right:'SPIEGEL', bottom:'EINGANG', left:'FENSTER'},
      stage: sanitizeStage(null),
      beats: null,
      music: null,
      pairs: [],
      customFigures: [],
      logo: null,
      song: null,
      activeIndex: 0,
      tempo: 50,
      // Local-only pointer at a live share (see js/share.js) — null until "Teilen" is used (or a
      // ?share=<id> link is opened), never itself part of what gets pushed to/pulled from the
      // server, and never written into .stg/.auf exports (buildProjectHeader doesn't reference it).
      sharedId: null,
      // Schreib-Token für den gebundenen Share (aus create.php bzw. ?t= im Bearbeiten-Link).
      // Fehlt es und shareReadOnly ist true, wurde ein reiner Nur-Ansehen-Link geöffnet:
      // dann werden lokale Änderungen nicht mehr hochgeladen (js/state.js saveState).
      shareEditToken: null,
      shareReadOnly: false,
      // Stable per-project key the undo/redo history (js/history.js) is filed under while a project
      // isn't bound to a share link. Local-only, like sharedId.
      localId: uid('proj')
    };
  }

  // „Neue Choreo → Leer“ (#2042): no dancers and one empty Bild — the app needs at least one.
  function emptyState(){
    var s = defaultState();
    s.dancers = [];
    s.formations = [{id:uid('f'), name:'Bild 1', pos:{}, showAxes:true, localAxes:[], category:'', startPos:{}, betweens:[]}];
    return s;
  }

  // Every tab works on its own project: the save lives under projectStorageKey(localId), and
  // sessionStorage (per tab, survives a reload) remembers which one this tab has open — so a reload
  // brings back this tab's project, not whichever tab saved last. STORAGE_KEY itself stays a copy of
  // the latest save: what a fresh tab opens, and where saves from before per-tab projects live.
  var TAB_PROJECT_KEY = 'aufstellung-tab-project';
  var PROJECT_INDEX_KEY = 'aufstellung-projects'; // localIds, most recently saved first
  var MAX_LOCAL_PROJECTS = 12;
  function projectStorageKey(id){ return STORAGE_KEY + ':' + id; }

  function loadState(){
    try{
      var tabId = null, openId = null, copyId = null;
      try{ tabId = sessionStorage.getItem(TAB_PROJECT_KEY); }catch(e){}
      // ?project=<localId>: the "Öffnen" list (js/export.js) reloads the page into that project;
      // ?neu: „Neue Choreo“ does, into a fresh one — ?neu=leer an empty one, ?neu=kopie&von=<localId>
      // a copy of that project under the new localId `id` (its logo/song are already filed there).
      try{
        var params = new URLSearchParams(location.search);
        if(params.has('neu')){
          if(params.get('neu') === 'leer') return emptyState();
          if(params.get('neu') !== 'kopie' || !params.get('von')) return defaultState();
          copyId = params.get('id') || uid('proj');
        }
        openId = params.get(copyId ? 'von' : 'project');
      }catch(e){}
      var raw = copyId ? localStorage.getItem(projectStorageKey(openId)) : (openId && localStorage.getItem(projectStorageKey(openId))) ||
        (tabId && localStorage.getItem(projectStorageKey(tabId))) || localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      var parsed = JSON.parse(raw);
      if(!parsed || !parsed.dancers || !parsed.formations || !parsed.formations.length) return defaultState();
      if(typeof parsed.tempo !== 'number') parsed.tempo = 50;
      if(typeof parsed.activeIndex !== 'number' || parsed.activeIndex >= parsed.formations.length) parsed.activeIndex = 0;
      if(typeof parsed.projectName !== 'string' || !parsed.projectName.trim()) parsed.projectName = 'Meine Formation';
      if(!Array.isArray(parsed.axes)) parsed.axes = [];
      parsed.stage = sanitizeStage(parsed.stage);
      var mu = sanitizeMusic(parsed); // older saves have bars instead: converted
      parsed.beats = mu.beats;
      parsed.music = mu.music;
      delete parsed.bars;
      parsed.videoLayout = sanitizeVideoLayout(parsed.videoLayout); // older saves have none: the standard layout
      if(typeof parsed.showAxes !== 'boolean') parsed.showAxes = true;
      if(typeof parsed.showFacing !== 'boolean'){
        parsed.showFacing = true;
        try{ parsed.showFacing = localStorage.getItem(LEGACY_FACING_KEY) !== '0'; }catch(e){}
      }
      // migration: older saves predate editable room-orientation labels entirely
      var defaultRoomLabels = {top:'WAND', right:'SPIEGEL', bottom:'EINGANG', left:'FENSTER'};
      if(!parsed.roomLabels || typeof parsed.roomLabels !== 'object') parsed.roomLabels = {};
      ['top','right','bottom','left'].forEach(function(side){
        if(typeof parsed.roomLabels[side] !== 'string') parsed.roomLabels[side] = defaultRoomLabels[side];
      });
      if(!Array.isArray(parsed.pairs)) parsed.pairs = [];
      var knownDancerIds = parsed.dancers.map(function(d){ return d.id; });
      parsed.pairs = parsed.pairs.filter(function(p){
        return p && Array.isArray(p.memberIds) && p.memberIds.length === 2 &&
          knownDancerIds.indexOf(p.memberIds[0]) !== -1 && knownDancerIds.indexOf(p.memberIds[1]) !== -1;
      });
      parsed.pairs.forEach(function(p){
        if(typeof p.name !== 'string') p.name = '';
        if(typeof p.collapsed !== 'boolean') p.collapsed = false;
      });
      if(!Array.isArray(parsed.customFigures)) parsed.customFigures = [];
      parsed.customFigures = parsed.customFigures.filter(function(fig){
        return fig && typeof fig.name === 'string' && fig.transform && typeof fig.transform === 'object';
      });
      if(typeof parsed.sharedId !== 'string' || !parsed.sharedId) parsed.sharedId = null;
      if(typeof parsed.shareEditToken !== 'string' || !parsed.shareEditToken) parsed.shareEditToken = null;
      // Vor diesem Feature gespeicherte Bindungen haben kein shareReadOnly-Feld -> als
      // bearbeitbar behandeln (der Server lässt Alt-Links mit edit_token IS NULL ohnehin durch).
      parsed.shareReadOnly = parsed.shareReadOnly === true;
      if(typeof parsed.localId !== 'string' || !parsed.localId) parsed.localId = uid('proj');
      if(copyId){
        parsed.localId = copyId;
        parsed.projectName = forkName(parsed.projectName);
        parsed.sharedId = null;
        parsed.shareEditToken = null;
        parsed.shareReadOnly = false;
      }
      // logo/song blobs are never stored in this localStorage JSON (too large/binary) — they're
      // persisted separately in IndexedDB and hydrated back in via hydrateBlobsFromIdb().
      parsed.logo = null;
      parsed.song = null;
      parsed.formations.forEach(function(f, i){
        Object.keys(f.pos).forEach(function(id){
          if(typeof f.pos[id].rot !== 'number') f.pos[id].rot = 0;
        });
        // migration: older saves only had the single global `showAxes` — fall back to it per Bild
        if(typeof f.showAxes !== 'boolean') f.showAxes = parsed.showAxes;
        // migration: older saves predate per-Bild-only axes entirely
        if(!Array.isArray(f.localAxes)) f.localAxes = [];
        // migration: older saves predate section categories entirely
        if(typeof f.category !== 'string') f.category = '';
        // migration: older saves predate the fixed per-Bild startPos snapshot (see
        // renderOnionSkin()). Seed it from the Bild's *own* current pos — same as a freshly
        // created Bild (addFormation/applyFigure) — so nothing shows until a dancer is dragged,
        // rather than back-filling the previous Bild's pos and lighting up ghosts everywhere.
        if(!f.startPos || typeof f.startPos !== 'object'){
          f.startPos = snapshotPos(f.pos);
        }
        // migration: older saves predate Zwischenpositionen entirely — see interpolateThroughBetweens()
        f.betweens = sanitizeBetweens(f.betweens, parsed.dancers);
        // The rounded-path option ("Weg abgerundet") is gone again — every move runs straight
        // through its Zwischenpositionen, so a leftover setting is just dropped.
        delete f.betweenPath;
        // migration: older saves predate Geschwindigkeitsverläufe — see speedEase()
        f.speedCurve = sanitizeSpeedCurve(f.speedCurve);
        f.move = sanitizeMoveName(f.move);
        // migration: older saves predate set Drehungen im Paar — see turnCouple()
        f.coupleTurns = sanitizeCoupleTurns(f.coupleTurns);
        // migration: older saves predate Eigendrehungen — see interpolateThroughBetweens()
        f.spins = sanitizeSpins(f.spins);
        // migration: older saves predate Kreisbahnen (#2067)
        f.orbits = sanitizeOrbits(f.orbits);
        f.paths = sanitizePaths(f.paths); // #2192
        f.note = sanitizeNote(f.note);
        // migration: older saves predate temporarily split pairs ("Paar lösen") entirely
        f.splitPairs = sanitizeSplitPairs(f.splitPairs);
      });
      return parsed;
    }catch(e){ return defaultState(); }
  }
  // Writes this tab's project to localStorage (its own key plus the STORAGE_KEY copy) and marks it as
  // the one this tab has open. No share push or history entry — saveState() adds those.
  function writeLocalProject(){
    if(tabResting) return;
    var id = state.localId, json;
    try{ sessionStorage.setItem(TAB_PROJECT_KEY, id); }catch(e){}
    try{
      json = JSON.stringify({
        projectName: state.projectName,
        dancers: state.dancers,
        formations: state.formations,
        axes: state.axes,
        showAxes: state.showAxes,
        showFacing: state.showFacing !== false,
        roomLabels: state.roomLabels,
        stage: state.stage,
        beats: state.beats,
        music: state.music,
        videoLayout: state.videoLayout || null,
        pairs: state.pairs,
        customFigures: state.customFigures,
        activeIndex: state.activeIndex,
        tempo: state.tempo,
        sharedId: state.sharedId,
        shareEditToken: state.shareEditToken,
        shareReadOnly: state.shareReadOnly,
        localId: id,
        savedAt: Date.now()
      });
    }catch(e){ return; }
    var index = readProjectIndex();
    if(index[0] !== id){
      index = [id].concat(index.filter(function(other){ return other !== id; }));
      while(index.length > MAX_LOCAL_PROJECTS) dropLocalProject(index.pop());
      writeProjectIndex(index);
    }
    // Storage full: give up the oldest other projects one by one until this one fits.
    for(;;){
      try{ localStorage.setItem(projectStorageKey(id), json); break; }catch(e){}
      if(index.length < 2) return;
      dropLocalProject(index.pop());
      writeProjectIndex(index);
    }
    try{ localStorage.setItem(STORAGE_KEY, json); }catch(e){}
  }
  function readProjectIndex(){
    try{
      var index = JSON.parse(localStorage.getItem(PROJECT_INDEX_KEY));
      return Array.isArray(index) ? index.filter(function(id){ return typeof id === 'string' && id; }) : [];
    }catch(e){ return []; }
  }
  function writeProjectIndex(index){
    try{ localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(index)); }catch(e){}
  }
  function dropLocalProject(id){
    try{ localStorage.removeItem(projectStorageKey(id)); }catch(e){}
    idbDelete(idbBlobKey('logo', id));
    idbDelete(idbBlobKey('song', id));
  }
  function forgetLocalProject(id){
    dropLocalProject(id);
    writeProjectIndex(readProjectIndex().filter(function(other){ return other !== id; }));
  }
  // The saved projects as the "Öffnen" list shows them, most recently saved first. savedAt is null
  // for saves from before it was recorded.
  function listLocalProjects(){
    return readProjectIndex().map(function(id){
      var p = null;
      try{ p = JSON.parse(localStorage.getItem(projectStorageKey(id))); }catch(e){}
      if(!p || !Array.isArray(p.formations)) return null;
      return {
        id: id,
        name: (typeof p.projectName === 'string' && p.projectName.trim()) || 'Meine Formation',
        savedAt: typeof p.savedAt === 'number' ? p.savedAt : null,
        bilder: p.formations.length,
        sharedId: typeof p.sharedId === 'string' && p.sharedId ? p.sharedId : null
      };
    }).filter(Boolean);
  }
  // „Kopie der aktuellen“: "<Name> - Fork <n>", n one past the highest fork of that name on this device (#2082).
  // A fork of a fork keeps the whole chain: "Original - Fork 1 - Fork 1" (#2142).
  function forkName(name){
    var base = name, n = 0;
    listLocalProjects().forEach(function(p){
      if(p.name.slice(0, base.length + 8) === base + ' - Fork ' && /^\d+$/.test(p.name.slice(base.length + 8))) n = Math.max(n, +p.name.slice(base.length + 8));
    });
    return base + ' - Fork ' + (n + 1);
  }
  // Opening the same share link again reuses its local copy instead of filing a duplicate.
  function localProjectForShare(sharedId){
    var hit = listLocalProjects().filter(function(p){ return p.sharedId === sharedId; })[0];
    return hit ? hit.id : null;
  }

  function saveState(){
    if(tabResting) return;
    writeLocalProject();
    // Every mutation in the app funnels through saveState() (directly or via saveStateDebounced),
    // so this is the one choke point that guarantees "bound to a live share -> every edit
    // propagates" without every individual call site needing to know about sharing. Soft dependency
    // (js/share.js defines this) so state.js — loaded first — doesn't need to know share.js exists;
    // by the time any edit actually happens, every script has finished loading regardless of order.
    if(state.sharedId && !state.shareReadOnly && typeof schedulePushSharedUpdate === 'function') schedulePushSharedUpdate();
    // Same soft-dependency trick for the undo/redo history (js/history.js) — one debounced snapshot
    // per settled edit, skipped while history itself is applying an undo/redo/merge.
    if(typeof captureHistorySoon === 'function') captureHistorySoon();
    if(typeof scheduleClashBadges === 'function') scheduleClashBadges(); // too-close warnings per move (js/stage.js)
  }
  var saveStateDebounced = (function(){
    var timer = null;
    function debounced(){ clearTimeout(timer); timer = setTimeout(function(){ timer = null; saveState(); }, 400); }
    // Runs a still-waiting save right away (before leaving the page).
    debounced.flush = function(){ if(timer){ clearTimeout(timer); timer = null; saveState(); } };
    return debounced;
  })();
  // Closing the tab or switching apps (phones never fire beforeunload) mustn't drop the last edit (#2071).
  function flushSaveOnHide(){ if(document.visibilityState === 'hidden') saveStateDebounced.flush(); }
  document.addEventListener('visibilitychange', flushSaveOnHide);
  window.addEventListener('pagehide', function(){ saveStateDebounced.flush(); });

  /* ---------- IndexedDB persistence for logo/song blobs (too large/binary for localStorage) ---------- */
  var IDB_NAME = 'aufstellung-blobs';
  var IDB_STORE = 'blobs';
  var idbHydrationGen = 0; // bumped whenever the user removes a logo/song, so a late in-flight hydration read can't resurrect it

  function idbOpen(){
    return new Promise(function(resolve, reject){
      if(!window.indexedDB){ reject(new Error('IndexedDB nicht verfügbar')); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function(){ req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
  }
  function idbPut(key, val){
    return idbOpen().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = function(){ resolve(); };
        tx.onerror = function(){ reject(tx.error); };
      });
    }).catch(function(){});
  }
  function idbDelete(key){
    return idbOpen().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = function(){ resolve(); };
        tx.onerror = function(){ reject(tx.error); };
      });
    }).catch(function(){});
  }
  function idbGet(key){
    return idbOpen().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function(){ resolve(req.result || null); };
        req.onerror = function(){ reject(req.error); };
      });
    }).catch(function(){ return null; });
  }

  // Logo and song are filed per project (kind 'logo' / 'song' + localId), like the localStorage save.
  function idbBlobKey(kind, id){ return kind + ':' + (id || state.localId); }

  // Before per-tab projects there was one logo/song for everyone, under plain 'logo' / 'song' — the
  // first tab to load afterwards hands them over to its project. The flag is set up front so a second
  // tab loading at the same time doesn't claim them too.
  var BLOBS_PER_PROJECT_KEY = 'aufstellung-blobs-per-project';
  function idbGetProjectBlob(kind, migrate, myGen){
    var id = state.localId, key = idbBlobKey(kind, id);
    return idbGet(key).then(function(rec){
      if(rec || !migrate) return rec;
      return idbGet(kind).then(function(old){
        if(!old) return null;
        // Removed or replaced in this very project meanwhile: the old record is stale. (If another
        // project took over the tab — share link, import — it still belongs to the one loaded here.)
        if(idbHydrationGen !== myGen && state.localId === id){ idbDelete(kind); return null; }
        return idbPut(key, old).then(function(){ return idbGet(key); }).then(function(copied){
          if(copied) idbDelete(kind);
          return old;
        });
      });
    });
  }

  function hydrateBlobsFromIdb(){
    var myGen = idbHydrationGen;
    var migrate = false;
    try{
      migrate = !localStorage.getItem(BLOBS_PER_PROJECT_KEY);
      if(migrate) localStorage.setItem(BLOBS_PER_PROJECT_KEY, '1');
    }catch(e){}
    return Promise.all([idbGetProjectBlob('logo', migrate, myGen).then(function(rec){
      if(!rec || !rec.blob || idbHydrationGen !== myGen) return;
      state.logo = { name:rec.name, mime:rec.mime, blob:rec.blob, url:URL.createObjectURL(rec.blob), opacity:rec.opacity||18 };
      updateStageLogo();
      updateLogoSettingsUI();
    }), idbGetProjectBlob('song', migrate, myGen).then(function(rec){
      if(!rec || !rec.blob || idbHydrationGen !== myGen) return;
      state.song = { name:rec.name, mime:rec.mime, blob:rec.blob, url:URL.createObjectURL(rec.blob) };
      applySongSource();
      updateSongSettingsUI();
    })]);
  }

  // Overwrites the IndexedDB logo/song records to match the current in-memory state — used
  // whenever `state` is replaced wholesale (import, reset) rather than edited via the upload/remove
  // handlers above (which keep IndexedDB in sync themselves).
  function syncBlobsToIdb(){
    idbHydrationGen++;
    if(state.logo && state.logo.blob) idbPut(idbBlobKey('logo'), { name:state.logo.name, mime:state.logo.mime, blob:state.logo.blob, opacity:state.logo.opacity });
    else idbDelete(idbBlobKey('logo'));
    if(state.song && state.song.blob) idbPut(idbBlobKey('song'), { name:state.song.name, mime:state.song.mime, blob:state.song.blob });
    else idbDelete(idbBlobKey('song'));
  }

  // Two tabs on the same project would keep overwriting each other's saves. That happens when a tab
  // is duplicated (sessionStorage comes along), a fresh tab opens the STORAGE_KEY copy, or the same
  // share link is opened twice. So each tab asks the others whether its project is already open — at
  // startup and whenever it comes back into view — and if one answers, asks whether to work on here
  // (the other tab then rests) or close this one (#2086). Called from js/main.js once every script has loaded.
  var tabChannel = null;
  var tabInstanceId = uid('tab');
  var tabResting = false; // another tab works on this project: this one neither saves nor syncs
  var onTabReleased = null;
  function startTabProjectGuard(askNow){
    if(typeof BroadcastChannel !== 'function') return;
    tabChannel = new BroadcastChannel('aufstellung-tabs');
    tabChannel.onmessage = function(e){
      var m = e.data || {};
      if(m.type === 'who' && m.from !== tabInstanceId && m.id === state.localId && !tabResting){
        tabChannel.postMessage({type:'mine', id:m.id, to:m.from});
      }else if(m.type === 'mine' && m.to === tabInstanceId && m.id === state.localId){
        restTab('„' + state.projectName + '“ ist schon in einem anderen Tab offen. Damit sich die beiden nicht gegenseitig überschreiben, arbeitet immer nur ein Tab daran.');
      }else if(m.type === 'takeover' && m.from !== tabInstanceId && m.id === state.localId){
        if(!tabResting) saveStateDebounced.flush(); // the last edit goes along to the other tab
        restTab('„' + state.projectName + '“ wird jetzt in einem anderen Tab bearbeitet. Hier ruht sie, bis du sie zurückholst.');
        tabChannel.postMessage({type:'released', id:m.id, to:m.from});
      }else if(m.type === 'released' && m.to === tabInstanceId && onTabReleased){
        onTabReleased();
      }else if(m.type === 'ping' && m.from !== tabInstanceId){
        tabChannel.postMessage({type:'pong', id:state.localId, to:m.from});
      }else if(m.type === 'pong' && m.to === tabInstanceId && onOpenTabProject){
        onOpenTabProject(m.id);
      }
    };
    if(askNow) askWhoHasTabProject();
    document.addEventListener('visibilitychange', function(){ if(!document.hidden) askWhoHasTabProject(); });
    window.addEventListener('pageshow', function(e){ if(e.persisted) askWhoHasTabProject(); });
  }
  function askWhoHasTabProject(){
    if(tabChannel && !tabResting) tabChannel.postMessage({type:'who', id:state.localId, from:tabInstanceId});
  }
  // Every other open tab answers with the localId it has open; onAnswer runs once per answer.
  var onOpenTabProject = null;
  function askOpenTabProjects(onAnswer){
    onOpenTabProject = onAnswer;
    if(tabChannel) tabChannel.postMessage({type:'ping', from:tabInstanceId});
  }
  function restTab(text){
    tabResting = true;
    if(typeof pausePlayback === 'function') pausePlayback();
    if(typeof stopSharePolling === 'function') stopSharePolling(); // also leaves the presence (js/share.js)
    document.getElementById('tabTakenText').textContent = text;
    document.getElementById('tabTakenBackdrop').hidden = false;
  }
  // „Hier weiterarbeiten“: the other tab saves its last edit and rests, then this one reloads that save.
  document.getElementById('tabTakenHereBtn').addEventListener('click', function(){
    var id = state.localId, done = false;
    function reload(){
      if(done) return;
      done = true;
      try{ sessionStorage.setItem(TAB_PROJECT_KEY, id); }catch(e){}
      location.reload();
    }
    onTabReleased = reload;
    setTimeout(reload, 1500); // the other tab may be gone (or frozen) meanwhile
    tabChannel.postMessage({type:'takeover', id:id, from:tabInstanceId});
  });
  document.getElementById('tabTakenCloseBtn').addEventListener('click', function(){
    window.close();
    // Browsers only let a page close a tab it opened itself.
    document.getElementById('tabTakenText').textContent = 'Du kannst diesen Tab jetzt schließen.';
  });

  var state = loadState();
  // ?project= / ?neu have done their job once loadState() read them; a reload goes by sessionStorage again.
  (function(){
    try{
      var params = new URLSearchParams(location.search);
      if(!params.has('project') && !params.has('neu')) return;
      ['project', 'neu', 'von', 'id'].forEach(function(k){ params.delete(k); });
      var rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    }catch(e){}
  })();
  // A save from before per-tab projects, or a brand-new project: file it under this tab right away,
  // so a reload before the first edit still finds it.
  try{ if(!localStorage.getItem(projectStorageKey(state.localId))) writeLocalProject(); }catch(e){}
  try{ sessionStorage.setItem(TAB_PROJECT_KEY, state.localId); }catch(e){}
  // Once every script is in: a fast IndexedDB answer could otherwise land before main.js defines
  // applySongSource (or stage.js updateStageLogo).
  // js/share.js waits on it before committing a reloaded copy with unsaved edits.
  var blobsHydrated = new Promise(function(resolve){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ resolve(hydrateBlobsFromIdb()); });
    else resolve(hydrateBlobsFromIdb());
  });
  var selectedDancerId = null;
  // dancerIds chosen via Strg/Cmd-Klick (or auto-populated with a saved pair's members on a plain
  // click) — rotated together around their centroid.
  var pairSelection = [];
  var stageMarkers = {}; // dancerId -> element
  var rosterCoordInputs = {}; // dancerId -> {x, y} input elements
  var rosterPairMidpointInputs = {}; // pairId -> {x, y} input elements (only present while collapsed)
  var rosterRowEls = {}; // dancerId -> .dancer-row element
  var rosterPairGroupEls = {}; // pairId -> .pair-group element

  // Non-null while posing a Zwischenposition on the stage instead of the active Bild itself — see
  // currentFormation() below and enterBetweenEdit()/exitBetweenEdit() in formations.js. {fIdx, bIdx}:
  // the Bild it belongs after, and its index within that Bild's own `betweens` array.
  var editingBetween = null;

  var playing = false, phaseStart = 0, fromIdx = 0, toIdx = 0, rafId = null, syncActive = false;

  var stageEl = document.getElementById('stage');
  var stageAreaEl = document.querySelector('.stage-area');
  var roomLabelInputs = {
    top: document.getElementById('roomLabelTop'),
    right: document.getElementById('roomLabelRight'),
    bottom: document.getElementById('roomLabelBottom'),
    left: document.getElementById('roomLabelLeft')
  };
  var rosterEl = document.querySelector('.roster');
  var pairRotateEl = document.getElementById('pairRotate');
  var pairRotateLabelEl = document.getElementById('pairRotateLabel');
  var pairRotateAngleInput = document.getElementById('pairRotateAngle');
  var pairRotateBtn = document.getElementById('pairRotateBtn');
  var pairSameRoleBtn = document.getElementById('pairSameRoleBtn');
  var pairSplitBtn = document.getElementById('pairSplitBtn');
  var pairRotateClearBtn = document.getElementById('pairRotateClearBtn');
  var pairTurnEl = document.getElementById('pairTurn');
  var pairTurnLabelEl = document.getElementById('pairTurnLabel');
  var pairTurnInput = document.getElementById('pairTurnInput');
  var pairTurnBtn = document.getElementById('pairTurnBtn');
  var pairTurnClearBtn = document.getElementById('pairTurnClearBtn');
  var pairSpinEl = document.getElementById('pairSpin');
  var pairSpinLabelEl = document.getElementById('pairSpinLabel');
  var pairSpinInput = document.getElementById('pairSpinInput');
  var pairSpinBtn = document.getElementById('pairSpinBtn');
  var pairSpinClearBtn = document.getElementById('pairSpinClearBtn');
  var pairOrbitEl = document.getElementById('pairOrbit');
  var pairOrbitLabelEl = document.getElementById('pairOrbitLabel');
  var pairOrbitInput = document.getElementById('pairOrbitInput');
  var pairOrbitBtn = document.getElementById('pairOrbitBtn');
  var pairOrbitClearBtn = document.getElementById('pairOrbitClearBtn');
  var rosterListEl = document.getElementById('rosterList');
  var dancerCountEl = document.getElementById('dancerCount');
  var addDancerBtn = document.getElementById('addDancerBtn');
  var filmTrackEl = document.getElementById('filmTrack');
  var playBtn = document.getElementById('playBtn');
  var iconPlay = document.getElementById('iconPlay');
  var iconPause = document.getElementById('iconPause');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var activeNameEl = document.getElementById('activeName');
  var activeReadoutEl = document.getElementById('activeReadout');
  var progressFillEl = document.getElementById('progressFill');
  var playScrubEl = document.getElementById('playScrub');
  var scrubThumbEl = document.getElementById('scrubThumb');
  var tempoSlider = document.getElementById('tempoSlider');
  var tempoInputEl = document.getElementById('tempoInput');
  var tempoUnitEl = document.getElementById('tempoUnit');
  var exportBtn = document.getElementById('exportBtn');
  var importBtn = document.getElementById('importBtn');
  var importInput = document.getElementById('importInput');
  var importErrorEl = document.getElementById('importError');
  var newChoreoBtn = document.getElementById('newChoreoBtn');
  var deleteChoreoBtn = document.getElementById('deleteChoreoBtn');
  var projectNameInput = document.getElementById('projectNameInput');
  var videoBackdrop = document.getElementById('videoBackdrop');
  var videoProgressFill = document.getElementById('videoProgressFill');
  var videoStatusText = document.getElementById('videoStatusText');
  var videoTitle = document.getElementById('videoTitle');
  var videoCancelBtn = document.getElementById('videoCancelBtn');
  var songAudioEl = new Audio();
  songAudioEl.preload = 'auto';
  songAudioEl.addEventListener('ended', function(){
    if(!syncActive) return;
    syncTick(); // the closing frame — a Bild spread to the song's end only lands on it here
    playing = false;
    cancelAnimationFrame(rafId);
    updatePlayButton();
    renderOnionSkin(); // sync playback finished — redraw ghosts with editing semantics
  });

  // Almost every stage/roster edit function reads/writes through currentFormation().pos rather than
  // reaching into state.formations directly — which means overriding what it returns while
  // editingBetween is set (see above) is enough to make dragging on the stage, the roster's numeric
  // inputs, keyboard nudging and pair-rotate all transparently pose a Zwischenposition instead of
  // the real active Bild, with no changes needed in any of them. The synthetic object forwards
  // showAxes/localAxes reads *and writes* to the real anchor Bild (there's no separate per-
  // Zwischenposition concept for either) via getters/setters rather than a plain copy.
  function currentFormation(){
    if(editingBetween){
      var anchor = state.formations[editingBetween.fIdx];
      var between = anchor && anchor.betweens && anchor.betweens[editingBetween.bIdx];
      if(anchor && between){
        return {
          id: anchor.id + ':between:' + between.id,
          name: 'Zwischenposition ' + (editingBetween.bIdx + 1) + (between.name ? ' — ' + between.name : '')
            + ' (' + anchor.name + ' → ' + (state.formations[editingBetween.fIdx+1]||{}).name + ')',
          pos: between.pos,
          category: anchor.category,
          get showAxes(){ return anchor.showAxes; },
          set showAxes(v){ anchor.showAxes = v; },
          get localAxes(){ return anchor.localAxes; },
          set localAxes(v){ anchor.localAxes = v; }
        };
      }
      editingBetween = null; // stale pointer (Bild/between deleted from under it) — fall through
    }
    return state.formations[state.activeIndex];
  }

  // "Paar lösen": a saved pair can be uncoupled for single Bilder only — there, Lead and Follow are
  // selected/dragged independently while staying a pair everywhere else. Stored as the pair ids in
  // the *real* Bild's `splitPairs` (a Zwischenposition being edited uses its anchor Bild's list).
  function sanitizeSplitPairs(arr){
    if(!Array.isArray(arr)) return [];
    var seen = {};
    return arr.filter(function(id){
      if(typeof id !== 'string' || !id || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  function splitHostFormation(){
    var idx = editingBetween ? editingBetween.fIdx : state.activeIndex;
    return state.formations[idx] || state.formations[state.activeIndex];
  }

  function isPairSplitHere(pair){
    if(!pair) return false;
    var host = splitHostFormation();
    return !!(host && Array.isArray(host.splitPairs) && host.splitPairs.indexOf(pair.id) !== -1);
  }

  function splitSignature(){
    var host = splitHostFormation();
    var base = (host && Array.isArray(host.splitPairs)) ? host.splitPairs.slice().sort().join(',') : '';
    var cf = currentFormation();
    var couples = state.dancers.filter(function(d){ return isCoupleSplitIn(cf, d.id); }).map(function(d){ return d.id; }).join(',');
    return base + '|' + couples;
  }

  // How fast a loaded song plays (songRate() in js/playback.js), kept apart from the project's own
  // state.tempo: a project slowed down for its Bilder (and shared or imported like that) would
  // otherwise start its song at 0,5×. Remembered per tab across a reload, never saved into the
  // project or pushed to a share — every new tab starts the song at 1,00×.
  var SONG_TEMPO_KEY = 'aufstellung-song-tempo';
  var songTempo = (function(){
    try{
      var v = parseFloat(sessionStorage.getItem(SONG_TEMPO_KEY));
      return isFinite(v) && v >= -25 && v <= 100 ? v : 50; // -25 = 0,25× (songTempoForRate)
    }catch(e){ return 50; }
  })();
  // The one Tempo value the playbar shows: the song's speed while a song is loaded (playback then
  // paces even unmarked Bilder by it, as before), the project's Bilder tempo otherwise.
  function activeTempo(){ return state.song && state.song.url ? songTempo : state.tempo; }

  function durations(tempo){
    var t = (tempo == null ? activeTempo() : tempo)/100;
    return { move: lerp(2200,500,t), hold: lerp(1600,300,t) };
  }
