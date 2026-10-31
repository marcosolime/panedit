// Interfaccia: barra superiore, pannelli per tipo di entità, ispettore, barra strumenti, stato.
const UI = (() => {
  let selected = null, panel = 'marca', quiet = false, listQueued = false;
  const filters = {}, collapsed = new Set();
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => Render.esc(s);
  const nf = (v, d = 0) => v.toLocaleString('it-IT', { maximumFractionDigits: d });
  const fmtArea = a => a >= 1e5 ? `${nf(a / 1e6, 2)} km²` : `${nf(Math.round(a))} blocchi²`;
  const fmtLen = l => l >= 1000 ? `${nf(l / 1000, 2)} km` : `${nf(Math.round(l))} blocchi`;
  // distanze ferroviarie: km con i blocchi tra parentesi (1 blocco = 1 m)
  const fmtKm = b => `${nf(b / 1000, 2)} km (${nf(Math.round(b))} blocchi)`;
  const typing = e => {
    const t = e.target;
    return !!t && (t.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !/^(range|checkbox|color|button)$/.test(t.type)));
  };
  const byName = (a, b) => (a.properties.name || '').localeCompare(b.properties.name || '', 'it');
  const kingdoms = () => Store.all('regno').sort(byName);
  const members = (kid, kind = 'marca') => Store.all(kind).filter(f => Model.kingdomIds(f.properties).includes(kid));
  // nomi dei regni di un'entità ("Avalon · Papasan" per i protettorati condivisi)
  const kingdomNames = f => Render.kingdomsOf(f).map(k => k.properties.name).join(' · ');
  const kindName = k => KINDS[k].label.toLowerCase();

  // ---------------------------------------------------------------- toast
  function toast(msg, type = 'info', action = null) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${esc(msg)}</span>`;
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.onclick = () => { action.fn(); el.remove(); };
      el.appendChild(b);
    }
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), action ? 7000 : 4200);
    setTimeout(() => el.remove(), action ? 7500 : 4700);
  }

  // ---------------------------------------------------------------- barra superiore
  function buildTopbar() {
    $('#tbActions').innerHTML = `
      <button class="tb" data-act="new" title="Nuova mappa vuota">${ICONS.file}<span>Nuovo</span></button>
      <button class="tb" data-act="open" title="Apri un file GeoJSON (Ctrl+O)">${ICONS.open}<span>Apri</span></button>
      <button class="tb" data-act="save" title="Salva (Ctrl+S)">${ICONS.save}<span>Salva</span></button>
      <button class="tb" data-act="saveas" title="Salva in un nuovo file GeoJSON (Ctrl+Maiusc+S)">${ICONS.saveas}<span>Salva come…</span></button>
      <span class="tb-sep"></span>
      <button class="tb icon" data-act="undo" title="Annulla (Ctrl+Z)">${ICONS.undo}</button>
      <button class="tb icon" data-act="redo" title="Ripeti (Ctrl+Y)">${ICONS.redo}</button>`;
    $('#tbActions').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b) command(b.dataset.act);
    });
    $('#searchIcon').innerHTML = ICONS.search;
    IO.onChange(updateFileInfo);
    Store.on('dirty', updateFileInfo);
  }

  function updateFileInfo() {
    $('#fileName').textContent = IO.fileName;
    $('#dirty').classList.toggle('on', Store.dirty);
    $('#stDraft').textContent = IO.draftState;
    document.title = `${Store.dirty ? '● ' : ''}${IO.fileName} — Editor di Panera`;
    $('[data-act="undo"]').disabled = !Store.canUndo();
    $('[data-act="redo"]').disabled = !Store.canRedo();
  }

  async function command(act) {
    try {
      switch (act) {
        case 'new':
          if (Store.dirty && !confirm('Ci sono modifiche non salvate. Creare comunque una mappa vuota?')) return;
          IO.newMap(); select(null); break;
        case 'open':
          if (Store.dirty && !confirm('Ci sono modifiche non salvate. Aprire comunque un altro file?')) return;
          if (await IO.open()) { select(null); toast(`Aperto ${IO.fileName}`); }
          break;
        case 'save': if (await IO.save(false)) toast(`Salvato ${IO.fileName}`, 'ok'); break;
        case 'saveas': if (await IO.save(true)) toast(`Salvato ${IO.fileName}`, 'ok'); break;
        case 'undo': { const l = Store.undo(); if (l) toast(`Annullato: ${l}`); afterHistory(); break; }
        case 'redo': { const l = Store.redo(); if (l) toast(`Ripetuto: ${l}`); afterHistory(); break; }
      }
    } catch (err) {
      console.error(err);
      toast(err.message || String(err), 'error');
    }
  }
  function afterHistory() {
    if (selected && !Store.get(selected)) select(null);
    else renderInspector();
    updateFileInfo();
  }

  // ---------------------------------------------------------------- ricerca
  function buildSearch() {
    const input = $('#search'), box = $('#results');
    let hits = [], cur = 0;
    const draw = () => {
      box.innerHTML = hits.map((f, i) => `<div class="res${i === cur ? ' cur' : ''}" data-id="${esc(f.id)}">
        <i style="--c:${Render.colorOf(f)}">${ICONS[f.properties.kind]}</i><b>${esc(f.properties.name || '—')}</b>
        <span>${esc(KINDS[f.properties.kind].label)}${kingdomNames(f) ? ' · ' + esc(kingdomNames(f)) : ''}</span></div>`).join('')
        || (input.value.trim() ? '<div class="res none">Nessun risultato</div>' : '');
      box.classList.toggle('open', !!input.value.trim() && document.activeElement === input);
    };
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      hits = q ? Store.all().filter(f => (f.properties.name || '').toLowerCase().includes(q))
        .sort((a, b) => (a.properties.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.properties.name.toLowerCase().startsWith(q) ? 0 : 1) || byName(a, b))
        .slice(0, 12) : [];
      cur = 0; draw();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { cur = Math.min(cur + 1, hits.length - 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { cur = Math.max(cur - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && hits[cur]) { go(hits[cur].id); }
      else if (e.key === 'Escape') { input.value = ''; hits = []; draw(); input.blur(); }
    });
    input.addEventListener('focus', draw);
    input.addEventListener('blur', () => setTimeout(() => box.classList.remove('open'), 150));
    box.addEventListener('mousedown', e => { const r = e.target.closest('[data-id]'); if (r) go(r.dataset.id); });
    const go = id => { select(id, { zoom: true }); input.value = ''; hits = []; input.blur(); box.classList.remove('open'); };
  }

  // ---------------------------------------------------------------- barra laterale (pannelli)
  // panel è l'id di un pannello di PANELS: coincide con il tipo, tranne "ferrovia" (linee e stazioni)
  const panelDef = id => PANELS.find(x => x.id === id);
  function buildRail() {
    $('#rail').innerHTML = PANELS.map((P, i) => `<button class="rail-btn" data-panel="${P.id}" title="${esc(P.label)} (${i + 1})">
      ${ICONS[P.id]}<span>${esc(P.label)}</span><b class="badge"></b></button>`).join('');
    // pannello chiuso: il clic apre quel pannello; clic sul pannello già aperto: lo chiude
    $('#rail').addEventListener('click', e => {
      const b = e.target.closest('[data-panel]');
      if (!b) return;
      if (b.dataset.panel === panel && Settings.leftOpen) { setSide('left', false); return; }
      showPanel(b.dataset.panel);
      setSide('left', true);
    });
  }
  function updateRail() {
    document.querySelectorAll('.rail-btn').forEach(b => {
      const P = panelDef(b.dataset.panel);
      b.classList.toggle('active', P.id === panel);
      b.classList.toggle('hidden-kind', P.kinds.every(k => Render.state.hidden.has(k)));
      b.querySelector('.badge').textContent = P.kinds.reduce((n, k) => n + Store.all(k).length, 0) || '';
    });
  }

  // k: id di un pannello o un tipo (si apre il pannello che lo contiene)
  function showPanel(k) {
    panel = panelOf(k);
    if (panel !== 'ferrovia' && route.shown) { route.shown = false; Render.showRoute(null); }
    const P = panelDef(panel);
    const lockable = panel !== 'regno';
    const news = P.kinds.map(x => `<button class="btn-new" data-act="new" data-kind="${x}">${ICONS.plus}<span>${esc(KINDS[x].article)}</span></button>`).join('');
    $('#panel').innerHTML = `
      <div class="ph">
        <div class="ph-title">${ICONS[panel]}<h2>${esc(P.label)}</h2><span class="count" id="phCount"></span></div>
        <div class="ph-tools">
          <button class="ib" data-act="vis" id="phVis"></button>
          ${lockable ? '<button class="ib" data-act="lock" id="phLock"></button>' : ''}
        </div>
      </div>
      <p class="ph-desc">${esc(DESCRIPTIONS[panel])}</p>
      ${P.kinds.length > 1 ? `<div class="new-row">${news}</div>` : news}
      ${panel === 'ferrovia' ? ROUTE_BOX : ''}
      <div class="filter">${ICONS.search}<input type="search" id="phFilter" placeholder="Filtra ${esc(P.label.toLowerCase())}…" value="${esc(filters[panel] || '')}"></div>
      <div class="list" id="phList"></div>`;
    $('#phFilter').addEventListener('input', e => { filters[panel] = e.target.value; renderList(); });
    renderList();
    updateRail();
  }

  // ---- calcolatore di percorso (pannello Ferrovie) ----
  const route = { from: '', to: '', shown: false };
  const ROUTE_BOX = `<div class="route" id="rtBox">
      <div class="route-sel"><select id="rtFrom" data-route="from"></select>
        <button class="ib sm" data-act="route-swap" title="Scambia partenza e arrivo">⇅</button></div>
      <div class="route-sel"><select id="rtTo" data-route="to"></select>
        <button class="btn" data-act="route-go">Calcola</button></div>
      <div id="rtOut"></div></div>`;

  // Menu delle stazioni e risultato; si ricalcola a ogni modifica della rete finché il percorso è mostrato
  function renderRoute() {
    if (!$('#rtBox')) return;
    const sts = Store.all('stazione').sort(byName);
    for (const k of ['from', 'to']) if (route[k] && !Store.get(route[k])) route[k] = '';
    const opts = (v, ph) => `<option value="">${ph}</option>` +
      sts.map(s => `<option value="${esc(s.id)}"${s.id === v ? ' selected' : ''}>${esc(s.properties.name || '—')}</option>`).join('');
    $('#rtFrom').innerHTML = opts(route.from, 'Partenza…');
    $('#rtTo').innerHTML = opts(route.to, 'Arrivo…');
    $('#rtOut').innerHTML = route.shown ? routeHtml() : '';
  }

  // Risultato: totale e cambi, poi un tratto per linea ("Costiera: Porto Vecchio → Bivio Nord") con i cambi in mezzo
  function routeHtml() {
    const close = `<button class="ib sm rt-x" data-act="route-clear" title="Togli il percorso">${ICONS.close}</button>`;
    const msg = (cls, t) => { Render.showRoute(null); return `<div class="rt-msg ${cls}">${t}${close}</div>`; };
    if (!route.from || !route.to) return msg('muted', 'Scegli la stazione di partenza e quella di arrivo.');
    if (route.from === route.to) return msg('muted', 'Partenza e arrivo coincidono.');
    const r = Rail.route(route.from, route.to);
    if (!r) return msg('warn-msg', 'Nessun percorso: le due stazioni non sono collegate dalla rete.');
    Render.showRoute(r.legs.map(l => ({ coords: l.coords, color: Render.colorOf(l.line) })));
    const nm = id => esc(Store.get(id)?.properties.name || '—');
    const stn = id => `<button class="link" data-goto="${esc(id)}">${nm(id)}</button>`;
    const legs = r.legs.map((l, i) => (i ? `<li class="chg">cambio a ${stn(l.from)}</li>` : '') +
      `<li class="leg" style="--c:${Render.colorOf(l.line)}"><div class="leg-h"><button class="link" data-goto="${esc(l.line.id)}">${esc(l.line.properties.name || '—')}</button>
        <em>${fmtLen(l.length)}</em></div><div class="leg-b">${stn(l.from)} → ${stn(l.to)} · ${l.stops} ${l.stops === 1 ? 'fermata' : 'fermate'}</div></li>`).join('');
    return `<div class="rt-head"><div class="stats"><div><b>${nf(r.length / 1000, 2)} km</b><span>${nf(Math.round(r.length))} blocchi</span></div>
      <div><b>${r.changes}</b><span>${r.changes === 1 ? 'cambio' : 'cambi'}</span></div></div>${close}</div><ol class="legs">${legs}</ol>`;
  }

  const DESCRIPTIONS = {
    regno: 'Ogni regno ha un colore; la sua estensione è data dalle marche che gli appartengono.',
    marca: 'Suddivisioni dei regni con nome e confini definiti. Trascina una marca su un regno per assegnarla.',
    protettorato: 'Territori sotto sovranità di un regno ma non incorporati: confini indicativi, tratteggiati.',
    territorio: 'Aree non incorporate in alcun regno, dai confini indefiniti (bordo sfumato), e linee di confine DMZ.',
    regione: 'Aree con caratteri naturali omogenei (es. pianure di Veld).',
    continente: 'Grandi masse di terra riconoscibili sulla mappa.',
    acqua: 'Fiumi e canali (linee), laghi e mari (aree).',
    localita: 'Città, villaggi e luoghi: oggetti puntiformi con nome.',
    ferrovia: 'Rete ferroviaria: linee (con fermate o direttissime) e stazioni. Una linea ferma nelle stazioni sui suoi vertici.'
  };

  function rowHtml(f, sw) {
    const p = f.properties, g = f.geometry;
    let meta = '';
    if (!g && p.kind !== 'regno') meta = '<span class="meta warn">senza geometria</span>';
    else if (Geo.isPoly(g)) meta = `<span class="meta">${fmtArea(Geo.area(g))}</span>`;
    else if (Geo.isLine(g)) meta = `<span class="meta">${fmtLen(Geo.length(g))}</span>`;
    else if (p.subtype && KINDS[p.kind].subtypes) meta = `<span class="meta">${esc(KINDS[p.kind].subtypes[p.subtype] || p.subtype)}</span>`;
    const drag = KINDS[p.kind].hasKingdom ? ' draggable="true"' : '';
    // protettorato condiviso: compare sotto ciascuno dei suoi regni
    const shared = Model.kingdomIds(p).length > 1 ? '<em class="shared">condiviso</em>' : '';
    return `<div class="row${p.id === selected ? ' sel' : ''}" data-id="${esc(p.id)}"${drag}>
      <i class="sw" style="--c:${sw || Render.colorOf(f)}"></i><span class="nm">${esc(p.name || '—')}${shared}</span>${meta}</div>`;
  }

  function renderList() {
    listQueued = false;
    const box = $('#phList');
    if (!box) return;
    const P = panelDef(panel), q = (filters[panel] || '').trim().toLowerCase();
    const match = f => !q || (f.properties.name || '').toLowerCase().includes(q);
    $('#phCount').textContent = P.kinds.reduce((n, k) => n + Store.all(k).length, 0);
    const hidden = P.kinds.every(k => Render.state.hidden.has(k)), locked = P.kinds.every(k => Render.state.locked.has(k));
    $('#phVis').innerHTML = hidden ? ICONS.eyeOff : ICONS.eye;
    $('#phVis').title = hidden ? 'Mostra sulla mappa' : 'Nascondi dalla mappa';
    $('#phVis').classList.toggle('off', hidden);
    if ($('#phLock')) {
      $('#phLock').innerHTML = locked ? ICONS.lock : ICONS.unlock;
      $('#phLock').title = locked ? 'Sblocca (rendi selezionabili sulla mappa)' : 'Blocca (non selezionabili sulla mappa)';
      $('#phLock').classList.toggle('off', locked);
    }
    // pannelli con più tipi (Ferrovie): una sezione per tipo
    const multi = P.kinds.length > 1;
    box.innerHTML = P.kinds.map(k => {
      const shown = Store.all(k).sort(byName).filter(match);
      const masc = k === 'regno' || k === 'territorio' || k === 'continente';
      const html = kindList(k, shown, q) || `<div class="empty">${q ? 'Nessun risultato' : `Nessun${masc ? ' ' : 'a '}${KINDS[k].label.toLowerCase()} — usa il pulsante qui sopra per crearne ${masc ? 'uno' : 'una'}.`}</div>`;
      return (multi ? `<div class="sec-h">${esc(KINDS[k].plural)}</div>` : '') + html;
    }).join('');
    renderRoute();
  }

  // Righe di un tipo: regni; raggruppate per regno (marche, protettorati, località) o per categoria; semplici
  function kindList(k, shown, q) {
    if (k === 'regno') {
      return shown.map(f => {
        const p = f.properties, ms = members(f.id), a = ms.reduce((s, m) => s + Geo.area(m.geometry), 0);
        return `<div class="row k-row${p.id === selected ? ' sel' : ''}" data-id="${esc(p.id)}">
          <label class="sw big" style="--c:${p.color}" title="Cambia colore"><input type="color" value="${p.color}" data-color="${esc(p.id)}"></label>
          <div class="nm"><b>${esc(p.name || '—')}</b><span>${ms.length} ${ms.length === 1 ? 'marca' : 'marche'}${a ? ' · ' + fmtArea(a) : ''}</span></div>
          <button class="ib sm" data-act="draw-marca" data-kid="${esc(p.id)}" title="Disegna una nuova marca di ${esc(p.name)}">${ICONS.plus}</button></div>`;
      }).join('');
    }
    if (KINDS[k].hasKingdom) {
      const groups = [...kingdoms().map(kf => ({ id: kf.id, name: kf.properties.name, color: kf.properties.color })), { id: '', name: 'Senza regno', color: '#6b7178' }];
      return groups.map(gr => {
        const rows = shown.filter(f => { const ks = Model.kingdomIds(f.properties); return gr.id ? ks.includes(gr.id) : !ks.length; });
        if (!rows.length && (q || k === 'localita' || !gr.id)) return '';
        const isCol = collapsed.has(k + gr.id);
        return `<div class="grp${isCol ? ' col' : ''}" data-kingdom="${esc(gr.id)}">
          <div class="grp-h" data-grp="${esc(gr.id)}"><i class="sw" style="--c:${gr.color}"></i><span>${esc(gr.name)}</span><em>${rows.length}</em></div>
          <div class="grp-b">${rows.map(f => rowHtml(f)).join('') || '<div class="drop-hint">Trascina qui</div>'}</div></div>`;
      }).join('');
    }
    if (KINDS[k].subtypes) {
      const grp = (label, rows) => rows.length ? `<div class="grp"><div class="grp-h plain"><span>${esc(label)}</span><em>${rows.length}</em></div><div class="grp-b">${rows.map(f => rowHtml(f)).join('')}</div></div>` : '';
      return Object.entries(KINDS[k].subtypes).map(([sk, sl]) => grp(sl, shown.filter(f => f.properties.subtype === sk))).join('') +
        grp('Altro', shown.filter(f => !KINDS[k].subtypes[f.properties.subtype]));
    }
    return shown.map(f => rowHtml(f)).join('');
  }
  const queueList = () => { if (!listQueued) { listQueued = true; requestAnimationFrame(() => { renderList(); updateRail(); }); } };

  function bindPanel() {
    const el = $('#panel');
    el.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act?.dataset.act.startsWith('route-')) {
        const a = act.dataset.act;
        if (a === 'route-swap') [route.from, route.to] = [route.to, route.from];
        if (a === 'route-clear') { route.shown = false; Render.showRoute(null); }
        if (a === 'route-go') {
          route.shown = true;
          renderRoute();
          const r = Rail.route(route.from, route.to);
          const b = r && L.latLngBounds(r.legs.flatMap(l => Geo.toLatLngs({ type: 'LineString', coordinates: l.coords })));
          if (b) Render.map.flyToBounds(b, { padding: [60, 60], maxZoom: 0, duration: 0.6 });
        } else renderRoute();
        return;
      }
      const go = e.target.closest('[data-goto]');
      if (go) { select(go.dataset.goto, { zoom: true }); return; }
      if (act) {
        const a = act.dataset.act;
        const kinds = panelDef(panel).kinds;   // nascondi / blocca valgono per tutti i tipi del pannello
        if (a === 'vis') { const on = !kinds.every(k => Render.state.hidden.has(k)); kinds.forEach(k => Render.setHidden(k, on)); renderList(); updateRail(); }
        else if (a === 'lock') { const on = !kinds.every(k => Render.state.locked.has(k)); kinds.forEach(k => Render.setLocked(k, on)); renderList(); }
        else if (a === 'new') newEntity(act.dataset.kind || kinds[0], act);
        else if (a === 'draw-marca') { e.stopPropagation(); drawFor(act.dataset.kid); }
        return;
      }
      if (e.target.closest('label.sw')) return;
      const gh = e.target.closest('[data-grp]');
      if (gh) {
        const key = panel + gh.dataset.grp;
        collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
        gh.parentElement.classList.toggle('col');
        return;
      }
      const row = e.target.closest('.row[data-id]');
      if (row) select(row.dataset.id, { zoom: true });
    });
    el.addEventListener('change', e => {
      if (e.target.dataset.route) { route[e.target.dataset.route] = e.target.value; e.target.blur(); if (route.shown) renderRoute(); return; }
      const id = e.target.dataset.color;
      if (id) Edit.update(id, p => { p.color = e.target.value; }, { label: 'Colore del regno' });
    });
    // Evidenzia sulla mappa ciò che si sta indicando nell'elenco
    let hoverRow = null;
    el.addEventListener('mouseover', e => {
      const row = e.target.closest('.row[data-id]') || e.target.closest('.grp-h[data-grp]');
      if (row === hoverRow) return;
      hoverRow = row;
      if (!row) { Render.setGroup([]); return; }
      const id = row.dataset.id ?? row.dataset.grp;
      const f = id && Store.get(id);
      if (f && f.properties.kind === 'regno') Render.setGroup([...members(id), ...members(id, 'protettorato')].map(m => m.id));
      else Render.setGroup(f ? [id] : []);
    });
    el.addEventListener('mouseleave', () => { hoverRow = null; Render.setGroup([]); });

    // Trascina una marca su un regno per assegnarla
    el.addEventListener('dragstart', e => {
      const row = e.target.closest('.row[data-id]');
      if (!row) return;
      e.dataTransfer.setData('text/plain', row.dataset.id);
      dragFrom = row.closest('.grp[data-kingdom]')?.dataset.kingdom || null;   // regno da cui si prende la riga
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    el.addEventListener('dragend', e => { e.target.classList?.remove('dragging'); clearDrop(); });
    el.addEventListener('dragover', e => {
      const grp = e.target.closest('.grp[data-kingdom]');
      if (!grp) return;
      e.preventDefault();
      clearDrop(); grp.classList.add('drop');
    });
    el.addEventListener('drop', e => {
      const grp = e.target.closest('.grp[data-kingdom]');
      if (!grp) return;
      e.preventDefault();
      clearDrop();
      const id = e.dataTransfer.getData('text/plain'), kid = grp.dataset.kingdom || null;
      const f = Store.get(id);
      if (f && f.properties.kind === 'protettorato') {
        // sostituisce solo il regno di partenza; gli altri proprietari restano
        if (dragFrom === kid) return;
        Edit.moveKingdom(id, dragFrom, kid);
        const after = Store.get(id);
        toast(`«${f.properties.name}» ${kingdomNames(after) ? 'ora di ' + kingdomNames(after) : 'ora senza regno'}`, 'ok');
      } else if (f && (f.properties.kingdom || null) !== kid) {
        Edit.setKingdom([id], kid);
        toast(`«${f.properties.name}» ${kid ? 'assegnata a ' + Store.get(kid).properties.name : 'ora senza regno'}`, 'ok');
      }
    });
    const clearDrop = () => el.querySelectorAll('.grp.drop').forEach(g => g.classList.remove('drop'));
    let dragFrom = null;
  }

  // ---------------------------------------------------------------- creazione
  function newEntity(k, anchor) {
    if (k === 'regno') {
      const id = Edit.createKingdom();
      select(id, { focus: true });
      return;
    }
    if (Tools.tool !== 'select') Tools.set('select');   // il menu Crea non va filtrato dallo strumento precedente
    Settings.target = k; Settings.save();
    renderToolstrip();
    const geoms = KINDS[k].geom;
    const opts = [];
    if (geoms.includes('Polygon')) opts.push(['freehand', 'Area a mano libera', 'F'], ['polygon', 'Area per punti', 'P']);
    if (k === 'territorio') opts.push(['polyline', 'DMZ (linea per punti)', 'D']);
    else if (k === 'linea') opts.push(['polyline', 'Linea per punti', 'D']);
    else if (geoms.includes('LineString')) opts.push(['line', 'Linea a mano libera (fiume)', 'L'], ['polyline', 'Fiume o canale per punti', 'D']);
    if (geoms.includes('Point')) opts.push(['point', 'Punto sulla mappa', 'K']);
    if (opts.length === 1) { Tools.set(opts[0][0]); return; }
    menu(anchor, opts.map(([t, label, key]) => ({ label, key, icon: ICONS[t], fn: () => Tools.set(t) })));
  }

  function drawFor(kid) {
    Settings.kingdom = kid; Settings.target = 'marca'; Settings.save();
    renderToolstrip();
    Tools.set('freehand');
    toast(`Disegna la nuova marca di ${Store.get(kid).properties.name}`);
  }

  function menu(anchor, items) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'menu';
    m.innerHTML = items.map((it, i) => `<button data-i="${i}">${it.icon || ''}<span>${esc(it.label)}</span>${it.key ? `<kbd>${it.key}</kbd>` : ''}</button>`).join('');
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.left = r.left + 'px';
    m.style.top = (r.bottom + 4) + 'px';
    m.style.minWidth = r.width + 'px';
    m.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { closeMenu(); items[b.dataset.i].fn(); } });
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
    function outside(e) { if (!m.contains(e.target)) closeMenu(); }
    m._outside = outside;
  }
  function closeMenu() {
    const m = $('.menu');
    if (m) { document.removeEventListener('mousedown', m._outside); m.remove(); }
  }

  // ---------------------------------------------------------------- barra strumenti
  function buildToolstrip() {
    const tools = ['select', 'freehand', 'polygon', 'line', 'polyline', 'point', null, 'add', 'sub', 'redraw'];
    $('#tsTools').innerHTML = tools.map(t => t ? `<button class="tool" data-tool="${t}" title="${esc(Tools.META[t].name)} (${Tools.META[t].key})">${ICONS[t]}</button>` : '<span class="ts-sep"></span>').join('');
    $('#tsTools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) Tools.set(b.dataset.tool); });
    $('#optTarget').addEventListener('change', e => { Settings.target = e.target.value; Settings.save(); renderToolstrip(); onTool(Tools.tool); });
    $('#optKingdom').addEventListener('change', e => {
      if (e.target.value === '__new') {
        const id = Edit.createKingdom();
        Settings.kingdom = id; Settings.save();
        select(id, { focus: true });
      } else { Settings.kingdom = e.target.value || null; Settings.save(); }
      renderToolstrip();
    });
    $('#optOverlap').addEventListener('change', e => { Settings.overlap = e.target.value; Settings.save(); });
    // prossima linea ferroviaria: categoria (ricordata) e colore (solo per la prossima, poi torna al primo libero)
    $('#optRailType').addEventListener('change', e => { Settings.railType = e.target.value; Settings.save(); });
    $('#optRailColor').addEventListener('input', e => { Settings.railColor = e.target.value; Settings.save(); });
    $('#optSnap').innerHTML = ICONS.magnet + '<span>Aggancio</span>';
    $('#optLink').innerHTML = ICONS.link + '<span>Confini collegati</span>';
    $('#optSnap').addEventListener('click', () => { Settings.snap = !Settings.snap; Settings.save(); renderToolstrip(); Render.setEditing(Tools.tool === 'select'); });
    $('#optLink').addEventListener('click', () => { Settings.link = !Settings.link; Settings.save(); renderToolstrip(); });
    // restituisce il focus alla mappa, così le scorciatoie da tastiera funzionano subito
    $('#toolstrip').addEventListener('change', e => { if (e.target.tagName === 'SELECT') e.target.blur(); });
    renderToolstrip();
  }

  // Menu Crea: solo i tipi compatibili con lo strumento di disegno attivo. Se il tipo scelto non lo è, si passa a
  // quello tipico dello strumento (aree → marca, linea a mano libera → fiume, per punti → territorio, punto → località)
  const TOOL_TARGET = { freehand: ['Polygon', 'marca'], polygon: ['Polygon', 'marca'], line: ['LineString', 'acqua'],
    polyline: ['LineString', 'territorio'], point: ['Point', 'localita'] };
  function targetOptions() {
    const t = TOOL_TARGET[Tools.tool];
    const ok = KIND_ORDER.filter(k => k !== 'regno' && (!t || KINDS[k].geom.includes(t[0])));
    if (t && !ok.includes(Settings.target)) { Settings.target = t[1]; Settings.save(); }
    $('#optTarget').innerHTML = ok.map(k => `<option value="${k}">${esc(KINDS[k].label)}</option>`).join('');
    $('#optTarget').value = Settings.target;
  }

  function renderToolstrip() {
    targetOptions();
    const ks = kingdoms();
    if (Settings.kingdom && !Store.get(Settings.kingdom)) Settings.kingdom = null;
    $('#optKingdom').innerHTML = '<option value="">— nessuno —</option>' +
      ks.map(k => `<option value="${esc(k.id)}">${esc(k.properties.name)}</option>`).join('') + '<option value="__new">+ Nuovo regno…</option>';
    $('#optKingdom').value = Settings.kingdom || '';
    $('#optKingdom').style.setProperty('--c', Settings.kingdom ? Store.get(Settings.kingdom).properties.color : 'transparent');
    $('#optKingdomWrap').hidden = !KINDS[Settings.target]?.hasKingdom || Settings.target === 'localita';
    $('#optOverlap').value = Settings.overlap;
    $('#optOverlapWrap').hidden = !KINDS[Settings.target]?.political;
    $('#optRailWrap').hidden = Settings.target !== 'linea';
    $('#optRailType').value = Settings.railType;
    $('#optRailColor').value = Settings.railColor || Model.nextColor('linea');
    $('#optSnap').classList.toggle('on', Settings.snap);
    $('#optLink').classList.toggle('on', Settings.link);
  }

  function onTool(t) {
    renderToolstrip();
    document.querySelectorAll('#tsTools .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    const needSel = !(selected && Geo.isPoly(Store.get(selected)?.geometry));
    ['add', 'sub', 'redraw'].forEach(x => { const b = $(`#tsTools [data-tool="${x}"]`); if (b) b.disabled = needSel; });
    $('#hint').textContent = Tools.hint();
    $('#hint').classList.toggle('drawing', t !== 'select');
  }

  // ---------------------------------------------------------------- pannelli laterali
  function setSide(side, open) {
    const key = side === 'left' ? 'leftOpen' : 'rightOpen';
    Settings[key] = open; Settings.save();
    $('#app').classList.toggle(side + '-closed', !open);
    const b = $(side === 'left' ? '#tglLeft' : '#tglRight');
    const what = side === 'left' ? "l'elenco" : 'le proprietà';
    b.title = `${open ? 'Chiudi' : 'Apri'} ${what} (${side === 'left' ? '[' : ']'})`;
    b.setAttribute('aria-expanded', open);
  }
  function bindSides(map) {
    $('#tglLeft').innerHTML = $('#tglRight').innerHTML = ICONS.chevron;
    $('#tglLeft').addEventListener('click', () => setSide('left', !Settings.leftOpen));
    $('#tglRight').addEventListener('click', () => setSide('right', !Settings.rightOpen));
    // stato iniziale senza animazione
    $('#app').classList.add('no-anim');
    setSide('left', Settings.leftOpen);
    setSide('right', Settings.rightOpen);
    requestAnimationFrame(() => requestAnimationFrame(() => $('#app').classList.remove('no-anim')));
    // la mappa segue lo scorrimento dei pannelli
    new ResizeObserver(() => map.invalidateSize({ animate: false })).observe($('#map'));
  }

  // ---------------------------------------------------------------- selezione
  function select(id, opts = {}) {
    if (id && !Store.get(id)) id = null;
    closeMenu();
    selected = id;
    Render.select(id);
    if (['add', 'sub', 'redraw'].includes(Tools.tool) && !(id && Geo.isPoly(Store.get(id).geometry))) Tools.set('select');
    if (id) {
      const f = Store.get(id), k = f.properties.kind;
      if (panelOf(k) !== panel) showPanel(k);
      if (k === 'regno') Settings.kingdom = id;
      else if (KINDS[k].political && f.properties.kingdom) Settings.kingdom = f.properties.kingdom;
      Settings.save();
      renderToolstrip();
    }
    document.querySelectorAll('#phList .row').forEach(r => r.classList.toggle('sel', r.dataset.id === id));
    const row = id && document.querySelector(`#phList .row[data-id="${CSS.escape(id)}"]`);
    if (row) { row.closest('.grp')?.classList.remove('col'); row.scrollIntoView({ block: 'nearest' }); }
    renderInspector();
    onTool(Tools.tool);
    if (opts.zoom) Render.zoomTo(id);
    if (opts.focus && !Settings.rightOpen) setSide('right', true);   // nuova entità: serve il campo nome
    if (opts.focus) { const inp = $('#inspector [data-p="name"]'); if (inp) { inp.focus(); inp.select(); } }
  }

  // ---------------------------------------------------------------- ispettore
  // Dimensione delle etichette in blocchi. Lo slider è logaritmico e dedica gran parte della corsa ai valori
  // piccoli (2–30, i più usati); il campo numerico accetta anche valori oltre il fondo scala.
  // Sotto i 20 blocchi la precisione è di mezzo blocco.
  const SIZE_MIN = 2, SIZE_MAX = 150, SIZE_FREE_MAX = 2000, SIZE_STEPS = 1000;
  const roundSize = s => s < 20 ? Math.round(s * 2) / 2 : Math.round(s);
  const sizeStep = s => s < 20 ? 0.5 : 1;
  const sizeToSlider = s => Math.round(SIZE_STEPS * Math.log(Math.min(Math.max(s, SIZE_MIN), SIZE_MAX) / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN));
  const sliderToSize = v => roundSize(SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, v / SIZE_STEPS));

  // Quadrante della rotazione: lancetta in alto = 0°, a sinistra -90°, a destra +90° (come la rotazione del
  // testo, in senso orario). Tacche ogni 5°, più marcate ogni 15° e 45°.
  function dialHtml(rot, auto) {
    const R = 46, ticks = [];
    for (let a = -90; a <= 90; a += 5) {
      const len = a % 45 === 0 ? 9 : a % 15 === 0 ? 6 : 3, t = a * Math.PI / 180, x = Math.sin(t), y = -Math.cos(t);
      ticks.push(`<line x1="${(x * R).toFixed(1)}" y1="${(y * R).toFixed(1)}" x2="${(x * (R - len)).toFixed(1)}" y2="${(y * (R - len)).toFixed(1)}"${a % 15 ? '' : ' class="maj"'}/>`);
    }
    return `<svg class="dial${auto ? ' auto' : ''}" viewBox="-60 -58 120 70" tabindex="0" role="slider" aria-label="Rotazione"
      aria-valuemin="-90" aria-valuemax="90" aria-valuenow="${rot}" data-v="${rot}">
      <path class="arc" d="M ${-R} 0 A ${R} ${R} 0 0 1 ${R} 0"/>${ticks.join('')}
      <text x="${-R}" y="10">−90</text><text x="0" y="-50">0</text><text x="${R}" y="10">+90</text>
      <g class="needle" transform="rotate(${rot})"><line x1="0" y1="5" x2="0" y2="-40"/><circle r="3.5"/></g></svg>`;
  }

  // Ispettore di una linea ferroviaria: capolinea (o "Circolare"), fermate in ordine con la progressiva e la
  // lunghezza di ogni segmento, lunghezza totale, avvisi sui capolinea
  function lineSection(f) {
    const info = Rail.lineInfo(f), st = info.stops, name = s => esc(s.station.properties.name || '—');
    const stop = (s, at, cls = '') => `<li class="stop${cls}"><button class="link" data-goto="${esc(s.station.id)}">${cls ? '↺ ' : ''}${name(s)}</button>
      <em>${nf(at / 1000, 2)} km</em></li>`;
    const seg = k => `<li class="seg">${fmtKm(info.segments[k].length)}</li>`;
    let h = `<section><h3>Fermate</h3>
      <div class="stats"><div><b>${info.ring ? 'Circolare' : st.length ? `${name(st[0])} → ${name(st.at(-1))}` : '—'}</b>
        <span>${info.ring ? 'linea' : 'capolinea'}</span></div><div><b>${st.length}</b><span>fermate</span></div></div>
      <div class="stats one"><div><b>${fmtKm(info.total)}</b><span>lunghezza totale${info.ring ? ', chiusura compresa' : ''}</span></div></div>`;
    h += info.warnings.map(w => `<p class="warn-msg">${esc(w)}</p>`).join('');
    if (st.length) {
      h += `<ol class="stops">${st.map((s, k) => (k ? seg(k - 1) : '') + stop(s, s.at)).join('')}
        ${info.ring && st.length > 1 ? seg(info.segments.length - 1) + stop(st[0], info.total + st[0].at, ' back') : ''}</ol>`;
    } else h += '<p class="muted">Nessuna fermata: clic su una stazione mentre si traccia, o posa una stazione sul binario.</p>';
    return h + '</section>';
  }

  // Ispettore di una stazione: le linee che ci fermano, con le fermate adiacenti e la distanza del segmento
  function stationSection(f) {
    const ls = Rail.stationInfo(f);
    let h = `<section><h3>Linee${ls.length > 1 ? ' <em class="tag">interscambio</em>' : ''}</h3>`;
    if (!ls.length) return h + '<p class="muted">Nessuna linea ferma qui: posa la stazione su un binario o traccia una linea che ci passi.</p></section>';
    const adj = (dir, a) => `<div><span class="dir">${dir}</span>${a
      ? `<button class="link" data-goto="${esc(a.station.id)}">${esc(a.station.properties.name || '—')}</button><em>${fmtKm(a.length)}</em>`
      : '<span class="muted">capolinea</span>'}</div>`;
    h += ls.map(({ line, prev, next }) => `<div class="sline" style="--c:${Render.colorOf(line)}">
        <div class="sline-h"><i class="sw"></i><button class="link" data-goto="${esc(line.id)}">${esc(line.properties.name || '—')}</button>
        <span class="muted">${esc(KINDS.linea.subtypes[line.properties.subtype] || '')}</span></div>
        <div class="adj">${adj('←', prev)}${adj('→', next)}</div></div>`).join('');
    return h + '</section>';
  }

  function field(label, control, cls = '') {
    return `<label class="fld ${cls}"><span class="fl">${label}</span>${control}</label>`;
  }

  function renderInspector() {
    const el = $('#insContent');
    const f = selected && Store.get(selected);
    $('#inspector').classList.toggle('is-empty', !f);
    if (!f) { el.innerHTML = inspectorOverview(); return; }
    const p = f.properties, g = f.geometry, K = KINDS[p.kind];
    const color = Render.colorOf(f);
    const k = Render.kingdomOf(f);
    const lab = p.label;
    let h = `<div class="ins-head" style="--c:${color}">
        <div class="ins-kind">${ICONS[p.kind]}<span>${esc(K.label)}${k ? ' · ' + esc(kingdomNames(f)) : ''}</span></div>
        <div class="ins-acts">
          <button class="ib" data-act="zoom" title="Centra sulla mappa (Z)">${ICONS.target}</button>
          <button class="ib danger" data-act="delete" title="Elimina (Canc)">${ICONS.trash}</button>
          <button class="ib" data-act="close" title="Chiudi (Esc)">${ICONS.close}</button>
        </div>
      </div>
      <div class="ins-body">
      <section>
        ${field('Nome', `<input type="text" data-p="name" value="${esc(p.name)}" spellcheck="false">`)}`;

    // tipo (solo tra tipi compatibili con la geometria)
    if (p.kind !== 'regno' && g) {
      const ok = KIND_ORDER.filter(x => KINDS[x].geom.includes(g.type));
      if (ok.length > 1) h += field('Tipo', `<select data-p="kind">${ok.map(x => `<option value="${x}"${x === p.kind ? ' selected' : ''}>${esc(KINDS[x].label)}</option>`).join('')}</select>`);
    }
    if (p.kind === 'protettorato') {
      // più regni proprietari: chip con × per toglierli, menu per aggiungerne
      const own = Render.kingdomsOf(f), others = kingdoms().filter(x => !own.includes(x));
      h += `<div class="fld"><span class="fl">Regni proprietari${own.length > 1 ? ' <em class="shared">condiviso</em>' : ''}</span><div class="owners">
        ${own.map(x => `<span class="owner" style="--c:${x.properties.color}"><button class="link" data-goto="${esc(x.id)}">${esc(x.properties.name)}</button>
          <button class="x" data-act="owner-remove" data-kid="${esc(x.id)}" title="Togli ${esc(x.properties.name)}">${ICONS.close}</button></span>`).join('')
          || '<span class="muted">nessun regno</span>'}</div>
        <select data-owner="add"><option value="">+ Aggiungi regno…</option>
        ${others.map(x => `<option value="${esc(x.id)}">${esc(x.properties.name)}</option>`).join('')}<option value="__new">+ Nuovo regno…</option></select></div>`;
    } else if (K.hasKingdom) {
      h += field('Regno', `<div class="kd-sel" style="--c:${k ? k.properties.color : 'transparent'}"><select data-p="kingdom">
        <option value="">— nessuno —</option>${kingdoms().map(x => `<option value="${esc(x.id)}"${x.id === p.kingdom ? ' selected' : ''}>${esc(x.properties.name)}</option>`).join('')}
        <option value="__new">+ Nuovo regno…</option></select></div>`);
    }
    // territori: la categoria (area / DMZ) dipende dalla geometria e non si sceglie
    if (K.subtypes && p.kind !== 'territorio') {
      h += field('Categoria', `<select data-p="subtype">${Object.entries(K.subtypes).map(([v, l]) => `<option value="${v}"${v === p.subtype ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
    }
    if (p.kind === 'regno') {
      h += field('Colore', `<div class="colors"><input type="color" data-p="color" value="${p.color}">
        ${PALETTE.map(c => `<button class="chip" data-color="${c}" style="--c:${c}" title="${c}"></button>`).join('')}</div>`);
    } else if (!K.hasKingdom || !k) {
      h += field('Colore', `<div class="colors"><input type="color" data-p="color" value="${color}">
        ${p.color ? `<button class="link" data-act="color-auto">automatico</button>` : '<span class="muted">automatico</span>'}</div>`);
    }
    if (p.subtype === 'dmz') {
      const m = p.margin || 0;
      h += `<div class="fld"><span class="fl">Margine <em id="dmzWidth">${m ? `fascia larga ${nf(2 * m)} blocchi` : 'solo la linea'}</em></span>
        <div class="rng"><input type="number" class="num" data-m="margin" min="0" max="5000" step="1" value="${m}">
        <span class="muted">blocchi per lato</span></div></div>`;
    }
    h += '</section>';

    // regno: riepilogo marche
    if (p.kind === 'regno') {
      const ms = members(p.id).sort(byName), pr = members(p.id, 'protettorato'), lc = members(p.id, 'localita');
      const area = ms.reduce((s, m) => s + Geo.area(m.geometry), 0);
      h += `<section><h3>Domini</h3>
        <div class="stats"><div><b>${ms.length}</b><span>marche</span></div><div><b>${pr.length}</b><span>protettorati</span></div>
        <div><b>${lc.length}</b><span>località</span></div><div><b>${area ? fmtArea(area) : '—'}</b><span>superficie</span></div></div>
        <div class="chips">${[...ms, ...pr].map(m => `<button class="mchip" data-goto="${esc(m.id)}" style="--c:${p.color}">${esc(m.properties.name)}${m.properties.kind === 'protettorato' ? ' <em>prot.</em>' : ''}</button>`).join('')}</div>
        <button class="btn" data-act="draw-marca">${ICONS.freehand}<span>Disegna una nuova marca</span></button>
      </section>`;
    }

    // etichetta (il regno non ne ha una propria: compare sotto le sue marche)
    const auto = lab.size == null, size = lab.size || roundSize(Render.autoSize(f));
    const rotAuto = lab.rotation == null;
    if (p.kind !== 'regno') {
    h += `<section><h3>Etichetta</h3>
      <label class="chk"><input type="checkbox" data-l="show"${lab.show !== false ? ' checked' : ''}> Mostra il nome sulla mappa</label>
      ${K.hasKingdom ? `<label class="chk"><input type="checkbox" data-l="showKingdom"${lab.showKingdom !== false ? ' checked' : ''}> Mostra il regno tra parentesi</label>` : ''}
      <div class="fld"><span class="fl">Dimensione <em>blocchi</em></span>
        <div class="rng"><input type="range" min="0" max="${SIZE_STEPS}" data-l="size" value="${sizeToSlider(size)}">
        <input type="number" class="num" data-l="sizeNum" min="${SIZE_MIN}" max="${SIZE_FREE_MAX}" step="${sizeStep(size)}" value="${size}">
        <label class="mini"><input type="checkbox" data-l="sizeAuto"${auto ? ' checked' : ''}> auto</label></div></div>`;
    if (Geo.isLine(g)) {
      // copie del nome distribuite lungo la linea: automatiche (in base alla lunghezza) o da 1 a 10
      const repAuto = lab.repeat == null, rep = repAuto ? Render.autoRepeat(f) : lab.repeat;
      h += `<div class="fld"><span class="fl">Ripetizioni del nome <em>${repAuto ? 'auto' : ''}</em></span>
        <div class="rng"><input type="number" class="num" data-l="repeat" min="1" max="10" step="1" value="${rep}">
        <span class="muted">da 1 a 10</span>
        <label class="mini"><input type="checkbox" data-l="repeatAuto"${repAuto ? ' checked' : ''}> auto</label></div></div>`;
    }
    if (!K.pointLabel) {
      h += `<div class="fld"><span class="fl">Rotazione <em id="rotVal">${rotAuto ? 'auto' : lab.rotation + '°'}</em></span>
        <div class="rot">${dialHtml(lab.rotation || 0, rotAuto)}
        <label class="mini"><input type="checkbox" data-l="rotAuto"${rotAuto ? ' checked' : ''}> auto</label></div></div>`;
    } else {
      h += field('Posizione del nome', `<select data-l="anchor">${[['right', 'a destra'], ['left', 'a sinistra'], ['top', 'sopra'], ['bottom', 'sotto']]
        .map(([v, l]) => `<option value="${v}"${(lab.anchor || 'right') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`);
    }
    if (!(g && g.type === 'Point')) {
      h += `<div class="row-btns"><span class="muted">${lab.pos ? 'Posizione manuale' : 'Posizione automatica'} — trascina l'etichetta sulla mappa</span>
        ${lab.pos ? `<button class="link" data-act="label-reset">${ICONS.reset} reimposta</button>` : ''}</div>`;
    }
    h += '</section>';
    }

    // ferrovie: fermate di una linea, linee di una stazione
    if (p.kind === 'linea' && g?.type === 'LineString') h += lineSection(f);
    if (p.kind === 'stazione' && g) h += stationSection(f);

    // geometria
    if (g) {
      h += '<section><h3>Geometria</h3>';
      if (Geo.isPoly(g)) {
        const parts = Geo.polygons(g).length;
        h += `<div class="stats"><div><b>${fmtArea(Geo.area(g))}</b><span>superficie</span></div>
          <div><b>${fmtLen(Geo.length(g))}</b><span>perimetro</span></div>
          <div><b>${nf(Geo.countVertices(g))}</b><span>vertici</span></div><div><b>${parts}</b><span>${parts === 1 ? 'parte' : 'parti'}</span></div></div>
          <div class="btn-grid">
            <button class="btn" data-act="add" title="Pennello (B)">${ICONS.add}<span>Aggiungi area</span></button>
            <button class="btn" data-act="sub" title="Gomma (E)">${ICONS.sub}<span>Togli area</span></button>
            <button class="btn" data-act="redraw" title="Ridisegna (R)">${ICONS.redraw}<span>Ridisegna</span></button>
            ${parts > 1 ? `<button class="btn" data-act="explode">${ICONS.split}<span>Separa parti</span></button>` : ''}
          </div>`;
      } else if (Geo.isLine(g)) {
        h += `<div class="stats"><div><b>${fmtLen(Geo.length(g))}</b><span>lunghezza</span></div><div><b>${nf(Geo.countVertices(g))}</b><span>vertici</span></div></div>`;
      } else {
        h += `<div class="xz">${field('X', `<input type="number" data-c="0" value="${g.coordinates[0]}">`)}${field('Z', `<input type="number" data-c="1" value="${g.coordinates[1]}">`)}</div>
          <p class="muted">Trascina il punto sulla mappa per spostarlo.</p>`;
      }
      // niente Semplifica sulle linee ferroviarie: toglierebbe vertici-fermata, staccando le stazioni
      if (g.type !== 'Point' && p.kind !== 'linea') {
        h += `<div class="simp"><button class="btn" data-act="simplify">${ICONS.simplify}<span>Semplifica</span></button>
          <label class="mini">tolleranza <input type="number" min="0.5" max="50" step="0.5" data-s="simplify" value="${Settings.simplify}"> blocchi</label></div>`;
      }
      h += '</section>';
    } else if (p.kind !== 'regno') {
      h += `<section><h3>Geometria</h3><p class="muted">Questa entità non ha ancora una geometria.</p></section>`;
    }

    h += `<section><h3>Note</h3><textarea data-p="notes" rows="3" placeholder="Storia, informazioni, fonti…">${esc(p.notes || '')}</textarea>
      <p class="muted id">id: ${esc(p.id)}</p></section></div>`;
    el.innerHTML = h;
  }

  function inspectorOverview() {
    const counts = KIND_ORDER.map(k => `<div><b>${Store.all(k).length}</b><span>${esc(KINDS[k].plural.toLowerCase())}</span></div>`).join('');
    const keys = [['V', 'Seleziona e modifica confini'], ['F', 'Area a mano libera'], ['P', 'Area per punti'], ['L', 'Fiume a mano libera'], ['D', 'Linea per punti (DMZ)'],
      ['K', 'Punto (località, stazione)'], ['B', 'Pennello: aggiungi area'], ['E', 'Gomma: togli area'], ['R', 'Ridisegna confine'],
      ['Spazio', 'Tieni premuto per spostare la mappa'], ['Esc', 'Annulla / deseleziona'], ['Canc', 'Elimina la selezione'],
      ['Z', 'Centra la selezione'], ['G', 'Griglia dei chunk'], ['[ / ]', 'Chiudi / apri i pannelli laterali'], ['Ctrl+Z / Ctrl+Y', 'Annulla / ripeti'], ['Ctrl+S', 'Salva'], ['Ctrl+K', 'Cerca'], ['1 – 9', 'Cambia pannello']];
    return `<div class="ins-head plain"><div class="ins-kind"><span>Nessuna selezione</span></div></div>
      <div class="ins-body"><section><h3>La mappa</h3><div class="stats">${counts}</div></section>
      <section><h3>Come si usa</h3><p class="muted">Passa col mouse sulla mappa per evidenziare le entità, clicca per selezionarle:
      compaiono i vertici del confine, che puoi trascinare. Con <b>Confini collegati</b> attivo, i vertici in comune con le marche vicine si spostano insieme.</p>
      <dl class="keys">${keys.map(([k, d]) => `<dt><kbd>${k}</kbd></dt><dd>${d}</dd>`).join('')}</dl></section></div>`;
  }

  function bindInspector() {
    const el = $('#inspector');
    const cur = () => selected;
    const upd = (fn, opts) => { quiet = !!opts?.quiet; Edit.update(cur(), fn, opts); quiet = false; };

    el.addEventListener('change', e => {
      const t = e.target, id = cur();
      if (!id) return;
      if (t.dataset.p) {
        const prop = t.dataset.p, v = t.value;
        if (prop === 'kingdom' && v === '__new') {
          const kid = Edit.createKingdom();
          Edit.setKingdom([id], kid);
          select(kid, { focus: true });
          toast('Regno creato: dagli un nome e un colore');
          return;
        }
        upd(p => {
          if (prop === 'name') p.name = v.trim() || p.name;
          else if (prop === 'kind') { p.kind = v; if (!KINDS[v].hasKingdom) p.kingdom = null; Model.fitProps(p, Store.get(id).geometry); }
          else if (prop === 'kingdom') p.kingdom = v || null;
          else if (prop === 'notes') p.notes = v;
          else p[prop] = v;
        }, { label: { name: 'Rinomina', kind: 'Cambia tipo', kingdom: 'Assegna regno', color: 'Colore', subtype: 'Categoria', notes: 'Note' }[prop] });
        if (prop === 'kind') showPanel(v);
      } else if (t.dataset.owner) {
        const v = t.value;
        if (v === '__new') {
          const kid = Edit.createKingdom();
          Edit.addKingdom(id, kid);
          select(kid, { focus: true });
          toast('Regno creato: dagli un nome e un colore');
        } else if (v) Edit.addKingdom(id, v);
      } else if (t.dataset.m) {
        // a fine digitazione: margine intero e non negativo
        const m = Math.max(0, Math.round(+t.value || 0));
        t.value = m;
        setMargin(m);
      } else if (t.dataset.l) {
        const l = t.dataset.l;
        if (l === 'size') return;   // già applicata durante il trascinamento (evento input)
        if (l === 'repeat') {
          // a fine digitazione: intero da 1 a 10
          const n = Math.min(10, Math.max(1, Math.round(+t.value) || 1));
          t.value = n;
          setRepeat(n);
          return;
        }
        if (l === 'sizeNum') {
          // a fine digitazione: valore riportato nei limiti e arrotondato
          const s = roundSize(Math.min(Math.max(+t.value || SIZE_MIN, SIZE_MIN), SIZE_FREE_MAX));
          setSizeFields(s);
          upd(p => { p.label.size = s; }, { quiet: true, source: 'edit', coalesce: 'size:' + id, label: 'Dimensione etichetta' });
          return;
        }
        upd(p => {
          if (l === 'show' || l === 'showKingdom') p.label[l] = t.checked;
          else if (l === 'sizeAuto') p.label.size = t.checked ? null : roundSize(Render.autoSize(Store.get(id)));
          else if (l === 'rotAuto') p.label.rotation = t.checked ? null : 0;
          else if (l === 'repeatAuto') { p.label.repeat = t.checked ? null : Render.autoRepeat(Store.get(id)); if (!t.checked) p.label.pos = null; }
          else if (l === 'anchor') p.label.anchor = t.value;
        }, { label: 'Etichetta' });
      } else if (t.dataset.c) {
        const f = Store.get(id), c = f.geometry.coordinates.slice();
        c[+t.dataset.c] = Geo.r1(+t.value || 0);
        Edit.movePoint(id, c);   // una stazione porta con sé le linee che ci fermano
      } else if (t.dataset.s === 'simplify') {
        Settings.simplify = Math.max(0.5, +t.value || 2); Settings.save();
      }
    });

    // Slider e campo numerico della dimensione mostrano lo stesso valore; quello che si sta usando non si tocca
    function setSizeFields(s, except) {
      const rng = el.querySelector('[data-l="size"]'), num = el.querySelector('[data-l="sizeNum"]');
      if (rng && rng !== except) rng.value = sizeToSlider(s);
      if (num) { if (num !== except) num.value = s; num.step = sizeStep(s); }
      const auto = el.querySelector('[data-l="sizeAuto"]'); if (auto) auto.checked = false;
    }

    // ripetizioni del nome su una linea: un numero fisso toglie l'eventuale posizione manuale (altrimenti
    // resterebbe una sola copia); se c'era, si ridisegna l'ispettore per aggiornare "Posizione manuale"
    function setRepeat(n) {
      const id = cur(), hadPos = !!Store.get(id)?.properties.label.pos;
      const auto = el.querySelector('[data-l="repeatAuto"]'); if (auto) auto.checked = false;
      upd(p => { p.label.repeat = n; p.label.pos = null; },
        { quiet: !hadPos, source: 'edit', coalesce: 'repeat:' + id, label: 'Ripetizioni del nome' });
    }

    // margine della DMZ: la fascia si aggiorna mentre si cambia il valore, un solo passo di annullamento
    function setMargin(m) {
      const id = cur();
      $('#dmzWidth').textContent = m ? `fascia larga ${nf(2 * m)} blocchi` : 'solo la linea';
      upd(p => { p.margin = m; }, { quiet: true, source: 'edit', coalesce: 'margin:' + id, label: 'Margine DMZ' });
    }

    // cursori e campo della dimensione: anteprima dal vivo, un solo passo di annullamento
    el.addEventListener('input', e => {
      const t = e.target, id = cur();
      if (id && t.dataset.m) { const m = +t.value; if (t.value !== '' && m >= 0) setMargin(Math.round(m)); return; }
      if (id && t.dataset.l === 'repeat') { const n = +t.value; if (Number.isInteger(n) && n >= 1 && n <= 10) setRepeat(n); return; }
      if (!id || (t.type !== 'range' && t.dataset.l !== 'sizeNum')) return;
      if (t.dataset.l === 'size' || t.dataset.l === 'sizeNum') {
        const v = +t.value;
        if (t.type !== 'range' && !(v >= SIZE_MIN && v <= SIZE_FREE_MAX)) return;   // numero ancora incompleto
        const s = t.type === 'range' ? sliderToSize(v) : roundSize(v);
        setSizeFields(s, t);
        upd(p => { p.label.size = s; }, { quiet: true, source: 'edit', coalesce: 'size:' + id, label: 'Dimensione etichetta' });
      }
    });

    // quadrante della rotazione: clic o trascinamento sulla lancetta (Shift: scatti di 15°), frecce da tastiera
    function setRotation(dial, a) {
      a = Math.max(-90, Math.min(90, a));
      if (+dial.dataset.v === a && !dial.classList.contains('auto')) return;
      dial.dataset.v = a;
      dial.setAttribute('aria-valuenow', a);
      dial.querySelector('.needle').setAttribute('transform', `rotate(${a})`);
      dial.classList.remove('auto');
      $('#rotVal').textContent = `${a}°`;
      const auto = el.querySelector('[data-l="rotAuto"]'); if (auto) auto.checked = false;
      upd(p => { p.label.rotation = a; }, { quiet: true, source: 'edit', coalesce: 'rot:' + cur(), label: 'Rotazione etichetta' });
    }
    function dialAngle(dial, e) {
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(dial.getScreenCTM().inverse());
      const a = Math.atan2(p.x, -p.y) * 180 / Math.PI;   // sotto il centro: si ferma a ±90°
      return e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a);
    }
    el.addEventListener('pointerdown', e => {
      const dial = e.target.closest('.dial');
      if (!dial || !cur() || e.button !== 0) return;
      e.preventDefault();
      dial.focus();
      dial.setPointerCapture(e.pointerId);
      const move = ev => setRotation(dial, dialAngle(dial, ev));
      move(e);
      dial.onpointermove = move;
      dial.onpointerup = dial.onpointercancel = () => { dial.onpointermove = dial.onpointerup = dial.onpointercancel = null; };
    });
    el.addEventListener('dblclick', e => { const dial = e.target.closest('.dial'); if (dial && cur()) setRotation(dial, 0); });

    el.addEventListener('keydown', e => {
      const dial = e.target.closest?.('.dial');
      if (dial && cur()) {
        const v = +dial.dataset.v, step = e.shiftKey ? 15 : 1;
        const next = { ArrowLeft: v - step, ArrowDown: v - step, ArrowRight: v + step, ArrowUp: v + step, Home: -90, End: 90, 0: 0 }[e.key];
        if (next !== undefined) { e.preventDefault(); e.stopPropagation(); setRotation(dial, next); return; }
      }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
      if (e.key === 'Escape') e.target.blur();
    });

    el.addEventListener('click', e => {
      const id = cur();
      const go = e.target.closest('[data-goto]');
      if (go) { select(go.dataset.goto, { zoom: true }); return; }
      const chip = e.target.closest('.chip[data-color]');
      if (chip && id) { Edit.update(id, p => { p.color = chip.dataset.color; }, { label: 'Colore del regno' }); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      switch (b.dataset.act) {
        case 'zoom': Render.zoomTo(id); break;
        case 'close': select(null); break;
        case 'delete': removeSelected(); break;
        case 'color-auto': Edit.update(id, p => { p.color = null; }, { label: 'Colore' }); break;
        case 'label-reset': Edit.update(id, p => { p.label.pos = null; }, { label: 'Reimposta etichetta' }); break;
        case 'owner-remove': Edit.removeKingdom(id, b.dataset.kid); break;
        case 'add': case 'sub': case 'redraw': Tools.set(b.dataset.act); break;
        case 'simplify': {
          const n = Edit.simplify(id, Settings.simplify);
          toast(n > 0 ? `Rimossi ${nf(n)} vertici` : 'Nessun vertice da rimuovere con questa tolleranza');
          break;
        }
        case 'explode': {
          const ids = Edit.explode(id);
          toast(`Separata in ${ids.length} entità`, 'ok');
          break;
        }
        case 'draw-marca': drawFor(id); break;
      }
    });
  }

  function removeSelected() {
    const f = selected && Store.get(selected);
    if (!f) return;
    const p = f.properties;
    if (p.kind === 'regno') {
      const n = members(p.id).length + members(p.id, 'protettorato').length + members(p.id, 'localita').length;
      if (n && !confirm(`Eliminare il regno «${p.name}»? Le sue ${n} entità resteranno senza regno.`)) return;
    }
    Edit.remove(p.id);
    select(null);
    toast(`Eliminato: ${p.name}`, 'info', { label: 'Annulla', fn: () => command('undo') });
  }

  // ---------------------------------------------------------------- mappa: hover, stato
  function bindMap(map) {
    const chip = $('#hoverChip');
    let hoverId = null;
    Render.hooks.hover = (id, ev) => {
      if (id !== undefined && ev === null) {
        hoverId = id;
        if (!id) { chip.classList.remove('on'); return; }
        const f = Store.get(id);
        if (!f) return;
        const p = f.properties, k = kingdomNames(f), g = f.geometry;
        const extra = Geo.isPoly(g) ? fmtArea(Geo.area(g)) : Geo.isLine(g) ? fmtLen(Geo.length(g)) : (p.subtype && KINDS[p.kind].subtypes?.[p.subtype]) || '';
        chip.innerHTML = `<i class="sw" style="--c:${Render.colorOf(f)}"></i><b>${esc(p.name || '—')}</b>
          <span>${esc(KINDS[p.kind].label)}${k ? ' di ' + esc(k) : ''}${extra ? ' · ' + esc(extra) : ''}</span>`;
        chip.classList.add('on');
      }
      if (ev && hoverId) {
        const r = map.getContainer().getBoundingClientRect();
        chip.style.transform = `translate(${ev.clientX - r.left + 16}px, ${ev.clientY - r.top + 18}px)`;
      }
    };
    Render.hooks.click = id => { if (Tools.tool === 'select' || id === null) select(id); };
    Render.hooks.vertexDragStart = Edit.vertexDragStart;
    Render.hooks.vertexDragEnd = Edit.vertexDragEnd;
    Render.hooks.edited = Edit.geometryEdited;
    Render.hooks.moved = Edit.labelMoved;

    map.on('mousemove', e => {
      const x = Math.floor(e.latlng.lng), z = Math.floor(-e.latlng.lat), c = Overlays.CHUNK;
      $('#stCoords').textContent = `X ${x}   Z ${z}   ·   chunk ${Math.floor(x / c)}, ${Math.floor(z / c)}`;
    });
    map.on('mouseout', () => chip.classList.remove('on'));
    const zoomInfo = () => {
      const z = map.getZoom(), bpp = Math.pow(2, -z);
      $('#stZoom').textContent = `Zoom ${z} · 1 px = ${bpp >= 1 ? nf(bpp, 1) + (bpp === 1 ? ' blocco' : ' blocchi') : '1/' + nf(1 / bpp) + ' di blocco'}`;
    };
    map.on('zoomend', zoomInfo);
    zoomInfo();

    const grid = $('#optGrid');
    grid.checked = Settings.grid;
    grid.addEventListener('change', () => { Settings.grid = grid.checked; Settings.save(); Overlays.setGrid(grid.checked); grid.blur(); });

    // Filtro dello sfondo: preferenza del browser, non va nel file
    const bgFx = [[$('#optBright'), 'bgBrightness'], [$('#optSat'), 'bgSaturation']];
    const applyBg = () => {
      bgFx.forEach(([el, key]) => { el.value = Settings[key]; el.nextElementSibling.textContent = Settings[key] + '%'; });
      Basemap.setFilter(map, Settings.bgBrightness, Settings.bgSaturation);
    };
    bgFx.forEach(([el, key]) => {
      el.addEventListener('input', () => { Settings[key] = +el.value; applyBg(); });
      el.addEventListener('change', () => { Settings.save(); el.blur(); });
      el.addEventListener('dblclick', () => { Settings[key] = 100; applyBg(); Settings.save(); });
    });
    applyBg();

    const zones = $('#zones');
    zones.innerHTML = '<option value="">Vai a una zona…</option>' + Basemap.clusters()
      .map(c => `<option value="${c.x},${c.z}">${c.x}, ${c.z} (${c.n} regioni)</option>`).join('');
    zones.onchange = () => {
      if (!zones.value) return;
      const [x, z] = zones.value.split(',').map(Number);
      map.setView(Geo.ll([x, z]), -2);
      zones.value = '';
    };
  }

  function updateCounts() {
    const n = Store.all().length;
    $('#stCounts').textContent = `${n} ${n === 1 ? 'entità' : 'entità'}`;
  }

  // ---------------------------------------------------------------- scorciatoie
  function bindKeys() {
    const TOOLKEYS = { v: 'select', f: 'freehand', p: 'polygon', l: 'line', d: 'polyline', k: 'point', b: 'add', e: 'sub', r: 'redraw' };
    document.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (mod && key === 's') { e.preventDefault(); command(e.shiftKey ? 'saveas' : 'save'); return; }
      if (mod && key === 'k') { e.preventDefault(); $('#search').focus(); return; }
      if (typing(e)) return;
      if (mod && key === 'z') { e.preventDefault(); command(e.shiftKey ? 'redo' : 'undo'); return; }
      if (mod && key === 'y') { e.preventDefault(); command('redo'); return; }
      if (mod && key === 'o') { e.preventDefault(); command('open'); return; }
      if (mod || e.altKey) return;
      if (e.key === 'Escape') { closeMenu(); if (!Tools.escape()) select(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
      if (e.key === 'Enter') { Tools.finishPolygon(); return; }
      if (e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
      if (key === 'z' && selected) { Render.zoomTo(selected); return; }
      if (key === 'g') { $('#optGrid').click(); return; }
      if (e.key === '[') { setSide('left', !Settings.leftOpen); return; }
      if (e.key === ']') { setSide('right', !Settings.rightOpen); return; }
      if (TOOLKEYS[key]) { Tools.set(TOOLKEYS[key]); return; }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= PANELS.length) showPanel(PANELS[n - 1].id);
    });
  }

  function bindDrop() {
    window.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); document.body.classList.add('file-over'); } });
    window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('file-over'); });
    window.addEventListener('drop', async e => {
      document.body.classList.remove('file-over');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      e.preventDefault();
      if (Store.dirty && !confirm('Ci sono modifiche non salvate. Aprire comunque il file?')) return;
      try { await IO.openFile(file); select(null); toast(`Aperto ${file.name}`, 'ok'); } catch (err) { toast(err.message, 'error'); }
    });
    window.addEventListener('beforeunload', e => { if (Store.dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  // ---------------------------------------------------------------- avvio
  function init(map) {
    buildTopbar();
    buildSearch();
    buildRail();
    buildToolstrip();
    bindPanel();
    bindInspector();
    bindMap(map);
    bindSides(map);
    bindKeys();
    bindDrop();
    showPanel(panel);
    renderInspector();

    Store.on('change', () => {
      queueList();
      if (!quiet) renderInspector();
      renderToolstrip();
      updateFileInfo();
      updateCounts();
      IO.scheduleDraft();
    });
    Store.on('reset', () => {
      selected = null;
      showPanel(panel);
      renderInspector();
      renderToolstrip();
      updateFileInfo();
      updateCounts();
    });
  }

  return {
    init, select, toast, onTool, typing, showPanel,
    get selected() { return selected; }
  };
})();
