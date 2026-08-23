"use strict";

/* ---------- share via link ----------
   Creates a server-side snapshot (see api/share/create.php) and shows a link that, when opened,
   loads the project the same way opening a .stg file does — a read-only import, not live
   collaborative editing. See loadSharedProjectFromUrl() at the bottom for the receiving side.
*/

var shareBtn = document.getElementById('shareBtn');
var shareBackdrop = document.getElementById('shareBackdrop');
var shareCloseBtn = document.getElementById('shareCloseBtn');
var shareIntroEl = document.getElementById('shareIntro');
var shareCreateBtn = document.getElementById('shareCreateBtn');
var shareProgressEl = document.getElementById('shareProgress');
var shareProgressFillEl = document.getElementById('shareProgressFill');
var shareProgressTextEl = document.getElementById('shareProgressText');
var shareResultEl = document.getElementById('shareResult');
var shareLinkInput = document.getElementById('shareLinkInput');
var shareCopyBtn = document.getElementById('shareCopyBtn');
var shareCopiedHint = document.getElementById('shareCopiedHint');
var shareErrorTextEl = document.getElementById('shareErrorText');

function resetShareModal(){
  shareIntroEl.hidden = false;
  shareProgressEl.hidden = true;
  shareResultEl.hidden = true;
  shareErrorTextEl.hidden = true;
  shareCopiedHint.hidden = true;
  shareProgressFillEl.style.width = '0%';
}
function openShareModal(){ resetShareModal(); shareBackdrop.hidden = false; }
function closeShareModal(){ shareBackdrop.hidden = true; }

shareBtn.addEventListener('click', openShareModal);
shareCloseBtn.addEventListener('click', closeShareModal);
shareBackdrop.addEventListener('click', function(e){ if(e.target === shareBackdrop) closeShareModal(); });

function showShareError(message){
  shareProgressEl.hidden = true;
  shareErrorTextEl.hidden = false;
  shareErrorTextEl.textContent = message;
}

shareCreateBtn.addEventListener('click', function(){
  shareIntroEl.hidden = true;
  shareErrorTextEl.hidden = true;
  shareProgressEl.hidden = false;
  shareProgressFillEl.style.width = '0%';
  shareProgressTextEl.textContent = 'Wird hochgeladen…';

  var header = buildProjectHeader(
    state,
    state.logo ? {name:state.logo.name, mime:state.logo.mime, opacity:state.logo.opacity||18} : null,
    state.song ? {name:state.song.name, mime:state.song.mime} : null
  );
  var formData = new FormData();
  formData.append('payload', JSON.stringify(header));
  if(state.logo && state.logo.blob) formData.append('logo', state.logo.blob, state.logo.name || 'logo');
  if(state.song && state.song.blob) formData.append('song', state.song.blob, state.song.name || 'song');

  var xhr = new XMLHttpRequest();
  xhr.open('POST', 'api/share/create.php');
  xhr.upload.addEventListener('progress', function(e){
    if(e.lengthComputable) shareProgressFillEl.style.width = Math.round((e.loaded/e.total)*100) + '%';
  });
  xhr.addEventListener('load', function(){
    var data = null;
    try{ data = JSON.parse(xhr.responseText); }catch(e){}
    if(xhr.status >= 200 && xhr.status < 300 && data && data.id){
      var url = location.origin + location.pathname + '?share=' + data.id;
      shareProgressEl.hidden = true;
      shareResultEl.hidden = false;
      shareLinkInput.value = url;
      shareLinkInput.focus();
      shareLinkInput.select();
    }else{
      showShareError((data && data.error) ? data.error : 'Der Link konnte nicht erstellt werden.');
    }
  });
  xhr.addEventListener('error', function(){
    showShareError('Der Link konnte nicht erstellt werden (Netzwerkfehler).');
  });
  xhr.send(formData);
});

