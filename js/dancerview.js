"use strict";

/* ---------- Tänzer-Ansicht ----------
   Die Choreo aus der Sicht eines Tänzers: links „Ich bin …“ und sein Ablauf Bild für Bild (Takt,
   Platz, Übergang, Notiz), auf der Bühne er selbst, die anderen blass. Abspielen wie sonst, ändern
   nicht. Wer einen Nur-Ansehen-Link öffnet, landet hier. */

  var dancerViewBtn = document.getElementById('dancerViewBtn');
  var dvWho = document.getElementById('dvWho');
  var dvList = document.getElementById('dvList');
  var dvStepsBtn = document.getElementById('dvStepsBtn');
  var dvStyle = document.head.appendChild(document.createElement('style'));

  function dvOn(){ return document.body.classList.contains('dancer-view'); }
  // Per device and choreo, so the phone remembers who you are.
  function dvKey(){ return 'aufstellung.me.' + (state.sharedId || state.localId || ''); }
  function dvMe(){
    var id = null;
    try{ id = localStorage.getItem(dvKey()); }catch(e){}
    return state.dancers.some(function(d){ return d.id === id; }) ? id : '';
  }

  function setDancerView(on){
    if(on) showWorkspace('choreo'); // js/main.js
    document.body.classList.toggle('dancer-view', on);
    dancerViewBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if(on){ clearSelection(); renderDancerView(); }
    else dvStyle.textContent = '';
  }

  function renderDancerView(){
    if(!dvOn()) return;
    var me = dvMe();
    dvWho.innerHTML = '';
    [{id: '', name: '– bitte wählen –'}].concat(state.dancers).forEach(function(d){
      var o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.name;
      dvWho.appendChild(o);
    });
    dvWho.value = me;
    dvStepsBtn.disabled = !me;
    // Everyone else fades on the stage; both spots of a split couple stay.
    dvStyle.textContent = me ? 'body.dancer-view .dancer:not([data-id="' + CSS.escape(me) + '"]):not([data-id="' + CSS.escape(followKey(me)) + '"]){opacity:.2;}' : '';
    dvList.innerHTML = '';
    if(!me){
      var p = document.createElement('p');
      p.className = 'hint dv-empty';
      p.textContent = 'Wähl oben, wer du bist – dann steht hier dein Weg durch die Choreo, Bild für Bild.';
      dvList.appendChild(p);
      return;
    }
    var times = isSyncActive() ? syncTimes() : [], active = null;
    state.formations.forEach(function(f, i){
      var t = formationTime(f);
      if(t === null && times[i] !== undefined) t = times[i];
      var next = state.formations[i + 1], tNext = next ? formationTime(next) : null;
      if(next && tNext === null && times[i + 1] !== undefined) tNext = times[i + 1];
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'dv-row' + (i === state.activeIndex ? ' active' : '');
      row.addEventListener('click', function(){ selectFormation(i); });
      function line(cls, text){
        if(!text) return;
        var el = row.appendChild(document.createElement('span'));
        el.className = cls;
        el.textContent = text;
      }
      line('dv-num', String(i + 1).padStart(2, '0'));
      line('dv-name', f.name);
      line('dv-bar', t === null ? '' : barLineLabel(t) || formatTime(t));
      var pos = f.pos[me], follow = f.pos[followKey(me)];
      line('dv-pos', !pos ? 'nicht auf der Fläche'
        : 'x ' + fmtSigned(pos.x) + ' m · y ' + fmtSigned(pos.y) + ' m' + (follow ? ' · Follow x ' + fmtSigned(follow.x) + ' y ' + fmtSigned(follow.y) : ''));
      if(next){
        var ph = t !== null && tNext !== null ? barPhrasing(t, tNext) : null, figs = barPhrasingTable(ph, 'dv-figs'); // js/beats.js
        line('dv-move', '→ ' + next.name + (ph ? ' · ' + ph.head : ''));
        if(figs) row.appendChild(figs);
      }
      line('dv-note', f.note);
      dvList.appendChild(row);
      if(i === state.activeIndex) active = row;
    });
    if(active) active.scrollIntoView({block: 'nearest'});
  }

  dancerViewBtn.addEventListener('click', function(){ setDancerView(!dvOn()); });
  dvWho.addEventListener('change', function(){
    try{ localStorage.setItem(dvKey(), dvWho.value); }catch(e){}
    renderDancerView();
  });
  dvStepsBtn.addEventListener('click', function(){
    var me = dvMe(), d = state.dancers.find(function(x){ return x.id === me; });
    if(!d) return;
    printStepsSheets(getStepsSheetsFor(['d:' + me]), sanitizeFilename((state.projectName || 'Choreo') + ' – ' + d.name), false, true, false); // js/steps.js
  });
  // A view-only link opens in this view, once; leaving it again is up to whoever looks.
  var dvAutoDone = false;
  new MutationObserver(function(){
    if(dvAutoDone || !document.body.classList.contains('share-readonly')) return;
    dvAutoDone = true;
    setDancerView(true);
  }).observe(document.body, {attributes: true, attributeFilter: ['class']});
