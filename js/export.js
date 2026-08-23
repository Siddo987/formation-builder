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
        current = {id: fid, name: fname, pos: {}, showAxes: true, localAxes: [], category: ''};
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
    return {
      projectName: 'Meine Formation',
      dancers: dancers, formations: formations,
      axes: [], showAxes: true, pairs: [], customFigures: [], logo: null, song: null,
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
        return {id:f.id, name:f.name, pos:pos, showAxes: f.showAxes !== false, localAxes: localAxes, category: f.category||'', time: time === null ? null : Math.round(time*100)/100};
      }),
      axes: (s.axes||[]).map(function(ax){ return {id:ax.id, x1:roundNum(ax.x1), y1:roundNum(ax.y1), x2:roundNum(ax.x2), y2:roundNum(ax.y2), label:ax.label||''}; }),
      showAxes: !!s.showAxes,
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

    var formations = header.formations.map(function(f){
      var pos = {};
      Object.keys(f.pos||{}).forEach(function(id){
        var p = f.pos[id];
        pos[id] = {x: clampGrid(p.x||0), y: clampGrid(p.y||0), rot: normAngle(p.rot||0)};
      });
      // migration: files saved before per-Bild axes existed only had the global header.showAxes
      var localAxes = (Array.isArray(f.localAxes) ? f.localAxes : []).filter(function(ax){
        return ax && typeof ax.x1 === 'number' && typeof ax.y1 === 'number' && typeof ax.x2 === 'number' && typeof ax.y2 === 'number';
      }).map(function(ax){ return {id: ax.id || uid('ax'), x1:clampGrid(ax.x1), y1:clampGrid(ax.y1), x2:clampGrid(ax.x2), y2:clampGrid(ax.y2), label:ax.label||''}; });
      var out = {id:f.id, name:f.name||'Bild', pos:pos, showAxes: typeof f.showAxes === 'boolean' ? f.showAxes : (header.showAxes !== false), localAxes: localAxes, category: typeof f.category === 'string' ? f.category : ''};
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
  var filenamePending = null;

  function sanitizeFilename(name){
    name = (name || '').trim();
    name = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
    name = name.replace(/^\.+/, '');
    name = name.slice(0, 120);
    return name || 'aufstellung';
  }

  function askFilename(ext, defaultName, onConfirm){
    filenamePending = { ext: ext, onConfirm: onConfirm };
    filenameExt.textContent = ext;
    filenameInput.value = defaultName;
    filenameBackdrop.hidden = false;
    requestAnimationFrame(function(){ filenameInput.focus(); filenameInput.select(); });
  }

  function closeFilenameDialog(){ filenameBackdrop.hidden = true; filenamePending = null; }

  function confirmFilename(){
    if(!filenamePending) return;
    var filename = sanitizeFilename(filenameInput.value) + filenamePending.ext;
    var onConfirm = filenamePending.onConfirm;
    closeFilenameDialog();
    onConfirm(filename);
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

  function applyImportedState(parsed){
    pausePlayback();
    revokeStateBlobs(state);
    state = parsed;
    state.activeIndex = Math.min(state.activeIndex || 0, state.formations.length-1);
    syncBlobsToIdb();
    saveState();
    fullRerender();
    importErrorEl.hidden = true;
  }

  importBtn.addEventListener('click', function(){ importInput.click(); });
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

  var resetArmed = false, resetTimer = null;
  var resetLabel = resetBtn.innerHTML;
  resetBtn.addEventListener('click', function(){
    if(!resetArmed){
      resetArmed = true;
      resetBtn.textContent = 'Wirklich? Nochmal klicken';
      resetTimer = setTimeout(function(){ resetArmed = false; resetBtn.innerHTML = resetLabel; }, 3000);
    }else{
      clearTimeout(resetTimer);
      resetArmed = false;
      resetBtn.innerHTML = resetLabel;
      pausePlayback();
      revokeStateBlobs(state);
      state = defaultState();
      syncBlobsToIdb();
      saveState();
      fullRerender();
    }
  });

  /* ---------- video export ---------- */

  var exportState = null;

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

  // focusIds (optional array of dancer ids): when given, only those dancers are drawn — used by
  // the "Schritte" per-dancer/pair video export (js/steps.js). Omitted/null draws everyone, same
  // as always.
  function renderCanvasFrame(ctx, W, H, posMap, logoImg, showAxes, localAxes, focusIds){
    ctx.clearRect(0, 0, W, H);
    var grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#241a30');
    grad.addColorStop(1, '#2b2038');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if(logoImg){
      var opacity = ((state.logo && state.logo.opacity) || 18) / 100;
      var maxW = W*0.8, maxH = H*0.8;
      var scale = Math.min(maxW/logoImg.width, maxH/logoImg.height);
      var lw = logoImg.width*scale, lh = logoImg.height*scale;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(logoImg, (W-lw)/2, (H-lh)/2, lw, lh);
      ctx.restore();
    }

    ctx.lineWidth = 1;
    for(var v = GRID_MIN; v <= GRID_MAX; v++){
      var isZero = v === 0;
      var px = gridToPercent(v)/100*W;
      var py = gridToPercent(v)/100*H;
      ctx.strokeStyle = isZero ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.08)';
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
    }

    function drawAxisSet(list, color, dash){
      if(!list || !list.length) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dash);
      list.forEach(function(ax){
        var x1 = gridToPercent(clampGrid(ax.x1))/100*W, y1 = gridToPercent(clampGrid(ax.y1))/100*H;
        var x2 = gridToPercent(clampGrid(ax.x2))/100*W, y2 = gridToPercent(clampGrid(ax.y2))/100*H;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        if(ax.label){
          ctx.save();
          ctx.setLineDash([]);
          ctx.font = '600 13px "Manrope",sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,.65)';
          ctx.textAlign = 'center';
          ctx.fillText(ax.label, (x1+x2)/2, (y1+y2)/2 - 8);
          ctx.restore();
        }
      });
      ctx.restore();
    }
    if(showAxes){
      drawAxisSet(state.axes, 'rgba(217,154,52,.6)', [8,6]);
      drawAxisSet(localAxes, '#4fa3a0', [3,7]); // matches --pair / .axis-line-local on the live stage
    }

    var radius = Math.max(14, Math.min(W,H)*0.024);
    state.dancers.forEach(function(d){
      var pos = posMap[d.id];
      if(!pos) return;
      if(focusIds && focusIds.indexOf(d.id) === -1) return;
      var cx = gridToPercent(pos.x)/100*W;
      var cy = gridToPercent(pos.y)/100*H;
      var rot = pos.rot || 0;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot*Math.PI/180);
      ctx.beginPath();
      ctx.moveTo(-4, -radius-2);
      ctx.lineTo(4, -radius-2);
      ctx.lineTo(0, -radius-9);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.4)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI*2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2); ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = '700 ' + Math.round(radius*0.72) + 'px "Manrope",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials(d.name), cx, cy+1);

      ctx.font = '600 13px "Manrope",sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(d.name, cx, cy - radius - 16);
    });
  }

  videoExportBtn.addEventListener('click', function(){
    if(exportState) return;
    if(!state.dancers.length || !state.formations.length) return;
    askFilename('.webm', filenameBase(), function(filename){
      startVideoExport(filename);
    });
  });
  videoCancelBtn.addEventListener('click', function(){
    if(exportState) exportState.cancelled = true;
  });

  // focusIds: see renderCanvasFrame's comment — passed through unchanged all the way down.
  function startVideoExport(filename, focusIds){
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

  function buildSyncSegments(pts, totalDur){
    var segments = [];
    if(pts[0].time > 0.02){
      segments.push({type:'hold', idx: pts[0].idx, dur: pts[0].time*1000});
    }
    for(var i=0; i<pts.length-1; i++){
      var span = Math.max(0, pts[i+1].time - pts[i].time);
      segments.push({type:'move', from: pts[i].idx, to: pts[i+1].idx, dur: Math.max(200, span*1000)});
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

  function runVideoRecording(logoImg, filename, focusIds){
    if(!window.MediaRecorder || !canvasCaptureStreamSupported()){
      videoStatusText.textContent = 'Dieser Browser unterstützt keine Videoaufnahme.';
      setTimeout(finishExportUI, 2000);
      return;
    }

    var W = 1200, H = 800;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    var exportAudioEl = (state.song && state.song.url) ? new Audio(state.song.url) : null;
    var pts = syncWaypoints();
    var useSync = exportAudioEl && pts.length >= 2;
    var durationPromise = useSync ? getAudioDuration(exportAudioEl) : Promise.resolve(0);

    durationPromise.then(function(songDuration){
      var d = durations();
      var segments;
      if(useSync && songDuration > 0){
        segments = buildSyncSegments(pts, songDuration);
      }else if(state.formations.length === 1){
        segments = [{type:'hold', idx:0, dur: Math.max(d.hold, 2000)}];
      }else{
        segments = [];
        for(var i=0; i<state.formations.length; i++){
          segments.push({type:'hold', idx:i, dur:d.hold});
          if(i < state.formations.length-1) segments.push({type:'move', from:i, to:i+1, dur:d.move});
        }
      }
      var totalDuration = segments.reduce(function(sum, seg){ return sum+seg.dur; }, 0);

      var canvasStream = canvas.captureStream(30);
      var tracks = canvasStream.getVideoTracks().slice();

      var audioCtx = null;
      if(exportAudioEl){
        var AudioCtor = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioCtor();
        if(audioCtx.state === 'suspended') audioCtx.resume().catch(function(){});
        var sourceNode = audioCtx.createMediaElementSource(exportAudioEl);
        var destNode = audioCtx.createMediaStreamDestination();
        sourceNode.connect(destNode);
        sourceNode.connect(audioCtx.destination);
        tracks = tracks.concat(destNode.stream.getAudioTracks());
      }

      recordSegments(segments, totalDuration, tracks, canvas, ctx, W, H, logoImg, exportAudioEl, audioCtx, filename, focusIds);
    });
  }

  function recordSegments(segments, totalDuration, tracks, canvas, ctx, W, H, logoImg, exportAudioEl, audioCtx, filename, focusIds){
    var combinedStream = new MediaStream(tracks);
    var mimeCandidates = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    var mimeType = '';
    for(var m=0; m<mimeCandidates.length; m++){
      if(MediaRecorder.isTypeSupported(mimeCandidates[m])){ mimeType = mimeCandidates[m]; break; }
    }
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
    function frame(now){
      if(!exportState || exportState.cancelled){
        recorder.stop();
        return;
      }
      if(segStart === null) segStart = now;
      var seg = segments[segIdx];
      var elapsedInSeg = now - segStart;
      var posMap, segShowAxes, segLocalAxes;
      if(seg.type === 'hold'){
        posMap = state.formations[seg.idx].pos;
        segShowAxes = state.formations[seg.idx].showAxes !== false;
        segLocalAxes = state.formations[seg.idx].localAxes;
      }else{
        var t = Math.min(1, elapsedInSeg/seg.dur);
        var e = easeInOutCubic(t);
        var fromPos = state.formations[seg.from].pos, toPos = state.formations[seg.to].pos;
        posMap = {};
        state.dancers.forEach(function(dd){
          var a = fromPos[dd.id] || {x:0,y:0,rot:0};
          var b = toPos[dd.id] || {x:0,y:0,rot:0};
          posMap[dd.id] = {x:a.x+(b.x-a.x)*e, y:a.y+(b.y-a.y)*e, rot: lerpAngle(a.rot||0, b.rot||0, e)};
        });
        // reveal the destination Bild's axes setting (global and local) as it's approached during the transition
        segShowAxes = state.formations[seg.to].showAxes !== false;
        segLocalAxes = state.formations[seg.to].localAxes;
      }
      renderCanvasFrame(ctx, W, H, posMap, logoImg, segShowAxes, segLocalAxes, focusIds);

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
          renderCanvasFrame(ctx, W, H, state.formations[lastSeg.idx].pos, logoImg, state.formations[lastSeg.idx].showAxes !== false, state.formations[lastSeg.idx].localAxes, focusIds);
          videoProgressFill.style.width = '100%';
          videoProgressFill.classList.add('indeterminate');
          videoStatusText.textContent = 'Wird finalisiert…';
          setTimeout(function(){ recorder.stop(); }, 300);
          return;
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
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
    renderRoster();
    renderFilmstrip();
    updatePlaybarInfo();
    updatePlayButton();
    tempoSlider.value = state.tempo;
    updateTempoReadout();
    projectNameInput.value = state.projectName || '';
    document.title = (state.projectName || 'Aufstellung') + ' — Aufstellung';
    applySongSource();
    resetBeatData();
    if(!settingsBackdrop.hidden){
      renderAxesList();
      updateLogoSettingsUI();
      updateSongSettingsUI();
    }
    if(!markerBackdrop.hidden) openMarkerModal();
  }
