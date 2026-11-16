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
var shareEditLinkField = document.getElementById('shareEditLinkField');
var shareEditLinkInput = document.getElementById('shareEditLinkInput');
var shareEditCopyBtn = document.getElementById('shareEditCopyBtn');
var shareViewOnlyNote = document.getElementById('shareViewOnlyNote');
var shareMainLinkHeading = document.getElementById('shareMainLinkHeading');
var shareLegacyNote = document.getElementById('shareLegacyNote');
var readonlyBanner = document.getElementById('readonlyBanner');
var historyBackdrop = document.getElementById('historyBackdrop');
var mergeBackdrop = document.getElementById('mergeBackdrop');
var mergeCloseBtn = document.getElementById('mergeCloseBtn');
var mergeCancelBtn = document.getElementById('mergeCancelBtn');
var mergeConfirmBtn = document.getElementById('mergeConfirmBtn');
var mergeIntroEl = document.getElementById('mergeIntro');
var mergeConflictListEl = document.getElementById('mergeConflictList');

// The share endpoints sit behind a proxy that caps the whole request body near 1 MB. The project
// JSON is always tiny, but a real song file (several MB, sometimes tens of MB) blows past that — a
// direct upload would just stall until the proxy resets it. So media only rides directly in the
// create/update/commit request when the whole thing comfortably fits under that cap; anything
// bigger is split into chunks first (see uploadMediaInChunks below and api/share/media_chunk.php)
// and only a small upload_id reference travels in the main request. Either way the full file
// reaches the server — nothing is skipped or dropped anymore, see [[share-link-1mb-upload-cap]].
var SHARE_BODY_BUDGET = 950 * 1024;
var MEDIA_CHUNK_BYTES = 700 * 1024; // comfortably under SHARE_BODY_BUDGET's own margin

// Uploads one media blob to media_chunk.php in pieces, each well under the proxy's cap, and
// resolves to the upload_id the main request should reference instead of the raw blob.
// onProgress(label, percent) — if given — is called after every chunk lands.
function uploadMediaInChunks(blob, label, onProgress){
  var uploadId = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  var total = Math.max(1, Math.ceil(blob.size / MEDIA_CHUNK_BYTES));
  var index = 0;
  function sendNext(){
    if(index >= total) return Promise.resolve(uploadId);
    var start = index * MEDIA_CHUNK_BYTES;
    var chunk = blob.slice(start, start + MEDIA_CHUNK_BYTES);
    var fd = new FormData();
    fd.append('upload_id', uploadId);
    fd.append('index', String(index));
    fd.append('chunk', chunk, 'chunk');
    return fetch('api/share/media_chunk.php', {method:'POST', body: fd})
      .then(function(res){ if(!res.ok) throw new Error('chunk upload failed: HTTP ' + res.status); return res.json(); })
      .then(function(data){
        if(!data || !data.ok) throw new Error('chunk upload rejected');
        index++;
        if(onProgress) onProgress(label, Math.round((index / total) * 100));
        return sendNext();
      });
  }
  return sendNext();
}

// Attaches state.logo/state.song to formData, either directly (small enough) or by chunk-uploading
// first and leaving a `<kind>_upload_id` + `<kind>_filename` reference for the server to resolve
// (see _media.php's share_resolve_incoming()). Returns a Promise that resolves once formData is
// ready to send; onProgress(label, percent), if given, reports chunk-upload progress only (the
// direct case is small enough that the caller's own xhr upload-progress event covers it).
function attachShareMedia(formData, usedBytes, onProgress){
  var items = [];
  if(state.logo && state.logo.blob) items.push({kind:'logo', label:'Logo', media: state.logo});
  if(state.song && state.song.blob) items.push({kind:'song', label:'Lied', media: state.song});

  var chain = Promise.resolve();
  items.forEach(function(item){
    chain = chain.then(function(){
      if(usedBytes + item.media.blob.size <= SHARE_BODY_BUDGET){
        formData.append(item.kind, item.media.blob, item.media.name || item.kind);
        usedBytes += item.media.blob.size;
        return;
      }
      return uploadMediaInChunks(item.media.blob, item.label, onProgress).then(function(uploadId){
        formData.append(item.kind + '_upload_id', uploadId);
        formData.append(item.kind + '_filename', item.media.name || item.kind);
      });
    });
  });
  return chain;
}

function shareUrlFor(id){ return location.origin + location.pathname + '?share=' + id; }
function shareEditUrlFor(id, token){ return shareUrlFor(id) + '&t=' + token; }

function isShareReadOnly(){ return !!(state.sharedId && state.shareReadOnly); }

// What the server lets this tab do with the bound share (#2104): {owner, owned, owner_name, rights,
// and for the owner the link settings}. Comes with every get.php/history.php; null until the first.
var shareAccess = null;
function shareLacks(right){ return !!(state.sharedId && shareAccess && shareAccess.rights.indexOf(right) === -1); }
function shareQuery(id, token){
  token = token === undefined ? state.shareEditToken : token;
  return 'id=' + encodeURIComponent(id) + (token ? '&t=' + encodeURIComponent(token) : '');
}
function applyShareAccess(access){
  if(!access || !state.sharedId) return;
  shareAccess = access;
  var ro = access.rights.indexOf('edit') === -1;
  // The owner on another device came in through the view link: hand them the edit link too.
  var newToken = access.edit_token && access.edit_token !== state.shareEditToken;
  if(newToken) state.shareEditToken = access.edit_token;
  if(newToken || ro !== state.shareReadOnly){ state.shareReadOnly = ro; writeLocalProject(); }
  applyShareReadonlyUi();
  if(!shareBackdrop.hidden && state.sharedId) showShareLink(state.sharedId);
}

// Blendet Banner + Sperr-Klasse für den Nur-Ansehen-Modus ein/aus.
function applyShareReadonlyUi(){
  var ro = isShareReadOnly();
  document.body.classList.toggle('share-readonly', ro);
  // „Choreo löschen“ entfernt geteilte Choreos nur lokal – der Link holt sie zurück.
  document.body.classList.toggle('shared', !!state.sharedId);
  if(readonlyBanner) readonlyBanner.hidden = !ro;
  document.body.classList.toggle('share-no-delete', shareLacks('delete'));
  document.body.classList.toggle('share-no-media', shareLacks('media'));
  projectNameInput.readOnly = ro || shareLacks('rename');
}

