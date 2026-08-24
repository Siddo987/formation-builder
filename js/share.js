"use strict";

/* ---------- share via link ----------
   A share link is a standing pointer at "this Formation", not a one-time snapshot: once a project
   is bound to a share id (state.sharedId — set the first time "Teilen" creates a link, or by
   opening a ?share=<id> link), every local edit pushes to the server (schedulePushSharedUpdate,
   hooked into saveState() in state.js) and this tab periodically polls for edits made elsewhere
   (pollSharedUpdate) and applies them — so everyone holding the link keeps seeing the current
   state without anyone generating a new link. Pressing "Teilen" again while already bound just
   re-shows the existing link instead of creating a second one; "Verknüpfung aufheben" stops the
   sync without touching the project itself (it keeps editing locally, just unbound).
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
var shareUnlinkBtn = document.getElementById('shareUnlinkBtn');

function shareUrlFor(id){ return location.origin + location.pathname + '?share=' + id; }

function showShareLink(id){
  shareIntroEl.hidden = true;
  shareProgressEl.hidden = true;
  shareErrorTextEl.hidden = true;
  shareResultEl.hidden = false;
  shareLinkInput.value = shareUrlFor(id);
}

function resetShareModal(){
  shareErrorTextEl.hidden = true;
  shareCopiedHint.hidden = true;
  shareProgressFillEl.style.width = '0%';
  if(state.sharedId){
    showShareLink(state.sharedId);
  }else{
    shareIntroEl.hidden = false;
    shareProgressEl.hidden = true;
    shareResultEl.hidden = true;
  }
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
  if(state.sharedId){ showShareLink(state.sharedId); return; } // already bound — nothing to create
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
      state.sharedId = data.id;
      lastKnownRev = data.rev || null;
      lastPushedLogoRef = state.logo;
      lastPushedSongRef = state.song;
      suppressSharePush = true;
      saveState(); // persists the binding locally — server already has this exact payload, see suppressSharePush
      suppressSharePush = false;
      startSharePolling();
      showShareLink(data.id);
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

// Same manual two-click-with-text-swap pattern as resetBtn (export.js) — matches its weight
// (visible-text btn-ghost.danger, moderately consequential but easily reversible by sharing again).
var shareUnlinkArmed = false, shareUnlinkTimer = null;
var shareUnlinkLabel = shareUnlinkBtn.textContent;
shareUnlinkBtn.addEventListener('click', function(){
  if(!shareUnlinkArmed){
    shareUnlinkArmed = true;
    shareUnlinkBtn.textContent = 'Wirklich? Nochmal klicken';
    shareUnlinkTimer = setTimeout(function(){ shareUnlinkArmed = false; shareUnlinkBtn.textContent = shareUnlinkLabel; }, 3000);
  }else{
    clearTimeout(shareUnlinkTimer);
    shareUnlinkArmed = false;
    shareUnlinkBtn.textContent = shareUnlinkLabel;
    state.sharedId = null;
    stopSharePolling();
    saveState();
    resetShareModal();
  }
});

/* ---------- pushing local edits to a bound share ---------- */

var PUSH_DEBOUNCE_MS = 700;
var pushDebounceTimer = null;
var pushInFlight = false;
var pushQueuedAgain = false;
var lastKnownRev = null; // last opaque revision token this tab has seen (its own push or a poll)
var lastPushedLogoRef = undefined; // reference tracking (not deep-equal) — see pushSharedUpdateNow
var lastPushedSongRef = undefined;
// Suppresses the automatic push saveState() would otherwise schedule — used both while
// pollSharedUpdate() is applying an incoming remote state (so pulling someone else's edit never
// turns around and pushes it straight back as a "new" local change) and right after create.php
// first binds this project (the server already has that exact payload — scheduling a redundant
// push here would open a real race: if it lands *after* someone else's fast follow-up edit, it'd
// silently clobber their change with this tab's now-stale copy).
var suppressSharePush = false;

