// Rappresentazione cartografica: aree, linee, punti ed etichette sopra le tiles.
const Render = (() => {
  let map;
  const items = new Map();   // id -> { kind, shape, labels, els, band (solo DMZ), size, show, pointShape }
  const state = { hover: null, group: new Set(), selected: null, editing: true, hidden: new Set(), locked: new Set() };
  const hooks = { hover: () => {}, click: () => {}, vertexDragStart: () => {}, vertexDragEnd: () => {}, edited: () => {}, moved: () => {} };

  // Ordine dei livelli (dal basso): continenti, regioni, territori, acque, protettorati, marche, DMZ (fascia e
  // linea principale), linee ferroviarie, etichette, località e stazioni
  const PANES = { continente: 402, regione: 404, territorio: 406, acqua: 408, protettorato: 410, marca: 412,
    dmzBand: 414, dmz: 416, linea: 418, sketch: 440, labels: 450, localita: 460 };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const norm = s => (s || '').trim().toLowerCase();

  // ---- colori ----
  function rgb(hex) {
    let h = (hex || '#888').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  // Tutti i regni di un'entità (più d'uno solo per i protettorati condivisi); kingdomOf è il primo
  const kingdomsOf = f => !f ? [] : Model.kingdomIds(f.properties).map(id => Store.get(id))
    .filter(k => k && k.properties.kind === 'regno');
  const kingdomOf = f => kingdomsOf(f)[0] || null;
  // DMZ: territorio tracciato come linea; la fascia cuscinetto è larga 2 × margin blocchi
  const isDmz = f => f.properties.kind === 'territorio' && Geo.isLine(f.geometry);
  const DMZ_COLOR = '#4f9a3a';
  const colorOf = f => f.properties.color || kingdomOf(f)?.properties.color || (isDmz(f) && DMZ_COLOR) || KINDS[f.properties.kind].color;

  // ---- definizioni SVG condivise (tratteggio protettorati, bordo sfumato territori) ----
  const Defs = (() => {
    let defs; const made = new Map();
    function init() {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', 0); svg.setAttribute('height', 0);
      svg.style.position = 'absolute';
      svg.innerHTML = '<defs><filter id="pe-soft" x="-10%" y="-10%" width="120%" height="120%">' +
        '<feGaussianBlur stdDeviation="9"/></filter></defs>';
      document.body.appendChild(svg);
      defs = svg.firstChild;
    }
    // Tratteggio dei protettorati: una striscia per colore, alternate (protettorati condivisi tra più regni)
    function hatch(colors) {
      const id = 'pe-h-' + colors.map(c => c.replace('#', '')).join('-');
      if (!made.has(id)) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
        el.setAttribute('id', id);
        el.setAttribute('patternUnits', 'userSpaceOnUse');
        el.setAttribute('width', 10 * colors.length); el.setAttribute('height', 10);
        el.setAttribute('patternTransform', 'rotate(45)');
        el.innerHTML = colors.map((c, i) => `<rect x="${10 * i}" width="10" height="10" fill="${c}" fill-opacity="0.22"/>` +
          `<rect x="${10 * i}" width="3.5" height="10" fill="${mix(c, '#ffffff', 0.35)}" fill-opacity="0.75"/>`).join('');
        defs.appendChild(el);
        made.set(id, true);
      }
      return `url(#${id})`;
    }
    return { init, hatch };
  })();

  // ---- stili ----
  function baseStyle(f) {
    const p = f.properties, c = colorOf(f), line = Geo.isLine(f.geometry);
    switch (p.kind) {
      case 'marca': return { color: mix(c, '#ffffff', 0.3), weight: 2, opacity: 1, fillColor: c, fillOpacity: 0.36, dashArray: null, lineJoin: 'round' };
      case 'protettorato': {
        // condiviso: strisce nei colori dei regni e bordo neutro
        const ks = kingdomsOf(f), shared = ks.length > 1;
        return { color: shared ? '#eeeeee' : mix(c, '#ffffff', 0.5), weight: 2.4, opacity: 1, dashArray: '0.1 6', lineCap: 'round',
          fillColor: Defs.hatch(shared ? ks.map(k => k.properties.color) : [c]), fillOpacity: 1 };
      }
      case 'territorio': return !line ? { stroke: false, fillColor: c, fillOpacity: 0.34 }
        // con la fascia la linea principale è sottile e tratteggiata, senza è una linea divisoria piena
        : p.margin > 0 ? { color: mix(c, '#ffffff', 0.55), weight: 1.6, opacity: 0.95, dashArray: '8 6', lineCap: 'butt', fill: false }
        : { color: c, weight: 3.5, opacity: 0.95, dashArray: null, lineCap: 'round', lineJoin: 'round', fill: false };
      case 'regione': return { color: c, weight: 1.6, opacity: 0.6, dashArray: '10 7', fillColor: c, fillOpacity: 0.04 };
      case 'continente': return { color: c, weight: 2, opacity: 0.4, dashArray: '1 9', lineCap: 'round', fillColor: c, fillOpacity: 0 };
      case 'acqua': return line
        ? { color: c, weight: 3.5, opacity: 0.85, lineCap: 'round', lineJoin: 'round', fill: false }
        : { color: c, weight: 1.6, opacity: 0.75, fillColor: c, fillOpacity: 0.16 };
      // linee ferroviarie: le direttissime più spesse
      case 'linea': return { color: c, weight: p.subtype === 'direttissima' ? 5.5 : 3.5, opacity: 1, lineCap: 'round', lineJoin: 'round', fill: false };
    }
    return {};
  }
  function hoverStyle(f, s) {
    switch (f.properties.kind) {
      case 'marca': return { ...s, color: '#ffffff', weight: 3.5, fillOpacity: 0.58 };
      case 'protettorato': return { ...s, color: '#ffffff', weight: 3.2 };
      case 'territorio': return Geo.isLine(f.geometry) ? { ...s, weight: s.weight + 2 } : { ...s, fillOpacity: 0.5 };
      case 'regione': case 'continente': return { ...s, opacity: 0.95, weight: 2.6, fillOpacity: 0.1 };
      case 'acqua': return { ...s, weight: s.weight + 2, opacity: 1, fillOpacity: (s.fillOpacity || 0) + 0.12 };
      case 'linea': return { ...s, weight: s.weight + 2 };
    }
    return s;
  }

  function restyle(id) {
    const it = items.get(id), f = Store.get(id);
    if (!it || !f || !it.shape || !it.shape.setStyle) return;
    const sel = state.selected;
    const hot = state.hover === id || state.group.has(id) || sel === id ||
      (!!sel && KINDS[f.properties.kind].political && Model.kingdomIds(f.properties).includes(sel));
    const s = baseStyle(f);
    it.shape.setStyle(hot ? hoverStyle(f, s) : s);
    const el = it.shape.getElement && it.shape.getElement();
    if (el) el.classList.toggle('pe-selected', state.selected === id);
  }
  const restyleAll = () => items.forEach((_, id) => restyle(id));

  // ---- etichette ----
  function autoSize(f) {
    const p = f.properties, g = f.geometry, k = p.kind;
    const len = Math.max(4, (p.name || '').length);
    if (k === 'regno') {
      const a = kingdomArea(f.id);
      return a ? clamp(Math.sqrt(a) * 0.28 / Math.max(1, len / 8), 150, 2400) : 150;
    }
    // Valori tarati sulle dimensioni scelte a mano nelle mappe reali (quasi sempre sotto i 30 blocchi)
    if (!g) return 20;
    // punti: località e stazioni
    if (g.type === 'Point') return k === 'stazione' ? 8 : { capitale: 14, citta: 10, villaggio: 8, castello: 8, porto: 8, luogo: 6 }[p.subtype] || 9;
    // cresce con la radice della lunghezza: sulle linee lunghe il nome si ripete invece di ingrandirsi
    if (Geo.isLine(g)) return clamp(Math.sqrt(Geo.lineAt(g, 0.5).length) * 0.6 / Math.max(1, len / 8), 4, 40);
    const b = Geo.bbox(g), w = b[2] - b[0];
    // larghezza media di un carattere (in em) secondo lo stile dell'etichetta, spaziatura inclusa
    const em = { continente: 1.25, regione: 0.75, acqua: 0.8 }[k] || 0.82;
    let s = Math.sqrt(Geo.area(g)) * 0.08;
    s = Math.min(s, w * 0.85 / (len * em));
    const [lo, hi] = { marca: [6, 420], protettorato: [5, 300], territorio: [10, 900], regione: [8, 700],
      continente: [15, 1600], acqua: [4, 600] }[k] || [4, 400];
    return clamp(s, lo, hi);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const posCache = new WeakMap();
  function cachedLabelPoint(g) {
    if (!posCache.has(g)) posCache.set(g, Geo.labelPoint(g));
    return posCache.get(g);
  }

  // Estensione di un regno = unione delle sue marche (in cache finché le marche non cambiano)
  const kCache = new Map();
  function kingdomShape(kid) {
    const members = Store.all('marca').filter(m => m.properties.kingdom === kid && Geo.isPoly(m.geometry));
    const key = members.map(m => m.id + ':' + Store.ver(m.id)).join('|');
    const c = kCache.get(kid);
    if (c && c.key === key) return c;
    const geom = members.length ? Geo.unionAll(members.map(m => m.geometry)) : null;
    const res = { key, geom, area: members.reduce((s, m) => s + Geo.area(m.geometry), 0), pos: geom ? Geo.labelPoint(geom) : null };
    kCache.set(kid, res);
    return res;
  }
  const kingdomArea = kid => kingdomShape(kid).area;

  // Larghezza approssimativa del nome in blocchi (0,8 em per carattere, come in autoSize)
  const textWidth = f => (f.properties.label.size || autoSize(f)) * Math.max(4, (f.properties.name || '').length) * 0.8;
  // Sulle linee il nome si ripete lasciando tra una copia e l'altra almeno REPEAT_GAP volte la sua larghezza
  const REPEAT_GAP = 3.5, REPEAT_MAX = 6;

  // Numero automatico di copie del nome su una linea (label.repeat = null)
  const autoRepeat = f => clamp(Math.floor(Geo.lineAt(f.geometry, 0.5).length / (textWidth(f) * REPEAT_GAP)), 1, REPEAT_MAX);

  // Posizioni dell'etichetta: una sola, tranne sulle linee (copie automatiche o label.repeat) senza posizione manuale
  function labelPlacements(f) {
    const p = f.properties, g = f.geometry;
    let pos = p.label.pos, rot = p.label.rotation;
    if (p.kind === 'regno') pos = pos || kingdomShape(f.id).pos;
    else if (g && g.type === 'Point') pos = g.coordinates;
    else if (Geo.isLine(g)) {
      const span = textWidth(f), mid = Geo.lineAt(g, 0.5, span);
      if (pos) return [{ pos, rot: rot ?? mid.angle }];
      const n = p.label.repeat ? clamp(Math.round(p.label.repeat), 1, 10) : autoRepeat(f);
      return Array.from({ length: n }, (_, i) => {
        const m = n === 1 ? mid : Geo.lineAt(g, (i + 1) / (n + 1), span);
        return { pos: m.pos, rot: rot ?? m.angle };
      });
    }
    else if (Geo.isPoly(g)) pos = pos || cachedLabelPoint(g);
    return [{ pos, rot: rot || 0 }];
  }

  function labelHtml(f) {
    const p = f.properties;
    const names = kingdomsOf(f).map(k => k.properties.name).filter(n => norm(n) !== norm(p.name));
    let sub = '';
    if (KINDS[p.kind].hasKingdom && p.label.showKingdom && names.length) sub = `<small>(${names.map(esc).join(' · ')})</small>`;
    const style = p.label.color ? ` style="color:${esc(p.label.color)}"` : '';
    return `<span class="t"${style}>${esc(p.name || '—')}</span>${sub}`;
  }

  function makeLabel(f, interactive, { pos, rot }) {
    if (!pos) return null;
    const p = f.properties, point = KINDS[p.kind].pointLabel;
    // località e stazioni: pallino con il nome accanto (le stazioni riusano lo stile delle località)
    const dot = p.kind === 'stazione' ? `stazione${isInterchange(f) ? ' s-interscambio' : ''}` : esc(p.subtype || 'citta');
    const html = point
      ? `<div class="in a-${p.label.anchor || 'right'}"><i class="dot s-${dot}"></i><div class="txt" style="--r:${rot}deg">${labelHtml(f)}</div></div>`
      : `<div class="in" style="--r:${rot}deg">${labelHtml(f)}</div>`;
    const sub = p.subtype ? ` s-${p.subtype}` : '';
    const cls = `pe-label pe-label-${p.kind}${point && p.kind !== 'localita' ? ' pe-label-localita' : ''} pe-k-${p.kind}${sub}`;
    return L.marker(Geo.ll(pos), {
      icon: L.divIcon({ className: cls, html, iconSize: null }),
      pane: interactive ? 'localita' : 'labels',
      // le stazioni sono punti di aggancio per le linee ferroviarie
      interactive: true, keyboard: false, pmIgnore: true, snapIgnore: p.kind !== 'stazione',
      zIndexOffset: { regno: -1000, continente: -900, regione: -800, territorio: -700 }[p.kind] || 0
    });
  }

  // Il nome del regno non compare mai da solo sulla mappa: lo si legge tra parentesi
  // sotto quello delle marche, che da lontano spariscono lasciando solo i colori.
  // Intervallo (px) in cui un'etichetta è leggibile senza coprire la mappa
  const PX = { continente: [10, 110], territorio: [9, 170], regione: [9, 150] };
  const pxRange = k => PX[k] || [7, 260];
  function updateLabels(zoom) {
    const scale = Math.pow(2, zoom ?? map.getZoom());
    items.forEach(it => {
      if (!it.els.length) return;
      const px = it.size * scale;
      if (it.kind === 'regno') { it.els.forEach(el => { el.style.display = 'none'; }); return; }
      // L'entità selezionata mostra sempre il nome, per poterlo trascinare; se è nascosto lo mostra attenuato
      const sel = state.selected === it.id, off = sel && !it.show;
      if (KINDS[it.kind].pointLabel) {
        const el = it.els[0], txt = el.querySelector('.txt');
        el.style.display = px >= 5 || sel ? '' : 'none';   // il pallino non dipende da "mostra il nome"
        el.classList.toggle('pe-label-off', off);
        if (txt) { txt.style.display = (it.show || sel) && px >= 8 ? '' : 'none'; txt.style.fontSize = px.toFixed(1) + 'px'; }
        return;
      }
      const [lo, hi] = pxRange(it.kind);
      const on = (it.show && px >= lo && px <= hi) || (sel && (it.pointShape || px <= 260));
      it.els.forEach(el => {
        el.style.display = on ? '' : 'none';
        el.classList.toggle('pe-label-off', off);
        if (on) el.firstChild.style.fontSize = Math.max(px, 7).toFixed(1) + 'px';
      });
    });
  }

  // ---- ferrovie ----
  // Interscambio: stazione su cui fermano due o più linee (una linea vi ferma se ha un vertice sulla stazione)
  function isInterchange(st) {
    const c = st.geometry?.coordinates;
    if (!c) return false;
    let n = 0;
    for (const l of Store.all('linea')) {
      if (l.geometry?.type === 'LineString' && l.geometry.coordinates.some(v => Geo.same(v, c)) && ++n > 1) return true;
    }
    return false;
  }
  function updateInterchanges() {
    for (const st of Store.all('stazione')) {
      const dot = items.get(st.id)?.els[0]?.querySelector('.dot');
      if (dot) dot.classList.toggle('s-interscambio', isInterchange(st));
    }
  }

  // ---- costruzione dei layer ----
  function create(f) {
    const p = f.properties, g = f.geometry, id = f.id;
    // labels / els: le etichette e i loro elementi; per i punti l'unica etichetta è la forma stessa
    const it = { id, kind: p.kind, shape: null, labels: [], els: [], size: p.label.size || autoSize(f), show: p.label.show !== false };
    if (g && g.type === 'Point') {
      it.shape = makeLabel(f, true, labelPlacements(f)[0]);
      it.pointShape = true;
    } else if (g && (Geo.isPoly(g) || Geo.isLine(g))) {
      const dmz = isDmz(f);
      const opts = { pane: dmz ? 'dmz' : p.kind in PANES ? p.kind : 'marca',
        className: `pe-k-${p.kind}${p.kind === 'territorio' && !dmz ? ' pe-soft' : ''}`, ...baseStyle(f) };
      it.shape = Geo.isPoly(g) ? L.polygon(Geo.toLatLngs(g), opts) : L.polyline(Geo.toLatLngs(g), opts);
    }
    if (it.shape) {
      it.shape.addTo(map);
      bindShape(it, id);
      updateBand(it, f);
    }
    if (it.pointShape) {
      it.labels = [it.shape];
      it.els = [it.shape.getElement()];
      it.shape.on('dragend', () => hooks.moved(id, Geo.xz(it.shape.getLatLng()), true));
    } else if (it.shape || p.kind === 'regno') addLabels(it, f);
    items.set(id, it);
    restyle(id);
    return it;
  }

  function bindShape(it, id) {
    const s = it.shape;
    s.on('mouseover', () => setHover(id));
    s.on('mouseout', () => { if (state.hover === id) setHover(null); });
    s.on('mousemove', e => hooks.hover(id, e.originalEvent));
    s.on('click', e => { L.DomEvent.stopPropagation(e); hooks.click(id, e); });
    if (s instanceof L.Path) {
      s.on('pm:markerdragstart', e => hooks.vertexDragStart(id, Geo.xz(e.markerEvent.target.getLatLng())));
      s.on('pm:markerdragend', e => hooks.vertexDragEnd(id, Geo.xz(e.markerEvent.target.getLatLng())));
      s.on('pm:edit', () => hooks.edited(id, Geo.fromLayer(s)));
    }
  }

  // Fascia della DMZ: due tratti larghi quanto la fascia (spessore in pixel ricalcolato a ogni zoom),
  // sotto il bordo chiaro e sopra il riempimento, in un pane semitrasparente
  function updateBand(it, f) {
    const m = isDmz(f) ? f.properties.margin || 0 : 0;
    if (!m) { if (it.band) { it.band.forEach(l => l.remove()); it.band = null; } return; }
    const c = colorOf(f), w = 2 * m * Math.pow(2, map.getZoom()), lls = Geo.toLatLngs(f.geometry);
    const styles = [{ color: mix(c, '#ffffff', 0.5), weight: w + 4 }, { color: c, weight: w }];
    if (it.band) { it.band.forEach((l, i) => { l.setLatLngs(lls); l.setStyle(styles[i]); }); return; }
    it.band = styles.map((s, i) => L.polyline(lls, { pane: 'dmzBand', className: 'pe-k-territorio', opacity: 1, lineCap: 'round',
      lineJoin: 'round', interactive: i === 1, pmIgnore: true, snapIgnore: true, ...s }).addTo(map));
    // anche la fascia, non solo la linea, si evidenzia e si seleziona
    const fill = it.band[1], id = it.id;
    fill.on('mouseover', () => setHover(id));
    fill.on('mouseout', () => { if (state.hover === id) setHover(null); });
    fill.on('mousemove', e => hooks.hover(id, e.originalEvent));
    fill.on('click', e => { L.DomEvent.stopPropagation(e); hooks.click(id, e); });
  }

  // Etichette (non interattive) di aree, linee e regni; trascinandone una si fissa la posizione
  function addLabels(it, f) {
    it.labels = labelPlacements(f).map(pl => makeLabel(f, false, pl)).filter(Boolean);
    it.labels.forEach(l => {
      l.addTo(map);
      l.on('dragend', () => hooks.moved(it.id, Geo.xz(l.getLatLng()), false));
    });
    it.els = it.labels.map(l => l.getElement());
  }
  function removeLabels(it) {
    if (!it.pointShape) it.labels.forEach(l => l.remove());
    it.labels = []; it.els = [];
  }

  function destroy(id) {
    const it = items.get(id);
    if (!it) return;
    if (it.shape && it.shape.pm && it.shape.pm.enabled && it.shape.pm.enabled()) it.shape.pm.disable();
    if (it.shape) it.shape.remove();
    if (it.band) it.band.forEach(l => l.remove());
    removeLabels(it);
    items.delete(id);
  }

  // Aggiorna etichette e stile senza ricreare la forma (usato mentre la si modifica)
  function refresh(it, f) {
    it.size = f.properties.label.size || autoSize(f);
    it.show = f.properties.label.show !== false;
    if (it.shape && !it.pointShape) updateBand(it, f);
    if (!it.pointShape) {
      const places = labelPlacements(f);
      if (places.length !== it.labels.length) {
        // cambia il numero di ripetizioni (linea allungata, etichetta trascinata o reimpostata)
        removeLabels(it);
        addLabels(it, f);
        if (state.selected === f.id && state.editing) labelDrag(it, true);
      } else {
        places.forEach(({ pos, rot }, i) => {
          if (pos) it.labels[i].setLatLng(Geo.ll(pos));
          const inner = it.els[i] && it.els[i].firstChild;
          if (inner) { inner.innerHTML = labelHtml(f); inner.style.setProperty('--r', rot + 'deg'); }
        });
      }
    }
    restyle(f.id);
  }

  function sync(id, source) {
    const f = Store.get(id), it = items.get(id);
    if (!f) { destroy(id); return; }
    if (it && source === 'edit' && it.kind === f.properties.kind) { refresh(it, f); return; }
    destroy(id);
    create(f);
    if (state.selected === id) { restyle(id); if (state.editing) enableEdit(id); }
  }

  function rebuildAll() {
    [...items.keys()].forEach(destroy);
    state.selected = state.hover = null;
    state.group.clear();
    kCache.clear();
    for (const k of KIND_ORDER) Store.all(k).forEach(create);
    updateLabels();
  }

  function onChange({ ids, sources }) {
    let kingdoms = false, rail = false;
    for (const id of ids) {
      const f = Store.get(id), it = items.get(id);
      if ((f && f.properties.kind === 'regno') || (it && it.kind === 'regno')) kingdoms = true;
      if ([f?.properties.kind, it?.kind].some(k => k === 'linea' || k === 'stazione')) rail = true;
      sync(id, sources[id]);
    }
    if (rail) updateInterchanges();
    // Le etichette dei regni dipendono dalle marche; i colori delle marche dai regni
    if (kingdoms) [...items].forEach(([id, it]) => {
      const f = Store.get(id);
      if (it.kind === 'regno' || !f || !f.properties.kingdom) return;
      if (it.pointShape) sync(id); else refresh(it, f);
    });
    Store.all('regno').forEach(k => { const it = items.get(k.id); if (it) refreshKingdom(it, k); else create(k); });
    updateLabels();
  }
  function refreshKingdom(it, k) {
    // senza marche il regno non ha posizione: l'etichetta va tolta (o creata quando torna ad averne)
    if (!it.labels.length || !labelPlacements(k)[0].pos) { destroy(k.id); create(k); return; }
    refresh(it, k);
  }

  // ---- interazione ----
  function setHover(id) {
    if (state.hover === id) return;
    const prev = state.hover;
    state.hover = id;
    if (prev) restyle(prev);
    if (id) {
      restyle(id);
      const it = items.get(id);
      if (it && it.shape && it.shape.bringToFront && it.kind === 'marca' && state.selected !== prev) it.shape.bringToFront();
      if (state.selected) items.get(state.selected)?.shape?.bringToFront?.();
    }
    hooks.hover(id, null);
  }

  // Mette in rilievo un gruppo (es. tutte le marche di un regno)
  function setGroup(ids) {
    const prev = [...state.group];
    state.group = new Set(ids || []);
    prev.forEach(restyle);
    state.group.forEach(restyle);
  }

  function select(id) {
    const prev = state.selected;
    if (prev === id) return;
    state.selected = id;
    if (prev) { disableEdit(prev); restyle(prev); }
    if ([prev, id].some(x => x && Store.get(x)?.properties.kind === 'regno')) restyleAll();
    if (id) {
      restyle(id);
      const it = items.get(id);
      if (it && it.shape && it.shape.bringToFront) it.shape.bringToFront();
      if (state.editing) enableEdit(id);
    }
    updateLabels();
  }

  function setEditing(on) {
    state.editing = on;
    if (!state.selected) return;
    if (on) enableEdit(state.selected); else disableEdit(state.selected);
  }

  function enableEdit(id) {
    const it = items.get(id), f = Store.get(id);
    if (!it || !f || state.locked.has(it.kind)) return;
    if (it.shape instanceof L.Path && it.shape.pm) {
      const n = Geo.countVertices(f.geometry);
      it.shape.pm.enable({
        allowSelfIntersection: true,
        snappable: Settings.snap,
        snapDistance: 14,
        removeLayerBelowMinVertexCount: false,
        limitMarkersToCount: n > 1500 ? 400 : -1,
        draggable: false,
        addVertexOn: 'click',
        removeVertexOn: 'contextmenu'
      });
    }
    labelDrag(it, true);
  }
  function disableEdit(id) {
    const it = items.get(id);
    if (!it) return;
    if (it.shape && it.shape.pm && it.shape.pm.enabled()) it.shape.pm.disable();
    labelDrag(it, false);
  }
  function labelDrag(it, on) {
    it.labels.forEach((l, i) => {
      if (!l.dragging) return;
      on ? l.dragging.enable() : l.dragging.disable();
      it.els[i]?.classList.toggle('is-draggable', on);
    });
  }

  function boundsOf(id) {
    const f = Store.get(id);
    if (!f) return null;
    if (f.properties.kind === 'regno') {
      const g = kingdomShape(id).geom;
      return g ? Geo.bounds(g) : null;
    }
    return f.geometry ? Geo.bounds(f.geometry) : null;
  }

  function zoomTo(id, opts = {}) {
    const f = Store.get(id), b = boundsOf(id);
    if (!f || !b) return;
    if (f.geometry && f.geometry.type === 'Point') {
      map.flyTo(b.getCenter(), Math.max(map.getZoom(), opts.zoom ?? -1), { duration: 0.6 });
    } else {
      map.flyToBounds(b, { padding: [60, 60], maxZoom: 0, duration: 0.6 });
    }
  }

  // ---- visibilità / blocco per tipo ----
  function setHidden(kind, hidden) {
    hidden ? state.hidden.add(kind) : state.hidden.delete(kind);
    map.getContainer().classList.toggle('hide-' + kind, hidden);
    if (hidden && state.selected && items.get(state.selected)?.kind === kind) hooks.click(null);
  }
  function setLocked(kind, locked) {
    locked ? state.locked.add(kind) : state.locked.delete(kind);
    map.getContainer().classList.toggle('lock-' + kind, locked);
    if (state.selected && items.get(state.selected)?.kind === kind) { disableEdit(state.selected); if (!locked && state.editing) enableEdit(state.selected); }
  }

  function init(m) {
    map = m;
    for (const [name, z] of Object.entries(PANES)) map.createPane(name).style.zIndex = z;
    map.getPane('labels').style.pointerEvents = 'none';
    map.getPane('dmzBand').style.opacity = 0.45;
    map.on('zoomend', () => items.forEach(it => { if (it.band) updateBand(it, Store.get(it.id)); }));
    Defs.init();
    map.on('zoom', () => updateLabels());
    map.on('zoomanim', e => updateLabels(e.zoom));
    Store.on('reset', rebuildAll);
    Store.on('change', onChange);
  }

  return {
    init, hooks, state, select, setHover, setGroup, setEditing, zoomTo, boundsOf, setHidden, setLocked,
    colorOf, kingdomOf, kingdomsOf, kingdomShape, autoSize, autoRepeat, restyleAll, updateLabels, esc, mix,
    get map() { return map; }, item: id => items.get(id)
  };
})();
