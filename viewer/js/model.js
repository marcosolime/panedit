// Modello dati: tipi di entità, normalizzazione GeoJSON, store con annulla/ripeti.
//
// File GeoJSON (FeatureCollection). Ogni Feature ha properties:
//   id, kind ('regno' | 'marca' | 'protettorato' | 'territorio' | 'regione' | 'continente' | 'acqua' | 'localita'),
//   name, kingdom (id del regno, per marche/protettorati/località), subtype, color, notes,
//   margin (solo territori DMZ: blocchi per lato dalla linea principale),
//   kingdoms (solo protettorati: tutti i regni proprietari, nell'ordine delle strisce; kingdom = kingdoms[0]),
//   label: { show, size (blocchi, null = automatica), rotation (gradi, null = automatica), pos ([x, z], null = automatica),
//            showKingdom, anchor (solo località) }
// I regni sono Feature con geometry null: la loro estensione è l'unione delle loro marche.
const KINDS = {
  regno: {
    label: 'Regno', plural: 'Regni', article: 'Nuovo regno', geom: [], color: '#d4b13a'
  },
  marca: {
    label: 'Marca', plural: 'Marche', article: 'Nuova marca', geom: ['Polygon', 'MultiPolygon'],
    political: true, hasKingdom: true, color: '#8f969c'
  },
  protettorato: {
    label: 'Protettorato', plural: 'Protettorati', article: 'Nuovo protettorato', geom: ['Polygon', 'MultiPolygon'],
    political: true, hasKingdom: true, color: '#8f969c'
  },
  // Un territorio tracciato come linea è una DMZ (linea di confine con una fascia cuscinetto larga 2 × margin)
  territorio: {
    label: 'Territorio', plural: 'Territori', article: 'Nuovo territorio', geom: ['Polygon', 'MultiPolygon', 'LineString'],
    color: '#26331b', labelColor: '#2f3d22', labelStroke: '#b9c79a',
    subtypes: { area: 'Area', dmz: 'DMZ' }
  },
  regione: {
    label: 'Regione', plural: 'Regioni', article: 'Nuova regione', geom: ['Polygon', 'MultiPolygon'],
    color: '#e8dcb0'
  },
  continente: {
    label: 'Continente', plural: 'Continenti', article: 'Nuovo continente', geom: ['Polygon', 'MultiPolygon'],
    color: '#ffffff'
  },
  acqua: {
    label: "Specchio d'acqua", plural: 'Acque', article: "Nuovo specchio d'acqua",
    geom: ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'], color: '#5fb4ff',
    subtypes: { fiume: 'Fiume', torrente: 'Torrente', canale: 'Canale', lago: 'Lago', laguna: 'Laguna', mare: 'Mare',
      oceano: 'Oceano', golfo: 'Golfo', baia: 'Baia', stretto: 'Stretto' }
  },
  localita: {
    label: 'Località', plural: 'Località', article: 'Nuova località', geom: ['Point'], hasKingdom: true, color: '#ffffff',
    subtypes: { capitale: 'Capitale', citta: 'Città', villaggio: 'Villaggio', castello: 'Castello', porto: 'Porto',
      luogo: 'Luogo' }
  }
};
const KIND_ORDER = ['regno', 'marca', 'protettorato', 'territorio', 'regione', 'continente', 'acqua', 'localita'];
const POLITICAL = KIND_ORDER.filter(k => KINDS[k].political);

const PALETTE = ['#e8d81c', '#2fd3c9', '#e8861c', '#c4101c', '#1f3fae', '#c8c9b2', '#7a3fd1', '#3fae4a', '#d1458f',
  '#8a5a2b', '#5ac8fa', '#f2a7c3', '#9fd356', '#ff6b4a', '#4a6b8a', '#b38df2'];