// Debounced entry point saveState() calls on every edit once state.sharedId is set. Skipped while
// we're in the middle of *applying* a remote update ourselves, so pulling someone else's edit
// never turns right back around and pushes it straight back as if it were a new local change.
function schedulePushSharedUpdate(){
  if(suppressSharePush) return;
  clearTimeout(pushDebounceTimer);
  pushDebounceTimer = setTimeout(pushSharedUpdateNow, PUSH_DEBOUNCE_MS);
}

function pushSharedUpdateNow(){
  pushDebounceTimer = null; // the debounce has resolved — clearTimeout() alone doesn't reset this
  if(!state.sharedId) return;
  if(pushInFlight){ pushQueuedAgain = true; return; }
  pushInFlight = true;
  var id = state.sharedId;
  // Blob references only ever change on an actual upload/remove (opacity tweaks mutate the
  // existing object in place — see main.js) — so this cheaply answers "do the bytes need
  // re-uploading" without diffing anything, and keeps routine position/name edits from re-sending
  // a multi-MB song on every debounced save.
  var mediaDirty = (state.logo !== lastPushedLogoRef) || (state.song !== lastPushedSongRef);
  var header = buildProjectHeader(
    state,
    state.logo ? {name:state.logo.name, mime:state.logo.mime, opacity:state.logo.opacity||18} : null,
    state.song ? {name:state.song.name, mime:state.song.mime} : null
  );
  var formData = new FormData();
  formData.append('id', id);
  formData.append('payload', JSON.stringify(header));
  formData.append('logo_present', state.logo ? '1' : '0');
  formData.append('song_present', state.song ? '1' : '0');
  if(mediaDirty && state.logo && state.logo.blob) formData.append('logo', state.logo.blob, state.logo.name || 'logo');
  if(mediaDirty && state.song && state.song.blob) formData.append('song', state.song.blob, state.song.name || 'song');

  fetch('api/share/update.php', {method:'POST', body: formData})
    .then(function(res){ return res.json().catch(function(){ return null; }).then(function(data){ return {ok: res.ok, status: res.status, data: data}; }); })
    .then(function(r){
      if(r.ok && r.data && r.data.rev){
        lastKnownRev = r.data.rev;
        lastPushedLogoRef = state.logo;
        lastPushedSongRef = state.song;
      }else if(r.status === 404){
        // the id no longer exists server-side (e.g. a dev DB reset) — stop trying to push into a
        // link that's gone rather than failing silently forever; the project itself is untouched
        state.sharedId = null;
        stopSharePolling();
        saveState();
      }
    })
    .catch(function(){ /* offline or similar — the next edit's debounced push retries */ })
    .then(function(){
      pushInFlight = false;
      if(pushQueuedAgain){ pushQueuedAgain = false; schedulePushSharedUpdate(); }
    });
}

/* ---------- pulling other people's edits ---------- */

var SHARE_POLL_MS = 8000;
var sharePollTimer = null;

function startSharePolling(){
  stopSharePolling();
  if(!state.sharedId) return;
  sharePollTimer = setInterval(pollSharedUpdate, SHARE_POLL_MS);
}
function stopSharePolling(){
  if(sharePollTimer){ clearInterval(sharePollTimer); sharePollTimer = null; }
}