shareCopyBtn.addEventListener('click', function(){
  shareLinkInput.focus();
  shareLinkInput.select();
  function done(){ shareCopiedHint.hidden = false; }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(shareLinkInput.value).then(done).catch(function(){
      try{ document.execCommand('copy'); }catch(e){}
      done();
    });
  }else{
    try{ document.execCommand('copy'); }catch(e){}
    done();
  }
});

/* ---------- loading a shared project (?share=<id> on page load) ---------- */

function fetchAsBlobMeta(url, meta){
  return fetch(url).then(function(res){
    if(!res.ok) throw new Error('Datei nicht erreichbar (' + res.status + '): ' + url);
    return res.blob();
  }).then(function(blob){
    return {
      name: (meta && meta.name) || url.split('/').pop(),
      mime: blob.type || (meta && meta.mime) || 'application/octet-stream',
      opacity: (meta && meta.opacity) || 18,
      blob: blob,
      url: URL.createObjectURL(blob)
    };
  });
}

function reconstructSharedState(payload){
  var formations = (payload.formations || []).map(function(f){
    var pos = {};
    Object.keys(f.pos || {}).forEach(function(id){
      var p = f.pos[id];
      pos[id] = {x: clampGrid(p.x||0), y: clampGrid(p.y||0), rot: normAngle(p.rot||0)};
    });
    var localAxes = (Array.isArray(f.localAxes) ? f.localAxes : []).map(function(ax){
      return {id: ax.id || uid('ax'), x1:clampGrid(ax.x1||0), y1:clampGrid(ax.y1||0), x2:clampGrid(ax.x2||0), y2:clampGrid(ax.y2||0), label:ax.label||''};
    });
    var out = {id:f.id, name:f.name||'Bild', pos:pos, showAxes: f.showAxes !== false, localAxes: localAxes, category: typeof f.category === 'string' ? f.category : ''};
    if(typeof f.time === 'number' && isFinite(f.time) && f.time >= 0) out.time = f.time;
    return out;
  });

  var base = {
    projectName: payload.projectName || 'Meine Formation',
    dancers: payload.dancers || [],
    formations: formations,
    axes: Array.isArray(payload.axes) ? payload.axes : [],
    showAxes: payload.showAxes !== false,
    pairs: (Array.isArray(payload.pairs) ? payload.pairs : []).map(function(p){
      return {id:p.id, memberIds:p.memberIds, name:p.name||'', collapsed:!!p.collapsed};
    }),
    customFigures: Array.isArray(payload.customFigures) ? payload.customFigures : [],
    activeIndex: typeof payload.activeIndex === 'number' ? payload.activeIndex : 0,
    tempo: typeof payload.tempo === 'number' ? payload.tempo : 50,
    logo: null,
    song: null
  };

  var logoPromise = (payload.logo && payload.logo.url) ? fetchAsBlobMeta(payload.logo.url, payload.logo) : Promise.resolve(null);
  var songPromise = (payload.song && payload.song.url) ? fetchAsBlobMeta(payload.song.url, payload.song) : Promise.resolve(null);

  return Promise.all([logoPromise, songPromise]).then(function(results){
    base.logo = results[0];
    base.song = results[1];
    return base;
  });
}

function loadSharedProjectFromUrl(){
  var params = new URLSearchParams(location.search);
  var id = params.get('share');
  if(!id) return;
  fetch('api/share/get.php?id=' + encodeURIComponent(id))
    .then(function(res){
      if(!res.ok){
        return res.json().catch(function(){ return {}; }).then(function(err){
          throw new Error(err.error || ('HTTP ' + res.status));
        });
      }
      return res.json();
    })
    .then(reconstructSharedState)
    .then(function(newState){
      applyImportedState(newState);
      syncBlobsToIdb();
      // drop ?share= so a later refresh reopens the locally-persisted copy instead of re-fetching
      history.replaceState(null, '', location.pathname);
    })
    .catch(function(err){
      console.error('Konnte geteilten Link nicht laden:', err);
      showImportError();
    });
}