function showShareLink(id){
  shareIntroEl.hidden = true;
  shareProgressEl.hidden = true;
  shareErrorTextEl.hidden = true;
  shareResultEl.hidden = false;

  shareLinkInput.value = shareUrlFor(id);

  var haveToken = !!state.shareEditToken;
  var legacy = !haveToken && !isShareReadOnly();   // vor diesem Feature erstellter Link: ?share= erlaubt allen das Bearbeiten
  shareEditLinkField.hidden = !haveToken;
  if(haveToken) shareEditLinkInput.value = shareEditUrlFor(id, state.shareEditToken);
  shareViewOnlyNote.hidden = !isShareReadOnly();
  shareLegacyNote.hidden = !legacy;
  shareMainLinkHeading.textContent = legacy ? 'Link' : 'Nur zum Ansehen';
  renderShareOwner();
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
    shareOwnerSection.hidden = true;
  }
}
function openShareModal(){ resetShareModal(); shareBackdrop.hidden = false; refreshShareAccount(); }
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
  var payloadStr = JSON.stringify(header);
  var formData = new FormData();
  formData.append('payload', payloadStr);

  attachShareMedia(formData, payloadStr.length, function(label, pct){
    shareProgressFillEl.style.width = pct + '%';
    shareProgressTextEl.textContent = 'Wird hochgeladen… ' + label + ' ' + pct + '%';
  }).then(function(){
    shareProgressFillEl.style.width = '0%';
    shareProgressTextEl.textContent = 'Wird hochgeladen…';

    var xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/share/create.php');
    xhr.timeout = 45000; // never leave the user staring at "Wird hochgeladen…" forever
    xhr.upload.addEventListener('progress', function(e){
      if(e.lengthComputable){
        var pct = Math.round((e.loaded/e.total)*100);
        shareProgressFillEl.style.width = pct + '%';
        shareProgressTextEl.textContent = 'Wird hochgeladen… ' + pct + '%';
      }
    });
    xhr.addEventListener('load', function(){
      var data = null;
      try{ data = JSON.parse(xhr.responseText); }catch(e){}
      if(xhr.status >= 200 && xhr.status < 300 && data && data.id){
        state.sharedId = data.id;
        state.shareEditToken = data.edit_token || null;
        state.shareReadOnly = false;   // wer den Link erstellt, darf bearbeiten
        applyShareReadonlyUi();
        lastKnownRev = data.rev || null;
        lastPushedLogoRef = state.logo;
        lastPushedSongRef = state.song;
        suppressSharePush = true;
        saveState(); // persists the binding locally — server already has this exact payload, see suppressSharePush
        suppressSharePush = false;
        startSharePolling();        // first poll bootstraps shareBaseCommit from the graph head
        if(typeof initHistory === 'function') initHistory(); // re-file the Verlauf under the share id
        showShareLink(data.id);
        if(typeof moveLocalVideosToShare === 'function') moveLocalVideosToShare(); // js/videos.js
      }else if(xhr.status === 413){
        showShareError('Das Projekt ist zu groß zum Teilen. Meist liegt es am Lied — ohne Lied teilen, oder das Server-Limit (SHARE_MAX_BYTES) erhöhen.');
      }else{
        showShareError((data && data.error) ? data.error : 'Der Link konnte nicht erstellt werden.');
      }
    });
    xhr.addEventListener('error', function(){
      showShareError('Der Link konnte nicht erstellt werden (Netzwerkfehler).');
    });
    xhr.addEventListener('timeout', function(){
      showShareError('Zeitüberschreitung beim Hochladen — bitte erneut versuchen.');
    });
    xhr.send(formData);
  }).catch(function(){
    showShareError('Der Link konnte nicht erstellt werden (Medien-Upload fehlgeschlagen). Bitte erneut versuchen.');
  });
});

function copyLinkFrom(inputEl){
  inputEl.focus();
  inputEl.select();
  function done(){ shareCopiedHint.hidden = false; }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(inputEl.value).then(done).catch(function(){
      try{ document.execCommand('copy'); }catch(e){}
      done();
    });
  }else{
    try{ document.execCommand('copy'); }catch(e){}
    done();
  }
}
shareCopyBtn.addEventListener('click', function(){ copyLinkFrom(shareLinkInput); });
shareEditCopyBtn.addEventListener('click', function(){ copyLinkFrom(shareEditLinkInput); });

shareUnlinkBtn.addEventListener('click', function(){
  confirmDelete('Verknüpfung aufheben?', function(){
    state.sharedId = null;
    state.shareEditToken = null;
    state.shareReadOnly = false;
    clearPushFailure();
    stopSharePolling();
    applyShareReadonlyUi();
    saveState();
    resetShareModal();
  }, shareUnlinkBtn, 'Aufheben');
});

/* ---------- Besitz & Rechte (#2104) ----------
   Without an account nothing changes: nobody owns the choreo, the edit link may do everything. Signed
   in, whoever holds the edit link can take the choreo over; the owner then switches the links on and
   off, picks what the edit link may do, renews it and can delete the choreo for good. The server
   (api/lib/account.php) enforces all of it; this only shows the controls that fit. */
var shareOwnerSection = document.getElementById('shareOwnerSection');
var shareOwnerStatus = document.getElementById('shareOwnerStatus');
var shareAccountForm = document.getElementById('shareAccountForm');
var shareAccountName = document.getElementById('shareAccountName');
var shareAccountPw = document.getElementById('shareAccountPw');
var shareClaimBtn = document.getElementById('shareClaimBtn');
var shareOwnerSettings = document.getElementById('shareOwnerSettings');
var shareViewLinkToggle = document.getElementById('shareViewLinkToggle');
var shareEditLinkToggle = document.getElementById('shareEditLinkToggle');
var shareRightsInputs = Array.prototype.slice.call(document.querySelectorAll('#shareRightsList input'));
var shareRotateBtn = document.getElementById('shareRotateBtn');
var shareDeleteBtn = document.getElementById('shareDeleteBtn');
var shareAccountLine = document.getElementById('shareAccountLine');
var shareOwnerError = document.getElementById('shareOwnerError');
var accountName = null; // signed in on this device (api/account/me.php), null if not
var SHARE_RIGHTS_ALL = ['edit', 'rename', 'delete', 'media', 'videos'];
var SHARE_RIGHT_LABELS = {edit: 'bearbeiten', rename: 'umbenennen', delete: 'Bilder löschen', media: 'Lied und Logo ändern', videos: 'Videos hochladen und löschen'};

function renderShareOwner(){
  var a = shareAccess;
  shareOwnerSection.hidden = !state.sharedId || !a;
  if(shareOwnerSection.hidden) return;
  var full = a.rights.length === SHARE_RIGHTS_ALL.length;
  shareOwnerStatus.textContent = !a.owned
    ? 'Gehört niemandem: Wer den Bearbeiten-Link hat, darf alles.' + (full ? ' Mit einem Konto kannst du die Choreo übernehmen und festlegen, was der Bearbeiten-Link darf.' : '')
    : a.owner ? 'Gehört dir.'
    : 'Gehört ' + (a.owner_name || 'jemandem') + '. ' + (a.rights.length
      ? 'Du darfst: ' + a.rights.map(function(r){ return SHARE_RIGHT_LABELS[r]; }).join(', ') + '.'
      : 'Du darfst nur ansehen.');
  shareAccountForm.hidden = !!accountName || a.owner || (!a.owned && !full);
  shareClaimBtn.hidden = !accountName || a.owned || !full;
  shareOwnerSettings.hidden = !a.owner;
  if(a.owner){
    shareViewLinkToggle.checked = a.view_link_enabled;
    shareEditLinkToggle.checked = a.edit_link_enabled;
    shareRightsInputs.forEach(function(inp){ inp.checked = a.link_rights.indexOf(inp.value) !== -1; });
  }
  shareDeleteBtn.hidden = !(a.owner || (!a.owned && full));
  shareAccountLine.hidden = !accountName;
  document.getElementById('shareAccountUser').textContent = accountName || '';
}

