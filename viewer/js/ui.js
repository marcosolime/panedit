// Interfaccia: barra superiore, pannelli per tipo di entità, ispettore, barra strumenti, stato.
const UI = (() => {
  let selected = null, panel = 'marca', quiet = false, listQueued = false;
  const filters = {}, collapsed = new Set();
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => Render.esc(s);
  const nf = (v, d = 0) => v.toLocaleString('it-IT', { maximumFractionDigits: d });
  const fmtArea = a => a >= 1e5 ? `${nf(a / 1e6, 2)} km²` : `${nf(Math.round(a))} blocchi²`;
  const fmtLen = l => l >= 1000 ? `${nf(l / 1000, 2)} km` : `${nf(Math.round(l))} blocchi`;
  const typing = e => {
    const t = e.target;
    return !!t && (t.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !/^(range|checkbox|color|button)$/.test(t.type)));
  };
  const byName = (a, b) => (a.properties.name || '').localeCompare(b.properties.name || '', 'it');
  const kingdoms = () => Store.all('regno').sort(byName);
  const members = (kid, kind = 'marca') => Store.all(kind).filter(f => f.properties.kingdom === kid);
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
        <span>${esc(KINDS[f.properties.kind].label)}${Render.kingdomOf(f) ? ' · ' + esc(Render.kingdomOf(f).properties.name) : ''}</span></div>`).join('')
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

  // ---------------------------------------------------------------- barra laterale (tipi)
  function buildRail() {
    $('#rail').innerHTML = KIND_ORDER.map((k, i) => `<button class="rail-btn" data-kind="${k}" title="${KINDS[k].plural} (${i + 1})">
      ${ICONS[k]}<span>${KINDS[k].plural}</span><b class="badge"></b></button>`).join('');
    // pannello chiuso: il clic apre quel tipo; clic sul tipo già aperto: chiude il pannello
    $('#rail').addEventListener('click', e => {
      const b = e.target.closest('[data-kind]');
      if (!b) return;
      if (b.dataset.kind === panel && Settings.leftOpen) { setSide('left', false); return; }
      showPanel(b.dataset.kind);
      setSide('left', true);
    });
  }
  function updateRail() {
    document.querySelectorAll('.rail-btn').forEach(b => {
      const k = b.dataset.kind;
      b.classList.toggle('active', k === panel);
      b.classList.toggle('hidden-kind', Render.state.hidden.has(k));
      b.querySelector('.badge').textContent = Store.all(k).length || '';
    });
  }

  function showPanel(k) {
    panel = k;
    const K = KINDS[k];
    const lockable = k !== 'regno';
    $('#panel').innerHTML = `
      <div class="ph">
        <div class="ph-title">${ICONS[k]}<h2>${K.plural}</h2><span class="count" id="phCount"></span></div>
        <div class="ph-tools">
          <button class="ib" data-act="vis" id="phVis"></button>
          ${lockable ? '<button class="ib" data-act="lock" id="phLock"></button>' : ''}
        </div>
      </div>
      <p class="ph-desc">${esc(DESCRIPTIONS[k])}</p>
      <button class="btn-new" data-act="new">${ICONS.plus}<span>${esc(K.article)}</span></button>
      <div class="filter">${ICONS.search}<input type="search" id="phFilter" placeholder="Filtra ${K.plural.toLowerCase()}…" value="${esc(filters[k] || '')}"></div>
      <div class="list" id="phList"></div>`;
    $('#phFilter').addEventListener('input', e => { filters[k] = e.target.value; renderList(); });
    renderList();
    updateRail();
  }

  const DESCRIPTIONS = {
    regno: 'Ogni regno ha un colore; la sua estensione è data dalle marche che gli appartengono.',
    marca: 'Suddivisioni dei regni con nome e confini definiti. Trascina una marca su un regno per assegnarla.',
    protettorato: 'Territori sotto sovranità di un regno ma non incorporati: confini indicativi, tratteggiati.',
    territorio: 'Aree non incorporate in alcun regno, dai confini indefiniti (bordo sfumato).',
    regione: 'Aree con caratteri naturali omogenei (es. pianure di Veld).',
    continente: 'Grandi masse di terra riconoscibili sulla mappa.',
    acqua: 'Fiumi (linee), laghi e mari (aree) oppure solo il nome (punto).',
    localita: 'Città, villaggi e luoghi: oggetti puntiformi con nome.'
  };

  function rowHtml(f, sw) {
    const p = f.properties, g = f.geometry;
    let meta = '';
    if (!g && p.kind !== 'regno') meta = '<span class="meta warn">senza geometria</span>';
    else if (Geo.isPoly(g)) meta = `<span class="meta">${fmtArea(Geo.area(g))}</span>`;
    else if (Geo.isLine(g)) meta = `<span class="meta">${fmtLen(Geo.length(g))}</span>`;
    else if (p.subtype && KINDS[p.kind].subtypes) meta = `<span class="meta">${esc(KINDS[p.kind].subtypes[p.subtype] || p.subtype)}</span>`;
    const drag = KINDS[p.kind].hasKingdom ? ' draggable="true"' : '';
    return `<div class="row${p.id === selected ? ' sel' : ''}" data-id="${esc(p.id)}"${drag}>
      <i class="sw" style="--c:${sw || Render.colorOf(f)}"></i><span class="nm">${esc(p.name || '—')}</span>${meta}</div>`;
  }

  function renderList() {
    listQueued = false;
    const box = $('#phList');
    if (!box) return;
    const k = panel, q = (filters[k] || '').trim().toLowerCase();
    const match = f => !q || (f.properties.name || '').toLowerCase().includes(q);
    const all = Store.all(k).sort(byName);
    const shown = all.filter(match);
    $('#phCount').textContent = all.length;
    const hidden = Render.state.hidden.has(k), locked = Render.state.locked.has(k);
    $('#phVis').innerHTML = hidden ? ICONS.eyeOff : ICONS.eye;
    $('#phVis').title = hidden ? 'Mostra sulla mappa' : 'Nascondi dalla mappa';
    $('#phVis').classList.toggle('off', hidden);
    if ($('#phLock')) {
      $('#phLock').innerHTML = locked ? ICONS.lock : ICONS.unlock;
      $('#phLock').title = locked ? 'Sblocca (rendi selezionabili sulla mappa)' : 'Blocca (non selezionabili sulla mappa)';
      $('#phLock').classList.toggle('off', locked);
    }

    let html = '';
    if (k === 'regno') {
      html = shown.map(f => {
        const p = f.properties, ms = members(f.id), a = ms.reduce((s, m) => s + Geo.area(m.geometry), 0);
        return `<div class="row k-row${p.id === selected ? ' sel' : ''}" data-id="${esc(p.id)}">
          <label class="sw big" style="--c:${p.color}" title="Cambia colore"><input type="color" value="${p.color}" data-color="${esc(p.id)}"></label>
          <div class="nm"><b>${esc(p.name || '—')}</b><span>${ms.length} ${ms.length === 1 ? 'marca' : 'marche'}${a ? ' · ' + fmtArea(a) : ''}</span></div>
          <button class="ib sm" data-act="draw-marca" data-kid="${esc(p.id)}" title="Disegna una nuova marca di ${esc(p.name)}">${ICONS.plus}</button></div>`;
      }).join('');
    } else if (KINDS[k].hasKingdom) {
      const groups = [...kingdoms().map(kf => ({ id: kf.id, name: kf.properties.name, color: kf.properties.color })), { id: '', name: 'Senza regno', color: '#6b7178' }];
      html = groups.map(gr => {
        const rows = shown.filter(f => (f.properties.kingdom || '') === gr.id);
        if (!rows.length && (q || k === 'localita' || !gr.id)) return '';
        const isCol = collapsed.has(k + gr.id);
        return `<div class="grp${isCol ? ' col' : ''}" data-kingdom="${esc(gr.id)}">
          <div class="grp-h" data-grp="${esc(gr.id)}"><i class="sw" style="--c:${gr.color}"></i><span>${esc(gr.name)}</span><em>${rows.length}</em></div>
          <div class="grp-b">${rows.map(f => rowHtml(f)).join('') || '<div class="drop-hint">Trascina qui</div>'}</div></div>`;
      }).join('');
    } else if (KINDS[k].subtypes) {
      const subs = Object.entries(KINDS[k].subtypes);
      html = subs.map(([sk, sl]) => {
        const rows = shown.filter(f => f.properties.subtype === sk);
        return rows.length ? `<div class="grp"><div class="grp-h plain"><span>${esc(sl)}</span><em>${rows.length}</em></div><div class="grp-b">${rows.map(f => rowHtml(f)).join('')}</div></div>` : '';
      }).join('') + (() => {
        const rest = shown.filter(f => !KINDS[k].subtypes[f.properties.subtype]);
        return rest.length ? `<div class="grp"><div class="grp-h plain"><span>Altro</span><em>${rest.length}</em></div><div class="grp-b">${rest.map(f => rowHtml(f)).join('')}</div></div>` : '';
      })();
    } else {
      html = shown.map(f => rowHtml(f)).join('');
    }
    box.innerHTML = html || `<div class="empty">${q ? 'Nessun risultato' : `Nessun${k === 'regno' || k === 'territorio' || k === 'continente' ? ' ' : 'a '}${KINDS[k].label.toLowerCase()} — usa il pulsante qui sopra per crearne ${k === 'regno' || k === 'territorio' || k === 'continente' ? 'uno' : 'una'}.`}</div>`;
  }
  const queueList = () => { if (!listQueued) { listQueued = true; requestAnimationFrame(() => { renderList(); updateRail(); }); } };

  function bindPanel() {
    const el = $('#panel');
    el.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'vis') { Render.setHidden(panel, !Render.state.hidden.has(panel)); renderList(); updateRail(); }
        else if (a === 'lock') { Render.setLocked(panel, !Render.state.locked.has(panel)); renderList(); }
        else if (a === 'new') newEntity(panel, act);
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
      if (f && (f.properties.kingdom || null) !== kid) {
        Edit.setKingdom([id], kid);
        toast(`«${f.properties.name}» ${kid ? 'assegnata a ' + Store.get(kid).properties.name : 'ora senza regno'}`, 'ok');
      }
    });
    const clearDrop = () => el.querySelectorAll('.grp.drop').forEach(g => g.classList.remove('drop'));
  }

  // ---------------------------------------------------------------- creazione
  function newEntity(k, anchor) {
    if (k === 'regno') {
      const id = Edit.createKingdom();
      select(id, { focus: true });
      return;
    }
    Settings.target = k; Settings.save();
    renderToolstrip();
    const geoms = KINDS[k].geom;
    const opts = [];
    if (geoms.includes('Polygon')) opts.push(['freehand', 'Area a mano libera', 'F'], ['polygon', 'Area per punti', 'P']);
    if (geoms.includes('LineString')) opts.push(['line', 'Linea a mano libera (fiume)', 'L']);
    if (geoms.includes('Point')) opts.push(['point', k === 'localita' ? 'Punto sulla mappa' : 'Solo il nome (punto)', 'K']);
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
    const tools = ['select', 'freehand', 'polygon', 'line', 'point', null, 'add', 'sub', 'redraw'];
    $('#tsTools').innerHTML = tools.map(t => t ? `<button class="tool" data-tool="${t}" title="${esc(Tools.META[t].name)} (${Tools.META[t].key})">${ICONS[t]}</button>` : '<span class="ts-sep"></span>').join('');
    $('#tsTools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) Tools.set(b.dataset.tool); });
    $('#optTarget').innerHTML = KIND_ORDER.filter(k => k !== 'regno').map(k => `<option value="${k}">${esc(KINDS[k].label)}</option>`).join('');
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
    $('#optSnap').innerHTML = ICONS.magnet + '<span>Aggancio</span>';
    $('#optLink').innerHTML = ICONS.link + '<span>Confini collegati</span>';
    $('#optSnap').addEventListener('click', () => { Settings.snap = !Settings.snap; Settings.save(); renderToolstrip(); Render.setEditing(Tools.tool === 'select'); });
    $('#optLink').addEventListener('click', () => { Settings.link = !Settings.link; Settings.save(); renderToolstrip(); });
    // restituisce il focus alla mappa, così le scorciatoie da tastiera funzionano subito
    $('#toolstrip').addEventListener('change', e => { if (e.target.tagName === 'SELECT') e.target.blur(); });
    renderToolstrip();
  }

  function renderToolstrip() {
    $('#optTarget').value = Settings.target;
    const ks = kingdoms();
    if (Settings.kingdom && !Store.get(Settings.kingdom)) Settings.kingdom = null;
    $('#optKingdom').innerHTML = '<option value="">— nessuno —</option>' +
      ks.map(k => `<option value="${esc(k.id)}">${esc(k.properties.name)}</option>`).join('') + '<option value="__new">+ Nuovo regno…</option>';
    $('#optKingdom').value = Settings.kingdom || '';
    $('#optKingdom').style.setProperty('--c', Settings.kingdom ? Store.get(Settings.kingdom).properties.color : 'transparent');
    $('#optKingdomWrap').hidden = !KINDS[Settings.target]?.hasKingdom || Settings.target === 'localita';
    $('#optOverlap').value = Settings.overlap;
    $('#optOverlapWrap').hidden = !KINDS[Settings.target]?.political;
    $('#optSnap').classList.toggle('on', Settings.snap);
    $('#optLink').classList.toggle('on', Settings.link);
  }

  function onTool(t) {
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
      if (k !== panel) showPanel(k);
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
  const SIZE_MIN = 8, SIZE_MAX = 2000;
  const sizeToSlider = s => Math.round(100 * Math.log(s / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN));
  const sliderToSize = v => Math.round(SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, v / 100));

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
        <div class="ins-kind">${ICONS[p.kind]}<span>${esc(K.label)}${k ? ' · ' + esc(k.properties.name) : ''}</span></div>
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
    if (K.hasKingdom) {
      h += field('Regno', `<div class="kd-sel" style="--c:${k ? k.properties.color : 'transparent'}"><select data-p="kingdom">
        <option value="">— nessuno —</option>${kingdoms().map(x => `<option value="${esc(x.id)}"${x.id === p.kingdom ? ' selected' : ''}>${esc(x.properties.name)}</option>`).join('')}
        <option value="__new">+ Nuovo regno…</option></select></div>`);
    }
    if (K.subtypes) {
      h += field('Categoria', `<select data-p="subtype">${Object.entries(K.subtypes).map(([v, l]) => `<option value="${v}"${v === p.subtype ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
    }
    if (p.kind === 'regno') {
      h += field('Colore', `<div class="colors"><input type="color" data-p="color" value="${p.color}">
        ${PALETTE.map(c => `<button class="chip" data-color="${c}" style="--c:${c}" title="${c}"></button>`).join('')}</div>`);
    } else if (!K.hasKingdom || !k) {
      h += field('Colore', `<div class="colors"><input type="color" data-p="color" value="${color}">
        ${p.color ? `<button class="link" data-act="color-auto">automatico</button>` : '<span class="muted">automatico</span>'}</div>`);
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

    // etichetta
    const auto = lab.size == null, size = lab.size || Math.round(Render.autoSize(f));
    const rotAuto = lab.rotation == null;
    h += `<section><h3>Etichetta</h3>
      <label class="chk"><input type="checkbox" data-l="show"${lab.show !== false ? ' checked' : ''}> Mostra il nome sulla mappa</label>
      ${K.hasKingdom ? `<label class="chk"><input type="checkbox" data-l="showKingdom"${lab.showKingdom !== false ? ' checked' : ''}> Mostra il regno tra parentesi</label>` : ''}
      <div class="fld"><span class="fl">Dimensione <em id="szVal">${size} blocchi</em></span>
        <div class="rng"><input type="range" min="0" max="100" data-l="size" value="${sizeToSlider(size)}">
        <label class="mini"><input type="checkbox" data-l="sizeAuto"${auto ? ' checked' : ''}> auto</label></div></div>`;
    if (p.kind !== 'localita') {
      h += `<div class="fld"><span class="fl">Rotazione <em id="rotVal">${rotAuto ? 'auto' : lab.rotation + '°'}</em></span>
        <div class="rng"><input type="range" min="-90" max="90" data-l="rotation" value="${lab.rotation || 0}">
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
      if (g.type !== 'Point') {
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
    const keys = [['V', 'Seleziona e modifica confini'], ['F', 'Area a mano libera'], ['P', 'Area per punti'], ['L', 'Fiume a mano libera'],
      ['K', 'Punto / località'], ['B', 'Pennello: aggiungi area'], ['E', 'Gomma: togli area'], ['R', 'Ridisegna confine'],
      ['Spazio', 'Tieni premuto per spostare la mappa'], ['Esc', 'Annulla / deseleziona'], ['Canc', 'Elimina la selezione'],
      ['Z', 'Centra la selezione'], ['G', 'Griglia dei chunk'], ['[ / ]', 'Chiudi / apri i pannelli laterali'], ['Ctrl+Z / Ctrl+Y', 'Annulla / ripeti'], ['Ctrl+S', 'Salva'], ['Ctrl+K', 'Cerca'], ['1 – 8', 'Cambia pannello']];
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
          else if (prop === 'kind') { p.kind = v; if (!KINDS[v].hasKingdom) p.kingdom = null; if (!KINDS[v].subtypes) p.subtype = null; else if (!KINDS[v].subtypes[p.subtype]) p.subtype = Object.keys(KINDS[v].subtypes)[0]; }
          else if (prop === 'kingdom') p.kingdom = v || null;
          else if (prop === 'notes') p.notes = v;
          else p[prop] = v;
        }, { label: { name: 'Rinomina', kind: 'Cambia tipo', kingdom: 'Assegna regno', color: 'Colore', subtype: 'Categoria', notes: 'Note' }[prop] });
        if (prop === 'kind') showPanel(v);
      } else if (t.dataset.l) {
        const l = t.dataset.l;
        upd(p => {
          if (l === 'show' || l === 'showKingdom') p.label[l] = t.checked;
          else if (l === 'sizeAuto') p.label.size = t.checked ? null : Math.round(Render.autoSize(Store.get(id)));
          else if (l === 'rotAuto') p.label.rotation = t.checked ? null : 0;
          else if (l === 'anchor') p.label.anchor = t.value;
        }, { label: 'Etichetta' });
      } else if (t.dataset.c) {
        const f = Store.get(id), c = f.geometry.coordinates.slice();
        c[+t.dataset.c] = Geo.r1(+t.value || 0);
        Edit.update(id, (p, ff) => { ff.geometry = { type: 'Point', coordinates: c }; }, { label: 'Sposta' });
      } else if (t.dataset.s === 'simplify') {
        Settings.simplify = Math.max(0.5, +t.value || 2); Settings.save();
      }
    });

    // cursori: anteprima dal vivo, un solo passo di annullamento
    el.addEventListener('input', e => {
      const t = e.target, id = cur();
      if (!id || t.type !== 'range') return;
      if (t.dataset.l === 'size') {
        const s = sliderToSize(+t.value);
        $('#szVal').textContent = `${s} blocchi`;
        const auto = el.querySelector('[data-l="sizeAuto"]'); if (auto) auto.checked = false;
        upd(p => { p.label.size = s; }, { quiet: true, source: 'edit', coalesce: 'size:' + id, label: 'Dimensione etichetta' });
      } else if (t.dataset.l === 'rotation') {
        $('#rotVal').textContent = `${t.value}°`;
        const auto = el.querySelector('[data-l="rotAuto"]'); if (auto) auto.checked = false;
        upd(p => { p.label.rotation = +t.value; }, { quiet: true, source: 'edit', coalesce: 'rot:' + id, label: 'Rotazione etichetta' });
      }
    });

    el.addEventListener('keydown', e => {
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
        const p = f.properties, k = Render.kingdomOf(f), g = f.geometry;
        const extra = Geo.isPoly(g) ? fmtArea(Geo.area(g)) : Geo.isLine(g) ? fmtLen(Geo.length(g)) : (p.subtype && KINDS[p.kind].subtypes?.[p.subtype]) || '';
        chip.innerHTML = `<i class="sw" style="--c:${Render.colorOf(f)}"></i><b>${esc(p.name || '—')}</b>
          <span>${esc(KINDS[p.kind].label)}${k ? ' di ' + esc(k.properties.name) : ''}${extra ? ' · ' + esc(extra) : ''}</span>`;
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
    const TOOLKEYS = { v: 'select', f: 'freehand', p: 'polygon', l: 'line', k: 'point', b: 'add', e: 'sub', r: 'redraw' };
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
      if (n >= 1 && n <= KIND_ORDER.length) showPanel(KIND_ORDER[n - 1]);
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