const Model = (() => {
  const clone = o => o == null ? o : structuredClone(o);
  const rand = () => Math.random().toString(36).slice(2, 8);
  const slug = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

  function newId(kind, name) {
    let id;
    do id = `${kind}-${slug(name) || 'x'}-${rand()}`; while (Store.get(id));
    return id;
  }

  function defaultLabel(kind) {
    return { show: true, size: null, rotation: null, pos: null, showKingdom: true, anchor: kind === 'localita' ? 'right' : null };
  }

  function make(kind, props = {}, geometry = null) {
    const name = props.name ?? KINDS[kind].article;
    const id = newId(kind, name);
    const p = { id, kind, name, kingdom: null, subtype: null, color: null, notes: '', label: defaultLabel(kind), ...props };
    if (kind === 'regno' && !p.color) p.color = nextColor();
    fitProps(p, geometry);
    return { type: 'Feature', id, properties: p, geometry };
  }

  // Categoria (e margine delle DMZ) coerenti con tipo e geometria. Per i territori la categoria
  // dipende solo dalla geometria: linea = DMZ, altrimenti area.
  function fitProps(p, g) {
    const S = KINDS[p.kind].subtypes, line = !!g && g.type.includes('Line');
    if (!S) p.subtype = null;
    else if (p.kind === 'territorio') p.subtype = line ? 'dmz' : 'area';
    else if (!S[p.subtype]) p.subtype = p.kind === 'acqua' ? (line ? 'fiume' : 'lago') : p.kind === 'localita' ? 'citta' : Object.keys(S)[0];
    if (p.subtype === 'dmz') p.margin = Math.max(0, +p.margin || 0);
    else delete p.margin;
    setKingdoms(p, kingdomIds(p));
    return p;
  }

  // Regni di un'entità: per i protettorati possono essere più d'uno (kingdoms), per gli altri al più uno (kingdom)
  function kingdomIds(p) {
    if (p.kind === 'protettorato' && Array.isArray(p.kingdoms)) return p.kingdoms;
    return p.kingdom ? [p.kingdom] : [];
  }
  // Scrive i regni tenendo allineati kingdoms e kingdom (= il primo)
  function setKingdoms(p, ids) {
    ids = [...new Set(ids.filter(Boolean))];
    if (p.kind === 'protettorato') p.kingdoms = ids;
    else { delete p.kingdoms; ids = ids.slice(0, 1); }
    p.kingdom = ids[0] || null;
    return p;
  }

  function nextColor() {
    const used = new Set(Store.all('regno').map(f => (f.properties.color || '').toLowerCase()));
    return PALETTE.find(c => !used.has(c)) || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  }

  // Accetta qualunque GeoJSON e lo porta alla struttura dell'editor
  function normalize(f) {
    const p = { ...(f.properties || {}) };
    const g = f.geometry || null;
    let kind = p.kind;
    // tipo sconosciuto, o geometria non ammessa dal tipo (es. un continente salvato come punto): si sceglie
    // in base alla geometria. I punti sono sempre località; quelli convertiti diventano "luoghi".
    const byGeom = () => g.type === 'Point' ? 'localita' : g.type.includes('Line') ? 'acqua' : 'marca';
    if (!KINDS[kind]) kind = !g ? 'regno' : byGeom();
    else if (g && kind !== 'regno' && !KINDS[kind].geom.includes(g.type)) {
      kind = byGeom();
      p.subtype = kind === 'localita' ? 'luogo' : null;
    }
    const name = p.name ?? p.Name ?? p.NAME ?? p.nome ?? '';
    const id = p.id || f.id || newId(kind, name);
    const props = {
      id, kind, name, kingdom: p.kingdom ?? null, subtype: p.subtype ?? null, color: p.color ?? null, notes: p.notes ?? '',
      ...p, id, kind, name,
      label: { ...defaultLabel(kind), ...(p.label || {}) }
    };
    fitProps(props, g);
    return { type: 'Feature', id, properties: props, geometry: g ? { type: g.type, coordinates: g.coordinates } : null };
  }

  function toFeatureCollection(meta = {}) {
    const fs = Store.all().slice().sort((a, b) =>
      KIND_ORDER.indexOf(a.properties.kind) - KIND_ORDER.indexOf(b.properties.kind) ||
      (a.properties.name || '').localeCompare(b.properties.name || '', 'it'));
    return {
      type: 'FeatureCollection',
      name: meta.name || 'Panera',
      metadata: {
        format: 'panera-map',
        version: 1,
        coordinates: 'Coordinate di gioco [x, z] in blocchi (z cresce verso sud)',
        updated: new Date().toISOString(),
        ...meta.extra
      },
      features: fs.map(clone)
    };
  }

  return { clone, make, fitProps, kingdomIds, setKingdoms, normalize, toFeatureCollection, nextColor, newId };
})();

