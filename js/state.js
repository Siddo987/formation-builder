"use strict";

var PALETTE = ['#e0a336','#4fa3a0','#8d79d1','#d1637d','#5b93c4','#8fae4f','#c96b3f','#a688c9'];
  var STORAGE_KEY = 'aufstellung-choreo-v2';
  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var GRID_MIN = -7, GRID_MAX = 7, GRID_SPAN = 14, GRID_INSET = 6;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function uid(prefix){ return prefix + '-' + Math.random().toString(36).slice(2,9); }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function normAngle(a){ return ((a % 360) + 360) % 360; }
  function lerpAngle(a,b,t){ var diff = (((b-a) % 360) + 540) % 360 - 180; return normAngle(a + diff*t); }
  function clampGrid(v){ return Math.min(GRID_MAX, Math.max(GRID_MIN, v)); }
  function gridToPercent(v){ return GRID_INSET + ((v-GRID_MIN)/GRID_SPAN)*(100-2*GRID_INSET); }
  function percentToGrid(p){ return ((p-GRID_INSET)/(100-2*GRID_INSET))*GRID_SPAN + GRID_MIN; }
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
  // How a move runs through its Zwischenpositionen (a per-Bild setting, like the betweens list it
  // belongs to): 'corner' = straight legs that turn sharply at each one, 'smooth' = one rounded,
  // flowing curve through all of them (see smoothLeg below). Unknown/missing means 'corner', which is
  // how every move played before the setting existed.
  function sanitizeBetweenPath(v){ return v === 'smooth' ? 'smooth' : 'corner'; }
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
    var smooth = legCount > 1 && sanitizeBetweenPath(fromF.betweenPath) === 'smooth';
    var ZERO = {x:0, y:0, rot:0};
    // Where pos key `k` is at a stop — a Follow whose couple is closed there is on the couple's dot.
    function spot(w, k){ return w[k] || w[baseDancerId(k)] || ZERO; }
    var interp = {};
    function place(k){
      var pa = spot(a, k), pb = spot(b, k);
      interp[k] = { x: lerp(pa.x, pb.x, e), y: lerp(pa.y, pb.y, e), rot: lerpAngle(pa.rot||0, pb.rot||0, e) };
      if(smooth){
        var c = smoothLeg(pts.map(function(w){ return spot(w, k); }), legIdx, e, anchors);
        interp[k].x = clampGrid(c.x); interp[k].y = clampGrid(c.y);
      }
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
      var mids = pts.map(function(w){
        var l = spot(w, lk), f = spot(w, fk);
        return {x: (l.x+f.x)/2, y: (l.y+f.y)/2};
      });
      if(smooth) return smoothLeg(mids, legIdx, e, anchors);
      return {x: lerp(mids[legIdx].x, mids[legIdx+1].x, e), y: lerp(mids[legIdx].y, mids[legIdx+1].y, e)};
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
    // Eigendrehungen last, so they win over a Drehung's facing: that one person's arrow turns by
    // the set amount over the leg, wherever they're walking.
    if(spins) Object.keys(spins).forEach(function(k){
      if(!interp[k]) return;
      var ra = spot(a, k).rot || 0;
      interp[k].rot = normAngle(ra + turnSweep((spot(b, k).rot || 0) - ra, spins[k]) * e);
    });
    return interp;
  }
  // "Abgerundet" (betweenPath 'smooth'): a Hermite spline through all waypoints of the move. The
  // two legs meeting at a Zwischenposition share one tangent there, so the dancer passes through it
  // without a corner or a jump in speed. `anchors` (see betweenAnchors) are when each waypoint is
  // reached — tangents are velocities per unit of that progress, so a short leg in the time doesn't
  // overshoot; without them every leg gets the same share. The tangent is the usual Catmull-Rom one,
  // shortened next to a leg that is much slower than the other so the curve can't overshoot or loop
  // — down to zero when the dancer stands still for a leg.
  function smoothLeg(points, legIdx, t, anchors){
    var n = points.length - 1;
    function dur(i){ return anchors ? Math.max(1e-6, anchors[i+1] - anchors[i]) : 1; }
    function tangent(i){
      if(i === 0) return {x: (points[1].x - points[0].x) / dur(0), y: (points[1].y - points[0].y) / dur(0)};
      if(i === n) return {x: (points[n].x - points[n-1].x) / dur(n-1), y: (points[n].y - points[n-1].y) / dur(n-1)};
      var p = points[i-1], q = points[i], r = points[i+1], h1 = dur(i-1), h2 = dur(i);
      var v1 = Math.hypot(q.x-p.x, q.y-p.y) / h1, v2 = Math.hypot(r.x-q.x, r.y-q.y) / h2;
      var damp = Math.max(v1, v2) < 1e-6 ? 0 : Math.min(1, 3 * Math.min(v1, v2) / Math.max(v1, v2));
      return {x: (r.x-p.x) / (h1+h2) * damp, y: (r.y-p.y) / (h1+h2) * damp};
    }
    var h = dur(legIdx);
    var p0 = points[legIdx], p1 = points[legIdx+1], m0 = tangent(legIdx), m1 = tangent(legIdx+1);
    var t2 = t*t, t3 = t2*t;
    var h00 = 2*t3 - 3*t2 + 1, h10 = (t3 - 2*t2 + t) * h, h01 = 3*t2 - 2*t3, h11 = (t3 - t2) * h;
    return {x: h00*p0.x + h10*m0.x + h01*p1.x + h11*m1.x, y: h00*p0.y + h10*m0.y + h01*p1.y + h11*m1.y};
  }
  // The couple's midpoint `c` — the axis they turn around, already worked out for this moment by
  // the caller (straight between the two ends' middles, or rounded through Zwischenpositionen) —
  // while the Follow→Lead vector rotates around it the short way and its length eases from the old
  // spacing (la/fa) to the new one (lb/fb). A couple that only moves (no change of direction
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
  // Shared "click again to confirm" pattern for small icon-only delete buttons (roster remove,
  // Bild remove) — same idea as the text-swapping resetBtn confirm, adapted for buttons with no
  // room for a label: a CSS-driven "armed" state stands in for the text change, and a second
  // click within the window actually deletes. Attaches its own click listener; callers don't add
  // one themselves.
  function armDeleteButton(btn, onConfirm){
    var armed = false, timer = null;
    function disarm(){
      armed = false;
      clearTimeout(timer);
      btn.classList.remove('armed');
    }
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      if(armed){
        disarm();
        onConfirm();
      }else{
        armed = true;
        btn.classList.add('armed');
        timer = setTimeout(disarm, 2500);
      }
    });
  }

  // Shared line icons (same 24-unit grid and 2px round stroke as the topbar SVGs in index.html),
  // so icon buttons built in JS look identical to the static ones instead of relying on text
  // glyphs like ✕/+/▶ whose size and baseline differ per font.
  var ICON_PATHS = {
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    play: '<path d="M7 4.5v15l12.5-7.5Z" fill="currentColor"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'path-corner': '<path d="M3 17 9 7l6 10 6-10"/>',
    'path-smooth': '<path d="M3 17C5 10 7 7 9 7s4 10 6 10 4-3 6-10"/>',
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
      roomLabels: {top:'WAND', right:'SPIEGEL', bottom:'EINGANG', left:'FENSTER'},
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
      var tabId = null;
      try{ tabId = sessionStorage.getItem(TAB_PROJECT_KEY); }catch(e){}
      var raw = (tabId && localStorage.getItem(projectStorageKey(tabId))) || localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      var parsed = JSON.parse(raw);
      if(!parsed || !parsed.dancers || !parsed.formations || !parsed.formations.length) return defaultState();
      if(typeof parsed.tempo !== 'number') parsed.tempo = 50;
      if(typeof parsed.activeIndex !== 'number' || parsed.activeIndex >= parsed.formations.length) parsed.activeIndex = 0;
      if(typeof parsed.projectName !== 'string' || !parsed.projectName.trim()) parsed.projectName = 'Meine Formation';
      if(!Array.isArray(parsed.axes)) parsed.axes = [];
      if(typeof parsed.showAxes !== 'boolean') parsed.showAxes = true;
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
        f.betweenPath = sanitizeBetweenPath(f.betweenPath);
        // migration: older saves predate Geschwindigkeitsverläufe — see speedEase()
        f.speedCurve = sanitizeSpeedCurve(f.speedCurve);
        // migration: older saves predate set Drehungen im Paar — see turnCouple()
        f.coupleTurns = sanitizeCoupleTurns(f.coupleTurns);
        // migration: older saves predate Eigendrehungen — see interpolateThroughBetweens()
        f.spins = sanitizeSpins(f.spins);
        // migration: older saves predate temporarily split pairs ("Paar lösen") entirely
        f.splitPairs = sanitizeSplitPairs(f.splitPairs);
      });
      return parsed;
    }catch(e){ return defaultState(); }
  }
  // Writes this tab's project to localStorage (its own key plus the STORAGE_KEY copy) and marks it as
  // the one this tab has open. No share push or history entry — saveState() adds those.
  function writeLocalProject(){
    var id = state.localId, json;
    try{ sessionStorage.setItem(TAB_PROJECT_KEY, id); }catch(e){}
    try{
      json = JSON.stringify({
        projectName: state.projectName,
        dancers: state.dancers,
        formations: state.formations,
        axes: state.axes,
        showAxes: state.showAxes,
        roomLabels: state.roomLabels,
        pairs: state.pairs,
        customFigures: state.customFigures,
        activeIndex: state.activeIndex,
        tempo: state.tempo,
        sharedId: state.sharedId,
        shareEditToken: state.shareEditToken,
        shareReadOnly: state.shareReadOnly,
        localId: id
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

  function saveState(){
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
  }
  var saveStateDebounced = (function(){
    var timer = null;
    return function(){ clearTimeout(timer); timer = setTimeout(saveState, 400); };
  })();

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
    idbGetProjectBlob('logo', migrate, myGen).then(function(rec){
      if(!rec || !rec.blob || idbHydrationGen !== myGen) return;
      state.logo = { name:rec.name, mime:rec.mime, blob:rec.blob, url:URL.createObjectURL(rec.blob), opacity:rec.opacity||18 };
      updateStageLogo();
      if(!settingsBackdrop.hidden) updateLogoSettingsUI();
    });
    idbGetProjectBlob('song', migrate, myGen).then(function(rec){
      if(!rec || !rec.blob || idbHydrationGen !== myGen) return;
      state.song = { name:rec.name, mime:rec.mime, blob:rec.blob, url:URL.createObjectURL(rec.blob) };
      applySongSource();
      if(!settingsBackdrop.hidden) updateSongSettingsUI();
    });
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
  // is duplicated (sessionStorage comes along) or a fresh tab opens the STORAGE_KEY copy while the
  // tab that saved it is still open. So each tab asks the others whether its project is already open
  // — at startup and whenever it comes back into view — and if one answers, carries on with its own
  // copy under a new localId. Called from js/main.js once every script has loaded.
  var tabChannel = null;
  var tabInstanceId = uid('tab');
  function startTabProjectGuard(askNow){
    if(typeof BroadcastChannel !== 'function') return;
    tabChannel = new BroadcastChannel('aufstellung-tabs');
    tabChannel.onmessage = function(e){
      var m = e.data || {};
      if(m.type === 'who' && m.from !== tabInstanceId && m.id === state.localId){
        tabChannel.postMessage({type:'mine', id:m.id, to:m.from});
      }else if(m.type === 'mine' && m.to === tabInstanceId && m.id === state.localId){
        forkTabProject();
      }
    };
    if(askNow) askWhoHasTabProject();
    document.addEventListener('visibilitychange', function(){ if(!document.hidden) askWhoHasTabProject(); });
    window.addEventListener('pageshow', function(e){ if(e.persisted) askWhoHasTabProject(); });
  }
  function askWhoHasTabProject(){
    if(tabChannel) tabChannel.postMessage({type:'who', id:state.localId, from:tabInstanceId});
  }
  function forkTabProject(){
    var oldId = state.localId, newId = uid('proj'), myGen = idbHydrationGen;
    state.localId = newId;
    ['logo', 'song'].forEach(function(kind){
      idbGet(idbBlobKey(kind, oldId)).then(function(rec){
        if(rec && idbHydrationGen === myGen) idbPut(idbBlobKey(kind, newId), rec);
      });
    });
    writeLocalProject();
    // A share-bound project stays one project across tabs (both sync through the share), so neither
    // a separate history nor the note applies there.
    if(state.sharedId) return;
    if(typeof initHistory === 'function') initHistory();
    var banner = document.getElementById('tabCopyBanner');
    if(!banner) return;
    banner.hidden = false;
    document.getElementById('tabCopyBannerClose').onclick = function(){ banner.hidden = true; };
  }

  var state = loadState();
  // A save from before per-tab projects, or a brand-new project: file it under this tab right away,
  // so a reload before the first edit still finds it.
  try{ if(!localStorage.getItem(projectStorageKey(state.localId))) writeLocalProject(); }catch(e){}
  try{ sessionStorage.setItem(TAB_PROJECT_KEY, state.localId); }catch(e){}
  hydrateBlobsFromIdb();
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
  var resetBtn = document.getElementById('resetBtn');
  var projectNameInput = document.getElementById('projectNameInput');
  var videoExportBtn = document.getElementById('videoExportBtn');
  var settingsBtn = document.getElementById('settingsBtn');
  var settingsBackdrop = document.getElementById('settingsBackdrop');
  var settingsCloseBtn = document.getElementById('settingsCloseBtn');
  var videoBackdrop = document.getElementById('videoBackdrop');
  var videoProgressFill = document.getElementById('videoProgressFill');
  var videoStatusText = document.getElementById('videoStatusText');
  var videoCancelBtn = document.getElementById('videoCancelBtn');
  var songAudioEl = new Audio();
  songAudioEl.preload = 'auto';
  songAudioEl.addEventListener('ended', function(){
    if(!syncActive) return;
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
      return isFinite(v) && v >= 0 && v <= 100 ? v : 50;
    }catch(e){ return 50; }
  })();
  // The one Tempo value the playbar shows: the song's speed while a song is loaded (playback then
  // paces even unmarked Bilder by it, as before), the project's Bilder tempo otherwise.
  function activeTempo(){ return state.song && state.song.url ? songTempo : state.tempo; }

  function durations(){
    var t = activeTempo()/100;
    return { move: lerp(2200,500,t), hold: lerp(1600,300,t) };
  }
