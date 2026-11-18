"use strict";

/* ---------- Videos zu Abschnitten (#2092) ----------
   Schritte zum Nachtanzen: ein Video gehört zu einem oder mehreren Abschnitten, gemerkt über die Id
   des Bilds, mit dem der Abschnitt beginnt (f.category). Eigener Bereich neben der Choreo, nicht im
   Verlauf. Geteilte Choreo: auf dem Server (api/share/videos.php), für alle mit dem Link sichtbar.
   Lokale Choreo: im IndexedDB dieses Geräts (Liste unter 'videos:<localId>', jede Datei unter
   'video:<id>'); beim Teilen werden sie hochgeladen (moveLocalVideosToShare). */

  var VIDEO_MAX_BYTES = 200 * 1024 * 1024;
  var videosBackdrop = document.getElementById('videosBackdrop');
  var videoList = document.getElementById('videoList');
  var videoAddBtn = document.getElementById('videoAddBtn');
  var videoFileInput = document.getElementById('videoFileInput');
  var videoStatus = document.getElementById('videoStatus');
  var videoPlayer = document.getElementById('videoPlayer'); // the player box, moved into the card that plays
  var videoEl = document.getElementById('videoEl');
  var vpPlayBtn = document.getElementById('vpPlayBtn');
  var vpSeek = document.getElementById('vpSeek');
  var vpTime = document.getElementById('vpTime');
  var vpRate = document.getElementById('vpRate');
  var vpMuteBtn = document.getElementById('vpMuteBtn');
  var vpFullBtn = document.getElementById('vpFullBtn');
  var videos = [], videosCanEdit = true, playingId = null;
  var blobUrls = {}; // local videos: id -> object URL, released when the dialog closes

  // A Bild whose category differs from the one before starts an Abschnitt, numbered per dance like
  // the film strip does it (renumberFilmCategories in js/formations.js): „1. Tango“, „2. Tango“.
  function videoSections(){
    var out = [], counts = {}, prev = null;
    state.formations.forEach(function(f, i){
      var key = (f.category || '').trim().toLowerCase();
      if(!key || key === prev) return; // blank or the same name again: still the same Abschnitt
      counts[key] = (counts[key] || 0) + 1;
      prev = key;
      out.push({id: f.id, name: counts[key] + '. ' + f.category.trim(), idx: i});
    });
    return out;
  }
  // The Abschnitt of the active Bild — a new video goes there first.
  function activeSectionId(){
    var id = null;
    videoSections().forEach(function(s){ if(s.idx <= state.activeIndex) id = s.id; });
    return id;
  }

  function showVideoStatus(msg){ videoStatus.hidden = !msg; videoStatus.textContent = msg || ''; }
  function localVideosKey(){ return 'videos:' + state.localId; }
  function videoResponse(res){
    return res.json().catch(function(){ return {}; }).then(function(data){
      if(!res.ok) throw Object.assign(new Error(data.error || 'HTTP ' + res.status), {status: res.status});
      videosCanEdit = data.can_edit;
      return data.videos;
    });
  }
  function postVideo(fields){
    var fd = new FormData();
    fd.append('id', state.sharedId);
    fd.append('edit_token', state.shareEditToken || '');
    Object.keys(fields).forEach(function(k){ fd.append(k, fields[k]); });
    return fetch('api/share/videos.php', {method: 'POST', body: fd}).then(videoResponse);
  }
  function loadVideos(){
    if(state.sharedId) return fetch('api/share/videos.php?' + shareQuery(state.sharedId)).then(videoResponse);
    videosCanEdit = true;
    return idbGet(localVideosKey()).then(function(list){ return list || []; });
  }
  // Local list changes: read, change, write back — the list holds no file data, only names and Abschnitte.
  function changeLocalVideos(fn){
    var key = localVideosKey();
    return idbGet(key).then(function(list){
      list = fn(list || []);
      return idbPut(key, list).then(function(){ return list; });
    });
  }
  function uploadVideoToShare(blob, name, mime, sections, label){
    return uploadMediaInChunks(blob, label, function(l, pct){ showVideoStatus(l + ' … ' + pct + ' %'); })
      .then(function(uploadId){
        return postVideo({action: 'add', upload_id: uploadId, name: name, mime: mime || '', sections: JSON.stringify(sections)});
      });
  }

  function addVideoFile(file){
    if(file.size > VIDEO_MAX_BYTES){ showVideoStatus('„' + file.name + '“ ist größer als 200 MB.'); return Promise.resolve(); }
    if(!/^video\//.test(file.type) && !/\.(mp4|m4v|mov|webm|ogv|mkv)$/i.test(file.name)){
      showVideoStatus('„' + file.name + '“ ist keine Videodatei.'); return Promise.resolve();
    }
    var name = file.name.replace(/\.[^.]+$/, '') || 'Video';
    var sections = activeSectionId() ? [activeSectionId()] : [];
    showVideoStatus('Prüft „' + name + '“ …');
    // Each video only once per choreo (#2162), recognised by its content — before anything is
    // uploaded; api/share/videos.php checks it again.
    return Promise.all([fileSha256(file), withHashes(videos)]).then(function(r){
      var hash = r[0], dup = hash && videos.filter(function(v){ return v.sha256 === hash; })[0];
      if(dup){ showVideoStatus('„' + file.name + '“ ist schon da – als „' + dup.name + '“.'); return; }
      if(state.sharedId){
        return uploadVideoToShare(file, name, file.type, sections, 'Lädt „' + name + '“ hoch').then(function(list){ videos = list; });
      }
      var id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      showVideoStatus('Speichert „' + name + '“ …');
      // idbPut swallows errors (full storage): read it back to know it landed.
      return idbPut('video:' + id, file).then(function(){ return idbGet('video:' + id); }).then(function(saved){
        if(!saved) throw new Error('Auf diesem Gerät ist nicht genug Platz für das Video.');
        return changeLocalVideos(function(list){
          return list.concat([{id: id, name: name, mime: file.type, size: file.size, sections: sections, created_at: new Date().toISOString(), sha256: hash}]);
        });
      }).then(function(list){ videos = list; });
    });
  }
  // SHA-256 of a file as hex; '' where the browser can't (no secure context) — the server still checks.
  function fileSha256(blob){
    if(!window.crypto || !crypto.subtle) return Promise.resolve('');
    return blob.arrayBuffer().then(function(buf){ return crypto.subtle.digest('SHA-256', buf); }).then(function(h){
      return Array.prototype.map.call(new Uint8Array(h), function(x){ return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  // Local videos saved before hashes were kept get theirs from the stored file (in memory only).
  function withHashes(list){
    return Promise.all(list.map(function(v){
      if(v.sha256 || v.url) return v;
      return idbGet('video:' + v.id).then(function(b){ return b && fileSha256(b).then(function(h){ v.sha256 = h; }); });
    }));
  }

  function updateVideo(v, changes){
    var name = 'name' in changes ? changes.name : v.name, sections = changes.sections || v.sections;
    var done = state.sharedId
      ? postVideo({action: 'update', video_id: v.id, name: name, sections: JSON.stringify(sections)})
      : changeLocalVideos(function(list){
          return list.map(function(x){ return x.id === v.id ? Object.assign({}, x, {name: name, sections: sections}) : x; });
        });
    return done.then(function(list){ videos = list; renderVideos(); }, function(err){ showVideoStatus(err.message); renderVideos(); });
  }
  function deleteVideo(v){
    if(playingId === v.id) stopVideo();
    var done = state.sharedId
      ? postVideo({action: 'delete', video_id: v.id})
      : idbDelete('video:' + v.id).then(function(){
          return changeLocalVideos(function(list){ return list.filter(function(x){ return x.id !== v.id; }); });
        });
    return done.then(function(list){ videos = list; renderVideos(); }, function(err){ showVideoStatus(err.message); });
  }

  function videoUrl(v){
    if(v.url) return Promise.resolve(v.url);
    if(blobUrls[v.id]) return Promise.resolve(blobUrls[v.id]);
    return idbGet('video:' + v.id).then(function(blob){
      if(!blob) throw new Error('Die Videodatei fehlt auf diesem Gerät.');
      return (blobUrls[v.id] = URL.createObjectURL(blob));
    });
  }
  function stopVideo(){
    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();
    videoPlayer.hidden = true;
    playingId = null;
  }
  // The one player opens inside the video's card; its thumbnail toggles it.
  function toggleVideo(v){
    var wasPlaying = playingId === v.id;
    stopVideo();
    if(wasPlaying){ renderVideos(); return; }
    videoUrl(v).then(function(url){
      playingId = v.id;
      videoEl.src = url;
      videoEl.playbackRate = +vpRate.value; // a new src resets it
      videoPlayer.hidden = false;
      renderVideos();
      videoEl.play().catch(function(){});
    }, function(err){ showVideoStatus(err.message); });
  }

  function fmtVideoSize(bytes){ return bytes >= 1048576 ? (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; }

  function renderVideos(){
    var secs = videoSections(), order = {};
    secs.forEach(function(s, i){ order[s.id] = i; });
    var firstSec = function(v){
      var idx = v.sections.map(function(id){ return id in order ? order[id] : 1e6; });
      return idx.length ? Math.min.apply(null, idx) : 1e6;
    };
    var list = videos.slice().sort(function(a, b){ return firstSec(a) - firstSec(b); });
    videoAddBtn.hidden = !videosCanEdit;
    videoList.textContent = '';
    if(!playingId) videoList.parentNode.insertBefore(videoPlayer, videoList); // parked, hidden, until a card plays
    if(!list.length){
      var empty = document.createElement('p');
      empty.className = 'settings-hint';
      empty.textContent = 'Noch keine Videos.' + (secs.length ? '' : ' Tipp: Mit „+ Abschnitt“ an einem Bild legst du Abschnitte an, denen du Videos zuordnen kannst.');
      videoList.appendChild(empty);
      return;
    }
    list.forEach(function(v){
      var playing = playingId === v.id;
      var item = document.createElement('div');
      item.className = 'video-item' + (playing ? ' playing' : '');
      var head = document.createElement('div');
      head.className = 'video-item-head';
      var thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'video-thumb';
      thumb.setAttribute('aria-label', '„' + v.name + '“ ' + (playing ? 'schließen' : 'abspielen'));
      var still = document.createElement('video');
      still.muted = true;
      still.preload = 'metadata';
      still.setAttribute('playsinline', '');
      videoUrl(v).then(function(url){ still.src = url + '#t=0.5'; }, function(){}); // a frame from the start as preview
      thumb.appendChild(still);
      var badge = document.createElement('span');
      badge.className = 'video-thumb-icon';
      badge.appendChild(svgIcon(playing ? 'x' : 'play', 14));
      thumb.appendChild(badge);
      thumb.addEventListener('click', function(){ toggleVideo(v); });
      head.appendChild(thumb);
      var name = document.createElement('input');
      name.type = 'text';
      name.className = 'video-name';
      name.value = v.name;
      name.maxLength = 200;
      name.readOnly = !videosCanEdit;
      name.setAttribute('aria-label', 'Name des Videos');
      name.addEventListener('change', function(){ updateVideo(v, {name: name.value.trim() || 'Video'}); });
      var size = document.createElement('span');
      size.className = 'video-size';
      size.textContent = fmtVideoSize(v.size) + (state.sharedId ? '' : ' · nur auf diesem Gerät');
      var meta = document.createElement('div');
      meta.className = 'video-meta';
      meta.appendChild(name);
      meta.appendChild(size);
      head.appendChild(meta);
      if(videosCanEdit){
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn-ghost btn-icon-only danger';
        del.setAttribute('aria-label', 'Video „' + v.name + '“ löschen');
        del.appendChild(svgIcon('x', 14));
        armDeleteButton(del, function(){ deleteVideo(v); });
        head.appendChild(del);
      }
      item.appendChild(head);
      if(playing) item.appendChild(videoPlayer); // moved back in the same task, so it keeps playing
      var chips = document.createElement('div');
      chips.className = 'video-sections';
      secs.forEach(function(s){
        var on = v.sections.indexOf(s.id) !== -1;
        if(!on && !videosCanEdit) return;
        var chip = document.createElement(videosCanEdit ? 'button' : 'span');
        chip.className = 'video-chip' + (on ? ' on' : '');
        chip.textContent = s.name;
        chip.title = 'Abschnitt ab Bild ' + (s.idx + 1);
        if(videosCanEdit){
          chip.type = 'button';
          chip.setAttribute('aria-pressed', on ? 'true' : 'false');
          chip.addEventListener('click', function(){
            var next = on ? v.sections.filter(function(id){ return id !== s.id; }) : v.sections.concat([s.id]);
            updateVideo(v, {sections: next});
          });
        }
        chips.appendChild(chip);
      });
      if(!chips.childNodes.length && secs.length){
        var none = document.createElement('span');
        none.className = 'settings-hint';
        none.textContent = 'Keinem Abschnitt zugeordnet';
        chips.appendChild(none);
      }
      item.appendChild(chips);
      videoList.appendChild(item);
    });
  }

  function openVideos(){
    videosBackdrop.hidden = false;
    showVideoStatus('');
    videos = [];
    videoList.textContent = 'Lädt …';
    (state.sharedId ? moveLocalVideosToShare() : Promise.resolve())
      .then(loadVideos)
      .then(function(list){ videos = list; renderVideos(); }, function(err){ videoList.textContent = ''; showVideoStatus(err.message); });
  }
  function closeVideos(){
    stopVideo();
    videosBackdrop.hidden = true;
    videoList.textContent = ''; // drops the previews before their object URLs go
    Object.keys(blobUrls).forEach(function(id){ URL.revokeObjectURL(blobUrls[id]); });
    blobUrls = {};
  }

  // A choreo that just got shared (or wasn't online the last time) takes its local videos along.
  var movingVideos = null;
  function moveLocalVideosToShare(){
    if(!state.sharedId || movingVideos) return movingVideos || Promise.resolve();
    var key = localVideosKey();
    movingVideos = idbGet(key).then(function(list){
      return (list || []).reduce(function(p, v){
        return p.then(function(){ return idbGet('video:' + v.id); }).then(function(blob){
          return blob && uploadVideoToShare(blob, v.name, v.mime, v.sections, 'Lädt „' + v.name + '“ in die geteilte Choreo')
            .catch(function(err){ if(err.status !== 409) throw err; }); // already in the shared choreo: drop the local copy all the same
        }).then(function(){
          return idbDelete('video:' + v.id).then(function(){
            return changeLocalVideos(function(l){ return l.filter(function(x){ return x.id !== v.id; }); });
          });
        });
      }, Promise.resolve());
    }).then(function(){ showVideoStatus(''); }, function(err){
      showVideoStatus('Lokale Videos konnten nicht hochgeladen werden: ' + err.message);
    }).then(function(){ movingVideos = null; });
    return movingVideos;
  }

  /* Player controls (#2163): play, position, speed, sound, full screen — in the app's own look. */
  function vpUpdate(){
    var dur = isFinite(videoEl.duration) ? videoEl.duration : 0;
    vpSeek.max = String(dur);
    if(!vpSeek.matches(':active')) vpSeek.value = String(videoEl.currentTime); // not under a dragging finger
    vpTime.textContent = vpFmt(videoEl.currentTime) + ' / ' + vpFmt(dur);
  }
  function vpFmt(t){ t = Math.floor(t || 0); return Math.floor(t / 60) + ':' + ('0' + t % 60).slice(-2); }
  function vpUpdatePlaying(){
    var on = !videoEl.paused;
    document.getElementById('vpIconPlay').hidden = on;
    document.getElementById('vpIconPause').hidden = !on;
    vpPlayBtn.setAttribute('aria-label', on ? 'Pausieren' : 'Abspielen');
  }
  function vpToggle(){ if(videoEl.paused) videoEl.play().catch(function(){}); else videoEl.pause(); }
  vpPlayBtn.addEventListener('click', vpToggle);
  videoEl.addEventListener('click', vpToggle);
  ['play', 'pause', 'ended', 'emptied'].forEach(function(t){ videoEl.addEventListener(t, vpUpdatePlaying); });
  ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked', 'emptied'].forEach(function(t){ videoEl.addEventListener(t, vpUpdate); });
  vpSeek.addEventListener('input', function(){ videoEl.currentTime = +vpSeek.value; vpUpdate(); });
  vpRate.addEventListener('change', function(){ videoEl.playbackRate = +vpRate.value; });
  vpMuteBtn.addEventListener('click', function(){
    videoEl.muted = !videoEl.muted;
    vpMuteBtn.setAttribute('aria-pressed', videoEl.muted ? 'true' : 'false');
    vpMuteBtn.setAttribute('aria-label', videoEl.muted ? 'Ton an' : 'Ton aus');
    vpMuteBtn.title = vpMuteBtn.getAttribute('aria-label');
  });
  // The whole box goes full screen so the controls come along; iPhone Safari only has the video's own.
  vpFullBtn.addEventListener('click', function(){
    if(document.fullscreenElement) document.exitFullscreen();
    else if(videoPlayer.requestFullscreen) videoPlayer.requestFullscreen().catch(function(){});
    else if(videoEl.webkitEnterFullscreen) videoEl.webkitEnterFullscreen();
  });

  document.getElementById('videosBtn').addEventListener('click', openVideos);
  document.getElementById('videosCloseBtn').addEventListener('click', closeVideos);
  videosBackdrop.addEventListener('click', function(e){ if(e.target === videosBackdrop) closeVideos(); });
  videoAddBtn.addEventListener('click', function(){ videoFileInput.click(); });
  videoFileInput.addEventListener('change', function(){
    var files = Array.prototype.slice.call(videoFileInput.files);
    videoFileInput.value = '';
    videoAddBtn.disabled = true;
    files.reduce(function(p, f){ return p.then(function(){ return addVideoFile(f); }); }, Promise.resolve())
      .then(function(){ if(videoStatus.textContent.indexOf('…') !== -1) showVideoStatus(''); }, function(err){ showVideoStatus(err.message); })
      .then(function(){ videoAddBtn.disabled = false; renderVideos(); });
  });