function showOwnerError(msg){ shareOwnerError.hidden = !msg; shareOwnerError.textContent = msg || ''; }
function postForm(url, fields){
  var fd = new FormData();
  Object.keys(fields).forEach(function(k){ fd.append(k, fields[k]); });
  return fetch(url, {method: 'POST', body: fd}).then(function(res){
    return res.json().catch(function(){ return {}; }).then(function(data){
      if(!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    });
  });
}
function ownerAction(action, extra){
  showOwnerError('');
  var fields = {id: state.sharedId, edit_token: state.shareEditToken || '', action: action};
  Object.keys(extra || {}).forEach(function(k){ fields[k] = extra[k]; });
  return postForm('api/share/owner.php', fields).catch(function(err){ showOwnerError(err.message); throw err; });
}
// Re-reads who is signed in and what they may do here (after login/logout, or opening the dialog).
function refreshShareAccount(){
  if(!state.sharedId) return;
  fetch('api/account/me.php').then(function(r){ return r.json(); }).then(function(me){
    accountName = me.username || null;
    return fetch('api/share/history.php?' + shareQuery(state.sharedId)).then(function(r){ return r.ok ? r.json() : null; });
  }).then(function(graph){
    if(graph) applyShareAccess(graph.access); else renderShareOwner();
  }).catch(function(){});
}
function accountSubmit(register){
  showOwnerError('');
  postForm('api/account/login.php', {username: shareAccountName.value, password: shareAccountPw.value, register: register ? '1' : '0'})
    .then(function(){ shareAccountPw.value = ''; refreshShareAccount(); })
    .catch(function(err){ showOwnerError(err.message); });
}
document.getElementById('shareLoginBtn').addEventListener('click', function(){ accountSubmit(false); });
document.getElementById('shareRegisterBtn').addEventListener('click', function(){ accountSubmit(true); });
shareAccountPw.addEventListener('keydown', function(e){ if(e.key === 'Enter') accountSubmit(false); });
document.getElementById('shareLogoutBtn').addEventListener('click', function(){
  postForm('api/account/logout.php', {}).then(refreshShareAccount, function(err){ showOwnerError(err.message); });
});
shareClaimBtn.addEventListener('click', function(){
  ownerAction('claim').then(function(data){ applyShareAccess(data.access); }, function(){});
});
function saveShareSettings(){
  ownerAction('settings', {
    view_link_enabled: shareViewLinkToggle.checked ? '1' : '0',
    edit_link_enabled: shareEditLinkToggle.checked ? '1' : '0',
    link_rights: shareRightsInputs.filter(function(inp){ return inp.checked; }).map(function(inp){ return inp.value; }).join(',')
  }).then(function(data){ applyShareAccess(data.access); }, function(){ renderShareOwner(); });
}
[shareViewLinkToggle, shareEditLinkToggle].concat(shareRightsInputs).forEach(function(inp){ inp.addEventListener('change', saveShareSettings); });
shareRotateBtn.addEventListener('click', function(){
  confirmDelete('Neuen Bearbeiten-Link erzeugen? Der alte bearbeitet dann nichts mehr.', function(){
    ownerAction('rotate').then(function(data){ applyShareAccess(data.access); }, function(){});
  }, shareRotateBtn, 'Erzeugen');
});
shareDeleteBtn.addEventListener('click', function(){
  confirmDelete('Choreo endgültig löschen? Alle Links hören auf zu funktionieren, der Verlauf ist weg. Deine Kopie auf diesem Gerät bleibt.', function(){
    ownerAction('delete').then(function(){ detachShare(); resetShareModal(); }, function(){});
  }, shareDeleteBtn, 'Endgültig löschen');
});

/* ---------- syncing a bound share as a commit graph -------------------------------------------
   Every edit that reaches the server is a commit (api/share/commit.php). While this client sits on
   the mainline tip its commits fast-forward it; once it has diverged (someone else committed
   first) its commits land on its own branch_id and the Verlauf panel offers "zusammenführen"
   (3-way merge, js/history.js, then api/share/merge.php). See also the plan / [[share-link-1mb-upload-cap]].
   ------------------------------------------------------------------------------------------- */

var PUSH_DEBOUNCE_MS = 700;
var pushDebounceTimer = null;
var pushInFlight = false;
var pushQueuedAgain = false;
var lastKnownRev = null;          // opaque mainline token (for read-only opens / dedup)
var lastPushedLogoRef = undefined;
var lastPushedSongRef = undefined;
var suppressSharePush = false;    // set while applying an incoming state, so it isn't pushed back

// Where this client sits in the commit graph.
var shareBaseCommit = null;   // the commit our current state descends from (last push or pull)
var shareBranchId = null;     // null on the mainline, else our own branch id
var shareHeadCommit = null;   // last-seen mainline tip
var shareGraph = null;        // last history.php result {head_commit, commits:[], branches:[]}
var shareNeedsInitialPull = false; // a returning tab (localStorage binding, no ?share=) may hold a
                                   // stale project — its first poll pulls the current head instead
                                   // of adopting whatever it had as "current". Stays set until that
                                   // pull has landed, so a failed one is retried on the next tick.
var pushWaitingForBase = false;    // an edit before the first poll knows the graph: committing it
                                   // without a base fast-forwarded a stale copy over the head.

// A failed commit used to vanish silently: the edit stayed only in this tab, and the next poll or a
// reopen (shareNeedsInitialPull) could replace it with the server head. Now the failure shows in
// #saveErrorBanner; transient errors (network, 5xx, 408/429) are retried with backoff and on the
// `online` event, other 4xx wait for the next edit or the "Erneut versuchen" button. pushUnsaved
// counts as a pending local edit (haveLocalPendingEdits), so polling never pulls over it.
var PUSH_RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];
var pushRetryTimer = null;
var pushFailCount = 0;
var pushUnsaved = false;
var saveErrorBanner = document.getElementById('saveErrorBanner');
var saveErrorTextEl = document.getElementById('saveErrorText');
var saveErrorRetryBtn = document.getElementById('saveErrorRetryBtn');

function schedulePushSharedUpdate(){
  if(suppressSharePush) return;
  clearTimeout(pushDebounceTimer);
  pushDebounceTimer = setTimeout(pushSharedUpdateNow, PUSH_DEBOUNCE_MS);
}

function clearPushFailure(){
  clearTimeout(pushRetryTimer); pushRetryTimer = null;
  pushFailCount = 0;
  pushUnsaved = false;
  if(saveErrorBanner) saveErrorBanner.hidden = true;
}

