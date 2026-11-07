"use strict";

/* ---------- custom .auf file format — lightweight positions/names/rotations, no song/logo/axes ---------- */
  /*
    AUFSTELLUNG 1
    TEMPO <0-100>
    LOOP <0|1>   (legacy — no longer produced, silently ignored on import)
    TAENZER <id> <farbe> <name>
    FORMATION <id> <name>
    POS <taenzerId> <x> <y> <rot>   (rot optional — old files without it default to 0)
    (POS-Zeilen gehören zur zuletzt genannten FORMATION)
  */
  function parseAuf(text){
    var lines = text.split(/\r?\n/);
    var first = (lines[0] || '').trim();
    if(!/^AUFSTELLUNG\s+\d+/.test(first)) throw new Error('Kein gültiges Aufstellung-Format');
    var tempo = 50, dancers = [], formations = [], current = null;
    for(var i=1; i<lines.length; i++){
      var line = lines[i].trim();
      if(!line) continue;
      var parts = line.split(/\s+/);
      var kw = parts[0];
      if(kw === 'TEMPO'){ tempo = parseFloat(parts[1]); if(isNaN(tempo)) tempo = 50; }
      else if(kw === 'LOOP'){ /* legacy field, ignored */ }
      else if(kw === 'TAENZER'){
        var did = parts[1], color = parts[2], dname = parts.slice(3).join(' ') || 'Tänzer';
        dancers.push({id: did, name: dname, color: color});
      }
      else if(kw === 'FORMATION'){
        var fid = parts[1], fname = parts.slice(2).join(' ') || 'Bild';
        // .auf stays the lightweight positions/names/rotations-only format — no explicit startPos
        // snapshot in the file (that's .stg/share-link territory, like axes/pairs). It's seeded
        // from each Bild's own pos once the POS lines are read (see below), so the onion-skin gray
        // dot behaves normally (nothing until a dancer is dragged) rather than never appearing.
        current = {id: fid, name: fname, pos: {}, showAxes: true, localAxes: [], category: '', startPos: null, betweens: [], splitPairs: []};
        formations.push(current);
      }
      else if(kw === 'POS' && current){
        var pid = parts[1], px = parseFloat(parts[2]), py = parseFloat(parts[3]);
        var prot = parts.length > 4 ? parseFloat(parts[4]) : 0;
        if(isNaN(prot)) prot = 0;
        if(!isNaN(px) && !isNaN(py)) current.pos[pid] = {x: clampGrid(px), y: clampGrid(py), rot: normAngle(prot)};
      }
    }
    if(!dancers.length || !formations.length) throw new Error('Datei enthält keine Tänzer oder Bilder');
    formations.forEach(function(f){
      f.startPos = {};
      Object.keys(f.pos).forEach(function(id){ f.startPos[id] = {x: f.pos[id].x, y: f.pos[id].y}; });
    });
    return {
      projectName: 'Meine Formation',
      dancers: dancers, formations: formations,
      axes: [], showAxes: true,
      roomLabels: {top:'WAND', right:'SPIEGEL', bottom:'EINGANG', left:'FENSTER'},
      pairs: [], customFigures: [], logo: null, song: null,
      activeIndex: 0, tempo: tempo
    };
  }

  // Symmetrical writer for the format `parseAuf` reads — keeps `.auf` a lightweight,
  // human-readable companion to `.stg` (positions/names/rotations only, no song/logo/axes/pairs).
  function buildAufText(s){
    var lines = ['AUFSTELLUNG 1', 'TEMPO ' + Math.round(s.tempo)];
    s.dancers.forEach(function(d){
      lines.push('TAENZER ' + d.id + ' ' + d.color + ' ' + d.name);
    });
    s.formations.forEach(function(f){
      lines.push('FORMATION ' + f.id + ' ' + f.name);
      Object.keys(f.pos).forEach(function(id){
        var p = f.pos[id];
        lines.push('POS ' + id + ' ' + roundNum(p.x) + ' ' + roundNum(p.y) + ' ' + roundNum(normAngle(p.rot||0)));
      });
    });
    return lines.join('\n') + '\n';
  }

  /* ---------- custom .stg binary file format ----------
    "STG1" | uint32LE headerLen | header JSON (utf8) | uint32LE logoLen | logo bytes | uint32LE songLen | song bytes
    header JSON: {version, projectName, dancers, formations (pos incl. x/y/rot), axes, showAxes, pairs,
                  activeIndex, tempo, logo:{name,mime,opacity}|null, song:{name,mime}|null}
  ---------- */

  function uint32LE(n){
    var buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, n, true);
    return buf;
  }

  function blobToArrayBuffer(blob){
    if(blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){ resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  }

  // Canonical "everything except the logo/song bytes themselves" project header — shared by the
  // .stg writer below and js/share.js (share links POST this same shape as JSON alongside the
  // logo/song as separate upload fields, rather than embedding them in a binary container).
  function buildProjectHeader(s, logoMeta, songMeta){
    return {
      version: 1,
      projectName: s.projectName || '',
      dancers: s.dancers.map(function(dc){ return {id:dc.id, name:dc.name, color:dc.color}; }),
      formations: s.formations.map(function(f){
        var pos = {};
        Object.keys(f.pos).forEach(function(id){
          var p = f.pos[id];
          pos[id] = {x: roundNum(p.x), y: roundNum(p.y), rot: roundNum(normAngle(p.rot||0))};
        });
        var time = formationTime(f);
        var localAxes = (f.localAxes||[]).map(function(ax){ return {id:ax.id, x1:roundNum(ax.x1), y1:roundNum(ax.y1), x2:roundNum(ax.x2), y2:roundNum(ax.y2), label:ax.label||''}; });
        var startPos = null;
        if(f.startPos){
          startPos = {};
          Object.keys(f.startPos).forEach(function(id){ startPos[id] = {x: roundNum(f.startPos[id].x), y: roundNum(f.startPos[id].y)}; });
        }
        var betweens = (f.betweens||[]).map(function(b){
          var bpos = {};
          Object.keys(b.pos||{}).forEach(function(id){
            var p = b.pos[id];
            bpos[id] = {x: roundNum(p.x), y: roundNum(p.y), rot: roundNum(normAngle(p.rot||0))};
          });
          var out = {id: b.id, name: b.name || '', pos: bpos};
          var at = sanitizeBetweenAt(b.at), turns = sanitizeCoupleTurns(b.coupleTurns), spins = sanitizeSpins(b.spins);
          if(at !== null) out.at = at;
          if(turns) out.coupleTurns = turns;
          if(spins) out.spins = spins;
          return out;
        });
        return {id:f.id, name:f.name, pos:pos, showAxes: f.showAxes !== false, localAxes: localAxes, category: f.category||'', time: time === null ? null : Math.round(time*100)/100, startPos: startPos, betweens: betweens, betweenPath: sanitizeBetweenPath(f.betweenPath), speedCurve: sanitizeSpeedCurve(f.speedCurve), coupleTurns: sanitizeCoupleTurns(f.coupleTurns), spins: sanitizeSpins(f.spins), splitPairs: sanitizeSplitPairs(f.splitPairs)};
      }),
      axes: (s.axes||[]).map(function(ax){ return {id:ax.id, x1:roundNum(ax.x1), y1:roundNum(ax.y1), x2:roundNum(ax.x2), y2:roundNum(ax.y2), label:ax.label||''}; }),
      showAxes: !!s.showAxes,
      roomLabels: {
        top: (s.roomLabels && s.roomLabels.top) || '',
        right: (s.roomLabels && s.roomLabels.right) || '',
        bottom: (s.roomLabels && s.roomLabels.bottom) || '',
        left: (s.roomLabels && s.roomLabels.left) || ''
      },
      pairs: (s.pairs||[]).map(function(p){ return {id:p.id, memberIds:p.memberIds.slice(), name:p.name||'', collapsed:!!p.collapsed}; }),
      customFigures: (s.customFigures||[]).map(function(fig){ return {id:fig.id, name:fig.name, transform:fig.transform}; }),
      activeIndex: s.activeIndex,
      tempo: s.tempo,
      logo: logoMeta || null,
      song: songMeta || null
    };
  }

  function buildStgBlob(s){
    var logoPromise = (s.logo && s.logo.blob) ? blobToArrayBuffer(s.logo.blob) : Promise.resolve(null);
    var songPromise = (s.song && s.song.blob) ? blobToArrayBuffer(s.song.blob) : Promise.resolve(null);
    return Promise.all([logoPromise, songPromise]).then(function(results){
      var logoBuf = results[0], songBuf = results[1];
      var header = buildProjectHeader(
        s,
        (s.logo && logoBuf) ? {name:s.logo.name, mime:s.logo.mime, opacity:s.logo.opacity||18} : null,
        (s.song && songBuf) ? {name:s.song.name, mime:s.song.mime} : null
      );
      var headerBytes = new TextEncoder().encode(JSON.stringify(header));
      var parts = [
        new TextEncoder().encode('STG1'),
        uint32LE(headerBytes.byteLength),
        headerBytes,
        uint32LE(logoBuf ? logoBuf.byteLength : 0)
      ];
      if(logoBuf) parts.push(logoBuf);
      parts.push(uint32LE(songBuf ? songBuf.byteLength : 0));
      if(songBuf) parts.push(songBuf);
      return new Blob(parts, {type:'application/octet-stream'});
    });
  }

  function parseStg(buf){
    var dv = new DataView(buf);
    var magicBytes = new Uint8Array(buf, 0, 4);
    var magic = String.fromCharCode(magicBytes[0], magicBytes[1], magicBytes[2], magicBytes[3]);
    if(magic !== 'STG1') throw new Error('Kein gültiges .stg-Format');
    var offset = 4;
    var headerLen = dv.getUint32(offset, true); offset += 4;
    var headerBytes = new Uint8Array(buf, offset, headerLen); offset += headerLen;
    var header = JSON.parse(new TextDecoder().decode(headerBytes));

    var logoLen = dv.getUint32(offset, true); offset += 4;
    var logoBytes = logoLen ? buf.slice(offset, offset+logoLen) : null; offset += logoLen;

    var songLen = dv.getUint32(offset, true); offset += 4;
    var songBytes = songLen ? buf.slice(offset, offset+songLen) : null; offset += songLen;

    if(!header.dancers || !header.dancers.length || !header.formations || !header.formations.length){
      throw new Error('Datei enthält keine Tänzer oder Bilder');
    }

    var formations = header.formations.map(function(f, i){
      var pos = {};
      Object.keys(f.pos||{}).forEach(function(id){
        var p = f.pos[id];
        pos[id] = {x: clampGrid(p.x||0), y: clampGrid(p.y||0), rot: normAngle(p.rot||0)};
      });
      // migration: files saved before per-Bild axes existed only had the global header.showAxes
      var localAxes = (Array.isArray(f.localAxes) ? f.localAxes : []).filter(function(ax){
        return ax && typeof ax.x1 === 'number' && typeof ax.y1 === 'number' && typeof ax.x2 === 'number' && typeof ax.y2 === 'number';
      }).map(function(ax){ return {id: ax.id || uid('ax'), x1:clampGrid(ax.x1), y1:clampGrid(ax.y1), x2:clampGrid(ax.x2), y2:clampGrid(ax.y2), label:ax.label||''}; });
      var startPos = null;
      if(f.startPos && typeof f.startPos === 'object'){
        startPos = {};
        Object.keys(f.startPos).forEach(function(id){
          var p = f.startPos[id];
          if(p) startPos[id] = {x: clampGrid(p.x||0), y: clampGrid(p.y||0)};
        });
      }else{
        // migration: files saved before this field existed — seed from the Bild's *own* pos so
        // no gray ghost shows until a dancer is dragged (matches addFormation/loadState), rather
        // than back-filling the preceding Bild and lighting up ghosts on every Bild.
        startPos = {};
        Object.keys(pos).forEach(function(id){ startPos[id] = {x: pos[id].x, y: pos[id].y}; });
      }
      var out = {id:f.id, name:f.name||'Bild', pos:pos, showAxes: typeof f.showAxes === 'boolean' ? f.showAxes : (header.showAxes !== false), localAxes: localAxes, category: typeof f.category === 'string' ? f.category : '', startPos: startPos, betweens: sanitizeBetweens(f.betweens, header.dancers), betweenPath: sanitizeBetweenPath(f.betweenPath), speedCurve: sanitizeSpeedCurve(f.speedCurve), coupleTurns: sanitizeCoupleTurns(f.coupleTurns), spins: sanitizeSpins(f.spins), splitPairs: sanitizeSplitPairs(f.splitPairs)};
      if(typeof f.time === 'number' && isFinite(f.time) && f.time >= 0) out.time = f.time;
      return out;
    });

    var logo = null;
    if(header.logo && logoBytes){
      var logoBlob = new Blob([logoBytes], {type: header.logo.mime || 'image/png'});
      logo = {name: header.logo.name||'logo', mime: header.logo.mime||'image/png', opacity: header.logo.opacity||18, blob: logoBlob, url: URL.createObjectURL(logoBlob)};
    }
    var song = null;
    if(header.song && songBytes){
      var songBlob = new Blob([songBytes], {type: header.song.mime || 'audio/mpeg'});
      song = {name: header.song.name||'song', mime: header.song.mime||'audio/mpeg', blob: songBlob, url: URL.createObjectURL(songBlob)};
    }

    var validDancerIds = header.dancers.map(function(d){ return d.id; });
    var pairs = (Array.isArray(header.pairs) ? header.pairs : []).filter(function(p){
      return p && Array.isArray(p.memberIds) && p.memberIds.length === 2 &&
        validDancerIds.indexOf(p.memberIds[0]) !== -1 && validDancerIds.indexOf(p.memberIds[1]) !== -1;
    }).map(function(p){ return {id:p.id, memberIds:p.memberIds, name:p.name||'', collapsed:!!p.collapsed}; });
    var customFigures = (Array.isArray(header.customFigures) ? header.customFigures : []).filter(function(fig){
      return fig && typeof fig.name === 'string' && fig.transform && typeof fig.transform === 'object';
    }).map(function(fig){ return {id: fig.id || uid('cf'), name: fig.name, transform: fig.transform}; });

    return {
      projectName: header.projectName || 'Meine Formation',
      dancers: header.dancers,
      formations: formations,
      axes: Array.isArray(header.axes) ? header.axes : [],
      showAxes: header.showAxes !== false,
      roomLabels: {
        top: (header.roomLabels && typeof header.roomLabels.top === 'string') ? header.roomLabels.top : 'WAND',
        right: (header.roomLabels && typeof header.roomLabels.right === 'string') ? header.roomLabels.right : 'SPIEGEL',
        bottom: (header.roomLabels && typeof header.roomLabels.bottom === 'string') ? header.roomLabels.bottom : 'EINGANG',
        left: (header.roomLabels && typeof header.roomLabels.left === 'string') ? header.roomLabels.left : 'FENSTER'
      },
      pairs: pairs,
      customFigures: customFigures,
      activeIndex: typeof header.activeIndex === 'number' ? header.activeIndex : 0,
      tempo: typeof header.tempo === 'number' ? header.tempo : 50,
      logo: logo,
      song: song
    };
  }

  function filenameBase(){
    var name = (state.projectName || 'aufstellung').trim();
    var slug = name.toLowerCase()
      .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
      .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    return slug || 'aufstellung';
  }

  function downloadBlob(blob, filename){
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- filename dialog (used before every export) ---------- */

  var filenameBackdrop = document.getElementById('filenameBackdrop');
  var filenameInput = document.getElementById('filenameInput');
  var filenameExt = document.getElementById('filenameExt');
  var filenameCloseBtn = document.getElementById('filenameCloseBtn');
  var filenameCancelBtn = document.getElementById('filenameCancelBtn');
  var filenameConfirmBtn = document.getElementById('filenameConfirmBtn');
  var filenameGhostOption = document.getElementById('filenameGhostOption');
  var filenameGhostToggle = document.getElementById('filenameGhostToggle');
  var filenamePending = null;

  function sanitizeFilename(name){
    name = (name || '').trim();
    name = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
    name = name.replace(/^\.+/, '');
    name = name.slice(0, 120);
    return name || 'aufstellung';
  }

  // showGhostOption: only the video exports pass true — reveals the "Herkunfts-/Zielpunkte"
  // checkbox, whose state is handed back to onConfirm as opts.includeGhosts.
  function askFilename(ext, defaultName, onConfirm, showGhostOption){
    filenamePending = { ext: ext, onConfirm: onConfirm };
    filenameExt.textContent = ext;
    filenameInput.value = defaultName;
    filenameGhostOption.hidden = !showGhostOption;
    filenameBackdrop.hidden = false;
    requestAnimationFrame(function(){ filenameInput.focus(); filenameInput.select(); });
  }

  function closeFilenameDialog(){ filenameBackdrop.hidden = true; filenamePending = null; }

  function confirmFilename(){
    if(!filenamePending) return;
    var filename = sanitizeFilename(filenameInput.value) + filenamePending.ext;
    var onConfirm = filenamePending.onConfirm;
    var opts = { includeGhosts: !filenameGhostOption.hidden && filenameGhostToggle.checked };
    closeFilenameDialog();
    onConfirm(filename, opts);
  }

  filenameCloseBtn.addEventListener('click', closeFilenameDialog);
  filenameCancelBtn.addEventListener('click', closeFilenameDialog);
  filenameConfirmBtn.addEventListener('click', confirmFilename);
  filenameBackdrop.addEventListener('click', function(e){ if(e.target === filenameBackdrop) closeFilenameDialog(); });
  filenameInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); confirmFilename(); }
  });

  function revokeStateBlobs(s){
    if(s.logo && s.logo.url) URL.revokeObjectURL(s.logo.url);
    if(s.song && s.song.url) URL.revokeObjectURL(s.song.url);
  }

  /* ---------- save / open / reset ---------- */

  var exportMenu = document.getElementById('exportMenu');
  var exportStgBtn = document.getElementById('exportStgBtn');
  var exportAufBtn = document.getElementById('exportAufBtn');

  function closeExportMenu(){
    exportMenu.hidden = true;
    exportBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleExportMenu(){
    var willOpen = exportMenu.hidden;
    exportMenu.hidden = !willOpen;
    exportBtn.setAttribute('aria-expanded', String(willOpen));
  }
  exportBtn.addEventListener('click', function(e){
    e.stopPropagation();
    toggleExportMenu();
  });
  document.addEventListener('click', function(e){
    if(!exportMenu.hidden && !exportMenu.contains(e.target) && e.target !== exportBtn) closeExportMenu();
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && !exportMenu.hidden) closeExportMenu();
  });

  // Runs the shared "ask filename, show a saving state on the button, build+download, restore
  // button" flow for either export format.
  function runExport(ext, buildBlobFn){
    closeExportMenu();
    askFilename(ext, filenameBase(), function(filename){
      var originalHtml = exportBtn.innerHTML;
      exportBtn.disabled = true;
      exportBtn.textContent = 'Wird gespeichert…';
      Promise.resolve(buildBlobFn(state)).then(function(blob){
        downloadBlob(blob, filename);
      }).catch(function(err){
        console.error(err);
      }).then(function(){ exportBtn.disabled = false; exportBtn.innerHTML = originalHtml; });
    });
  }

  exportStgBtn.addEventListener('click', function(){ runExport('.stg', buildStgBlob); });
  exportAufBtn.addEventListener('click', function(){
    runExport('.auf', function(s){ return new Blob([buildAufText(s)], {type:'text/plain'}); });
  });

  function showImportError(){
    importErrorEl.hidden = false;
    setTimeout(function(){ importErrorEl.hidden = true; }, 3500);
  }

  // Canonical plain-JSON form of a project — no logo/song bytes, no sharedId/localId. Same shape
  // buildStgBlob's header uses and js/share.js POSTs; the one representation history snapshots
  // (js/history.js) and share commits are built from.
  function serializableState(s){ return buildProjectHeader(s || state, null, null); }

  // Swap `state` for a new one and re-render. A plain .stg/.auf import uses it fresh (new blobs,
  // drop any live-share binding). Undo/redo/revert/merge (js/history.js) pass keepBinding+keepBlobs
  // so the live-share link and the in-memory logo/song survive — neither is part of a snapshot.
  function applyState(next, opts){
    opts = opts || {};
    pausePlayback();
    if(opts.keepBlobs){
      next.logo = state.logo;
      next.song = state.song;
    }else{
      revokeStateBlobs(state);
    }
    if(opts.keepBinding){
      next.sharedId = state.sharedId;
      next.shareEditToken = state.shareEditToken;
      next.shareReadOnly = state.shareReadOnly;
      next.localId = state.localId;
    }
    state = next;
    if(!state.localId) state.localId = uid('proj');
    state.activeIndex = Math.min(Math.max(0, state.activeIndex || 0), state.formations.length - 1);
    // Callers that want the live-share binding kept set next.sharedId themselves (or pass
    // keepBinding); otherwise importing an unrelated file correctly severs it.
    if(!state.sharedId) stopSharePolling();
    if(!opts.keepBlobs) syncBlobsToIdb();
    saveState();
    fullRerender();
    applyShareReadonlyUi();   // a file opened from a view-only link is the viewer's own, editable project
    importErrorEl.hidden = true;
  }

  function applyImportedState(parsed){ applyState(parsed, {}); }

  // „Öffnen“: a project saved on this device (listLocalProjects() in js/state.js) or a file. Opening
  // a saved one reloads the page into it (?project=) instead of swapping state in place, so a share
  // push still pending for the current project can't end up in the other one's link.
  var openBackdrop = document.getElementById('openBackdrop');
  var openProjectsList = document.getElementById('openProjectsList');
  var openElsewhere = {}; // localId -> true once another tab has answered that it has it open

  function openProjectsModal(){
    openElsewhere = {};
    renderOpenProjectsList();
    openBackdrop.hidden = false;
    askOpenTabProjects(function(id){
      if(openElsewhere[id] || id === state.localId) return;
      openElsewhere[id] = true;
      if(!openBackdrop.hidden) renderOpenProjectsList();
    });
  }
  function closeOpenProjectsModal(){ openBackdrop.hidden = true; }

  function renderOpenProjectsList(){
    openProjectsList.innerHTML = '';
    var projects = listLocalProjects();
    // The open project first, with its in-memory name (a rename may still be in the save debounce).
    projects.sort(function(a, b){ return (b.id === state.localId) - (a.id === state.localId); });
    projects.forEach(function(p){
      var isCurrent = p.id === state.localId;
      var elsewhere = !isCurrent && openElsewhere[p.id];
      var name = isCurrent ? (state.projectName.trim() || 'Meine Formation') : p.name;
      var bilder = isCurrent ? state.formations.length : p.bilder;
      var meta = [];
      if(isCurrent) meta.push('Hier geöffnet');
      else if(elsewhere) meta.push('In einem anderen Tab geöffnet');
      if(p.savedAt && typeof relTime === 'function') meta.push(relTime(p.savedAt));
      meta.push(bilder + (bilder === 1 ? ' Bild' : ' Bilder'));
      if(p.sharedId) meta.push('geteilt');

      var row = document.createElement('div');
      row.className = 'figure-row';
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'export-menu-item' + (isCurrent ? ' is-current' : '');
      item.disabled = isCurrent || elsewhere;
      item.innerHTML = '<strong></strong><span></span>';
      item.querySelector('strong').textContent = name;
      item.querySelector('span').textContent = meta.join(' · ');
      if(!item.disabled) item.addEventListener('click', function(){ openLocalProject(p.id); });
      row.appendChild(item);

      if(!isCurrent){
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'figure-delete';
        del.disabled = elsewhere;
        del.appendChild(svgIcon('x', 16));
        del.setAttribute('aria-label', 'Projekt "' + name + '" von diesem Gerät entfernen');
        del.title = 'Von diesem Gerät entfernen';
        armDeleteButton(del, function(){ forgetLocalProject(p.id); renderOpenProjectsList(); });
        row.appendChild(del);
      }
      openProjectsList.appendChild(row);
    });
  }

  function openLocalProject(id){
    saveStateDebounced.flush();
    writeLocalProject();
    location.assign(location.pathname + '?project=' + encodeURIComponent(id));
  }

  importBtn.addEventListener('click', openProjectsModal);
  document.getElementById('openCloseBtn').addEventListener('click', closeOpenProjectsModal);
  openBackdrop.addEventListener('click', function(e){ if(e.target === openBackdrop) closeOpenProjectsModal(); });
  document.getElementById('openFileBtn').addEventListener('click', function(){ closeOpenProjectsModal(); importInput.click(); });
  importInput.addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    var isStg = file.name.toLowerCase().slice(-4) === '.stg';
    if(isStg){
      file.arrayBuffer().then(function(buf){
        applyImportedState(parseStg(buf));
      }).catch(function(){ showImportError(); });
    }else{
      var reader = new FileReader();
      reader.onload = function(){
        try{
          var parsed = parseAuf(reader.result);
          parsed.projectName = file.name.replace(/\.[^.]+$/, '') || 'Meine Formation';
          applyImportedState(parsed);
        }catch(err){ showImportError(); }
      };
      reader.onerror = function(){ showImportError(); };
      reader.readAsText(file);
    }
    e.target.value = '';
  });

  // Resetting wipes the entire project (every Bild, dancer, axis, logo, song — replaced wholesale by
  // defaultState()) and, unlike the app's other destructive actions, isn't really undoable: the
  // fresh project gets its own localId, so js/history.js's undo/redo starts a brand new timeline
  // rather than being able to step back into the one that just got replaced (see historyKeyFor()).
  // That's a lot more consequential than the two-click arm-then-confirm pattern used for deleting
  // one dancer or one Bild, so this gets a real modal instead — explicit consequences spelled out,
  // and the confirm button stays disabled until a checkbox acknowledges there's no undoing it.
  var resetBackdrop = document.getElementById('resetBackdrop');
  var resetCloseBtn = document.getElementById('resetCloseBtn');
  var resetCancelBtn = document.getElementById('resetCancelBtn');
  var resetConfirmBtn = document.getElementById('resetConfirmBtn');
  var resetConfirmCheckbox = document.getElementById('resetConfirmCheckbox');

  function openResetModal(){
    resetConfirmCheckbox.checked = false;
    resetConfirmBtn.disabled = true;
    resetBackdrop.hidden = false;
  }
  function closeResetModal(){ resetBackdrop.hidden = true; }

  resetBtn.addEventListener('click', openResetModal);
  resetCloseBtn.addEventListener('click', closeResetModal);
  resetCancelBtn.addEventListener('click', closeResetModal);
  resetBackdrop.addEventListener('click', function(e){ if(e.target === resetBackdrop) closeResetModal(); });
  resetConfirmCheckbox.addEventListener('change', function(){ resetConfirmBtn.disabled = !resetConfirmCheckbox.checked; });
  resetConfirmBtn.addEventListener('click', function(){
    if(resetConfirmBtn.disabled) return;
    closeResetModal();
    pausePlayback();
    revokeStateBlobs(state);
    stopSharePolling();
    var oldId = state.localId;
    state = defaultState();
    // The dialog says the project is deleted, so it must not linger in the „Öffnen“ list either.
    forgetLocalProject(oldId);
    syncBlobsToIdb();
    saveState();
    fullRerender();
  });

  /* ---------- video export ---------- */

  var exportState = null;
  // Set from the filename dialog's "Herkunfts-/Zielpunkte einblenden" checkbox each time a video
  // export starts; read via ghostsFor() below. One export runs at a time, so a plain module flag
  // is enough (same pattern as exportState).
  var exportIncludeGhosts = false;
  // Schritte-Video "Andere Paare hellgrau einblenden": dancers outside focusIds are drawn as plain
  // light-gray context dots instead of being left out. Set per export like exportIncludeGhosts.
  var exportShowContext = false;

  // The onion-skin ghost source Bilder for a timeline segment — mirrors renderOnionSkin() in
  // js/stage.js: gray = the Bild *behind* you (the previous Bild while holding, the move's origin
  // while moving), faint colour = the Bild *ahead*. Returns null when the option is off or the
  // neighbour doesn't exist.
  function ghostsFor(seg){
    if(!exportIncludeGhosts || !seg) return null;
    var pIdx = seg.type === 'move' ? seg.from : seg.idx - 1;
    var nIdx = seg.type === 'move' ? seg.to   : seg.idx + 1;
    var prev = state.formations[pIdx], next = state.formations[nIdx];
    return { prev: prev ? prev.pos : null, next: next ? next.pos : null };
  }

  function setExportingUI(active){
    document.body.classList.toggle('exporting', active);
    exportBtn.disabled = active;
    importBtn.disabled = active;
    resetBtn.disabled = active;
    videoExportBtn.disabled = active;
    settingsBtn.disabled = active;
    playBtn.disabled = active || state.formations.length < 2;
  }

  function loadImage(url){
    return new Promise(function(resolve, reject){
      var img = new Image();
      img.onload = function(){ resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }

  // Pure (DOM-independent) equivalent of formations.js's renumberFilmCategories() — the running
  // "N." a named section gets (a repeat of the same name elsewhere starts its own count), plus
  // which section text is actually in effect at a given Bild (a blank category just continues
  // whatever section came before it). The video export has no filmstrip DOM to read the numbers
  // back off of, so this recomputes them straight from state.formations.
  function categoryLabelAt(idx){
    var counts = {}, prevKey = null, effectiveText = '', num = 0;
    for(var i = 0; i <= idx; i++){
      var f = state.formations[i];
      var text = f && f.category ? f.category.trim() : '';
      if(text){
        var key = text.toLowerCase();
        if(key !== prevKey) counts[key] = (counts[key] || 0) + 1;
        prevKey = key;
        effectiveText = text;
        num = counts[key];
      }
    }
    return effectiveText ? (num + '. ' + effectiveText) : '';
  }

  // Fixed width of the left info panel drawn by drawVideoInfoPanel() below — reserved out of the
  // canvas by runVideoRecording (the stage itself keeps its old 1200×800 footprint; the panel is
  // added alongside it, not carved out of it).
  var VIDEO_INFO_PANEL_W = 300;

  // Greedy word-wrap for canvas text (no native equivalent) — sets ctx.font first if given, then
  // breaks `text` into lines no wider than maxWidth. Always returns at least one (possibly empty)
  // line so callers can loop over the result unconditionally.
  function wrapCanvasText(ctx, text, maxWidth, font){
    if(font) ctx.font = font;
    var words = String(text || '').split(/\s+/).filter(Boolean);
    var lines = [], line = '';
    words.forEach(function(w){
      var test = line ? line + ' ' + w : w;
      if(line && ctx.measureText(test).width > maxWidth){
        lines.push(line);
        line = w;
      }else{
        line = test;
      }
    });
    if(line) lines.push(line);
    return lines.length ? lines : [''];
  }

  // Left info panel for the video export — the stage lives on the right (see renderCanvasFrame).
  // Every Bild has a continuous "slot" position, `i - cursor`: 0 is dead center (biggest,
  // brightest), +1/-1 roughly where the old fixed next/previous rows sat, anything further fades
  // out. `cursor` itself glides smoothly between whole numbers over a move's entire duration
  // (recordSegments' segCursor) instead of jumping at the end of it, so each Bild visibly grows in
  // from the top as the show approaches it, passes through the middle, then shrinks away toward the
  // bottom as the show moves past — "durchfahren", not next/current/previous swapped in a hard cut.
  function drawVideoInfoPanel(ctx, panelW, H, cursor){
    var total = state.formations.length;
    if(!total) return;
    cursor = Math.max(0, Math.min(total - 1, cursor));
    var maxTextW = panelW * 0.8;
    var cx = panelW / 2;
    var centerY = H * 0.52;
    var slotH = H * 0.22; // vertical distance the stack moves per whole Bild of cursor progress

    ctx.save();

    // Divider between panel and stage.
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(panelW, 0); ctx.lineTo(panelW, H); ctx.stroke();

    // Dance section badge — top-left (not centered like the scrolling stack below), persistent,
    // tracks whichever Bild is nearest dead center rather than scrolling with the stack itself.
    // Left out entirely when the Bild has no category (categoryLabelAt already returns '' there).
    var padX = Math.round(panelW * 0.09);
    var cat = categoryLabelAt(Math.round(cursor));
    if(cat){
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(217,154,52,.95)';
      wrapCanvasText(ctx, cat.toUpperCase(), panelW - padX * 2, '700 15px "JetBrains Mono", monospace').forEach(function(line, i){
        ctx.fillText(line, padX, 30 + i * 20);
      });
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for(var i = 0; i < total; i++){
      var s = i - cursor;
      if(Math.abs(s) > 1.6) continue; // fully faded out at this distance — not worth drawing
      var emphasis = Math.max(0, 1 - Math.abs(s));       // 1 dead center, 0 by one full slot away
      var fade = Math.max(0, Math.min(1, (1.6 - Math.abs(s)) / 0.6)); // fades out over the last stretch instead of popping off
      var y = centerY - s * slotH;
      var size = Math.round(15 + emphasis * 17); // 15px far away up to 32px dead center
      var f = state.formations[i];
      var font = (emphasis > 0.6 ? '700 ' : '600 ') + size + 'px "Manrope",sans-serif';
      ctx.font = font;
      ctx.globalAlpha = fade * (0.4 + 0.6 * emphasis);
      ctx.fillStyle = emphasis > 0.6 ? '#fff' : 'rgba(255,255,255,.7)';
      // Just the Bild's own name — no "Bild N — " prefix — wrapped onto up to 2 lines rather than
      // truncated with an ellipsis (a name always falls back to "Bild N" itself if left blank, see
      // formations.js's fname blur handler, so this is never actually empty).
      var lines = wrapCanvasText(ctx, f.name || ('Bild ' + (i + 1)), maxTextW, font);
      if(lines.length > 2){
        var second = lines.slice(1).join(' ');
        while(second.length > 1 && ctx.measureText(second + '…').width > maxTextW) second = second.slice(0, -1);
        lines = [lines[0], second + '…'];
      }
      var lineH = size * 1.22;
      var baseY = y - (lines.length - 1) * lineH / 2;
      lines.forEach(function(line, li){ ctx.fillText(line, cx, baseY + li * lineH); });
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // focusIds (optional array of dancer ids): when given, only those dancers are drawn — used by
  // the "Schritte" per-dancer/pair video export (js/steps.js). Omitted/null draws everyone, same
  // as always. panelCursor (optional): the continuous Bild "cursor" driving drawVideoInfoPanel's
  // left panel (see its own comment) and reserving space for it — omitted (e.g. by any future
  // static single-Bild render) draws the stage across the full canvas with no panel.
  function renderCanvasFrame(ctx, W, H, posMap, logoImg, focusIds, ghosts, panelCursor){
    ctx.clearRect(0, 0, W, H);

    var hasPanel = panelCursor !== undefined && panelCursor !== null;
    var panelW = hasPanel ? Math.min(VIDEO_INFO_PANEL_W, W * 0.4) : 0;
    // Stage sub-rectangle: [sx0, 0, sw, sh] — every coordinate below goes through gx()/gy() rather
    // than the old straight gridToPercent(v)/100*W so the whole stage draws confined to the right
    // of the panel instead of across the full canvas.
    var sx0 = panelW, sw = W - panelW, sh = H;
    // The grid itself is a centered square inside that rectangle so 1 m is equally long in x and y
    // (same as the square live stage); the floor still fills the whole rectangle around it.
    var side = Math.min(sw, sh), gx0 = sx0 + (sw - side) / 2, gy0 = (sh - side) / 2;
    function gx(v){ return gx0 + gridToPercent(v) / 100 * side; }
    function gy(v){ return gy0 + gridToPercent(v) / 100 * side; }

    if(hasPanel){
      ctx.fillStyle = '#150f1c';
      ctx.fillRect(0, 0, panelW, H);
    }

    var grad = ctx.createLinearGradient(sx0, 0, sx0 + sw, H);
    grad.addColorStop(0, '#241a30');
    grad.addColorStop(1, '#2b2038');
    ctx.fillStyle = grad;
    ctx.fillRect(sx0, 0, sw, H);

    if(logoImg){
      var opacity = ((state.logo && state.logo.opacity) || 18) / 100;
      var maxW = sw*0.8, maxH = sh*0.8;
      var scale = Math.min(maxW/logoImg.width, maxH/logoImg.height);
      var lw = logoImg.width*scale, lh = logoImg.height*scale;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(logoImg, sx0 + (sw-lw)/2, (sh-lh)/2, lw, lh);
      ctx.restore();
    }

    ctx.lineWidth = 1;
    for(var v = GRID_MIN; v <= GRID_MAX; v++){
      var isZero = v === 0;
      var px = gx(v), py = gy(v);
      ctx.strokeStyle = isZero ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.08)';
      ctx.beginPath(); ctx.moveTo(px, gy0); ctx.lineTo(px, gy0+side); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx0, py); ctx.lineTo(gx0+side, py); ctx.stroke();
    }

    // Room-orientation labels (Wand/Spiegel/Eingang/Fenster or whatever they've been renamed to,
    // see state.roomLabels) — shown around the live stage's edges (js/stage.js) but, unlike those,
    // baked right onto the canvas near the corresponding edge here since a video frame has no DOM
    // to overlay them on afterward.
    var roomLabels = state.roomLabels || {};
    var roomInset = Math.round(Math.min(sw, sh) * 0.03);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.42)';
    ctx.font = '700 ' + Math.round(Math.min(sw,sh)*0.024) + 'px "JetBrains Mono", monospace';
    if(roomLabels.top){
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(roomLabels.top.toUpperCase(), gx0 + side/2, gy0 + roomInset);
    }
    if(roomLabels.bottom){
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(roomLabels.bottom.toUpperCase(), gx0 + side/2, gy0 + side - roomInset);
    }
    if(roomLabels.left){
      ctx.save();
      ctx.translate(gx0 + roomInset, gy0 + side/2);
      ctx.rotate(-Math.PI/2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(roomLabels.left.toUpperCase(), 0, 0);
      ctx.restore();
    }
    if(roomLabels.right){
      ctx.save();
      ctx.translate(gx0 + side - roomInset, gy0 + side/2);
      ctx.rotate(Math.PI/2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(roomLabels.right.toUpperCase(), 0, 0);
      ctx.restore();
    }
    ctx.restore();

    var radius = Math.max(14, Math.min(sw,sh)*0.024);

    // Onion-skin ghosts, drawn under the dancers: gray = where they came from, faint colour = where
    // they're going. Only present when the video export's "Herkunfts-/Zielpunkte" option is on.
    if(ghosts){
      var ghostR = radius * 0.42;
      var drawGhosts = function(map, fixedFill, alpha){
        if(!map) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        state.dancers.forEach(function(d){
          if(focusIds && focusIds.indexOf(d.id) === -1) return;
          var gp = map[d.id];
          if(!gp) return;
          ctx.fillStyle = fixedFill || d.color;
          ctx.beginPath();
          ctx.arc(gx(gp.x), gy(gp.y), ghostR, 0, Math.PI*2);
          ctx.fill();
        });
        ctx.restore();
      };
      drawGhosts(ghosts.prev, '#c9c2d6', 0.4);
      drawGhosts(ghosts.next, null, 0.32);
    }

    var drawList = [];
    state.dancers.forEach(function(d){
      drawList.push({d: d, k: d.id, follow: false});
      if(posMap[followKey(d.id)]) drawList.push({d: d, k: followKey(d.id), follow: true});
    });
    if(focusIds && exportShowContext){
      ctx.save();
      drawList.forEach(function(item){
        var pos = posMap[item.k];
        if(!pos || focusIds.indexOf(item.d.id) !== -1) return;
        var r = (item.follow || posMap[followKey(item.d.id)]) ? radius*0.62 : radius;
        var cx = gx(pos.x), cy = gy(pos.y);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(201,194,214,.5)';
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        ctx.font = '700 ' + Math.round(r*0.72) + 'px "Manrope",sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials(item.d.name), cx, cy+1);
      });
      ctx.restore();
    }
    drawList.forEach(function(item){
      var d = item.d;
      var pos = posMap[item.k];
      if(!pos) return;
      if(focusIds && focusIds.indexOf(d.id) === -1) return;
      var isSplit = item.follow || !!posMap[followKey(d.id)];
      var splitRole = item.follow ? ' · F' : (isSplit ? ' · L' : '');
      // Getrennte Lead/Follow-Punkte etwas kleiner als normale Paar-Punkte (wie auf der Bühne).
      var r = isSplit ? radius*0.62 : radius;
      var cx = gx(pos.x);
      var cy = gy(pos.y);
      var rot = pos.rot || 0;

      if(showFacing){
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot*Math.PI/180);
        ctx.beginPath();
        ctx.moveTo(-4, -r-2);
        ctx.lineTo(4, -r-2);
        ctx.lineTo(0, -r-9);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.4)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI*2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      if(item.follow) ctx.setLineDash([4,3]);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#fff';
      ctx.font = '700 ' + Math.round(r*0.72) + 'px "Manrope",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials(d.name), cx, cy+1);

      ctx.font = '600 13px "Manrope",sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(d.name + splitRole, cx, cy - r - 16);
    });

    if(hasPanel) drawVideoInfoPanel(ctx, panelW, H, panelCursor);
  }

  // H.264/MP4 plays everywhere that matters — iPhones, PowerPoint/Keynote, WhatsApp, video editors —
  // where VP8/VP9 WebM often doesn't. MediaRecorder can emit MP4 in current Chrome/Edge and Safari;
  // Firefox and older Chrome can't, so WebM stays as the automatic fallback (still a real file, just
  // less portable). Deterministic within a session, so it's safe to call once for the extension and
  // again in recordSegments for the recorder mime.
  function bestVideoMime(){
    if(!window.MediaRecorder || !MediaRecorder.isTypeSupported) return {mime:'', ext:'.webm'};
    var candidates = [
      ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', '.mp4'],
      ['video/mp4;codecs=avc1.42001E,mp4a.40.2', '.mp4'],
      ['video/mp4', '.mp4'],
      ['video/webm;codecs=vp9,opus', '.webm'],
      ['video/webm;codecs=vp8,opus', '.webm'],
      ['video/webm', '.webm']
    ];
    for(var i=0; i<candidates.length; i++){
      if(MediaRecorder.isTypeSupported(candidates[i][0])) return {mime: candidates[i][0], ext: candidates[i][1]};
    }
    return {mime:'', ext:'.webm'};
  }

  videoExportBtn.addEventListener('click', function(){
    if(exportState) return;
    if(!state.dancers.length || !state.formations.length) return;
    askFilename(bestVideoMime().ext, filenameBase(), function(filename, opts){
      startVideoExport(filename, null, opts && opts.includeGhosts);
    }, true);
  });
  videoCancelBtn.addEventListener('click', function(){
    if(exportState) exportState.cancelled = true;
  });

  // focusIds: see renderCanvasFrame's comment — passed through unchanged all the way down.
  function startVideoExport(filename, focusIds, includeGhosts, showContext){
    exportIncludeGhosts = !!includeGhosts;
    exportShowContext = !!showContext;
    pausePlayback();
    videoBackdrop.hidden = false;
    videoProgressFill.classList.remove('indeterminate');
    videoProgressFill.style.width = '0%';
    videoStatusText.textContent = 'Wird vorbereitet…';
    setExportingUI(true);

    var logoPromise = (state.logo && state.logo.url) ? loadImage(state.logo.url) : Promise.resolve(null);
    logoPromise.then(function(logoImg){
      runVideoRecording(logoImg, filename, focusIds);
    }).catch(function(err){
      console.error(err);
      videoStatusText.textContent = 'Fehler beim Rendern.';
      setTimeout(finishExportUI, 1500);
    });
  }

  // Marker times are positions in the original song; at songRate() ≠ 1 the song (and so each
  // segment) takes 1/rate as long in real time.
  function buildSyncSegments(pts, totalDur, rate){
    var msPerSongSec = 1000/rate;
    var segments = [];
    if(pts[0].time > 0.02){
      segments.push({type:'hold', idx: pts[0].idx, dur: pts[0].time*msPerSongSec});
    }
    for(var i=0; i<pts.length-1; i++){
      var span = Math.max(0, pts[i+1].time - pts[i].time);
      segments.push({type:'move', from: pts[i].idx, to: pts[i+1].idx, dur: Math.max(200, span*msPerSongSec)});
    }
    var last = pts[pts.length-1];
    var tailDur = Math.max(300, (totalDur - last.time)*msPerSongSec);
    segments.push({type:'hold', idx: last.idx, dur: tailDur});
    return segments;
  }

  function getAudioDuration(audioEl){
    return new Promise(function(resolve){
      if(audioEl.readyState >= 1 && isFinite(audioEl.duration) && audioEl.duration > 0){
        resolve(audioEl.duration);
        return;
      }
      var done = false;
      function onReady(){
        if(done) return;
        done = true;
        audioEl.removeEventListener('loadedmetadata', onReady);
        resolve(isFinite(audioEl.duration) ? audioEl.duration : 0);
      }
      audioEl.addEventListener('loadedmetadata', onReady);
      setTimeout(onReady, 3000);
    });
  }

  function runVideoRecording(logoImg, filename, focusIds){
    if(!window.MediaRecorder || !canvasCaptureStreamSupported()){
      videoStatusText.textContent = 'Dieser Browser unterstützt keine Videoaufnahme.';
      setTimeout(finishExportUI, 2000);
      return;
    }

    // The stage itself keeps its old 1200×800 footprint — the left info panel (drawVideoInfoPanel)
    // is added alongside it, not carved out of it, so the dance display doesn't shrink to make room.
    var H = 800, W = 1200 + VIDEO_INFO_PANEL_W;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    var exportAudioEl = (state.song && state.song.url) ? new Audio(state.song.url) : null;
    if(exportAudioEl) applySongRate(exportAudioEl);
    var pts = syncWaypoints();
    var useSync = exportAudioEl && pts.length >= 2;
    var durationPromise = useSync ? getAudioDuration(exportAudioEl) : Promise.resolve(0);

    durationPromise.then(function(songDuration){
      var d = durations();
      var segments;
      if(useSync && songDuration > 0){
        segments = buildSyncSegments(pts, songDuration, songRate());
      }else if(state.formations.length === 1){
        segments = [{type:'hold', idx:0, dur: Math.max(d.hold, 2000)}];
      }else{
        // Match the live playback (js/playback.js tick): one continuous chain of moves with no
        // hold in between — just a brief hold on the first and last Bild so the opening and closing
        // formations are readable before/after the motion.
        segments = [{type:'hold', idx:0, dur:d.hold}];
        for(var i=0; i<state.formations.length-1; i++){
          segments.push({type:'move', from:i, to:i+1, dur:d.move});
        }
        segments.push({type:'hold', idx:state.formations.length-1, dur:d.hold});
      }
      var totalDuration = segments.reduce(function(sum, seg){ return sum+seg.dur; }, 0);

      // Manual capture mode when the browser supports it (Chrome/Edge): the canvas only emits a
      // frame when recordSegments() explicitly calls track.requestFrame() after drawing one, rather
      // than on its own internal timer — see recordSegments' comment for why that matters once the
      // tab is backgrounded. Firefox has no requestFrame() at all, so it falls back to the old
      // automatic-capture stream (imperfect in the background, but no worse than before this fix).
      var canvasStream = canvas.captureStream(0);
      var manualCaptureTrack = canvasStream.getVideoTracks()[0];
      if(!manualCaptureTrack || typeof manualCaptureTrack.requestFrame !== 'function'){
        canvasStream = canvas.captureStream(30);
        manualCaptureTrack = null;
      }
      var tracks = canvasStream.getVideoTracks().slice();

      var audioCtx = null;
      if(exportAudioEl){
        var AudioCtor = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioCtor();
        if(audioCtx.state === 'suspended') audioCtx.resume().catch(function(){});
        var sourceNode = audioCtx.createMediaElementSource(exportAudioEl);
        var destNode = audioCtx.createMediaStreamDestination();
        // Only into the recording, not to the speakers — the song shouldn't play aloud while exporting.
        sourceNode.connect(destNode);
        tracks = tracks.concat(destNode.stream.getAudioTracks());
      }

      recordSegments(segments, totalDuration, tracks, manualCaptureTrack, canvas, ctx, W, H, logoImg, exportAudioEl, audioCtx, filename, focusIds);
    });
  }

  function recordSegments(segments, totalDuration, tracks, manualCaptureTrack, canvas, ctx, W, H, logoImg, exportAudioEl, audioCtx, filename, focusIds){
    var combinedStream = new MediaStream(tracks);
    var mimeType = bestVideoMime().mime; // MP4/H.264 where supported, else WebM — matches the extension picked at askFilename time
    var recorder = new MediaRecorder(combinedStream, mimeType ? {mimeType:mimeType, videoBitsPerSecond:6000000} : undefined);
    var chunks = [];
    recorder.ondataavailable = function(e){ if(e.data && e.data.size) chunks.push(e.data); };

    exportState = { cancelled:false };

    recorder.onstop = function(){
      var cancelled = exportState && exportState.cancelled;
      if(exportAudioEl) exportAudioEl.pause();
      if(audioCtx) audioCtx.close().catch(function(){});
      if(!cancelled && chunks.length){
        var blob = new Blob(chunks, {type: mimeType || 'video/webm'});
        downloadBlob(blob, filename);
      }
      finishExportUI();
    };

    recorder.start(250);
    if(exportAudioEl){ exportAudioEl.currentTime = 0; exportAudioEl.play().catch(function(){}); }

    var segIdx = 0, segStart = null;
    // setTimeout, not requestAnimationFrame: every major browser fully suspends rAF callbacks in a
    // backgrounded tab, which used to freeze this loop — and the frame it froze on — for however
    // long the user had another tab/window focused, while the (unaffected, real-time) audio element
    // kept playing right through it. The recorded video came out with its picture stuck for that
    // whole stretch and the audio consequently way ahead of it once the tab regained focus — a
    // export "zerschossen" by nothing more than switching away for a bit. setTimeout is only
    // throttled in the background (typically to ~1/s), never suspended outright, so the timeline
    // keeps advancing in step with the still-playing audio the whole time — just at a lower visual
    // frame rate while hidden, exactly like a slow machine would render it, not a frozen one.
    function scheduleFrame(){ setTimeout(frame, 1000/30); }
    function frame(){
      if(!exportState || exportState.cancelled){
        recorder.stop();
        return;
      }
      var now = performance.now();
      if(segStart === null) segStart = now;
      var seg = segments[segIdx];
      var elapsedInSeg = now - segStart;
      var posMap, segCursor;
      if(seg.type === 'hold'){
        posMap = state.formations[seg.idx].pos;
        segCursor = seg.idx; // static — the info-panel stack only moves during an actual move segment
      }else{
        var t = Math.min(1, elapsedInSeg/seg.dur);
        // Chains through any Zwischenpositionen on seg.from's own betweens list, same as live
        // playback (see interpolateThroughBetweens in state.js) — so a video export shows exactly
        // the poses the editor does, not a single straight interpolation that skips them.
        posMap = interpolateThroughBetweens(seg.from, seg.to, t);
        // The info-panel's own continuous cursor (see drawVideoInfoPanel) — glides from seg.from to
        // seg.to across the *whole* segment, independent of however many Zwischenpositionen-legs
        // posMap above just chained through, so the panel scrolls smoothly through exactly one Bild
        // per move regardless of how it's spatially subdivided.
        segCursor = seg.from + moveEase(seg.from, seg.to, t);
      }
      renderCanvasFrame(ctx, W, H, posMap, logoImg, focusIds, ghostsFor(seg), segCursor);
      // In manual-capture mode (see runVideoRecording), the stream never emits a frame on its own —
      // this is the one and only signal that a new frame is ready, which is exactly what keeps
      // recording accurate while backgrounded: however slowly setTimeout ends up firing, each call
      // still pushes the frame that actually matches its `now`, rather than the browser sampling the
      // canvas on its own separate timer.
      if(manualCaptureTrack) manualCaptureTrack.requestFrame();

      var elapsedBefore = 0;
      for(var s=0; s<segIdx; s++) elapsedBefore += segments[s].dur;
      var elapsedTotal = elapsedBefore + Math.min(elapsedInSeg, seg.dur);
      videoProgressFill.style.width = Math.min(100, (elapsedTotal/totalDuration*100)) + '%';
      var displayIdx = (seg.type === 'hold' ? seg.idx : seg.to) + 1;
      videoStatusText.textContent = 'Bild ' + displayIdx + ' / ' + state.formations.length;

      if(elapsedInSeg >= seg.dur){
        segIdx += 1;
        segStart = now;
        if(segIdx >= segments.length){
          var lastSeg = segments[segments.length-1];
          renderCanvasFrame(ctx, W, H, state.formations[lastSeg.idx].pos, logoImg, focusIds, ghostsFor(lastSeg), lastSeg.idx);
          if(manualCaptureTrack) manualCaptureTrack.requestFrame();
          videoProgressFill.style.width = '100%';
          videoProgressFill.classList.add('indeterminate');
          videoStatusText.textContent = 'Wird finalisiert…';
          setTimeout(function(){ recorder.stop(); }, 300);
          return;
        }
      }
      scheduleFrame();
    }
    scheduleFrame();
  }

  function canvasCaptureStreamSupported(){
    var c = document.createElement('canvas');
    return typeof c.captureStream === 'function';
  }

  function finishExportUI(){
    exportState = null;
    videoBackdrop.hidden = true;
    setExportingUI(false);
  }

  function fullRerender(){
    stageEl.innerHTML = '';
    stageMarkers = {};
    activeLayoutId = null; // a freshly imported/reset project has no business keeping the old ghost
    buildStageLayers();
    renderLayoutSelectOptions();
    ensureMarkers();
    positionMarkers(currentFormation().pos);
    updateRoomLabelInputs();
    renderRoster();
    renderFilmstrip();
    updatePairRotateUI();
    updatePlaybarInfo();
    updatePlayButton();
    applyTempo();
    projectNameInput.value = state.projectName || '';
    document.title = (state.projectName || 'Aufstellung') + ' — Aufstellung';
    applySongSource();
    if(!settingsBackdrop.hidden){
      updateLogoSettingsUI();
      updateSongSettingsUI();
    }
    if(!markerBackdrop.hidden) openMarkerModal();
  }