// Store: tutte le entità, raggruppamento delle modifiche in transazioni, annulla/ripeti.
// Ogni put/remove apre una transazione automatica chiusa alla fine del ciclo di eventi
// (o esplicitamente con commit()); una transazione è un singolo passo di annullamento.
const Store = (() => {
  const features = new Map();
  const versions = new Map();
  const listeners = {};
  const undoStack = [], redoStack = [];
  let tx = null, version = 0, dirty = false;
  const MAX_UNDO = 150;

  const on = (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn);
  const emit = (ev, data) => (listeners[ev] || []).forEach(fn => fn(data));

  const get = id => features.get(id);
  const all = kind => {
    const out = [];
    for (const f of features.values()) if (!kind || f.properties.kind === kind) out.push(f);
    return out;
  };
  const ver = id => versions.get(id) || 0;

  function open(label, opts = {}) {
    if (!tx) {
      tx = { label, before: new Map(), sources: {}, coalesce: opts.coalesce || null, source: opts.source };
      setTimeout(commit, 0);
    } else if (label && !tx.label) tx.label = label;
    return tx;
  }
  function touch(id) {
    open();
    if (!tx.before.has(id)) tx.before.set(id, features.has(id) ? Model.clone(features.get(id)) : null);
  }

  function put(f, opts = {}) {
    open(opts.label, opts);
    touch(f.id);
    f.id = f.properties.id;
    features.set(f.id, f);
    versions.set(f.id, ++version);
    if (opts.source) tx.sources[f.id] = opts.source;
    if (opts.coalesce) tx.coalesce = opts.coalesce;
  }
  function remove(id) {
    if (!features.has(id)) return;
    touch(id);
    features.delete(id);
    versions.delete(id);
  }

  function commit() {
    if (!tx) return;
    const t = tx; tx = null;
    const changes = [];
    for (const [id, before] of t.before) changes.push({ id, before, after: Model.clone(features.get(id) ?? null) });
    if (!changes.length) return;
    const top = undoStack[undoStack.length - 1];
    if (t.coalesce && top && top.coalesce === t.coalesce && Date.now() - top.time < 2000) {
      for (const c of changes) {
        const prev = top.changes.find(x => x.id === c.id);
        if (prev) prev.after = c.after; else top.changes.push(c);
      }
      top.time = Date.now();
    } else {
      undoStack.push({ label: t.label, changes, coalesce: t.coalesce, time: Date.now() });
      if (undoStack.length > MAX_UNDO) undoStack.shift();
    }
    redoStack.length = 0;
    setDirty(true);
    emit('change', { ids: changes.map(c => c.id), sources: t.sources, source: t.source });
  }

  function apply(entry, dir) {
    const ids = [];
    for (const c of entry.changes) {
      const v = dir === 'undo' ? c.before : c.after;
      if (v) { features.set(c.id, Model.clone(v)); versions.set(c.id, ++version); } else { features.delete(c.id); versions.delete(c.id); }
      ids.push(c.id);
    }
    setDirty(true);
    emit('change', { ids, sources: {}, source: dir });
    return entry.label;
  }
  function undo() {
    commit();
    const e = undoStack.pop();
    if (!e) return null;
    redoStack.push(e);
    return apply(e, 'undo') || 'modifica';
  }
  function redo() {
    commit();
    const e = redoStack.pop();
    if (!e) return null;
    undoStack.push(e);
    return apply(e, 'redo') || 'modifica';
  }

  function load(fc) {
    features.clear(); versions.clear();
    undoStack.length = redoStack.length = 0;
    tx = null;
    const list = fc && Array.isArray(fc.features) ? fc.features : [];
    for (const raw of list) {
      const f = Model.normalize(raw);
      features.set(f.id, f);
      versions.set(f.id, ++version);
    }
    // riferimenti a regni inesistenti
    for (const f of features.values()) {
      const p = f.properties;
      Model.setKingdoms(p, Model.kingdomIds(p).filter(k => features.get(k)?.properties.kind === 'regno'));
    }
    setDirty(false);
    emit('reset');
  }

  function setDirty(v) { dirty = v; emit('dirty', v); }

  return {
    on, get, all, ver, put, remove, commit, undo, redo, load, open,
    get dirty() { return dirty; }, setDirty,
    canUndo: () => undoStack.length > 0 || !!tx, canRedo: () => redoStack.length > 0
  };
})();