// r: {status, data} from the commit response, or {status:0} for a network/media-upload error.
function notePushFailure(r){
  pushUnsaved = true;
  pushFailCount++;
  var s = r.status;
  var transient = !s || s < 400 || s >= 500 || s === 408 || s === 429;
  var reason;
  if(!s) reason = navigator.onLine === false ? 'keine Internetverbindung' : 'Server nicht erreichbar';
  else if(s < 400) reason = 'unerwartete Antwort vom Server';
  else if(s === 413) reason = 'das Projekt ist zu groß (meist liegt es am Lied)';
  else if(r.data && r.data.error) reason = String(r.data.error).replace(/[.!\s]+$/, '');
  else reason = 'Serverfehler ' + s;
  var text = 'Speichern fehlgeschlagen: ' + reason + '. Deine letzten Änderungen sind nur in diesem Browser'
    + (transient ? ' — neuer Versuch läuft automatisch.' : '.');
  clearTimeout(pushRetryTimer); pushRetryTimer = null;
  if(transient){
    var delay = PUSH_RETRY_DELAYS_MS[Math.min(pushFailCount, PUSH_RETRY_DELAYS_MS.length) - 1];
    pushRetryTimer = setTimeout(function(){ pushRetryTimer = null; pushSharedUpdateNow(); }, delay);
  }
  if(saveErrorBanner){
    saveErrorTextEl.textContent = text;
    saveErrorRetryBtn.disabled = false;
    saveErrorRetryBtn.textContent = 'Jetzt erneut versuchen';
    saveErrorBanner.hidden = false;
  }
}

function retryPushNow(){
  if(!pushUnsaved || pushInFlight) return;
  clearTimeout(pushRetryTimer); pushRetryTimer = null;
  pushSharedUpdateNow();
}
if(saveErrorRetryBtn) saveErrorRetryBtn.addEventListener('click', retryPushNow);
window.addEventListener('online', retryPushNow);

// Closing the tab while an edit is still unsaved would lose it (a reopen pulls the server head),
// so ask first. A still-debounced edit goes out right away, so it can land while the dialog shows.
window.addEventListener('beforeunload', function(e){
  if(!state.sharedId || state.shareReadOnly) return;
  pushDebouncedNow();
  if(!haveLocalPendingEdits()) return;
  e.preventDefault();
  e.returnValue = '';
});
// Phones never fire beforeunload, and a hidden tab may be frozen or killed — send now (#2071).
// Registered after state.js's hide handler, so its flushed save has already scheduled this push.
function pushDebouncedNow(){ if(pushDebounceTimer){ clearTimeout(pushDebounceTimer); pushSharedUpdateNow(); } }
document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'hidden') pushDebouncedNow(); });
window.addEventListener('pagehide', pushDebouncedNow);

function shareLogoMeta(){ return state.logo ? {name:state.logo.name, mime:state.logo.mime, opacity:state.logo.opacity||18} : null; }
function shareSongMeta(){ return state.song ? {name:state.song.name, mime:state.song.mime} : null; }
function shareAuthor(){ return (typeof currentAuthor === 'function') ? currentAuthor() : ''; }

function detachShare(){
  state.sharedId = null;
  state.shareEditToken = null;
  state.shareReadOnly = false;
  shareAccess = null;
  shareBaseCommit = null; shareBranchId = null; shareHeadCommit = null; shareGraph = null;
  shareNeedsInitialPull = false; pushWaitingForBase = false;
  clearPushFailure();
  stopSharePolling();
  applyShareReadonlyUi();
  saveState();
}

function pushSharedUpdateNow(){
  pushDebounceTimer = null;
  if(!state.sharedId || state.shareReadOnly){ clearPushFailure(); return; }   // Nur-Ansehen-Link: nichts hochladen
  if(!shareBaseCommit){ pushWaitingForBase = true; return; }                  // first poll sends it (or drops it, see pollSharedUpdate)
  if(pushInFlight){ pushQueuedAgain = true; return; }
  pushInFlight = true;
  clearTimeout(pushRetryTimer); pushRetryTimer = null;
  if(saveErrorBanner && !saveErrorBanner.hidden){
    saveErrorRetryBtn.disabled = true;
    saveErrorRetryBtn.textContent = 'Wird gespeichert…';
  }
  var id = state.sharedId;
  var mediaDirty = (state.logo !== lastPushedLogoRef) || (state.song !== lastPushedSongRef);
  var payloadStr = JSON.stringify(buildProjectHeader(state, shareLogoMeta(), shareSongMeta()));
  var formData = new FormData();
  formData.append('id', id);
  formData.append('edit_token', state.shareEditToken || '');
  formData.append('base_commit', shareBaseCommit || '');
  formData.append('payload', payloadStr);
  formData.append('author', shareAuthor());
  formData.append('note', (typeof lastEditSummary === 'function') ? lastEditSummary() : '');
  formData.append('logo_present', state.logo ? '1' : '0');
  formData.append('song_present', state.song ? '1' : '0');
  var mediaReady = mediaDirty ? attachShareMedia(formData, payloadStr.length) : Promise.resolve();

  mediaReady
    .then(function(){ return fetch('api/share/commit.php', {method:'POST', body: formData}); })
    .then(function(res){ return res.json().catch(function(){ return null; }).then(function(data){ return {ok:res.ok, status:res.status, data:data}; }); })
    .then(function(r){
      if(r.ok && r.data && r.data.commit_id){
        shareBaseCommit = r.data.commit_id;
        lastPushedLogoRef = state.logo;
        lastPushedSongRef = state.song;
        if(r.data.is_branch){
          shareBranchId = r.data.branch_id || shareBranchId || 'ast';
          shareHeadCommit = r.data.head_commit || shareHeadCommit;
        }else{
          shareBranchId = null;
          shareHeadCommit = r.data.head_commit || r.data.commit_id;
          if(r.data.rev) lastKnownRev = r.data.rev;
        }
        clearPushFailure();
        refreshShareBranchUI();
      }else if(r.status === 404){
        detachShare();
      }else{
        notePushFailure(r);
      }
    }, function(){ notePushFailure({status:0}); })
    .catch(function(){})
    .then(function(){
      pushInFlight = false;
      if(pushQueuedAgain){ pushQueuedAgain = false; schedulePushSharedUpdate(); }
    });
}

// Force the pending debounced commit out now and resolve once it (and any queued follow-up) has
// settled — used before a merge so "ours" is a real committed tip.
function flushPendingCommit(){
  return new Promise(function(resolve){
    if(!state.sharedId){ resolve(); return; }
    if(pushRetryTimer && !pushInFlight){ clearTimeout(pushRetryTimer); pushRetryTimer = null; pushSharedUpdateNow(); } // one try now, not a loop
    if(!pushInFlight && !pushDebounceTimer && !pushQueuedAgain){ resolve(); return; }
    clearTimeout(pushDebounceTimer); pushDebounceTimer = null;
    var tries = 0;
    (function wait(){
      if(!pushInFlight && !pushDebounceTimer && !pushQueuedAgain){ resolve(); return; }
      if(!pushInFlight && (pushDebounceTimer || pushQueuedAgain)) pushSharedUpdateNow();
      if(++tries > 60){ resolve(); return; } // ~9s safety net
      setTimeout(wait, 150);
    })();
  });
}

/* ---------- polling: watch the graph, fast-forward when it's safe ---------- */

var SHARE_POLL_MS = 8000;
var sharePollTimer = null;

