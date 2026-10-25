// Rappresentazione cartografica: aree, linee, punti ed etichette sopra le tiles.
const Render = (() => {
  let map;
  const items = new Map();   // id -> { kind, shape, label, el, size, show }
  const state = { hover: null, group: new Set(), selected: null, editing: true, hidden: new Set(), locked: new Set() };
  const hooks = { hover: () => {}, click: () => {}, vertexDragStart: () => {}, vertexDragEnd: () => {}, edited: () => {}, moved: () => {} };

  // Ordine dei livelli (dal basso): continenti, regioni, territori, acque, protettorati, marche, etichette, località
  const PANES = { continente: 402, regione: 404, territorio: 406, acqua: 408, protettorato: 410, marca: 412,
    sketch: 440, labels: 450, localita: 460 };

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

  const kingdomOf = f => {
    const k = f && f.properties.kingdom && Store.get(f.properties.kingdom);
    return k && k.properties.kind === 'regno' ? k : null;
  };
  const colorOf = f => f.properties.color || kingdomOf(f)?.properties.color || KINDS[f.properties.kind].color;

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
    function hatch(color) {
      const id = 'pe-h-' + color.replace('#', '');
      if (!made.has(id)) {
        const light = mix(color, '#ffffff', 0.35);
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
        el.setAttribute('id', id);
        el.setAttribute('patternUnits', 'userSpaceOnUse');
        el.setAttribute('width', 10); el.setAttribute('height', 10);
        el.setAttribute('patternTransform', 'rotate(45)');
        el.innerHTML = `<rect width="10" height="10" fill="${color}" fill-opacity="0.22"/>` +
          `<rect width="3.5" height="10" fill="${light}" fill-opacity="0.75"/>`;
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
      case 'protettorato': return { color: mix(c, '#ffffff', 0.5), weight: 2.4, opacity: 1, dashArray: '0.1 6', lineCap: 'round', fillColor: Defs.hatch(c), fillOpacity: 1 };
      case 'territorio': return { stroke: false, fillColor: c, fillOpacity: 0.34 };
      case 'regione': return { color: c, weight: 1.6, opacity: 0.6, dashArray: '10 7', fillColor: c, fillOpacity: 0.04 };
      case 'continente': return { color: c, weight: 2, opacity: 0.4, dashArray: '1 9', lineCap: 'round', fillColor: c, fillOpacity: 0 };
      case 'acqua': return line
        ? { color: c, weight: 3.5, opacity: 0.85, lineCap: 'round', lineJoin: 'round', fill: false }
        : { color: c, weight: 1.6, opacity: 0.75, fillColor: c, fillOpacity: 0.16 };
    }
    return {};
  }
  function hoverStyle(f, s) {
    switch (f.properties.kind) {
      case 'marca': return { ...s, color: '#ffffff', weight: 3.5, fillOpacity: 0.58 };
      case 'protettorato': return { ...s, color: '#ffffff', weight: 3.2 };
      case 'territorio': return { ...s, fillOpacity: 0.5 };
      case 'regione': case 'continente': return { ...s, opacity: 0.95, weight: 2.6, fillOpacity: 0.1 };
      case 'acqua': return { ...s, weight: s.weight + 2, opacity: 1, fillOpacity: (s.fillOpacity || 0) + 0.12 };
    }
    return s;
  }

  function restyle(id) {
    const it = items.get(id), f = Store.get(id);
    if (!it || !f || !it.shape || !it.shape.setStyle) return;
    const sel = state.selected;
    const hot = state.hover === id || state.group.has(id) || sel === id ||
      (!!sel && f.properties.kingdom === sel && KINDS[f.properties.kind].political);
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
    if (!g) return 60;
    if (g.type === 'Point') {
      if (k === 'localita') return { capitale: 44, citta: 32, villaggio: 22, castello: 24, porto: 24, luogo: 18 }[p.subtype] || 26;
      if (k === 'acqua') return { oceano: 300, mare: 200, golfo: 100, lago: 60, laguna: 60, baia: 60, stretto: 60, fiume: 32, torrente: 24, canale: 32 }[p.subtype] || 60;
      return { continente: 360, regione: 140, territorio: 200 }[k] || 80;
    }
    if (Geo.isLine(g)) return clamp(Geo.length(g) / len / 6, 16, 80);
    const b = Geo.bbox(g), w = b[2] - b[0];
    // larghezza media di un carattere (in em) secondo lo stile dell'etichetta, spaziatura inclusa
    const em = { continente: 1.25, regione: 0.75, acqua: 0.8 }[k] || 0.82;
    let s = Math.sqrt(Geo.area(g)) * 0.11;
    s = Math.min(s, w * 0.85 / (len * em));
    const [lo, hi] = { marca: [22, 420], protettorato: [16, 300], territorio: [60, 900], regione: [40, 700],
      continente: [120, 1600], acqua: [20, 600] }[k] || [20, 400];
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

  function labelPlacement(f) {
    const p = f.properties, g = f.geometry;
    let pos = p.label.pos, rot = p.label.rotation;
    if (p.kind === 'regno') pos = pos || kingdomShape(f.id).pos;
    else if (g && g.type === 'Point') pos = g.coordinates;
    else if (Geo.isLine(g)) { const m = Geo.lineMid(g); pos = pos || m.pos; if (rot == null) rot = m.angle; }
    else if (Geo.isPoly(g)) pos = pos || cachedLabelPoint(g);
    return { pos, rot: rot || 0 };
  }

  function labelHtml(f) {
    const p = f.properties, k = kingdomOf(f);
    let sub = '';
    if (KINDS[p.kind].hasKingdom && p.label.showKingdom && k && norm(k.properties.name) !== norm(p.name))
      sub = `<small>(${esc(k.properties.name)})</small>`;
    const style = p.label.color ? ` style="color:${esc(p.label.color)}"` : '';
    return `<span class="t"${style}>${esc(p.name || '—')}</span>${sub}`;
  }

  function makeLabel(f, interactive) {
    const { pos, rot } = labelPlacement(f);
    if (!pos) return null;
    const p = f.properties;
    const html = p.kind === 'localita'
      ? `<div class="in a-${p.label.anchor || 'right'}"><i class="dot s-${esc(p.subtype || 'citta')}"></i><div class="txt" style="--r:${rot}deg">${labelHtml(f)}</div></div>`
      : `<div class="in" style="--r:${rot}deg">${labelHtml(f)}</div>`;
    const sub = p.subtype ? ` s-${p.subtype}` : '';
    return L.marker(Geo.ll(pos), {
      icon: L.divIcon({ className: `pe-label pe-label-${p.kind} pe-k-${p.kind}${sub}`, html, iconSize: null }),
      pane: interactive ? 'localita' : 'labels',
      interactive: true, keyboard: false, pmIgnore: true, snapIgnore: true,
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
      if (!it.el) return;
      const px = it.size * scale;
      if (it.kind === 'regno') { it.el.style.display = 'none'; return; }
      if (it.kind === 'localita') {
        const txt = it.el.querySelector('.txt');
        const dotOn = it.show !== false && (px >= 5 || state.selected === it.id);
        it.el.style.display = dotOn ? '' : 'none';
        if (txt) { txt.style.display = it.show && px >= 8 ? '' : 'none'; txt.style.fontSize = px.toFixed(1) + 'px'; }
        return;
      }
      const [lo, hi] = pxRange(it.kind);
      const on = (it.show && px >= lo && px <= hi) || (state.selected === it.id && (it.pointShape || px <= 260));
      it.el.style.display = on ? '' : 'none';
      if (on) it.el.firstChild.style.fontSize = Math.max(px, 7).toFixed(1) + 'px';
    });
  }

  // ---- costruzione dei layer ----
  function create(f) {
    const p = f.properties, g = f.geometry, id = f.id;
    const it = { id, kind: p.kind, shape: null, label: null, el: null, size: p.label.size || autoSize(f), show: p.label.show !== false };
    if (g && g.type === 'Point') {
      it.shape = it.label = makeLabel(f, true);
      it.pointShape = true;
    } else if (g && (Geo.isPoly(g) || Geo.isLine(g))) {
      const opts = { pane: p.kind in PANES ? p.kind : 'marca', className: `pe-k-${p.kind}${p.kind === 'territorio' ? ' pe-soft' : ''}`,
        ...baseStyle(f) };
      it.shape = Geo.isPoly(g) ? L.polygon(Geo.toLatLngs(g), opts) : L.polyline(Geo.toLatLngs(g), opts);
      it.label = makeLabel(f, false);
    } else if (p.kind === 'regno') {
      it.label = makeLabel(f, false);
    }
    if (it.shape) {
      it.shape.addTo(map);
      bindShape(it, id);
    }
    if (it.label && it.label !== it.shape) it.label.addTo(map);
    if (it.label) {
      it.el = it.label.getElement();
      it.label.on('dragend', () => hooks.moved(id, Geo.xz(it.label.getLatLng()), it.label === it.shape));
    }
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

  function destroy(id) {
    const it = items.get(id);
    if (!it) return;
    if (it.shape && it.shape.pm && it.shape.pm.enabled && it.shape.pm.enabled()) it.shape.pm.disable();
    if (it.shape) it.shape.remove();
    if (it.label && it.label !== it.shape) it.label.remove();
    items.delete(id);
  }

  // Aggiorna etichetta e stile senza ricreare la forma (usato mentre la si modifica)
  function refresh(it, f) {
    if (it.label && it.label !== it.shape) {
      const { pos, rot } = labelPlacement(f);
      if (pos) it.label.setLatLng(Geo.ll(pos));
      const inner = it.el && it.el.firstChild;
      if (inner) { inner.innerHTML = labelHtml(f); inner.style.setProperty('--r', rot + 'deg'); }
    }
    it.size = f.properties.label.size || autoSize(f);
    it.show = f.properties.label.show !== false;
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
    let kingdoms = false;
    for (const id of ids) {
      const f = Store.get(id), it = items.get(id);
      if ((f && f.properties.kind === 'regno') || (it && it.kind === 'regno')) kingdoms = true;
      sync(id, sources[id]);
    }
    // Le etichette dei regni dipendono dalle marche; i colori delle marche dai regni
    if (kingdoms) [...items].forEach(([id, it]) => {
      const f = Store.get(id);
      if (it.kind === 'regno' || !f || !f.properties.kingdom) return;
      if (it.label === it.shape) sync(id); else refresh(it, f);
    });
    Store.all('regno').forEach(k => { const it = items.get(k.id); if (it) refreshKingdom(it, k); else create(k); });
    updateLabels();
  }
  function refreshKingdom(it, k) {
    // senza marche il regno non ha posizione: l'etichetta va tolta (o creata quando torna ad averne)
    if (!it.label || !labelPlacement(k).pos) { destroy(k.id); create(k); return; }
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
    if (it.label && it.label.dragging) { it.label.dragging.enable(); it.el?.classList.add('is-draggable'); }
  }
  function disableEdit(id) {
    const it = items.get(id);
    if (!it) return;
    if (it.shape && it.shape.pm && it.shape.pm.enabled()) it.shape.pm.disable();
    if (it.label && it.label.dragging) { it.label.dragging.disable(); it.el?.classList.remove('is-draggable'); }
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
    Defs.init();
    map.on('zoom', () => updateLabels());
    map.on('zoomanim', e => updateLabels(e.zoom));
    Store.on('reset', rebuildAll);
    Store.on('change', onChange);
  }

  return {
    init, hooks, state, select, setHover, setGroup, setEditing, zoomTo, boundsOf, setHidden, setLocked,
    colorOf, kingdomOf, kingdomShape, autoSize, restyleAll, updateLabels, esc, mix,
    get map() { return map; }, item: id => items.get(id)
  };
})();
