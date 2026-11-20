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
    var tempo = 50, dancers = [], formations = [], current = null, stage = sanitizeStage(null);
    for(var i=1; i<lines.length; i++){
      var line = lines[i].trim();
      if(!line) continue;
      var parts = line.split(/\s+/);
      var kw = parts[0];
      if(kw === 'TEMPO'){ tempo = parseFloat(parts[1]); if(isNaN(tempo)) tempo = 50; }
      else if(kw === 'LOOP'){ /* legacy field, ignored */ }
      else if(kw === 'BUEHNE') stage = sanitizeStage({w: parseFloat(parts[1]), d: parseFloat(parts[2])});
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
      stage: stage,
      pairs: [], customFigures: [], logo: null, song: null,
      activeIndex: 0, tempo: tempo
    };
  }

  // Symmetrical writer for the format `parseAuf` reads — keeps `.auf` a lightweight,
  // human-readable companion to `.stg` (positions/names/rotations only, no song/logo/axes/pairs).
  function buildAufText(s){
    var lines = ['AUFSTELLUNG 1', 'TEMPO ' + Math.round(s.tempo), 'BUEHNE ' + sanitizeStage(s.stage).w + ' ' + sanitizeStage(s.stage).d];
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
    var header = {
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
          var orbits = sanitizeOrbits(b.orbits);
          if(orbits) out.orbits = orbits;
          var paths = sanitizePaths(b.paths);
          if(paths) out.paths = paths;
          if(sanitizeNote(b.note)) out.note = sanitizeNote(b.note);
          return out;
        });
        return {id:f.id, name:f.name, pos:pos, showAxes: f.showAxes !== false, localAxes: localAxes, category: f.category||'', time: time === null ? null : Math.round(time*100)/100, startPos: startPos, betweens: betweens, speedCurve: sanitizeSpeedCurve(f.speedCurve), move: sanitizeMoveName(f.move), coupleTurns: sanitizeCoupleTurns(f.coupleTurns), spins: sanitizeSpins(f.spins), orbits: sanitizeOrbits(f.orbits), paths: sanitizePaths(f.paths), note: sanitizeNote(f.note), splitPairs: sanitizeSplitPairs(f.splitPairs)};
      }),
      axes: (s.axes||[]).map(function(ax){ return {id:ax.id, x1:roundNum(ax.x1), y1:roundNum(ax.y1), x2:roundNum(ax.x2), y2:roundNum(ax.y2), label:ax.label||''}; }),
      showAxes: !!s.showAxes,
      showFacing: s.showFacing !== false,
      roomLabels: {
        top: (s.roomLabels && s.roomLabels.top) || '',
        right: (s.roomLabels && s.roomLabels.right) || '',
        bottom: (s.roomLabels && s.roomLabels.bottom) || '',
        left: (s.roomLabels && s.roomLabels.left) || ''
      },
      stage: sanitizeStage(s.stage),
      coords: sanitizeCoords(s.coords),
      pairs: (s.pairs||[]).map(function(p){ return {id:p.id, memberIds:p.memberIds.slice(), name:p.name||'', collapsed:!!p.collapsed}; }),
      customFigures: (s.customFigures||[]).map(function(fig){ return {id:fig.id, name:fig.name, transform:fig.transform}; }),
      activeIndex: s.activeIndex,
      tempo: s.tempo,
      logo: logoMeta || null,
      song: songMeta || null
    };
    var mu = sanitizeMusic(s);
    if(mu.beats) header.beats = mu.beats; // only when there are any, so older snapshots stay comparable
    if(mu.music) header.music = mu.music;
    var videoLayout = sanitizeVideoLayout(s.videoLayout); // a copy: history snapshots must not share it
    if(videoLayout) header.videoLayout = videoLayout;
    return header;
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
      var out = {id:f.id, name:f.name||'Bild', pos:pos, showAxes: typeof f.showAxes === 'boolean' ? f.showAxes : (header.showAxes !== false), localAxes: localAxes, category: typeof f.category === 'string' ? f.category : '', startPos: startPos, betweens: sanitizeBetweens(f.betweens, header.dancers), speedCurve: sanitizeSpeedCurve(f.speedCurve), move: sanitizeMoveName(f.move), coupleTurns: sanitizeCoupleTurns(f.coupleTurns), spins: sanitizeSpins(f.spins), orbits: sanitizeOrbits(f.orbits), paths: sanitizePaths(f.paths), note: sanitizeNote(f.note), splitPairs: sanitizeSplitPairs(f.splitPairs)};
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
    var mu = sanitizeMusic(header); // older files have bars instead: converted

    return {
      projectName: header.projectName || 'Meine Formation',
      dancers: header.dancers,
      formations: formations,
      axes: Array.isArray(header.axes) ? header.axes : [],
      showAxes: header.showAxes !== false,
      showFacing: header.showFacing !== false,
      roomLabels: {
        top: (header.roomLabels && typeof header.roomLabels.top === 'string') ? header.roomLabels.top : 'WAND',
        right: (header.roomLabels && typeof header.roomLabels.right === 'string') ? header.roomLabels.right : 'SPIEGEL',
        bottom: (header.roomLabels && typeof header.roomLabels.bottom === 'string') ? header.roomLabels.bottom : 'EINGANG',
        left: (header.roomLabels && typeof header.roomLabels.left === 'string') ? header.roomLabels.left : 'FENSTER'
      },
      stage: sanitizeStage(header.stage),
      coords: sanitizeCoords(header.coords),
      beats: mu.beats,
      music: mu.music,
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

  function sanitizeFilename(name){
    name = (name || '').trim();
    name = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
    name = name.replace(/^\.+/, '');
    name = name.slice(0, 120);
    return name || 'aufstellung';
  }

  function revokeStateBlobs(s){
    if(s.logo && s.logo.url) URL.revokeObjectURL(s.logo.url);
    if(s.song && s.song.url) URL.revokeObjectURL(s.song.url);
  }

  /* ---------- save / open / reset ---------- */

  /* ---------- Exportieren: one dialog for every output (.stg, .auf, Video, Schritte-PDF) ---------- */

  var exportBackdrop = document.getElementById('exportBackdrop');
  var exportCloseBtn = document.getElementById('exportCloseBtn');
  var exportCancelBtn = document.getElementById('exportCancelBtn');
  var exportConfirmBtn = document.getElementById('exportConfirmBtn');
  var exportFormatInputs = Array.prototype.slice.call(document.querySelectorAll('input[name="exportFormat"]'));
  var exportEmptyHint = document.getElementById('exportEmptyHint');
  var exportWhoSection = document.getElementById('exportWhoSection');
  var exportWhoList = document.getElementById('exportWhoList');
  var exportWhoHint = document.getElementById('exportWhoHint');
  var exportOptionsSection = document.getElementById('exportOptionsSection');
  var exportContextOption = document.getElementById('exportContextOption');
  var exportContextToggle = document.getElementById('exportContextToggle');
  var exportGhostOption = document.getElementById('exportGhostOption');
  var exportGhostToggle = document.getElementById('exportGhostToggle');
  var exportNotesOption = document.getElementById('exportNotesOption');
  var exportNotesToggle = document.getElementById('exportNotesToggle');
  var exportPathsOption = document.getElementById('exportPathsOption');
  var exportPathsToggle = document.getElementById('exportPathsToggle');
  var exportBackOption = document.getElementById('exportBackOption');
  var exportPdfHint = document.getElementById('exportPdfHint');
  var exportQualityOption = document.getElementById('exportQualityOption');
  var exportQualitySelect = document.getElementById('exportQualitySelect');
  var exportRealtimeHint = document.getElementById('exportRealtimeHint');
  var filenameInput = document.getElementById('filenameInput');
  var filenameExt = document.getElementById('filenameExt');
  // Kept across openings, so a second video right after the first needs one click.
  var exportFormat = 'stg';
  // Wer?: the ticked steps.js values ('d:<id>' dancer, 'p:<id>' pair), in list order; none = alle.
  // Kept across openings too.
  var exportWho = [];
  // Once the name is typed by hand it stays put when switching format/Wer; until then it follows them.
  var filenameEdited = false;

  var EXPORT_CONFIRM_LABELS = {stg: 'Speichern', auf: 'Speichern', video: 'Video rendern', pdf: 'PDF erstellen'};

  function exportNeedsDancers(fmt){ return fmt === 'video' || fmt === 'pdf'; }

  function exportExt(){
    if(exportFormat === 'video') return videoExportExt();
    if(exportFormat === 'pdf') return '.pdf';
    return '.' + exportFormat;
  }

  // One name group per ticked entry ("Anna & Ben, Clara & Dirk"); '' for alle.
  function exportWhoLabel(){
    var labels = [];
    exportWho.forEach(function(v){
      var label = sheetsLabel(getStepsSheets(v));
      if(label && labels.indexOf(label) === -1) labels.push(label);
    });
    return labels.join(', ');
  }

  function exportWhoInputs(){ return Array.prototype.slice.call(exportWhoList.querySelectorAll('input')); }

  // "Alle" first, then the pairs, then (on a line of their own) the single dancers.
  function fillExportWhoList(){
    var choices = stepsWhoChoices();
    exportWho = exportWho.filter(function(v){ return choices.some(function(c){ return c.value === v; }); });
    exportWhoList.innerHTML = '';
    var prevKind = null;
    [{value: '', label: 'Alle'}].concat(choices).forEach(function(c){
      var kind = c.value.slice(0,1);
      if(prevKind !== null && kind !== prevKind){
        var br = document.createElement('span');
        br.className = 'export-who-break';
        exportWhoList.appendChild(br);
      }
      prevKind = kind;
      var item = document.createElement('label');
      item.className = 'export-who-item';
      var inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.value = c.value;
      var text = document.createElement('span');
      text.textContent = c.label;
      item.appendChild(inp);
      item.appendChild(text);
      exportWhoList.appendChild(item);
    });
  }

  function exportDefaultName(){
    var label = exportWhoLabel();
    if(exportFormat === 'pdf') return (state.projectName || 'Aufstellung') + ' — Schritte — ' + (label || 'Alle');
    if(exportFormat === 'video' && label) return filenameBase() + '-' + label.replace(/[^\w-]+/g,'_');
    return filenameBase();
  }

  function syncExportDialog(){
    var noDancers = !state.dancers.length || !state.formations.length;
    exportFormatInputs.forEach(function(inp){
      inp.disabled = noDancers && exportNeedsDancers(inp.value);
      inp.checked = inp.value === exportFormat;
    });
    exportEmptyHint.hidden = !noDancers;
    var media = exportNeedsDancers(exportFormat);
    var who = exportWho.length > 0;
    exportWhoInputs().forEach(function(inp){
      inp.checked = inp.value ? exportWho.indexOf(inp.value) !== -1 : !who;
    });
    exportWhoSection.hidden = !media;
    if(exportFormat === 'pdf'){
      exportWhoHint.textContent = (who
        ? (exportWho.length > 1 ? 'Ein Dokument mit den Blättern aller Gewählten, Paar für Paar. ' : '') +
          'Pro Bild eine Karte mit großer, gut lesbarer Koordinatenangabe.'
        : 'Ein Dokument mit den Blättern aller Tänzer – erst Paar 1, dann Paar 2 usw.') +
        ' Ist ein Paar in Lead & Follow geteilt, stehen beide Positionen auf derselben Karte nebeneinander.';
    } else {
      exportWhoHint.textContent = who ? 'Das Video zeigt nur die Gewählten.' : 'Die ganze Choreo mit allen Tänzern.';
    }
    // On a video of everyone there are no "other couples" to grey out; on the PDF every sheet has them.
    exportContextOption.hidden = !media || (exportFormat === 'video' && !who);
    exportGhostOption.hidden = exportFormat !== 'video';
    exportNotesOption.hidden = exportFormat !== 'pdf';
    exportBackOption.hidden = exportFormat !== 'pdf';
    exportPathsOption.hidden = exportFormat !== 'pdf' && exportFormat !== 'video';
    exportQualityOption.hidden = exportFormat !== 'video';
    document.getElementById('exportLayoutOption').hidden = exportFormat !== 'video';
    syncVideoQualityLabels();
    exportRealtimeHint.hidden = fastVideoExportPossible();
    exportOptionsSection.hidden = exportContextOption.hidden && exportGhostOption.hidden && exportNotesOption.hidden && exportPathsOption.hidden && exportBackOption.hidden;
    exportPdfHint.hidden = exportFormat !== 'pdf';
    filenameExt.textContent = exportExt();
    if(!filenameEdited) filenameInput.value = exportDefaultName();
    exportConfirmBtn.textContent = EXPORT_CONFIRM_LABELS[exportFormat];
  }

  function openExportDialog(){
    if(exportState) return;
    fillExportWhoList();
    if((!state.dancers.length || !state.formations.length) && exportNeedsDancers(exportFormat)) exportFormat = 'stg';
    filenameEdited = false;
    exportPathsToggle.checked = pathsToggle.checked; // starts like the stage's own Weglinien setting
    syncExportDialog();
    exportBackdrop.hidden = false;
    requestAnimationFrame(function(){
      var checked = exportFormatInputs.find(function(inp){ return inp.checked; });
      if(checked) checked.focus();
    });
  }
  function closeExportDialog(){ exportBackdrop.hidden = true; }

  // Shows a saving state on the button while the (possibly song-sized) file is built.
  function saveProjectFile(filename, buildBlobFn){
    var originalHtml = exportConfirmBtn.innerHTML;
    exportConfirmBtn.disabled = true;
    exportConfirmBtn.textContent = 'Wird gespeichert…';
    Promise.resolve(buildBlobFn(state)).then(function(blob){
      downloadBlob(blob, filename);
    }).catch(function(err){
      console.error(err);
    }).then(function(){ exportConfirmBtn.disabled = false; exportConfirmBtn.innerHTML = originalHtml; });
  }

  function confirmExport(){
    if(exportBackdrop.hidden) return;
    var base = sanitizeFilename(filenameInput.value);
    if(exportFormat === 'stg' || exportFormat === 'auf'){
      if(exportFormat === 'stg') saveProjectFile(base + '.stg', function(s){ return buildStgBlob(s).then(appendStgVideoImages); });
      else saveProjectFile(base + '.auf', function(s){ return new Blob([buildAufText(s)], {type:'text/plain'}); });
      return;
    }
    if(!state.dancers.length || !state.formations.length) return;
    var sheets = exportWho.length ? getStepsSheetsFor(exportWho) : null;
    if(sheets && !sheets.length) return;
    var showContext = !exportContextOption.hidden && exportContextToggle.checked;
    if(exportFormat === 'video'){
      startVideoExport(base + videoExportExt(), sheets ? stepsFocusIds(sheets) : null, exportGhostToggle.checked, showContext, exportPathsToggle.checked);
    } else {
      printStepsSheets(sheets || getAllStepsSheets(), base, showContext, exportNotesToggle.checked, exportPathsToggle.checked, document.getElementById('exportBackToggle').checked);
    }
  }

  exportBtn.addEventListener('click', openExportDialog);
  exportCloseBtn.addEventListener('click', closeExportDialog);
  exportCancelBtn.addEventListener('click', closeExportDialog);
  exportConfirmBtn.addEventListener('click', confirmExport);
  exportBackdrop.addEventListener('click', function(e){ if(e.target === exportBackdrop) closeExportDialog(); });
  exportFormatInputs.forEach(function(inp){
    inp.addEventListener('change', function(){
      if(!inp.checked) return;
      exportFormat = inp.value;
      syncExportDialog();
    });
  });
  // Ticking "Alle" (or unticking the last one) clears the rest; ticking anyone else unticks "Alle".
  exportWhoList.addEventListener('change', function(e){
    exportWho = !e.target.value ? [] : exportWhoInputs().filter(function(inp){
      return inp.value && inp.checked;
    }).map(function(inp){ return inp.value; });
    syncExportDialog();
  });
  filenameInput.addEventListener('input', function(){ filenameEdited = true; });
  exportBackdrop.addEventListener('keydown', function(e){
    if(e.key !== 'Enter' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    confirmExport();
  });

  var importErrorText = importErrorEl.textContent;
  function showImportError(msg){
    importErrorEl.textContent = msg || importErrorText; // a share link says why it failed (gone, switched off)
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
  // keepView (share sync) stays on the Bild shown here instead of jumping to the sender's (#2076).
  function applyState(next, opts){
    opts = opts || {};
    var keepId = opts.keepView && state.formations[state.activeIndex] ? state.formations[state.activeIndex].id : null;
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
    if(keepId) state.formations.forEach(function(f, i){ if(f.id === keepId) state.activeIndex = i; });
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
        applyImportedState(readStgVideoExtras(buf, parseStg(buf)));
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

  // „Neue Choreo“ (#2042): with the sample Bilder, empty, or a copy of this one. The current one
  // stays saved on this device (the „Öffnen“ list) and the page reloads into the new project
  // (?neu=…, see loadState()) — not swapped in place, for the same reason as openLocalProject() above.
  var newChoreoBackdrop = document.getElementById('newChoreoBackdrop');
  function closeNewChoreoModal(){ newChoreoBackdrop.hidden = true; }
  newChoreoBtn.addEventListener('click', function(){ newChoreoBackdrop.hidden = false; });
  document.getElementById('newChoreoCloseBtn').addEventListener('click', closeNewChoreoModal);
  newChoreoBackdrop.addEventListener('click', function(e){ if(e.target === newChoreoBackdrop) closeNewChoreoModal(); });
  Array.prototype.forEach.call(newChoreoBackdrop.querySelectorAll('[data-neu]'), function(btn){
    btn.addEventListener('click', function(){
      saveStateDebounced.flush();
      writeLocalProject();
      var url = location.pathname + '?neu=' + btn.dataset.neu;
      if(btn.dataset.neu !== 'kopie'){ location.assign(url); return; }
      // Logo and song live in IndexedDB per project — file them under the copy's id first.
      var id = uid('proj'), puts = [];
      if(state.logo && state.logo.blob) puts.push(idbPut(idbBlobKey('logo', id), { name:state.logo.name, mime:state.logo.mime, blob:state.logo.blob, opacity:state.logo.opacity }));
      if(state.song && state.song.blob) puts.push(idbPut(idbBlobKey('song', id), { name:state.song.name, mime:state.song.mime, blob:state.song.blob }));
      Promise.all(puts).then(function(){
        location.assign(url + '&von=' + encodeURIComponent(state.localId) + '&id=' + encodeURIComponent(id));
      });
    });
  });

  // „Choreo löschen“ wipes the entire project (every Bild, dancer, axis, logo, song — replaced
  // wholesale by defaultState()) and, unlike the app's other destructive actions, isn't really
  // undoable: the fresh project gets its own localId, so js/history.js's undo/redo starts a brand
  // new timeline rather than being able to step back into the one that just got replaced (see historyKeyFor()).
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

  deleteChoreoBtn.addEventListener('click', openResetModal);
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
  // "Weglinien einzeichnen": the move's walk (movePaths, js/stage.js), cached per Bild for the run.
  var exportIncludePaths = false, exportPathCache = {};
  // The {wer} placeholder of the video layout: who a Schritte video shows. Set per export.
  var exportWhoText = '';

  // The onion-skin ghost source Bilder for a timeline segment — mirrors renderOnionSkin() in
  // js/stage.js: gray = the Bild *behind* you (the previous Bild while holding, the move's origin
  // while moving), faint colour = the Bild *ahead* — plus, with Weglinien on, the walk of the move
  // out of the Bild shown (like the stage). Returns null when both options are off.
  function ghostsFor(seg){
    if((!exportIncludeGhosts && !exportIncludePaths) || !seg) return null;
    var pIdx = seg.type === 'move' ? seg.from : seg.idx - 1;
    var nIdx = seg.type === 'move' ? seg.to   : seg.idx + 1;
    var prev = state.formations[pIdx], next = state.formations[nIdx];
    var fIdx = seg.type === 'move' ? seg.from : seg.idx, paths = null;
    if(exportIncludePaths && state.formations[fIdx + 1]) paths = exportPathCache[fIdx] || (exportPathCache[fIdx] = movePaths(fIdx));
    return exportIncludeGhosts
      ? { prev: prev ? prev.pos : null, next: next ? next.pos : null, paths: paths }
      : { prev: null, next: null, paths: paths };
  }

  function setExportingUI(active){
    document.body.classList.toggle('exporting', active);
    exportBtn.disabled = active;
    importBtn.disabled = active;
    newChoreoBtn.disabled = active;
    deleteChoreoBtn.disabled = active;
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

  // Width of the left info panel in the standard landscape layout (defaultVideoLayout below) —
  // the stage itself keeps its old 1200×800 footprint; the panel is added alongside it, not carved
  // out of it.
  var VIDEO_INFO_PANEL_W = 300;

  // Video layout (#2095): what a frame shows and where. Every part of the frame is an element with a
  // box (x, y, w, h in the format's units, VIDEO_FORMATS in js/state.js), drawn bottom to top in
  // `els` order: 'stage' (floor, grid, room labels, dancers), 'logo' (the project logo), 'bilder'
  // (the scrolling Bild names), 'text' (with placeholders, see videoTextFor) and 'image'. The stage
  // floors are painted first, over the frame background, so the logo and anything else placed under
  // the stage sits on the floor and under the grid — as the logo always did. state.videoLayout null
  // means this standard layout: the frame the export drew before the builder, plus the metre numbers
  // along the grid (#2154).
  function defaultVideoLayout(format){
    format = VIDEO_FORMATS[format] ? format : 'quer';
    var W = VIDEO_FORMATS[format].w, H = VIDEO_FORMATS[format].h, stage, panel, pad, s = 1;
    if(format === 'hoch'){
      // Phone portrait: stage on top, the panel underneath.
      stage = {x: 0, y: 0, w: W, h: Math.round(H * 0.58)};
      panel = {x: 0, y: stage.h, w: W, h: H - stage.h};
      pad = 40; s = 1.2;
    }else{
      var pw = Math.min(VIDEO_INFO_PANEL_W, Math.round(W * 0.25));
      stage = {x: pw, y: 0, w: W - pw, h: H};
      panel = {x: 0, y: 0, w: pw, h: H};
      pad = Math.round(pw * 0.09);
    }
    // The panel, top to bottom: Abschnitt, the bar heard and its Phrasierung, the Figuren
    // (the one danced now in the middle, the one before and after it), the Bild's name. Offsets in
    // the landscape panel's units, from its top (top >= 0) or its foot (top < 0).
    var gold = 'rgba(217,154,52,.95)', fig = {top: 170, foot: 140};
    function text(id, t, top, h, size, mono, color){
      return {id: id, type: 'text', x: panel.x + pad, y: Math.round(top < 0 ? panel.y + panel.h + top * s : panel.y + top * s), w: panel.w - pad * 2, h: Math.round(h * s),
        text: t, font: mono ? 'mono' : 'sans', size: Math.round(size * s), bold: true, upper: mono, color: color, align: 'left', bg: ''};
    }
    var lw = stage.w * 0.8, lh = stage.h * 0.8;
    return {format: format, bg: '#150f1c', els: [
      {id: 'logo', type: 'logo', x: stage.x + (stage.w - lw) / 2, y: stage.y + (stage.h - lh) / 2, w: lw, h: lh},
      {id: 'stage', type: 'stage', x: stage.x, y: stage.y, w: stage.w, h: stage.h, grid: true, nums: true, line: 1, dot: 100, initials: true, names: true, room: true, floor: ''},
      text('abschnitt', '{abschnitt}', 30, 40, 15, true, gold),
      text('takt', 'Takt {takt}', 72, 52, 36, false, '#ffffff'),
      text('rhythmus', '{rhythmus}', 126, 34, 22, true, 'rgba(255,255,255,.7)'),
      {id: 'figuren', type: 'figuren', x: panel.x, y: Math.round(panel.y + fig.top * s), w: panel.w, h: Math.round(panel.h - (fig.top + fig.foot) * s), size: Math.round(100 * s), color: '#ffffff', divider: format !== 'hoch'},
      text('bildnr', 'Bild {nr}', -120, 24, 13, true, gold),
      text('bild', '{bild}', -94, 70, 26, false, '#ffffff')
    ]};
  }
  function currentVideoLayout(){ return state.videoLayout || defaultVideoLayout('quer'); }
  function videoFrameSize(){ return VIDEO_FORMATS[currentVideoLayout().format]; }

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

  function hexRgb(hex){ var n = parseInt(hex.slice(1), 16); return (n >> 16) + ',' + (n >> 8 & 255) + ',' + (n & 255); }

  // The 'bilder' element: every Bild has a continuous "slot" position, `i - cursor`: 0 is dead
  // center (biggest, brightest), +1/-1 roughly where the old fixed next/previous rows sat, anything
  // further fades out. `cursor` itself glides smoothly between whole numbers over a move's entire
  // duration (videoFrameAt's cursor) instead of jumping at the end of it, so each Bild visibly grows
  // in from the top as the show approaches it, passes through the middle, then shrinks away toward
  // the bottom as the show moves past — "durchfahren", not next/current/previous swapped in a hard cut.
  function drawVideoInfoPanel(ctx, el, cursor){
    drawNameStack(ctx, el, state.formations.map(function(f, i){ return f.name || ('Bild ' + (i + 1)); }), cursor, el.y, el.h);
  }
  // The 'figuren' element: the Figuren of the bars (Musik › Phrasierung, one per run of bars) scroll
  // the same way — the one danced now in the middle, the next one above, the last one below. Each
  // stays put while it's danced and glides on in the half second before the next one starts. Without
  // any Figuren (or without the song) it shows the Bild names instead.
  function drawFigurenPanel(ctx, el, cursor, info){
    var list = [], t = Math.max(0, (info && info.tMs) || 0) / 1000;
    if(isSyncActive()) music().bars.forEach(function(b){ // js/beats.js
      var f = b.f.trim();
      if(f && (!list.length || list[list.length - 1].f !== f)) list.push({t: b.t, f: f});
    });
    if(!list.length){ drawVideoInfoPanel(ctx, el, cursor); return; }
    var k = 0;
    while(k + 1 < list.length && list[k + 1].t <= t + 0.02) k++;
    function glide(from, to){ var g = Math.min(0.5, (to - from) * 0.4); return g > 0 ? Math.min(1, Math.max(0, (t - (to - g)) / g)) : 1; }
    var c = t + 0.02 < list[0].t ? glide(0, list[0].t) - 1 : k + (k + 1 < list.length ? glide(list[k].t, list[k + 1].t) : 0);
    // The panel's divider runs the frame's full height, though the Figuren sit only in its middle.
    drawNameStack(ctx, el, list.map(function(x){ return x.f; }), c, 0, videoFrameSize().h);
  }
  function drawNameStack(ctx, el, names, cursor, divY, divH){
    var total = names.length;
    if(!total) return;
    cursor = Math.max(-1, Math.min(total - 1, cursor));
    var maxTextW = el.w * 0.8;
    var cx = el.x + el.w / 2;
    var centerY = el.y + el.h * 0.52;
    var slotH = el.h * 0.22; // vertical distance the stack moves per whole Bild of cursor progress
    var k = el.size / 100, dim = 'rgba(' + hexRgb(el.color) + ',.7)';

    ctx.save();

    // Divider between panel and stage.
    if(el.divider){
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(el.x + el.w, divY); ctx.lineTo(el.x + el.w, divY + divH); ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for(var i = 0; i < total; i++){
      var s = i - cursor;
      if(Math.abs(s) > 1.6) continue; // fully faded out at this distance — not worth drawing
      var emphasis = Math.max(0, 1 - Math.abs(s));       // 1 dead center, 0 by one full slot away
      var fade = Math.max(0, Math.min(1, (1.6 - Math.abs(s)) / 0.6)); // fades out over the last stretch instead of popping off
      var y = centerY - s * slotH;
      var size = Math.round((15 + emphasis * 17) * k); // 15px far away up to 32px dead center, at 100 %
      var weight = emphasis > 0.6 ? '700 ' : '600 ';
      ctx.globalAlpha = fade * (0.4 + 0.6 * emphasis);
      ctx.fillStyle = emphasis > 0.6 ? el.color : dim;
      // Just the Bild's own name — no "Bild N — " prefix — wrapped and never cut off (#2167): a name
      // too tall for its slot (or with a word too wide) gets a smaller font instead, so it never runs
      // into its neighbours (a blank name already falls back to "Bild N", see formations.js).
      var name = names[i], lines, lineH;
      for(;;){
        lines = wrapCanvasText(ctx, name, maxTextW, weight + size + 'px "Manrope",sans-serif');
        lineH = size * 1.22;
        var widest = Math.max.apply(null, lines.map(function(l){ return ctx.measureText(l).width; }));
        if(size <= 6 || (lines.length * lineH <= slotH && widest <= maxTextW)) break;
        size--;
      }
      var baseY = y - (lines.length - 1) * lineH / 2;
      lines.forEach(function(line, li){ ctx.fillText(line, cx, baseY + li * lineH); });
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // A text element's text with its placeholders filled in for the Bild nearest `cursor`; '' when it
  // has placeholders and all of them are empty there (no Abschnitt yet, no note …), so a caption
  // like „{abschnitt}“ disappears instead of leaving an empty line or a lone label.
  function videoTextFor(el, cursor, info){
    var total = state.formations.length;
    var idx = Math.round(Math.max(0, Math.min(total - 1, cursor)));
    var f = state.formations[idx] || {};
    var sec = Math.floor(Math.max(0, (info && info.tMs) || 0) / 1000);
    // With the song, the video's time is the song's (buildSyncSegments): the bar heard then.
    var songT = isSyncActive() ? Math.max(0, (info && info.tMs) || 0) / 1000 : null, bar = songT === null ? null : barAt(songT);
    // With the song, an Abschnitt starts when its Bild is reached: none yet before Bild 1, and on the
    // way to the next Abschnitt's Bild still the current one.
    var reached = songT === null ? idx : syncTimes().filter(function(t){ return t !== null && t <= songT + 0.02; }).length - 1;
    var vals = {
      choreo: state.projectName || '',
      bild: f.name || ('Bild ' + (idx + 1)),
      nr: String(idx + 1),
      anzahl: String(total),
      abschnitt: reached < 0 ? '' : categoryLabelAt(reached),
      zeit: Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60),
      notiz: f.note || '',
      wer: (info && info.who) || '',
      takt: bar ? String(bar.n) : '',
      rhythmus: bar ? bar.p : '',
      figur: bar ? bar.f : '',
      uebergang: bar ? bar.f : '' // the moves' own names are gone (#2183): older texts get the Figur
    };
    var used = 0, filled = 0;
    var text = el.text.replace(/\{(\w+)\}/g, function(m, key){
      if(!Object.prototype.hasOwnProperty.call(vals, key)) return m;
      used++;
      if(vals[key]) filled++;
      return vals[key];
    });
    return used && !filled ? '' : text;
  }

  function drawTextElement(ctx, el, cursor, info){
    var text = videoTextFor(el, cursor, info);
    if(!text.trim()) return;
    if(el.upper) text = text.toUpperCase();
    var font = (el.bold ? '700 ' : '500 ') + el.size + 'px ' + (el.font === 'mono' ? '"JetBrains Mono", monospace' : '"Manrope",sans-serif');
    var pad = el.bg ? Math.round(el.size * 0.5) : 0, lineH = el.size * 4 / 3, lines = [];
    ctx.save();
    text.split('\n').forEach(function(p){ lines = lines.concat(wrapCanvasText(ctx, p, el.w - pad * 2, font)); });
    if(el.bg){
      ctx.fillStyle = el.bg;
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(el.x, el.y, el.w, el.h, Math.min(pad, el.h / 2)); else ctx.rect(el.x, el.y, el.w, el.h);
      ctx.fill();
    }
    ctx.fillStyle = el.color;
    ctx.textAlign = el.align;
    ctx.textBaseline = 'top';
    var x = el.align === 'center' ? el.x + el.w / 2 : el.align === 'right' ? el.x + el.w - pad : el.x + pad;
    lines.forEach(function(line, i){ ctx.fillText(line, x, el.y + pad + i * lineH); });
    ctx.restore();
  }

  // Logo and images: as large as fits the box, centered, in proportion.
  function drawImageFit(ctx, img, el, alpha){
    if(!img) return;
    var scale = Math.min(el.w / img.width, el.h / img.height);
    var lw = img.width * scale, lh = img.height * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, el.x + (el.w - lw) / 2, el.y + (el.h - lh) / 2, lw, lh);
    ctx.restore();
  }

  function drawStageFloor(ctx, el){
    if(el.floor === 'none') return;
    if(el.floor){
      ctx.fillStyle = el.floor;
    }else{
      var grad = ctx.createLinearGradient(el.x, el.y, el.x + el.w, el.y + el.h);
      grad.addColorStop(0, '#241a30');
      grad.addColorStop(1, '#2b2038');
      ctx.fillStyle = grad;
    }
    ctx.fillRect(el.x, el.y, el.w, el.h);
  }

  // The 'stage' element without its floor (drawStageFloor): grid, room labels, ghosts, dancers.
  function drawStageElement(ctx, el, posMap, focusIds, ghosts){
    var sw = el.w, sh = el.h;
    // The grid itself is a centered rectangle of the stage's proportions (#2060) inside the box, so
    // 1 m is equally long in x and y; the floor still fills the whole box around it.
    var ar = stageAspect(), sideW = Math.min(sw, sh * ar), sideH = sideW / ar;
    var gx0 = el.x + (sw - sideW) / 2, gy0 = el.y + (sh - sideH) / 2;
    function gx(v){ return gx0 + gridToPercentX(v) / 100 * sideW; }
    function gy(v){ return gy0 + gridToPercentY(v) / 100 * sideH; }
    // Everything with a fixed size in the original 1200×800 stage scales with the box.
    var k = Math.min(sw, sh) / 800;

    var stage = stageSize(), v;
    if(el.grid){
      ctx.lineWidth = el.line;
      for(v = Math.ceil(-stage.w / 2); v <= stage.w / 2; v++){
        ctx.strokeStyle = v === 0 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.08)';
        ctx.beginPath(); ctx.moveTo(gx(v), gy0); ctx.lineTo(gx(v), gy0+sideH); ctx.stroke();
      }
      for(v = Math.ceil(-stage.d / 2); v <= stage.d / 2; v++){
        ctx.strokeStyle = v === 0 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.08)';
        ctx.beginPath(); ctx.moveTo(gx0, gy(v)); ctx.lineTo(gx0+sideW, gy(v)); ctx.stroke();
      }
    }
    // Metre numbers like the editor's stage (buildGridOverlay in js/stage.js): along the bottom and
    // the left edge, every second one on a big stage.
    if(el.nums){
      var step = Math.max(stage.w, stage.d) > 20 ? 2 : 1, fs = Math.round(Math.min(sideW, sideH) * 0.017);
      ctx.save();
      ctx.font = '600 ' + fs + 'px "JetBrains Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      for(v = Math.ceil(-stage.w / 2); v <= stage.w / 2; v++){
        if(v % step) continue;
        ctx.fillStyle = v === 0 ? 'rgba(255,255,255,.65)' : 'rgba(255,255,255,.38)';
        ctx.fillText(String(dispCoord(v, 'x')), gx(v), gy0 + sideH - fs * 0.4);
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for(v = Math.ceil(-stage.d / 2); v <= stage.d / 2; v++){
        if(v % step) continue;
        ctx.fillStyle = v === 0 ? 'rgba(255,255,255,.65)' : 'rgba(255,255,255,.38)';
        ctx.fillText(String(dispCoord(v, 'y')), gx0 + fs * 0.45, gy(v));
      }
      ctx.restore();
    }

    // Room-orientation labels (Wand/Spiegel/Eingang/Fenster or whatever they've been renamed to,
    // see state.roomLabels) — shown around the live stage's edges (js/stage.js) but, unlike those,
    // baked right onto the canvas near the corresponding edge here since a video frame has no DOM
    // to overlay them on afterward.
    var roomLabels = el.room ? (state.roomLabels || {}) : {};
    var roomInset = Math.round(Math.min(sw, sh) * 0.03);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.42)';
    ctx.font = '700 ' + Math.round(Math.min(sw,sh)*0.024) + 'px "JetBrains Mono", monospace';
    if(roomLabels.top){
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(roomLabels.top.toUpperCase(), gx0 + sideW/2, gy0 + roomInset);
    }
    if(roomLabels.bottom){
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(roomLabels.bottom.toUpperCase(), gx0 + sideW/2, gy0 + sideH - roomInset);
    }
    if(roomLabels.left){
      ctx.save();
      ctx.translate(gx0 + roomInset, gy0 + sideH/2);
      ctx.rotate(-Math.PI/2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(roomLabels.left.toUpperCase(), 0, 0);
      ctx.restore();
    }
    if(roomLabels.right){
      ctx.save();
      ctx.translate(gx0 + sideW - roomInset, gy0 + sideH/2);
      ctx.rotate(Math.PI/2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(roomLabels.right.toUpperCase(), 0, 0);
      ctx.restore();
    }
    ctx.restore();

    var radius = Math.min(sw,sh)*0.024 * (el.dot / 100);

    // Onion-skin ghosts, drawn under the dancers: gray = where they came from, faint colour = where
    // they're going. Only present when the video export's "Herkunfts-/Zielpunkte" option is on.
    if(ghosts && ghosts.paths){
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(2, radius * 0.14);
      ghosts.paths.keys.forEach(function(e){
        if(focusIds && focusIds.indexOf(e.d.id) === -1) return;
        ctx.strokeStyle = e.d.color;
        ctx.setLineDash(isFollowKey(e.k) ? [radius * 0.4, radius * 0.3] : []);
        ctx.beginPath();
        ghosts.paths.frames.forEach(function(w, i){ var p = pathAt(w, e.k); if(p) ctx[i ? 'lineTo' : 'moveTo'](gx(p.x), gy(p.y)); });
        ctx.stroke();
      });
      ctx.restore();
    }
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
        if(!el.initials) return;
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        ctx.font = '700 ' + Math.round(r*0.72) + 'px "Manrope",sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials(item.d.name), cx, cy+k);
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

      if(state.showFacing !== false){
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot*Math.PI/180);
        ctx.beginPath();
        ctx.moveTo(-4*k, -r-2*k);
        ctx.lineTo(4*k, -r-2*k);
        ctx.lineTo(0, -r-9*k);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.4)';
      ctx.shadowBlur = 8*k;
      ctx.shadowOffsetY = 3*k;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI*2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 2*k;
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      if(item.follow) ctx.setLineDash([4*k,3*k]);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);

      ctx.textAlign = 'center';
      if(el.initials){
        ctx.fillStyle = '#fff';
        ctx.font = '700 ' + Math.round(r*0.72) + 'px "Manrope",sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials(d.name), cx, cy+k);
      }
      if(el.names){
        ctx.font = '600 ' + 13*k + 'px "Manrope",sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(d.name + splitRole, cx, cy - r - 16*k);
      }
    });
  }

  // One video frame in the current layout (currentVideoLayout). focusIds (optional array of dancer
  // ids): when given, only those dancers are drawn — used by the "Schritte" per-dancer/pair video
  // export (js/steps.js). Omitted/null draws everyone, same as always. panelCursor: the continuous
  // Bild "cursor" (videoFrameAt) driving the Bild names and the placeholders. info: {tMs, who} for
  // the {zeit} and {wer} placeholders. The builder (js/videolayout.js) draws its preview with this
  // same function, so what it shows is what the export produces.
  function renderCanvasFrame(ctx, W, H, posMap, logoImg, focusIds, ghosts, panelCursor, info){
    var layout = currentVideoLayout();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = layout.bg;
    ctx.fillRect(0, 0, W, H);
    layout.els.forEach(function(el){ if(!el.hidden && el.type === 'stage') drawStageFloor(ctx, el); });
    layout.els.forEach(function(el){
      if(el.hidden) return;
      if(el.type === 'stage') drawStageElement(ctx, el, posMap, focusIds, ghosts);
      else if(el.type === 'logo') drawImageFit(ctx, logoImg, el, ((state.logo && state.logo.opacity) || 18) / 100);
      else if(el.type === 'bilder') drawVideoInfoPanel(ctx, el, panelCursor);
      else if(el.type === 'figuren') drawFigurenPanel(ctx, el, panelCursor, info);
      else if(el.type === 'text') drawTextElement(ctx, el, panelCursor, info);
      else if(el.type === 'image') drawImageFit(ctx, videoImageFor(el.img), el, el.opacity / 100);
    });
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

  // Fast path: MediaRecorder can only film the canvas in real time, so a 3-minute choreo took 3
  // minutes to export. With WebCodecs every frame is encoded as soon as it's drawn and mp4-muxer
  // (js/vendor, loaded on first use) packs the chunks into an .mp4 — seconds instead of minutes.
  // H.264/AAC where the browser can encode them, else VP9/Opus, which an .mp4 carries just as well.
  // isConfigSupported is async, so the codecs are probed once at load; until that settles (or where
  // nothing fits) the video goes through the real-time recording below.
  var FAST_VIDEO_FPS = 30, FAST_AUDIO_RATE = 48000;
  var fastVideoCodecs = null; // {video:{codec, muxer, config}, audio:{…}|null} once probed

  function firstSupportedConfig(Encoder, candidates){
    var i = 0;
    function next(){
      if(i >= candidates.length) return Promise.resolve(null);
      var c = candidates[i++];
      return Encoder.isConfigSupported(c.config).then(function(r){ return r.supported ? c : next(); }, next);
    }
    return next();
  }

  (function probeFastVideoCodecs(){
    if(typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined' || !VideoEncoder.isConfigSupported) return;
    var W = 1200 + VIDEO_INFO_PANEL_W, H = 800;
    var video = ['avc1.640028', 'avc1.4D0028', 'avc1.42E028'].map(function(codec){
      return {codec:codec, muxer:'avc', config:{codec:codec, width:W, height:H, bitrate:6000000, framerate:FAST_VIDEO_FPS, avc:{format:'avc'}}};
    }).concat([{codec:'vp09.00.10.08', muxer:'vp9', config:{codec:'vp09.00.10.08', width:W, height:H, bitrate:6000000, framerate:FAST_VIDEO_FPS}}]);
    var audio = (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') ? [] : [['mp4a.40.2', 'aac'], ['opus', 'opus']].map(function(c){
      return {codec:c[0], muxer:c[1], config:{codec:c[0], sampleRate:FAST_AUDIO_RATE, numberOfChannels:2, bitrate:128000}};
    });
    Promise.all([firstSupportedConfig(VideoEncoder, video), firstSupportedConfig(window.AudioEncoder, audio)]).then(function(found){
      if(!found[0]) return;
      fastVideoCodecs = {video:found[0], audio:found[1]};
      if(!exportBackdrop.hidden) syncExportDialog();
    }).catch(function(){});
  })();

  // The video always plays the song at 1×, whatever the playbar's Tempo (#2023).
  function fastVideoExportPossible(){
    if(!fastVideoCodecs) return false;
    if(!(state.song && state.song.url)) return true;
    return !!fastVideoCodecs.audio && typeof OfflineAudioContext !== 'undefined';
  }

  function videoExportExt(){
    return fastVideoExportPossible() ? '.mp4' : bestVideoMime().ext;
  }

  var mp4MuxerPromise = null;
  function loadMp4Muxer(){
    if(window.Mp4Muxer) return Promise.resolve(window.Mp4Muxer);
    if(!mp4MuxerPromise){
      mp4MuxerPromise = new Promise(function(resolve, reject){
        var script = document.createElement('script');
        script.src = 'js/vendor/mp4-muxer-5.2.2.js';
        script.onload = function(){
          if(window.Mp4Muxer) resolve(window.Mp4Muxer);
          else{ mp4MuxerPromise = null; reject(new Error('mp4-muxer did not define Mp4Muxer')); }
        };
        script.onerror = function(){ mp4MuxerPromise = null; reject(new Error('mp4-muxer failed to load')); };
        document.head.appendChild(script);
      });
    }
    return mp4MuxerPromise;
  }

  videoCancelBtn.addEventListener('click', function(){
    if(exportState) exportState.cancelled = true;
  });

  // focusIds: see renderCanvasFrame's comment — passed through unchanged all the way down.
  function startVideoExport(filename, focusIds, includeGhosts, showContext, includePaths){
    exportIncludeGhosts = !!includeGhosts;
    exportIncludePaths = !!includePaths;
    exportPathCache = {};
    exportShowContext = !!showContext;
    exportWhoText = focusIds ? exportWhoLabel() : '';
    pausePlayback();
    videoBackdrop.hidden = false;
    videoProgressFill.classList.remove('indeterminate');
    videoProgressFill.style.width = '0%';
    videoStatusText.textContent = 'Wird vorbereitet…';
    videoTitle.textContent = 'Video wird gerendert…';
    videoProgressT0 = 0;
    setExportingUI(true);

    var logoPromise = (state.logo && state.logo.url) ? loadImage(state.logo.url) : Promise.resolve(null);
    logoPromise = Promise.all([logoPromise, loadVideoImages()]).then(function(r){ return r[0]; }); // the layout's images (js/videolayout.js)
    logoPromise.then(function(logoImg){
      runVideoRecording(logoImg, filename, focusIds);
    }).catch(function(err){
      console.error(err);
      videoStatusText.textContent = 'Fehler beim Rendern.';
      setTimeout(finishExportUI, 1500);
    });
  }

  // Exactly the song's times, like sync playback (syncFrameAt): any padding here added up and
  // pushed the picture further behind the sound with every short move (#2074).
  function buildSyncSegments(pts, totalDur){
    var segments = [];
    if(pts[0].time > 0){
      segments.push({type:'hold', idx: pts[0].idx, dur: pts[0].time*1000});
    }
    for(var i=0; i<pts.length-1; i++){
      segments.push({type:'move', from: pts[i].idx, to: pts[i+1].idx, dur: Math.max(0, pts[i+1].time - pts[i].time)*1000});
    }
    var last = pts[pts.length-1];
    var tailDur = Math.max(300, (totalDur - last.time)*1000);
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

  // syncPts: syncWaypoints(songDuration) when the video follows the song, else null.
  function buildVideoSegments(syncPts, songDuration){
    if(syncPts && songDuration > 0) return buildSyncSegments(syncPts, songDuration);
    // A loaded song's Tempo is only the playbar's; the video paces like a song at 1× (songTempo 50).
    var d = durations(state.song && state.song.url ? 50 : state.tempo);
    if(state.formations.length === 1) return [{type:'hold', idx:0, dur: Math.max(d.hold, 2000)}];
    // Match the live playback (js/playback.js tick): one continuous chain of moves with no
    // hold in between — just a brief hold on the first and last Bild so the opening and closing
    // formations are readable before/after the motion.
    var segments = [{type:'hold', idx:0, dur:d.hold}];
    for(var i=0; i<state.formations.length-1; i++){
      segments.push({type:'move', from:i, to:i+1, dur:d.move});
    }
    segments.push({type:'hold', idx:state.formations.length-1, dur:d.hold});
    return segments;
  }

  function segmentsDuration(segments){
    return segments.reduce(function(sum, seg){ return sum+seg.dur; }, 0);
  }

  // Where everyone stands elapsedInSeg ms into seg, plus the info panel's cursor (drawVideoInfoPanel).
  function videoFrameAt(seg, elapsedInSeg){
    if(seg.type === 'hold'){
      // static — the info-panel stack only moves during an actual move segment
      return {pos: state.formations[seg.idx].pos, cursor: seg.idx};
    }
    var t = seg.dur > 0 ? Math.min(1, elapsedInSeg/seg.dur) : 1; // two Bilder at the same time: a jump
    return {
      // Chains through any Zwischenpositionen on seg.from's own betweens list, same as live
      // playback (see interpolateThroughBetweens in state.js) — so a video export shows exactly
      // the poses the editor does, not a single straight interpolation that skips them.
      pos: interpolateThroughBetweens(seg.from, seg.to, t),
      // The info-panel's own continuous cursor (see drawVideoInfoPanel) — glides from seg.from to
      // seg.to across the *whole* segment, independent of however many Zwischenpositionen-legs
      // pos above just chained through, so the panel scrolls smoothly through exactly one Bild
      // per move regardless of how it's spatially subdivided.
      cursor: seg.from + moveEase(seg.from, seg.to, t)
    };
  }

  var videoProgressT0 = 0; // when the first frame went out, for the time left (#2073)
  function showVideoProgress(seg, fraction){
    videoProgressFill.style.width = Math.min(100, fraction*100) + '%';
    var displayIdx = (seg.type === 'hold' ? seg.idx : seg.to) + 1;
    var text = 'Bild ' + displayIdx + ' / ' + state.formations.length;
    var now = performance.now();
    if(!videoProgressT0) videoProgressT0 = now;
    else if(fraction > 0.02 && fraction < 1){
      var left = Math.ceil((now - videoProgressT0)/fraction*(1 - fraction)/1000);
      text += ' · noch ca. ' + (left < 60 ? left + ' s' : Math.round(left/60) + ' min');
    }
    videoStatusText.textContent = text;
  }

  // Every frame is drawn in the layout's format (videoFrameSize, 1500×800 by default) and scaled to
  // the chosen quality: the encoder's time grows with the pixels, so Entwurf is the quick one (#2094).
  var VIDEO_QUALITIES = {entwurf:{scale:0.6, bitrate:2000000}, standard:{scale:1, bitrate:6000000}, hoch:{scale:1.28, bitrate:12000000}};
  function videoQuality(){ return VIDEO_QUALITIES[exportQualitySelect.value] || VIDEO_QUALITIES.standard; }
  // The Qualität options name the pixel size they give in the layout's format.
  function syncVideoQualityLabels(){
    var F = videoFrameSize(), texts = {entwurf: 'Entwurf – %, am schnellsten', standard: 'Standard – %', hoch: 'Hoch – %, dauert länger'};
    Array.prototype.forEach.call(exportQualitySelect.options, function(o){
      var q = VIDEO_QUALITIES[o.value];
      o.textContent = texts[o.value].replace('%', 2*Math.round(F.w*q.scale/2) + ' × ' + 2*Math.round(F.h*q.scale/2));
    });
  }
  function createVideoCanvas(){
    var canvas = document.createElement('canvas'), q = videoQuality(), F = videoFrameSize();
    // H.264 only takes even sizes
    canvas.width = 2*Math.round(F.w*q.scale/2); canvas.height = 2*Math.round(F.h*q.scale/2);
    canvas.getContext('2d').scale(canvas.width/F.w, canvas.height/F.h);
    return canvas;
  }

  function runVideoRecording(logoImg, filename, focusIds){
    var realtimePossible = !!window.MediaRecorder && canvasCaptureStreamSupported();
    if(fastVideoExportPossible()){
      renderVideoOffline(logoImg, filename, focusIds).then(finishExportUI, function(err){
        // Whatever WebCodecs or mp4-muxer trip over (a song decodeAudioData can't read, an encoder
        // failing half-way) falls back to the real-time recording instead of ending in nothing.
        console.error(err);
        if(exportState.cancelled){ finishExportUI(); return; }
        if(!realtimePossible){
          videoStatusText.textContent = 'Fehler beim Rendern.';
          setTimeout(finishExportUI, 1500);
          return;
        }
        videoProgressFill.classList.remove('indeterminate');
        videoProgressFill.style.width = '0%';
        videoStatusText.textContent = 'Wird vorbereitet…';
        recordVideoRealtime(logoImg, filename.replace(/\.mp4$/i, bestVideoMime().ext), focusIds);
      });
      return;
    }
    if(!realtimePossible){
      videoStatusText.textContent = 'Dieser Browser unterstützt keine Videoaufnahme.';
      setTimeout(finishExportUI, 2000);
      return;
    }
    recordVideoRealtime(logoImg, filename, focusIds);
  }

  // setTimeout is throttled to about once a second in a background tab, a MessageChannel message
  // isn't — so the offline render keeps its pace while the user looks at something else.
  function yieldToBrowser(fn){
    if(!document.hidden){ setTimeout(fn, 0); return; }
    var channel = new MessageChannel();
    channel.port1.onmessage = function(){ channel.port1.close(); fn(); };
    channel.port2.postMessage(null);
  }

  // Resumes once the encoder has taken a frame off its queue; the timeout covers browsers without
  // the dequeue event and an encoder that errored (and so never dequeues again).
  function waitForEncoder(encoder, fn){
    var done = false;
    function go(){
      if(done) return;
      done = true;
      if(encoder.removeEventListener) encoder.removeEventListener('dequeue', go);
      fn();
    }
    if(encoder.addEventListener) encoder.addEventListener('dequeue', go);
    setTimeout(go, 50);
  }

  function closeEncoder(encoder){
    try{ if(encoder && encoder.state !== 'closed') encoder.close(); }catch(e){}
  }

  // Resolves once the .mp4 is downloaded or the user cancelled; rejects when anything fails.
  function renderVideoOffline(logoImg, filename, focusIds){
    exportState = { cancelled:false };
    var codecs = fastVideoCodecs;
    var canvas = createVideoCanvas();
    var W = videoFrameSize().w, H = videoFrameSize().h;
    var ctx = canvas.getContext('2d');
    // decodeAudioData resamples to the context's rate, so the samples come out at FAST_AUDIO_RATE.
    var songPromise = (state.song && state.song.url) ? fetch(state.song.url).then(function(res){ return res.arrayBuffer(); }).then(function(buf){
      return new OfflineAudioContext(2, 1, FAST_AUDIO_RATE).decodeAudioData(buf);
    }) : Promise.resolve(null);

    return Promise.all([loadMp4Muxer(), songPromise]).then(function(loaded){
      if(exportState.cancelled) return;
      var Mp4 = loaded[0], audioBuf = loaded[1];
      var pts = audioBuf ? syncWaypoints(audioBuf.duration) : [];
      var segments = buildVideoSegments(pts.length >= 2 ? pts : null, audioBuf ? audioBuf.duration : 0);
      var totalDuration = segmentsDuration(segments);
      var totalFrames = Math.max(1, Math.ceil(totalDuration*FAST_VIDEO_FPS/1000));
      // Like the real-time recording, the sound ends with the picture (or earlier, with the song).
      var audioFrames = audioBuf ? Math.min(audioBuf.length, Math.round(totalFrames/FAST_VIDEO_FPS*FAST_AUDIO_RATE)) : 0;
      var left = audioBuf ? audioBuf.getChannelData(0) : null;
      var right = audioBuf ? audioBuf.getChannelData(Math.min(1, audioBuf.numberOfChannels-1)) : null; // mono → both sides

      var muxer = new Mp4.Muxer({
        target: new Mp4.ArrayBufferTarget(),
        video: {codec: codecs.video.muxer, width: canvas.width, height: canvas.height, frameRate: FAST_VIDEO_FPS},
        audio: audioBuf ? {codec: codecs.audio.muxer, numberOfChannels: 2, sampleRate: FAST_AUDIO_RATE} : undefined,
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset'
      });
      var failure = null;
      function fail(err){ if(!failure) failure = err || new Error('encoder failed'); }
      var videoEncoder = new VideoEncoder({
        output: function(chunk, meta){ try{ muxer.addVideoChunk(chunk, meta); }catch(e){ fail(e); } },
        error: fail
      });
      videoEncoder.configure(Object.assign({}, codecs.video.config, {width: canvas.width, height: canvas.height, bitrate: videoQuality().bitrate}));
      var audioEncoder = null;
      if(audioBuf){
        audioEncoder = new AudioEncoder({
          output: function(chunk, meta){ try{ muxer.addAudioChunk(chunk, meta); }catch(e){ fail(e); } },
          error: fail
        });
        audioEncoder.configure(codecs.audio.config);
      }

      return new Promise(function(resolve, reject){
        var frameIdx = 0, segIdx = 0, segStart = 0, audioPos = 0;

        // Audio goes in alongside the frames it belongs to, so the muxer gets both tracks in time order.
        function encodeAudioUntil(end){
          while(audioPos < end){
            var n = Math.min(4800, end - audioPos);
            var planes = new Float32Array(n*2);
            planes.set(left.subarray(audioPos, audioPos+n), 0);
            planes.set(right.subarray(audioPos, audioPos+n), n);
            var data = new AudioData({format:'f32-planar', sampleRate:FAST_AUDIO_RATE, numberOfFrames:n, numberOfChannels:2,
              timestamp: Math.round(audioPos*1e6/FAST_AUDIO_RATE), data:planes});
            audioEncoder.encode(data);
            data.close();
            audioPos += n;
          }
        }

        function stop(err){
          closeEncoder(videoEncoder);
          closeEncoder(audioEncoder);
          if(err) reject(err); else resolve();
        }

        function finish(){
          videoProgressFill.style.width = '100%';
          videoProgressFill.classList.add('indeterminate');
          videoStatusText.textContent = 'Wird finalisiert…';
          Promise.all([videoEncoder.flush(), audioEncoder && audioEncoder.flush()]).then(function(){
            if(failure) throw failure;
            if(exportState.cancelled){ stop(); return; }
            muxer.finalize();
            downloadBlob(new Blob([muxer.target.buffer], {type:'video/mp4'}), filename);
            stop();
          }).catch(stop);
        }

        function step(){
          if(exportState.cancelled){ stop(); return; }
          if(failure){ stop(failure); return; }
          try{ encodeSlice(); }catch(e){ stop(e); return; } // an encoder that errored throws on encode()
          showVideoProgress(segments[segIdx], frameIdx/totalFrames);
          if(frameIdx >= totalFrames) finish();
          else if(videoEncoder.encodeQueueSize > 8) waitForEncoder(videoEncoder, step);
          else yieldToBrowser(step);
        }

        function encodeSlice(){
          var sliceEnd = performance.now() + 40; // keep the page (and the Abbrechen button) responsive
          while(frameIdx < totalFrames && videoEncoder.encodeQueueSize <= 8 && performance.now() < sliceEnd){
            var tMs = frameIdx*1000/FAST_VIDEO_FPS;
            while(segIdx < segments.length-1 && tMs >= segStart + segments[segIdx].dur){
              segStart += segments[segIdx].dur;
              segIdx++;
            }
            var seg = segments[segIdx];
            var at = videoFrameAt(seg, tMs - segStart);
            renderCanvasFrame(ctx, W, H, at.pos, logoImg, focusIds, ghostsFor(seg), at.cursor, {tMs: tMs, who: exportWhoText});
            var frame = new VideoFrame(canvas, {timestamp: Math.round(frameIdx*1e6/FAST_VIDEO_FPS), duration: Math.round(1e6/FAST_VIDEO_FPS)});
            videoEncoder.encode(frame, {keyFrame: frameIdx % (2*FAST_VIDEO_FPS) === 0});
            frame.close();
            frameIdx++;
            if(audioEncoder) encodeAudioUntil(Math.min(audioFrames, Math.round(frameIdx*FAST_AUDIO_RATE/FAST_VIDEO_FPS)));
          }
        }
        step();
      });
    });
  }

  function recordVideoRealtime(logoImg, filename, focusIds){
    videoTitle.textContent = 'Video wird in Echtzeit aufgenommen…';
    videoProgressT0 = 0;
    var canvas = createVideoCanvas();
    var W = videoFrameSize().w, H = videoFrameSize().h;
    var ctx = canvas.getContext('2d');

    var exportAudioEl = (state.song && state.song.url) ? new Audio(state.song.url) : null;
    var durationPromise = exportAudioEl ? getAudioDuration(exportAudioEl) : Promise.resolve(0);

    durationPromise.then(function(songDuration){
      var pts = exportAudioEl ? syncWaypoints(songDuration) : [];
      var segments = buildVideoSegments(pts.length >= 2 ? pts : null, songDuration);
      var totalDuration = segmentsDuration(segments);

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
    var mimeType = bestVideoMime().mime; // MP4/H.264 where supported, else WebM — matches the extension shown in the Exportieren dialog
    var recorder = new MediaRecorder(combinedStream, mimeType ? {mimeType:mimeType, videoBitsPerSecond:videoQuality().bitrate} : undefined);
    var chunks = [];
    recorder.ondataavailable = function(e){ if(e.data && e.data.size) chunks.push(e.data); };

    // Already set when this is the fallback after a failed offline render — keeping it means an
    // Abbrechen clicked in between still counts.
    exportState = exportState || { cancelled:false };

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

    var segIdx = 0, segStart = 0, clockStart = null;
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
      if(clockStart === null) clockStart = now;
      // While the song plays, the picture follows its currentTime like sync playback does, so the
      // song's start lag and each frame's overshoot can't shift it against the sound (#2074).
      var tMs = (exportAudioEl && !exportAudioEl.paused) ? exportAudioEl.currentTime*1000 : now - clockStart;
      while(segIdx < segments.length-1 && tMs >= segStart + segments[segIdx].dur){
        segStart += segments[segIdx].dur;
        segIdx++;
      }
      var seg = segments[segIdx];
      var at = videoFrameAt(seg, tMs - segStart);
      renderCanvasFrame(ctx, W, H, at.pos, logoImg, focusIds, ghostsFor(seg), at.cursor, {tMs: tMs, who: exportWhoText});
      // In manual-capture mode (see runVideoRecording), the stream never emits a frame on its own —
      // this is the one and only signal that a new frame is ready, which is exactly what keeps
      // recording accurate while backgrounded: however slowly setTimeout ends up firing, each call
      // still pushes the frame that actually matches its `now`, rather than the browser sampling the
      // canvas on its own separate timer.
      if(manualCaptureTrack) manualCaptureTrack.requestFrame();

      showVideoProgress(seg, tMs/totalDuration);

      if(tMs >= totalDuration){
        videoProgressFill.style.width = '100%';
        videoProgressFill.classList.add('indeterminate');
        videoStatusText.textContent = 'Wird finalisiert…';
        setTimeout(function(){ recorder.stop(); }, 300);
        return;
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
    if(typeof applyFacingVisibility === 'function') applyFacingVisibility();
    updateSettingsUI(); // js/main.js
    if(!markerBackdrop.hidden) openMarkerModal();
    if(typeof refreshVideoLayoutBuilder === 'function') refreshVideoLayoutBuilder();
  }