function startSharePolling(){
  if(!state.sharedId){ stopSharePolling(); return; }
  clearInterval(sharePollTimer); clearInterval(presenceTimer);
  sharePollTimer = setInterval(pollSharedUpdate, SHARE_POLL_MS);
  presenceTimer = setInterval(sendPresence, PRESENCE_MS);
  pollSharedUpdate();
  sendPresence();
}
function stopSharePolling(){
  if(sharePollTimer){ clearInterval(sharePollTimer); sharePollTimer = null; }
  if(presenceTimer){ clearInterval(presenceTimer); presenceTimer = null; leavePresence(); }
}

/* ---------- Bild-Sperre (#2076/#2047): wer ein Bild offen hat, bearbeitet es allein ----------
   Every editing tab posts a heartbeat (api/share/presence.php) naming the Bild it has open. Per Bild,
   of the tabs with input in the last 2 min, the one that has had it open longest holds it; everyone
   else sees it read-only with the holder's name. Global data (Tänzer, Musik, Marker, Reihenfolge …)
   stays free and merges by itself (the auto-merge in pollSharedUpdate). */

var PRESENCE_MS = 2500;
var PRESENCE_IDLE_MS = 120000;
var PRESENCE_ALIVE_MS = 20000; // no heartbeat for this long = tab closed or offline
var presenceClientId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
var presenceTimer = null;
var presenceSent = null;       // {id, token} of the last heartbeat, for the goodbye
var presenceFormationId = null;
var presenceOnSince = Date.now();
// A reload keeps this tab's id and its claim on the open Bild (#2079) — otherwise the new page
// queues behind its own old entry. Taken out on load and put back on pagehide, so a duplicated tab
// (which copies sessionStorage) still starts with an id of its own.
var PRESENCE_KEEP_KEY = 'aufstellung-presence';
try{
  var keptPresence = JSON.parse(sessionStorage.getItem(PRESENCE_KEEP_KEY));
  sessionStorage.removeItem(PRESENCE_KEEP_KEY);
  if(keptPresence && /^[A-Za-z0-9]{8,32}$/.test(keptPresence.id)){
    presenceClientId = keptPresence.id;
    presenceFormationId = keptPresence.fid;
    presenceOnSince = keptPresence.since;
  }
}catch(e){}
var lastActivityAt = Date.now();
var presenceOthers = [];       // other tabs, times converted to this clock
var bildLockSig = null;
var bildLockBanner = document.getElementById('bildLockBanner');

['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function(t){
  document.addEventListener(t, function(){
    var now = Date.now(), wasIdle = now - lastActivityAt > PRESENCE_IDLE_MS;
    lastActivityAt = now;
    // Back from a break: queue up behind whoever took the Bild over meanwhile.
    if(wasIdle){ presenceOnSince = now; updateBildLocks(); }
  }, {capture: true, passive: true});
});
window.addEventListener('pagehide', function(){
  try{ sessionStorage.setItem(PRESENCE_KEEP_KEY, JSON.stringify({id: presenceClientId, fid: presenceFormationId, since: presenceOnSince})); }catch(e){}
  leavePresence();
});

function syncPresenceFormation(){
  if(playing) return; // playback runs through every Bild — keep claiming the one it started on
  var f = state.formations[state.activeIndex];
  var fid = f ? f.id : '';
  if(fid !== presenceFormationId){ presenceFormationId = fid; presenceOnSince = Date.now(); }
}

function presenceForm(id, token){
  var fd = new FormData();
  fd.append('id', id);
  fd.append('edit_token', token || '');
  fd.append('client_id', presenceClientId);
  fd.append('author', shareAuthor());
  return fd;
}

function sendPresence(){
  if(!state.sharedId || state.shareReadOnly) return;
  syncPresenceFormation();
  var id = state.sharedId, now = Date.now();
  presenceSent = {id: id, token: state.shareEditToken};
  var fd = presenceForm(id, state.shareEditToken);
  fd.append('formation_id', presenceFormationId || '');
  fd.append('on_ms', String(now - presenceOnSince));
  fd.append('idle_ms', String(now - lastActivityAt));
  fetch('api/share/presence.php', {method: 'POST', body: fd})
    .then(function(res){ return res.ok ? res.json() : null; })
    .then(function(d){
      if(!d || state.sharedId !== id) return;
      var at = Date.now();
      presenceOthers = (d.clients || []).map(function(c){
        return {client_id: c.client_id, author: c.author, formation_id: c.formation_id,
          since: at - c.on_ms, active: at - c.idle_ms, seen: at - c.seen_ms};
      });
      updateBildLocks();
      if(d.head_commit && shareBaseCommit && d.head_commit !== shareHeadCommit) pollSharedUpdate(); // live instead of the 8 s tick
    })
    .catch(function(){});
}

function leavePresence(){
  if(presenceSent){
    var fd = presenceForm(presenceSent.id, presenceSent.token);
    fd.append('leave', '1');
    try{ navigator.sendBeacon('api/share/presence.php', fd); }catch(e){}
    presenceSent = null;
  }
  presenceOthers = [];
  updateBildLocks();
}

// The other tab holding Bild `fid`, or null when it's free or ours.
function bildLockHolder(fid){
  var now = Date.now(), best = null;
  presenceOthers.forEach(function(c){
    if(c.formation_id !== fid || now - c.active > PRESENCE_IDLE_MS || now - c.seen > PRESENCE_ALIVE_MS) return;
    if(!best || c.since < best.since || (c.since === best.since && c.client_id < best.client_id)) best = c;
  });
  if(!best) return null;
  var mine = presenceFormationId === fid && now - lastActivityAt <= PRESENCE_IDLE_MS;
  if(mine && (presenceOnSince < best.since || (presenceOnSince === best.since && presenceClientId < best.client_id))) return null;
  return best;
}

function isBildLocked(){
  var f = state.formations[state.activeIndex];
  return !!(f && bildLockHolder(f.id));
}

// Banner on the stage + lock badge on every held Bild's card (also called by renderFilmstrip, force).
function updateBildLocks(force){
  syncPresenceFormation();
  var held = {};
  state.formations.forEach(function(f){ var h = bildLockHolder(f.id); if(h) held[f.id] = h.author || 'Jemand'; });
  var cur = state.formations[state.activeIndex];
  var who = cur ? held[cur.id] : null;
  var sig = JSON.stringify(held) + '|' + (who || '');
  if(sig === bildLockSig && !force) return;
  if(sig !== bildLockSig && typeof updateMarkerWarnings === 'function') updateMarkerWarnings(); // its Zwischenzeiten follow the locks
  bildLockSig = sig;
  document.body.classList.toggle('bild-locked', !!who);
  if(bildLockBanner){
    bildLockBanner.hidden = !who;
    bildLockBanner.textContent = bildLockBanner.title = who ? who + ' bearbeitet gerade dieses Bild – du kannst zusehen.' : '';
  }
  Array.prototype.forEach.call(document.querySelectorAll('.film-card'), function(card){
    var by = held[card.dataset.id];
    var badge = card.querySelector('.film-lock-badge');
    card.classList.toggle('film-card--locked', !!by);
    if(!by){ if(badge) badge.remove(); return; }
    if(!badge){
      badge = document.createElement('span');
      badge.className = 'film-lock-badge';
      card.querySelector('.film-preview').appendChild(badge);
    }
    badge.textContent = by;
    badge.title = by + ' bearbeitet gerade dieses Bild';
  });
  Array.prototype.forEach.call(document.querySelectorAll('.film-connector'), function(c){
    var f = state.formations[+c.dataset.f];
    c.classList.toggle('film-connector--locked', !!(f && held[f.id]));
  });
}