// A short allowlist of reasons to skip *this* tick rather than yank a shared project out from
// under someone mid-action — the next tick tries again a few seconds later regardless.
function sharePollShouldSkip(){
  if(!state.sharedId || document.visibilityState !== 'visible') return true;
  if(pushInFlight || pushDebounceTimer) return true; // a local edit is still in flight/queued
  var ae = document.activeElement;
  if(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return true; // actively typing somewhere
  var openModals = [shareBackdrop, settingsBackdrop, markerBackdrop, filenameBackdrop, videoBackdrop, addBildBackdrop, stepsBackdrop];
  for(var i=0;i<openModals.length;i++){ if(openModals[i] && !openModals[i].hidden) return true; }
  return false;
}

function pollSharedUpdate(){
  if(sharePollShouldSkip()) return;
  var id = state.sharedId;
  fetch('api/share/get.php?id=' + encodeURIComponent(id))
    .then(function(res){
      if(res.status === 404) throw {notFound:true};
      if(!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(payload){
      if(payload.rev === lastKnownRev) return; // nothing new since our last push/pull
      lastKnownRev = payload.rev;
      return reconstructSharedState(payload).then(function(newState){
        if(state.sharedId !== id) return; // unlinked/switched while the fetch was in flight
        newState.sharedId = id;
        suppressSharePush = true;
        applyImportedState(newState);
        lastPushedLogoRef = newState.logo;
        lastPushedSongRef = newState.song;
        suppressSharePush = false;
      });
    })
    .catch(function(err){
      if(err && err.notFound){
        state.sharedId = null;
        stopSharePolling();
        saveState();
      }
      // any other error (offline, hiccup): just try again on the next tick
    });
}

/* ---------- loading a shared project (?share=<id> on page load, or a returning bound tab) ---------- */

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
    var startPos = null;
    if(f.startPos && typeof f.startPos === 'object'){
      startPos = {};
      Object.keys(f.startPos).forEach(function(id){
        var p = f.startPos[id];
        if(p) startPos[id] = {x: clampGrid(p.x||0), y: clampGrid(p.y||0)};
      });
    }
    var out = {id:f.id, name:f.name||'Bild', pos:pos, showAxes: f.showAxes !== false, localAxes: localAxes, category: typeof f.category === 'string' ? f.category : '', startPos: startPos};
    if(typeof f.time === 'number' && isFinite(f.time) && f.time >= 0) out.time = f.time;
    return out;
  });

  var base = {
    projectName: payload.projectName || 'Meine Formation',
    dancers: payload.dancers || [],
    formations: formations,
    axes: Array.isArray(payload.axes) ? payload.axes : [],
    showAxes: payload.showAxes !== false,
    roomLabels: {
      top: (payload.roomLabels && typeof payload.roomLabels.top === 'string') ? payload.roomLabels.top : 'WAND',
      right: (payload.roomLabels && typeof payload.roomLabels.right === 'string') ? payload.roomLabels.right : 'SPIEGEL',
      bottom: (payload.roomLabels && typeof payload.roomLabels.bottom === 'string') ? payload.roomLabels.bottom : 'EINGANG',
      left: (payload.roomLabels && typeof payload.roomLabels.left === 'string') ? payload.roomLabels.left : 'FENSTER'
    },
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
  if(!id){
    // No ?share= this time — a returning tab that's already bound to a link still needs its
    // binding honored: pick up right where the last visit left off (refresh against the server
    // once, then keep polling) without needing the id in the URL again.
    if(state.sharedId){ lastKnownRev = null; startSharePolling(); pollSharedUpdate(); }
    return;
  }
  fetch('api/share/get.php?id=' + encodeURIComponent(id))
    .then(function(res){
      if(!res.ok){
        return res.json().catch(function(){ return {}; }).then(function(err){
          throw new Error(err.error || ('HTTP ' + res.status));
        });
      }
      return res.json();
    })
    .then(function(payload){
      lastKnownRev = payload.rev || null;
      return reconstructSharedState(payload);
    })
    .then(function(newState){
      newState.sharedId = id;
      applyImportedState(newState);
      lastPushedLogoRef = newState.logo;
      lastPushedSongRef = newState.song;
      syncBlobsToIdb();
      // Drop ?share= from the visible URL — the binding now lives in state.sharedId (persisted to
      // localStorage) and no longer needs the query param to be remembered across reloads.
      history.replaceState(null, '', location.pathname);
      startSharePolling();
    })
    .catch(function(err){
      console.error('Konnte geteilten Link nicht laden:', err);
      showImportError();
    });
}