// An error body must never be applied as the project — the next edit would commit it over the head.
function pullJson(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }

function haveLocalPendingEdits(){ return pushInFlight || !!pushDebounceTimer || pushQueuedAgain || pushUnsaved || pushWaitingForBase; }

// The graph is fetched every tick so the Verlauf panel stays current; this only gates *swapping
// state under the user* (a fast-forward pull) — never the fetch itself.
function pollApplyBlocked(){
  if(haveLocalPendingEdits() || playing) return true; // swapping state reloads the song mid-playback (#2038)
  var ae = document.activeElement;
  if(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return true;
  var m = [shareBackdrop, settingsBackdrop, markerBackdrop, exportBackdrop, videoBackdrop, addBildBackdrop, mergeBackdrop, historyBackdrop, document.getElementById('resetBackdrop')];
  for(var i=0;i<m.length;i++){ if(m[i] && !m[i].hidden) return true; }
  return false;
}

function pollSharedUpdate(){
  if(!state.sharedId || document.visibilityState !== 'visible') return;
  var id = state.sharedId;
  fetch('api/share/history.php?' + shareQuery(id))
    .then(function(res){
      if(res.status === 404 || res.status === 403) throw {notFound:true}; // deleted, or the link was switched off
      if(!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(graph){
      if(state.sharedId !== id) return;
      shareGraph = graph;
      applyShareAccess(graph.access);
      var newHead = graph.head_commit;

      if(!shareBaseCommit){
        shareHeadCommit = newHead;
        if(shareNeedsInitialPull){
          return fetch('api/share/get.php?' + shareQuery(id))
            .then(pullJson)
            .then(function(payload){
              return reconstructSharedState(payload).then(function(newState){
                if(state.sharedId !== id || !shareNeedsInitialPull) return;
                suppressSharePush = true;
                applyState(newState, {keepBinding: true, keepBlobs: false});
                suppressSharePush = false;
                lastPushedLogoRef = newState.logo;
                lastPushedSongRef = newState.song;
                lastKnownRev = payload.rev || lastKnownRev;
                shareBaseCommit = newHead;
                shareNeedsInitialPull = false;
                pushWaitingForBase = false; // made on the stale copy — it stays in this device's Verlauf
                refreshShareBranchUI();
              });
            });
        }
        shareBaseCommit = newHead; // freshly created/loaded — local state already equals head
        refreshShareBranchUI();
        if(pushWaitingForBase){ pushWaitingForBase = false; pushSharedUpdateNow(); }
        return;
      }

      shareHeadCommit = newHead || shareHeadCommit;

      // Our own branch is safe to fast-forward past once its tip is an ancestor of the new head —
      // that means someone merged it into the mainline, our work is already in there.
      var branchMerged = shareBranchId && isAncestorCommit(graph.commits || [], shareBaseCommit, newHead);
      // Behind the head with nothing of our own pending — also on a later tick, when the head moved
      // while applying was blocked (typing, a dialog open …).
      var canFastForward = newHead && shareBaseCommit !== newHead && !pollApplyBlocked()
        && (!shareBranchId || branchMerged);

      if(canFastForward){
        return fetch('api/share/get.php?' + shareQuery(id))
          .then(pullJson)
          .then(function(payload){
            if(state.sharedId !== id || haveLocalPendingEdits()) return;
            return reconstructSharedState(payload).then(function(newState){
              if(state.sharedId !== id || haveLocalPendingEdits()) return;
              suppressSharePush = true;
              applyState(newState, {keepBinding: true, keepBlobs: false, keepView: true});
              lastPushedLogoRef = newState.logo;
              lastPushedSongRef = newState.song;
              lastKnownRev = payload.rev || lastKnownRev;
              shareBaseCommit = newHead;
              shareBranchId = null;
              suppressSharePush = false;
              refreshShareBranchUI();
            });
          });
      }
      // Our edits landed on a branch because someone else committed first: merge it back by itself
      // (#2076). Only a real conflict asks — once per head, so cancelling doesn't nag on every tick.
      if(shareBranchId && !branchMerged && newHead && !pendingMerge && autoMergeTried !== newHead && !pollApplyBlocked()){
        autoMergeTried = newHead;
        startMerge(newHead, true);
      }
      refreshShareBranchUI();
    })
    .catch(function(err){
      if(err && err.notFound) detachShare();
    });
}

/* ---------- branch view + 3-way merge (Verlauf panel) ---------- */

function relTimeStr(iso){
  var t = Date.parse(iso);
  if(isNaN(t)) return '';
  var s = Math.round((Date.now() - t) / 1000);
  if(s < 60) return 'vor ' + Math.max(0, s) + ' s';
  if(s < 3600) return 'vor ' + Math.round(s / 60) + ' min';
  if(s < 86400) return 'vor ' + Math.round(s / 3600) + ' h';
  return 'vor ' + Math.round(s / 86400) + ' Tagen';
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

function refreshShareBranchUI(){ if(typeof updateHistoryUI === 'function') updateHistoryUI(); }

// Called by js/history.js while rendering the Verlauf panel (only when state.sharedId is set).
function renderShareBranchArea(container){
  if(!shareGraph) return;
  var foreign = (shareGraph.branches || []).filter(function(b){ return b.branch_id !== shareBranchId; });
  var onBranch = !!shareBranchId;
  if(!onBranch && !foreign.length) return;

  if(onBranch){
    var note = document.createElement('div');
    note.className = 'history-branch-note';
    note.textContent = 'Du arbeitest auf einem eigenen Ast — deine Änderungen sind noch nicht im gemeinsamen Hauptast.';
    container.appendChild(note);
  }

  var list = document.createElement('div');
  list.className = 'branch-list';
  function row(label, sub, onMerge){
    var r = document.createElement('div');
    r.className = 'branch-row';
    var info = document.createElement('div');
    info.className = 'branch-row-info';
    info.innerHTML = '<b>' + escapeHtml(label) + '</b>' + (sub ? '<br>' + escapeHtml(sub) : '');
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn-ghost';
    btn.textContent = 'Zusammenführen';
    btn.addEventListener('click', function(){ onMerge(); });
    r.appendChild(info); r.appendChild(btn);
    list.appendChild(r);
  }

  if(onBranch){
    row('Hauptast', '', function(){ startMerge(shareGraph.head_commit); });
  }
  foreign.forEach(function(b){
    row('Ast von ' + (b.author || 'jemandem'), relTimeStr(b.created_at), function(){ startMerge(b.tip); });
  });
  container.appendChild(list);

  if(foreign.length + (onBranch ? 1 : 0) > 1){
    var all = document.createElement('button');
    all.type = 'button'; all.className = 'btn-ghost';
    all.style.marginTop = '.5rem';
    all.textContent = 'Alle zusammenführen';
    all.addEventListener('click', function(){ mergeAll(); });
    container.appendChild(all);
  }
}

function commitParents(byId, id){ var c = byId[id]; return c ? String(c.parent_ids || '').split(',').filter(Boolean) : []; }

// Is `anc` reachable by walking parents from `desc`? (i.e. did our branch tip get merged into head)
function isAncestorCommit(commits, anc, desc){
  if(!anc || !desc) return false;
  if(anc === desc) return true;
  var byId = {};
  commits.forEach(function(c){ byId[c.commit_id] = c; });
  var stack = [desc], seen = {};
  while(stack.length){
    var id = stack.pop();
    if(!id || seen[id]) continue;
    seen[id] = true;
    if(id === anc) return true;
    commitParents(byId, id).forEach(function(p){ stack.push(p); });
  }
  return false;
}

function findLCA(commits, a, b){
  var byId = {};
  commits.forEach(function(c){ byId[c.commit_id] = c; });
  function parents(id){ return commitParents(byId, id); }
  var ancA = {}, stack = [a];
  while(stack.length){
    var id = stack.pop();
    if(!id || ancA[id]) continue;
    ancA[id] = true;
    parents(id).forEach(function(p){ stack.push(p); });
  }
  var q = [b], seen = {};
  while(q.length){
    var id2 = q.shift();
    if(!id2 || seen[id2]) continue;
    seen[id2] = true;
    if(ancA[id2]) return id2;
    parents(id2).forEach(function(p){ q.push(p); });
  }
  return null;
}

function fetchCommitPayload(commitId){
  return fetch('api/share/get.php?' + shareQuery(state.sharedId) + '&commit=' + encodeURIComponent(commitId))
    .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
}

var pendingMerge = null; // {ourTip, theirTip, merged, conflicts, auto}
var autoMergeTried = null; // head the poll last auto-merged against

function startMerge(theirTip, auto){
  if(!state.sharedId || !shareGraph) return;
  refreshShareBranchUI();
  flushPendingCommit().then(function(){
    if(pushUnsaved){ alert('Zusammenführen geht gerade nicht: deine letzten Änderungen sind noch nicht gespeichert (siehe Hinweis oben).'); return; }
    var ourTip = shareBaseCommit;
    if(!ourTip || !theirTip || ourTip === theirTip) return;
    var lca = findLCA(shareGraph.commits || [], ourTip, theirTip) || ourTip;
    return Promise.all([fetchCommitPayload(lca), fetchCommitPayload(ourTip), fetchCommitPayload(theirTip)])
      .then(function(p){
        var res = mergeStates(p[0], p[1], p[2]);
        pendingMerge = {ourTip: ourTip, theirTip: theirTip, merged: res.merged, conflicts: res.conflicts, auto: !!auto && !res.conflicts.length};
        if(!res.conflicts.length){ finishMerge(); }
        else openMergeModal();
      });
  }).catch(function(err){
    console.error('Merge fehlgeschlagen', err);
    if(auto) autoMergeTried = null; else alert('Zusammenführen fehlgeschlagen.');
  });
}

function finishMerge(){
  if(!pendingMerge || pendingMerge.conflicts.some(function(c){ return !c.choice; })) return;
  var auto = pendingMerge.auto;
  // Silent merge, but the user edited meanwhile: applying it would drop that edit — retry next tick.
  if(auto && haveLocalPendingEdits()){ pendingMerge = null; autoMergeTried = null; return; }
  var mergedState = applyConflictChoices(pendingMerge.merged, pendingMerge.conflicts); // canonical shape
  var fd = new FormData();
  fd.append('id', state.sharedId);
  fd.append('edit_token', state.shareEditToken || '');
  fd.append('commit_a', pendingMerge.ourTip);
  fd.append('commit_b', pendingMerge.theirTip);
  fd.append('expected_head', (shareGraph && shareGraph.head_commit) || '');
  fd.append('payload', JSON.stringify(mergedState));
  fd.append('author', shareAuthor());
  var theirTip = pendingMerge.theirTip;
  return fetch('api/share/merge.php', {method:'POST', body: fd})
    .then(function(res){ return res.json().catch(function(){ return null; }).then(function(d){ return {ok:res.ok, status:res.status, data:d}; }); })
    .then(function(r){
      if(r.ok && r.data && r.data.commit_id){
        if(auto && haveLocalPendingEdits()){
          // Edited while the merge was on its way: those edits go onto our branch, the next tick merges again.
          pendingMerge = null; autoMergeTried = null; pollSharedUpdate();
          return theirTip;
        }
        suppressSharePush = true;
        applyState(mergedState, {keepBinding: true, keepBlobs: true, keepView: true});
        suppressSharePush = false;
        shareBaseCommit = r.data.commit_id;
        shareHeadCommit = r.data.head_commit || r.data.commit_id;
        shareBranchId = null;
        if(r.data.rev) lastKnownRev = r.data.rev;
        pendingMerge = null;
        closeMergeModal();
        pollSharedUpdate(); // refresh the graph
        return theirTip;
      }
      if(r.status === 409){
        if(auto) autoMergeTried = null;
        else alert('Der Hauptast hat sich gerade geändert. Ich hole den neuen Stand — bitte erneut zusammenführen.');
        pendingMerge = null; closeMergeModal(); pollSharedUpdate();
        return null;
      }
      if(auto){ pendingMerge = null; console.warn('Automatisches Zusammenführen fehlgeschlagen', r.status); return null; }
      alert((r.data && r.data.error) || 'Zusammenführen fehlgeschlagen.');
      return null;
    });
}

function mergeAll(){
  if(!shareGraph) return;
  var onBranch = !!shareBranchId;
  var targets = (shareGraph.branches || []).filter(function(b){ return b.branch_id !== shareBranchId; }).map(function(b){ return b.tip; });
  if(onBranch) targets.unshift(shareGraph.head_commit);
  (function next(){
    if(!targets.length) return;
    var tip = targets.shift();
    var before = pendingMerge;
    startMerge(tip);
    // startMerge is async; chain the rest only once this one clears without an open conflict modal
    var guard = 0;
    (function wait(){
      if(pendingMerge && mergeBackdrop && !mergeBackdrop.hidden) return; // stop — user must resolve
      if(!pendingMerge){ if(++guard > 40){ return; } setTimeout(next, 400); return; }
      if(++guard > 40) return;
      setTimeout(wait, 200);
    })();
  })();
}

/* ---------- conflict resolution modal ---------- */

function openMergeModal(){
  if(!mergeBackdrop || !pendingMerge) return;
  mergeIntroEl.textContent = pendingMerge.conflicts.length === 1
    ? 'Eine Stelle wurde auf beiden Seiten unterschiedlich geändert. Wähle, was gelten soll:'
    : pendingMerge.conflicts.length + ' Stellen wurden auf beiden Seiten unterschiedlich geändert. Wähle jeweils, was gelten soll:';
  // No default side (#2076): every conflict needs its own decision before "Übernehmen".
  var open = pendingMerge.conflicts.filter(function(c){ return !c.choice; }).length;
  if(open) mergeIntroEl.textContent += ' (noch ' + open + ' offen)';
  if(mergeConfirmBtn) mergeConfirmBtn.disabled = open > 0;
  mergeConflictListEl.innerHTML = '';
  pendingMerge.conflicts.forEach(function(c, i){
    var wrap = document.createElement('div');
    wrap.className = 'merge-conflict';
    var lab = document.createElement('div');
    lab.className = 'merge-conflict-label';
    lab.textContent = c.label;
    var choices = document.createElement('div');
    choices.className = 'merge-conflict-choices';
    function choiceBtn(which, title, val){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'merge-choice' + (c.choice === which ? ' merge-choice--picked' : '');
      b.innerHTML = '<small>' + title + '</small>' + escapeHtml(describeConflictValue(c.path, val));
      b.addEventListener('click', function(){
        c.choice = which;
        openMergeModal();
      });
      return b;
    }
    choices.appendChild(choiceBtn('mine', 'Meine', c.mine));
    choices.appendChild(choiceBtn('theirs', 'Andere', c.theirs));
    wrap.appendChild(lab); wrap.appendChild(choices);
    mergeConflictListEl.appendChild(wrap);
  });
  mergeBackdrop.hidden = false;
}
function closeMergeModal(){ if(mergeBackdrop) mergeBackdrop.hidden = true; }

function describeConflictValue(path, val){
  if(val === undefined) return '(entfernt)';
  if(path.indexOf('/pos/') !== -1) return '(' + val.x + ', ' + val.y + ')' + (val.rot ? ' · ' + val.rot + '°' : '');
  if(path === 'meta/tempo') return 'Tempo ' + val;
  if(path === 'meta/beats') return val ? val.length + ' Schläge' : 'keine Schläge';
  if(path === 'meta/bars') return val ? val.length + ' Taktanfänge' : 'keine Taktanfänge';
  if(typeof val === 'object' && val.name !== undefined) return '„' + val.name + '“';
  if(typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

if(mergeCloseBtn) mergeCloseBtn.addEventListener('click', function(){ pendingMerge = null; closeMergeModal(); });
if(mergeCancelBtn) mergeCancelBtn.addEventListener('click', function(){ pendingMerge = null; closeMergeModal(); });
if(mergeConfirmBtn) mergeConfirmBtn.addEventListener('click', function(){ finishMerge(); });
if(mergeBackdrop) mergeBackdrop.addEventListener('click', function(e){ if(e.target === mergeBackdrop){ pendingMerge = null; closeMergeModal(); } });

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
    var startPos = {};
    if(f.startPos && typeof f.startPos === 'object'){
      Object.keys(f.startPos).forEach(function(id){
        var p = f.startPos[id];
        if(p) startPos[id] = {x: clampGrid(p.x||0), y: clampGrid(p.y||0)};
      });
    }else{
      // payload predates the field — seed from this Bild's own pos so nothing shows until a
      // dancer is dragged, rather than leaving the onion-skin gray dot permanently disabled.
      Object.keys(pos).forEach(function(id){ startPos[id] = {x: pos[id].x, y: pos[id].y}; });
    }
    var out = {id:f.id, name:f.name||'Bild', pos:pos, showAxes: f.showAxes !== false, localAxes: localAxes, category: typeof f.category === 'string' ? f.category : '', startPos: startPos, betweens: sanitizeBetweens(f.betweens, payload.dancers), speedCurve: sanitizeSpeedCurve(f.speedCurve), coupleTurns: sanitizeCoupleTurns(f.coupleTurns), spins: sanitizeSpins(f.spins), orbits: sanitizeOrbits(f.orbits), note: sanitizeNote(f.note), splitPairs: sanitizeSplitPairs(f.splitPairs)};
    if(typeof f.time === 'number' && isFinite(f.time) && f.time >= 0) out.time = f.time;
    return out;
  });

  var base = {
    projectName: payload.projectName || 'Meine Formation',
    dancers: payload.dancers || [],
    formations: formations,
    axes: Array.isArray(payload.axes) ? payload.axes : [],
    showAxes: payload.showAxes !== false,
    showFacing: payload.showFacing !== false,
    roomLabels: {
      top: (payload.roomLabels && typeof payload.roomLabels.top === 'string') ? payload.roomLabels.top : 'WAND',
      right: (payload.roomLabels && typeof payload.roomLabels.right === 'string') ? payload.roomLabels.right : 'SPIEGEL',
      bottom: (payload.roomLabels && typeof payload.roomLabels.bottom === 'string') ? payload.roomLabels.bottom : 'EINGANG',
      left: (payload.roomLabels && typeof payload.roomLabels.left === 'string') ? payload.roomLabels.left : 'FENSTER'
    },
    stage: sanitizeStage(payload.stage),
    beats: sanitizeBeats(payload.beats),
    bars: sanitizeBars(payload.bars, sanitizeBeats(payload.beats)),
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
    // binding honored: pick up right where the last visit left off (poll the graph once, then
    // keep polling) without needing the id in the URL again.
    if(state.sharedId){ lastKnownRev = null; shareNeedsInitialPull = true; applyShareReadonlyUi(); startSharePolling(); if(typeof initHistory === 'function') initHistory(); }
    return;
  }
  // ?t=<edit_token> im Link => Bearbeiten erlaubt; ohne t => reiner Nur-Ansehen-Link.
  var editToken = params.get('t') || null;
  var access = null;
  fetch('api/share/get.php?' + shareQuery(id, editToken))
    .then(function(res){
      if(!res.ok){
        return res.json().catch(function(){ return {}; }).then(function(err){
          var e = new Error(err.error || ('HTTP ' + res.status)); e.fromServer = true; throw e;
        });
      }
      return res.json();
    })
    .then(function(payload){
      lastKnownRev = payload.rev || null;
      access = payload.access;
      return reconstructSharedState(payload);
    })
    .then(function(newState){
      newState.sharedId = id;
      newState.shareEditToken = editToken;
      newState.shareReadOnly = !editToken;
      newState.localId = localProjectForShare(id);
      suppressSharePush = true;     // loading the link must not turn around and commit it back
      applyImportedState(newState);
      suppressSharePush = false;
      pushWaitingForBase = false;   // an edit held from before belonged to the replaced local project
      applyShareAccess(access);
      applyShareReadonlyUi();
      lastPushedLogoRef = newState.logo;
      lastPushedSongRef = newState.song;
      syncBlobsToIdb();
      // Drop ?share= (und ?t=) aus der sichtbaren URL — die Bindung liegt jetzt in
      // state.sharedId / state.shareEditToken (localStorage) und braucht die Query nicht mehr.
      history.replaceState(null, '', location.pathname);
      startSharePolling();          // first poll bootstraps shareBaseCommit from the graph head
      if(typeof initHistory === 'function') initHistory();
      askWhoHasTabProject();        // the reused local copy may already be open in another tab
    })
    .catch(function(err){
      console.error('Konnte geteilten Link nicht laden:', err);
      showImportError(err.fromServer ? err.message : null);
      if(typeof initHistory === 'function') initHistory();
    });
}
