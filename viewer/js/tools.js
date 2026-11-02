// Preferenze dell'editor (ricordate nel browser)
const Settings = (() => {
  const KEY = 'panera-editor-settings';
  const s = { snap: true, link: true, grid: false, leftOpen: true, rightOpen: true, overlap: 'clip', target: 'marca', kingdom: null, simplify: 2, bgBrightness: 100, bgSaturation: 100,
    railType: 'fermate', railColor: null,   // categoria e colore (null = primo libero) della prossima linea ferroviaria
    zigzag: false };                        // Posa binari: tratti a 45° invece che orizzontali/verticali
  try { Object.assign(s, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* preferenze di default */ }
  Object.defineProperty(s, 'save', {
    value: () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* non essenziale */ } }
  });
  return s;
})();

// Operazioni sulle entità (ognuna è un singolo passo annullabile)
const Edit = (() => {
  const clone = Model.clone;
  const political = f => !!KINDS[f.properties.kind].political;

  function neighbors(id, g, margin = 1) {
    const b = Geo.bbox(g);
    return POLITICAL.flatMap(k => Store.all(k))
      .filter(o => o.id !== id && Geo.isPoly(o.geometry) && Geo.bboxHit(b, Geo.bbox(o.geometry), margin));
  }

  const validKingdom = id => (id && Store.get(id)?.properties.kind === 'regno') ? id : null;

  // Regola per le sovrapposizioni tra aree politiche (marche e protettorati):
  //  clip  = la nuova area si ferma ai confini esistenti
  //  steal = la nuova area viene tolta alle entità confinanti
  //  free  = nessun controllo
  function resolveOverlap(f, piece) {
    if (!political(f) || Settings.overlap === 'free') return piece;
    for (const o of neighbors(f.id, piece)) {
      if (Settings.overlap === 'clip') {
        piece = Geo.diff(piece, o.geometry);
        if (!piece) return null;
      } else {
        const g = Geo.diff(o.geometry, piece);
        if (!g) {
          Store.remove(o.id);
          UI.toast(`«${o.properties.name}» è stata interamente assorbita ed eliminata`, 'warn');
        } else if (Math.abs(Geo.area(g) - Geo.area(o.geometry)) > 0.5) {
          const c = clone(o); c.geometry = g; Store.put(c);
        }
      }
    }
    return piece;
  }

  // Allinea i vertici lungo i confini comuni con le entità politiche vicine
  function stitchAround(f) {
    if (!political(f) || !Geo.isPoly(f.geometry)) return;
    for (const o0 of neighbors(f.id, f.geometry, 2)) {
      const o = Store.get(o0.id);
      if (!o) continue;
      const og = Geo.stitch(o.geometry, f.geometry);
      if (og !== o.geometry) { const c = clone(o); c.geometry = og; Store.put(c); }
      f.geometry = Geo.stitch(f.geometry, og);
    }
  }

  // Tipo dell'entità creata: quello scelto in "Crea" se accetta la geometria, altrimenti un ripiego
  // (le linee a mano libera diventano fiumi, quelle per punti DMZ)
  function targetKind(want, geomType, lineFallback = 'acqua') {
    if (KINDS[want] && KINDS[want].geom.includes(geomType)) return want;
    return geomType === 'Point' ? 'localita' : geomType === 'LineString' ? lineFallback : 'marca';
  }

  function baseProps(kind) {
    return KINDS[kind].hasKingdom && kind !== 'localita' ? { kingdom: validKingdom(Settings.kingdom) } : {};
  }

  function createArea(want, poly) {
    const kind = targetKind(want, 'Polygon');
    Store.open(`Crea ${KINDS[kind].label.toLowerCase()}`);
    const f = Model.make(kind, baseProps(kind));
    const g = resolveOverlap(f, poly);
    if (!g) { Store.commit(); UI.toast("L'area disegnata è già interamente occupata da altre marche", 'warn'); return null; }
    f.geometry = g;
    stitchAround(f);
    Store.put(f);
    Store.commit();
    return f.id;
  }

  function createLine(want, line, fallback) {
    const kind = targetKind(want, 'LineString', fallback);
    const f = Model.make(kind, {}, line);
    Store.put(f, { label: `Crea ${KINDS[kind].label.toLowerCase()}` });
    Store.commit();
    return f.id;
  }

  // Linea ferroviaria (regole in docs/ferrovie.md). tol: distanza in blocchi entro cui un clic "prende" una stazione.
  //  - i vertici vicini a una stazione vanno esattamente sulla stazione: sono le fermate
  //  - un ultimo punto vicino al primo chiude la linea circolare (ultimo vertice = primo)
  //  - un capolinea (o il punto di chiusura dell'anello) fuori da una stazione ne crea una
  function createRailLine(line, tol) {
    const stations = Store.all('stazione').map(s => s.geometry.coordinates);
    const near = v => stations.find(c => Math.hypot(c[0] - v[0], c[1] - v[1]) <= tol);
    let pts = line.coordinates.map(v => (near(v) || v).slice());
    pts = pts.filter((v, i) => !i || !Geo.same(v, pts[i - 1]));   // doppio clic: vertici ripetuti
    if (pts.length < 2) return null;
    const ring = pts.length >= 4 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) <= tol;
    if (ring) pts[pts.length - 1] = pts[0].slice();
    const dup = Rail.duplicate(pts);
    if (dup) { UI.toast(dupMsg('La linea', dup), 'warn'); return null; }
    Store.open('Crea linea ferroviaria');
    let made = 0;
    for (const v of ring ? [pts[0]] : [pts[0], pts.at(-1)]) {
      if (stations.some(c => Geo.same(c, v))) continue;
      const st = Model.make('stazione', {}, { type: 'Point', coordinates: v.slice() });
      Store.put(st);
      stations.push(st.geometry.coordinates);
      made++;
    }
    const f = Model.make('linea', { subtype: Settings.railType, color: Settings.railColor }, { type: 'LineString', coordinates: pts });
    Store.put(f);
    Store.commit();
    Settings.railColor = null; Settings.save();   // la prossima linea riprende il primo colore libero
    if (made) UI.toast(`${made === 1 ? 'Creata una stazione' : `Create ${made} stazioni`} al capolinea: ${made === 1 ? 'dalle' : 'dai loro'} un nome`, 'info');
    return f.id;
  }

  function createPoint(want, pos) {
    const kind = targetKind(want, 'Point');
    if (kind === 'stazione' && stationAt(pos)) { UI.toast(`C'è già una stazione in quel punto`, 'warn'); return null; }
    Store.open(`Crea ${KINDS[kind].label.toLowerCase()}`);
    // una stazione posata su un binario diventa una fermata di quella linea (e delle altre che passano di lì)
    if (kind === 'stazione') pos = stopOnTracks(pos, railTol(), true);
    const f = Model.make(kind, baseProps(kind), { type: 'Point', coordinates: pos });
    Store.put(f);
    Store.commit();
    return f.id;
  }

  // ---- ferrovie: stazioni e fermate (regole in docs/ferrovie.md) ----
  // Distanza in blocchi entro cui una stazione "prende" un binario: 14 px allo zoom attuale
  const railTol = () => 14 * Math.pow(2, -Render.map.getZoom());
  const stationAt = (c, except) => Store.all('stazione').find(s => s.id !== except && Geo.same(s.geometry.coordinates, c));
  const dupMsg = (what, st) => `${what} passerebbe due volte da «${st.properties.name}»: una stazione compare una sola volta ` +
    'in una linea (tranne la chiusura di una linea circolare). Modifica annullata.';
  // modifica rifiutata: si ridisegna l'entità com'era (dopo l'evento in corso, che appartiene al suo layer)
  const rejectEdit = (id, msg) => { UI.toast(msg, 'warn'); setTimeout(() => Render.redraw(id), 0); };

  // Stazione nel punto pos: ogni linea il cui binario passa entro tol e che non ci ferma già riceve un vertice e
  // diventa una fermata. Con snap la stazione si sposta sul binario della prima linea trovata (o sul suo vertice,
  // se è lì vicino); senza, il vertice si aggiunge nel punto della stazione. Restituisce la posizione della stazione.
  function stopOnTracks(pos, tol, snap, skip = new Set()) {
    for (const l of Store.all('linea')) {
      if (skip.has(l.id) || l.geometry?.type !== 'LineString') continue;
      const c = l.geometry.coordinates;
      if (c.some(v => Geo.same(v, pos))) continue;
      const n = Geo.nearestOnLine(c, pos);
      if (!n || n.dist > tol) continue;
      if (snap) {
        const v = [c[n.seg], c[n.seg + 1]].find(x => Math.hypot(x[0] - n.pos[0], x[1] - n.pos[1]) <= tol / 3);
        pos = (v || n.pos).slice();
        snap = false;
      }
      const lc = clone(l);
      if (!lc.geometry.coordinates.some(v => Geo.same(v, pos))) lc.geometry.coordinates.splice(n.seg + 1, 0, pos.slice());
      Store.put(lc);
    }
    return pos;
  }

  // Sposta un punto. Una stazione porta con sé i vertici delle linee che ci fermano; se arriva su un binario
  // diventa anche una fermata di quella linea. source: 'edit' se il marker è già stato trascinato sulla mappa.
  function movePoint(id, pos, source) {
    const f = clone(Store.get(id));
    if (!f) return;
    if (f.properties.kind !== 'stazione') {
      f.geometry = { type: 'Point', coordinates: pos };
      Store.put(f, { source, label: 'Sposta' });
      Store.commit();
      return;
    }
    const from = f.geometry.coordinates;
    if (Geo.same(from, pos)) return;
    if (stationAt(pos, id)) return rejectEdit(id, `C'è già una stazione in quel punto. Spostamento annullato.`);
    const stations = Store.all('stazione').map(s => s.id === id ? { ...s, geometry: { type: 'Point', coordinates: pos } } : s);
    const lines = Rail.linesAt(from).map(l => ({ l, g: Geo.moveVertex(l.geometry, from, pos) }));
    const bad = lines.find(({ g }) => Rail.duplicate(g.coordinates, stations));
    if (bad) return rejectEdit(id, dupMsg(`«${bad.l.properties.name}»`, Store.get(id)));
    Store.open('Sposta stazione');
    lines.forEach(({ l, g }) => { const c = clone(l); c.geometry = g; Store.put(c); });
    // se la stazione non ha linee può agganciarsi al binario; se ne ha, resta dove la si è lasciata
    const at = stopOnTracks(pos, railTol(), !lines.length, new Set(lines.map(({ l }) => l.id)));
    f.geometry = { type: 'Point', coordinates: at };
    Store.put(f, { source: Geo.same(at, pos) ? source : undefined });
    Store.commit();
  }

  function createKingdom(props = {}) {
    const f = Model.make('regno', props);
    Store.put(f, { label: 'Crea regno' });
    Store.commit();
    return f.id;
  }

  function addArea(id, poly) {
    const f = clone(Store.get(id));
    if (!f || !Geo.isPoly(f.geometry)) return;
    Store.open('Aggiungi area');
    const piece = resolveOverlap(f, poly);
    if (!piece) { Store.commit(); UI.toast("L'area aggiunta è già occupata da altre marche", 'warn'); return; }
    f.geometry = Geo.union(f.geometry, piece);
    stitchAround(f);
    Store.put(f);
    Store.commit();
  }

  function subArea(id, poly) {
    const f = clone(Store.get(id));
    if (!f || !Geo.isPoly(f.geometry)) return;
    const g = Geo.diff(f.geometry, poly);
    if (!g) { UI.toast("Non resterebbe nulla dell'area: per eliminarla usa il pulsante Elimina", 'warn'); return; }
    f.geometry = g;
    Store.put(f, { label: 'Togli area' });
    Store.commit();
  }

  // Sostituisce l'intero confine (ridisegno)
  function replaceArea(id, poly) {
    const f = clone(Store.get(id));
    if (!f) return;
    Store.open('Ridisegna confine');
    const g = resolveOverlap(f, poly);
    if (!g) { Store.commit(); UI.toast("L'area disegnata è già interamente occupata", 'warn'); return; }
    f.geometry = g;
    stitchAround(f);
    Store.put(f);
    Store.commit();
  }

  // ---- modifiche dirette sulla mappa ----
  let dragFrom = null, railDrag = null;
  function vertexDragStart(id, from) { dragFrom = from; }
  function vertexDragEnd(id, to) {
    const from = dragFrom; dragFrom = null;
    const f = Store.get(id);
    if (!from || !f || Geo.same(from, to, 0)) return;
    if (f.properties.kind === 'linea') { railVertexMoved(f, from, to); return; }
    if (!Settings.link) return;
    const group = political(f) ? POLITICAL : [f.properties.kind];
    for (const k of group) for (const o of Store.all(k)) {
      if (o.id === id || !o.geometry) continue;
      const g = Geo.moveVertex(o.geometry, from, to);
      if (g) { const c = clone(o); c.geometry = g; Store.put(c, { label: 'Sposta vertice' }); }
    }
  }
  // Vertice di una linea ferroviaria trascinato (subito dopo arriva geometryEdited con la geometria del layer).
  // Se era una fermata, la stazione e le altre linee che ci fermano lo seguono. Si sposta ogni vertice della linea
  // che stava lì: nella linea circolare, primo e ultimo insieme.
  function railVertexMoved(f, from, to) {
    const st = stationAt(from), own = Geo.moveVertex(f.geometry, from, to);
    if (st && stationAt(to, st.id)) { railDrag = { id: f.id, reject: `C'è già una stazione in quel punto. Modifica annullata.` }; return; }
    const stations = Store.all('stazione').map(s => s === st ? { ...s, geometry: { type: 'Point', coordinates: to } } : s);
    const others = st ? Rail.linesAt(from).filter(l => l.id !== f.id).map(l => ({ l, g: Geo.moveVertex(l.geometry, from, to) })) : [];
    const bad = [{ l: f, g: own || f.geometry }, ...others].find(({ g }) => Rail.duplicate(g.coordinates, stations));
    if (bad) { railDrag = { id: f.id, reject: dupMsg(`«${bad.l.properties.name}»`, Rail.duplicate(bad.g.coordinates, stations)) }; return; }
    if (st) {
      const c = clone(st); c.geometry = { type: 'Point', coordinates: to.slice() };
      Store.put(c, { label: 'Sposta fermata' });
      others.forEach(({ l, g }) => { const c2 = clone(l); c2.geometry = g; Store.put(c2); });
    }
    railDrag = { id: f.id, geometry: own };
  }

  function geometryEdited(id, g) {
    const f = clone(Store.get(id));
    if (!f) return;
    if (f.properties.kind === 'linea') {
      const drag = railDrag?.id === id ? railDrag : null;
      railDrag = null;
      if (drag?.reject) { rejectEdit(id, drag.reject); return; }
      // vertice aggiunto o tolto: solo il controllo di unicità
      const dup = !drag && Rail.duplicate(g.coordinates);
      if (dup) { rejectEdit(id, dupMsg(`«${f.properties.name}»`, dup)); return; }
      // la geometria calcolata può differire da quella del layer (anello): in quel caso si ridisegna la linea
      const geom = drag?.geometry || g, redraw = JSON.stringify(geom) !== JSON.stringify(g);
      f.geometry = geom;
      Store.put(f, { source: redraw ? undefined : 'edit', label: 'Modifica linea' });
      return;
    }
    f.geometry = Geo.isPoly(g) ? (Geo.clean(g, 0) || f.geometry) : g;
    Store.put(f, { source: 'edit', label: 'Modifica confine' });
  }
  function labelMoved(id, pos, isShape) {
    if (isShape) { movePoint(id, pos, 'edit'); return; }   // punto trascinato (località, stazione)
    const f = clone(Store.get(id));
    if (!f) return;
    f.properties.label.pos = pos;
    Store.put(f, { source: 'edit', label: 'Sposta etichetta' });
  }

  // ---- proprietà ----
  function update(id, fn, opts = {}) {
    const f = clone(Store.get(id));
    if (!f) return;
    fn(f.properties, f);
    Store.put(f, opts);
    Store.commit();
  }

  function setKingdom(ids, kid) {
    Store.open('Assegna regno');
    for (const id of ids) {
      const f = clone(Store.get(id));
      if (f && f.properties.kingdom !== kid) { Model.setKingdoms(f.properties, [kid]); Store.put(f); }
    }
    Store.commit();
  }

  // Regni proprietari di un protettorato (anche più d'uno)
  function editKingdoms(id, fn, label) {
    const f = clone(Store.get(id));
    if (!f) return;
    const before = Model.kingdomIds(f.properties).join();
    Model.setKingdoms(f.properties, fn(Model.kingdomIds(f.properties).slice()));
    if (Model.kingdomIds(f.properties).join() === before) return;
    Store.put(f, { label });
    Store.commit();
  }
  const addKingdom = (id, kid) => editKingdoms(id, ks => [...ks, kid], 'Aggiungi regno');
  const removeKingdom = (id, kid) => editKingdoms(id, ks => ks.filter(k => k !== kid), 'Togli regno');
  // Trascinamento nel pannello: sostituisce solo il regno da cui si è presa la riga (to = null: lo toglie)
  const moveKingdom = (id, from, to) => editKingdoms(id, ks => {
    const i = from ? ks.indexOf(from) : -1;
    if (!to) return ks.filter(k => k !== from);
    if (ks.includes(to)) return ks.filter(k => k !== from);
    if (i < 0) return [...ks, to];
    ks[i] = to;
    return ks;
  }, 'Assegna regno');

  function remove(id) {
    const f = Store.get(id);
    if (!f) return;
    Store.open(`Elimina ${KINDS[f.properties.kind].label.toLowerCase()}`);
    // stazione: sulle linee il vertice resta come semplice curva; si avvisa delle fermate e dei capolinea persi
    if (f.properties.kind === 'stazione') {
      const c = f.geometry.coordinates, lines = Rail.linesAt(c);
      const ends = lines.filter(l => { const v = l.geometry.coordinates; return Geo.same(v[0], c) || Geo.same(v.at(-1), c); });
      const names = ls => ls.map(l => `«${l.properties.name}»`).join(', ');
      if (lines.length) UI.toast(`«${f.properties.name}» non è più una fermata di ${names(lines)}` +
        (ends.length ? `; ${names(ends)} ${ends.length === 1 ? 'resta' : 'restano'} senza capolinea in quel punto` : ''), 'warn');
    }
    if (f.properties.kind === 'regno') {
      for (const o of Store.all()) {
        const ks = Model.kingdomIds(o.properties);
        if (ks.includes(id)) { const c = clone(o); Model.setKingdoms(c.properties, ks.filter(k => k !== id)); Store.put(c); }
      }
    }
    Store.remove(id);
    Store.commit();
  }

  // Posizioni nello schema della rete (vista Schema): pos = { id stazione: [x, y] in unità di griglia | null = automatica }
  function setSchema(pos, label) {
    Store.open(label);
    for (const [id, v] of Object.entries(pos)) {
      const f = clone(Store.get(id));
      if (!f || JSON.stringify(f.properties.schema ?? null) === JSON.stringify(v)) continue;
      if (v) f.properties.schema = v; else delete f.properties.schema;
      Store.put(f);
    }
    Store.commit();
  }

  function simplify(id, tol) {
    const f = clone(Store.get(id));
    if (!f || !f.geometry || f.properties.kind === 'linea') return 0;   // linee ferroviarie: perderebbero le fermate
    const before = Geo.countVertices(f.geometry);
    f.geometry = Geo.simplify(f.geometry, tol);
    stitchAround(f);
    Store.put(f, { label: 'Semplifica confine' });
    Store.commit();
    return before - Geo.countVertices(f.geometry);
  }

  // Una MultiPolygon diventa più entità separate (una per parte)
  function explode(id) {
    const f = Store.get(id);
    if (!f || f.geometry?.type !== 'MultiPolygon') return [];
    Store.open('Separa parti');
    const ids = [];
    f.geometry.coordinates.forEach((poly, i) => {
      const c = clone(f);
      c.geometry = { type: 'Polygon', coordinates: poly };
      if (i) {
        c.properties.id = Model.newId(c.properties.kind, c.properties.name);
        c.properties.name = `${f.properties.name} (${i + 1})`;
        c.properties.label = { ...c.properties.label, pos: null };
      } else c.properties.label = { ...c.properties.label, pos: null };
      Store.put(c);
      ids.push(c.properties.id);
    });
    Store.commit();
    return ids;
  }

  return {
    createArea, createLine, createRailLine, createPoint, movePoint, createKingdom, addArea, subArea, replaceArea,
    vertexDragStart, vertexDragEnd, geometryEdited, labelMoved, update, setKingdom, addKingdom, removeKingdom, moveKingdom, remove, simplify,
    explode, targetKind, validKingdom, setSchema
  };
})();

// Strumenti interattivi sulla mappa
const Tools = (() => {
  let map, tool = 'select', drawing = null, space = false, swallow = false;
  const SNAP_PX = 14;   // distanza di aggancio (pixel), come snapDistance di Leaflet-Geoman
  const FREEHAND = ['freehand', 'line', 'add', 'sub', 'redraw'];

  const META = {
    select:   { key: 'V', name: 'Seleziona e modifica' },
    freehand: { key: 'F', name: 'Area a mano libera' },
    polygon:  { key: 'P', name: 'Area per punti' },
    line:     { key: 'L', name: 'Linea a mano libera (fiumi)' },
    polyline: { key: 'D', name: 'Linea per punti (DMZ, linee dritte)' },
    track:    { key: 'T', name: 'Posa binari (linee ferroviarie)' },
    point:    { key: 'K', name: 'Punto (località o stazione)' },
    add:      { key: 'B', name: "Pennello: aggiungi all'area selezionata" },
    sub:      { key: 'E', name: "Gomma: togli dall'area selezionata" },
    redraw:   { key: 'R', name: "Ridisegna il confine dell'area selezionata" }
  };

  const selectedArea = () => {
    const f = UI.selected && Store.get(UI.selected);
    return f && Geo.isPoly(f.geometry) ? f : null;
  };

  function hint() {
    const kindOf = (g, fb) => KINDS[Edit.targetKind(Settings.target, g, fb)].label.toLowerCase();
    const dmz = Edit.targetKind(Settings.target, 'LineString', 'territorio') === 'territorio';
    const sel = selectedArea();
    const name = sel ? `«${sel.properties.name}»` : '';
    switch (tool) {
      case 'select': return UI.selected
        ? 'Trascina i vertici per modificare il confine · clic su un lato per aggiungere un vertice · tasto destro su un vertice per toglierlo · trascina l\'etichetta per spostarla'
        : "Passa sopra un'entità per evidenziarla, clic per selezionarla";
      case 'freehand': return `Tieni premuto e disegna il contorno: nuova ${kindOf('Polygon')} · Spazio + trascina per spostare la mappa · Esc per annullare`;
      case 'polygon': return `Clic per aggiungere i vertici della nuova ${kindOf('Polygon')} · clic sul primo vertice o Invio per chiudere · Esc per annullare`;
      case 'line': return `Tieni premuto e disegna il corso del fiume · Spazio + trascina per spostare la mappa`;
      case 'polyline': return `Clic per aggiungere i punti ${dmz ? 'della DMZ' : `della linea (${kindOf('LineString', 'territorio')})`} · due clic = linea dritta · clic sull'ultimo punto o Invio per finire · Esc per annullare`;
      case 'track': return `Clic per posare il binario ${Settings.zigzag ? 'a zig-zag (45°)' : 'in orizzontale o in verticale'} · clic su una stazione = fermata · clic sul primo punto = linea circolare · clic sull'ultimo punto, doppio clic o Invio per finire · Backspace toglie l'ultimo punto · X zig-zag · Esc per annullare`;
      case 'point': return `Clic sulla mappa per posizionare la nuova ${kindOf('Point')}`;
      case 'add': return `Disegna l'area da aggiungere a ${name} · Spazio + trascina per spostare la mappa · Esc per finire`;
      case 'sub': return `Disegna l'area da togliere a ${name} · Spazio + trascina per spostare la mappa · Esc per finire`;
      case 'redraw': return `Disegna il nuovo confine completo di ${name}`;
    }
    return '';
  }

  function set(t) {
    if (['add', 'sub', 'redraw'].includes(t) && !selectedArea()) {
      UI.toast("Seleziona prima un'area (marca, protettorato, territorio…)", 'warn');
      return;
    }
    cancel();
    if (map.pm.globalDrawModeEnabled()) map.pm.disableDraw();
    tool = t;
    const el = map.getContainer();
    el.className = el.className.replace(/\btool-\S+/g, '').trim();
    el.classList.add('tool-' + t);
    el.classList.toggle('pe-drawing', t !== 'select');
    if (FREEHAND.includes(t)) map.dragging.disable(); else map.dragging.enable();
    if (t === 'track') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();   // il doppio clic finisce la linea
    Render.setEditing(t === 'select');
    if (t === 'polygon') {
      map.pm.enableDraw('Polygon', {
        snappable: Settings.snap, snapDistance: 14, allowSelfIntersection: false, continueDrawing: false,
        templineStyle: { color: '#ffffff', weight: 2 },
        hintlineStyle: { color: '#ffffff', weight: 1.5, dashArray: '5 5' },
        pathOptions: { color: '#ffffff', weight: 2, fillOpacity: 0.15 }
      });
    } else if (t === 'polyline') {
      map.pm.enableDraw('Line', {
        snappable: Settings.snap, snapDistance: 14, continueDrawing: false,
        templineStyle: { color: '#ffffff', weight: 2 },
        hintlineStyle: { color: '#ffffff', weight: 1.5, dashArray: '5 5' },
        pathOptions: { color: '#ffffff', weight: 2 }
      });
    }
    UI.onTool(t);
  }

  const sketchColor = () => tool === 'sub' ? '#ff6b6b' : tool === 'add' ? '#7dff9a' : '#ffffff';

  function start(e) {
    const p = map.mouseEventToContainerPoint(e);
    const ll = map.containerPointToLatLng(p);
    const opts = { pane: 'sketch', interactive: false, pmIgnore: true, snapIgnore: true, color: sketchColor(),
      weight: 2.5, fillColor: sketchColor(), fillOpacity: 0.12, dashArray: tool === 'sub' ? '6 5' : null };
    drawing = { pts: [p], line: (tool === 'line' ? L.polyline([ll], opts) : L.polygon([ll], opts)).addTo(map) };
  }

  function move(e) {
    const p = map.mouseEventToContainerPoint(e);
    const last = drawing.pts[drawing.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
    drawing.pts.push(p);
    drawing.line.addLatLng(map.containerPointToLatLng(p));
  }

  function finish() {
    const d = drawing;
    drawing = null;
    swallowNextClick();   // il click che segue il rilascio non deve deselezionare
    d.line.remove();
    if (d.pts.length < 3) return;
    const pts = Geo.rdp(d.pts, 1.2).map(p => Geo.xz(map.containerPointToLatLng(p)));
    if (tool === 'line') {
      if (pts.length < 2) return;
      const id = Edit.createLine(Settings.target, { type: 'LineString', coordinates: pts });
      if (id) { set('select'); UI.select(id, { focus: true }); }
      return;
    }
    if (pts.length < 3) return;
    const poly = Geo.fix({ type: 'Polygon', coordinates: [Geo.closeRing(pts)] });
    if (!poly) return;
    if (tool === 'freehand') {
      const id = Edit.createArea(Settings.target, poly);
      if (id) { set('select'); UI.select(id, { focus: true }); }
    } else if (tool === 'add') Edit.addArea(UI.selected, poly);
    else if (tool === 'sub') Edit.subArea(UI.selected, poly);
    else if (tool === 'redraw') { Edit.replaceArea(UI.selected, poly); set('select'); }
  }

  function swallowNextClick() {
    swallow = true;
    setTimeout(() => { swallow = false; }, 300);
  }

  function cancel() {
    if (drawing) { drawing.line.remove(); drawing = null; }
    trackClear();
  }

  function escape() {
    if (drawing) { cancel(); return true; }
    if (trk.pts.length) { trackClear(); return true; }
    if (tool !== 'select') { set('select'); return true; }
    return false;
  }

  function init(m) {
    map = m;
    const el = map.getContainer();
    map.pm.setLang('it');
    map.pm.setGlobalOptions({ snappable: true, snapDistance: 14 });

    // Disegno a mano libera: intercetta i puntatori prima di Leaflet (fase di cattura)
    el.addEventListener('pointerdown', e => {
      if (!FREEHAND.includes(tool) || space || e.button !== 0 || e.target.closest('.leaflet-control')) return;
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      start(e);
    }, true);
    el.addEventListener('pointermove', e => { if (drawing) { e.stopPropagation(); move(e); } }, true);
    el.addEventListener('pointerup', e => { if (drawing) { e.stopPropagation(); finish(); } }, true);
    el.addEventListener('pointercancel', () => cancel(), true);

    // Spazio tenuto premuto: sposta la mappa anche mentre si disegna
    document.addEventListener('keydown', e => {
      if (e.code !== 'Space' || UI.typing(e) || space) return;
      e.preventDefault();
      space = true;
      el.classList.add('pe-panning');
      map.dragging.enable();
    });
    document.addEventListener('keyup', e => {
      if (e.code !== 'Space' || !space) return;
      space = false;
      el.classList.remove('pe-panning');
      if (FREEHAND.includes(tool)) map.dragging.disable();
    });

    map.on('pm:create', e => {
      swallowNextClick();
      const g = Geo.fromLayer(e.layer);
      e.layer.remove();
      if (e.shape === 'Line') {
        const id = g && g.coordinates.length >= 2 && Edit.createLine(Settings.target, g, 'territorio');
        set('select');
        if (id) UI.select(id, { focus: true });
        return;
      }
      const poly = Geo.fix(g);
      const id = poly && Edit.createArea(Settings.target, poly);
      set('select');
      if (id) UI.select(id, { focus: true });
    });

    map.on('click', e => {
      if (swallow) { swallow = false; return; }
      if (tool === 'point') {
        const id = Edit.createPoint(Settings.target, Geo.xz(e.latlng));
        set('select');
        UI.select(id, { focus: true });
      } else if (tool === 'track') trackClick(e.latlng);
      else if (tool === 'select') UI.select(null);
    });
    map.on('mousemove', e => { if (tool === 'track') { trk.mouse = e.latlng; trackPreview(); } });

    set('select');
  }

  // ---- Posa binari: linee ferroviarie solo orizzontali/verticali, o a 45° con lo zig-zag (docs/ferrovie.md, fase 7)
  // pts: punti posati; mouse: ultima posizione del puntatore (per ridisegnare l'anteprima cambiando modo)
  const trk = { pts: [], mouse: null, laid: null, next: null, cursor: null };
  const r1 = v => Math.round(v * 10) / 10;
  const railColor = () => Settings.railColor || Model.nextColor('linea');

  // Punti da aggiungere andando dall'ultimo punto a verso p. Senza end: un tratto di blocchi interi lungo l'asse
  // prevalente (o lungo la diagonale del quadrante, in zig-zag). Con end (p è una stazione o il primo punto): si
  // arriva esattamente su p, con un gomito se non è allineato (orizzontale + verticale, oppure 45° + dritto).
  function trackStep(a, p, end) {
    const dx = p[0] - a[0], dz = p[1] - a[1], sx = dx < 0 ? -1 : 1, sz = dz < 0 ? -1 : 1;
    const ax = Math.abs(dx), az = Math.abs(dz);
    if (!end) {
      if (!Settings.zigzag) return [ax >= az ? [a[0] + Math.round(dx), a[1]] : [a[0], a[1] + Math.round(dz)]];
      const t = Math.round((ax + az) / 2);
      return [[a[0] + sx * t, a[1] + sz * t]];
    }
    const e = Settings.zigzag
      ? (ax <= az ? [p[0], r1(a[1] + sz * ax)] : [r1(a[0] + sx * az), p[1]])
      : (ax >= az ? [p[0], a[1]] : [a[0], p[1]]);
    return Geo.same(e, a) || Geo.same(e, p) ? [p.slice()] : [e, p.slice()];
  }

  // Dove porta il puntatore: { kind: 'last' | 'ring' | 'station' | 'free', path: punti da aggiungere, station }
  function trackTarget(ll) {
    const px = c => map.latLngToContainerPoint(Geo.ll(c)).distanceTo(map.latLngToContainerPoint(ll));
    const p = Geo.xz(ll), pts = trk.pts, a = pts.at(-1);
    const st = Store.all('stazione').map(s => ({ s, d: px(s.geometry.coordinates) }))
      .filter(o => o.d <= SNAP_PX).sort((x, y) => x.d - y.d)[0]?.s;
    if (!a) return { kind: 'free', path: [st ? st.geometry.coordinates.slice() : p.map(Math.round)], station: st };
    if (px(a) <= SNAP_PX) return { kind: 'last', path: [] };
    if (pts.length >= 2 && px(pts[0]) <= SNAP_PX) return { kind: 'ring', path: trackStep(a, pts[0], true) };
    if (st) return { kind: 'station', path: trackStep(a, st.geometry.coordinates, true), station: st };
    const path = trackStep(a, p, false);
    return Geo.same(path[0], a) ? { kind: 'last', path: [] } : { kind: 'free', path };
  }

  function trackPreview() {
    if (tool !== 'track' || !trk.mouse) return;
    const t = trackTarget(trk.mouse), a = trk.pts.at(-1);
    const end = t.path.at(-1) || a, lls = [a, ...t.path].filter(Boolean).map(Geo.ll);
    const opts = { pane: 'sketch', interactive: false, pmIgnore: true, snapIgnore: true };
    if (!trk.next) trk.next = L.polyline([], { ...opts, color: railColor(), weight: 3, dashArray: '6 6' }).addTo(map);
    if (!trk.cursor) trk.cursor = L.circleMarker(Geo.ll(end), { ...opts, radius: 5, weight: 2, color: '#fff', fillOpacity: 1 })
      .bindTooltip('', { permanent: true, direction: 'top', offset: [0, -8], className: 'pe-track-tip' }).addTo(map);
    trk.next.setLatLngs(lls);
    trk.next.setStyle({ color: railColor() });
    trk.cursor.setLatLng(Geo.ll(end));
    trk.cursor.setStyle({ fillColor: t.station || t.kind === 'ring' ? '#fff' : railColor() });
    let len = 0;
    [a, ...t.path].forEach((v, i, all) => { if (i && all[i - 1]) len += Math.hypot(v[0] - all[i - 1][0], v[1] - all[i - 1][1]); });
    const label = t.kind === 'last' ? (trk.pts.length > 1 ? 'fine' : '') : t.kind === 'ring' ? 'chiudi l\'anello'
      : t.station ? `«${t.station.properties.name}»` : '';
    const tip = [a && len ? `${Math.round(len).toLocaleString('it-IT')} blocchi` : '', label].filter(Boolean).join(' · ');
    trk.cursor.setTooltipContent(tip);
    trk.cursor.getTooltip()?.getElement()?.classList.toggle('empty', !tip);
  }

  function trackRedraw() {
    const lls = trk.pts.map(Geo.ll);
    if (!trk.laid) trk.laid = L.polyline([], { pane: 'sketch', interactive: false, pmIgnore: true, snapIgnore: true, weight: 4, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    trk.laid.setLatLngs(lls);
    trk.laid.setStyle({ color: railColor() });
    trackPreview();
  }

  function trackClear() {
    ['laid', 'next', 'cursor'].forEach(k => { if (trk[k]) { trk[k].remove(); trk[k] = null; } });
    trk.pts = [];
  }

  function trackClick(ll) {
    trk.mouse = ll;
    const t = trackTarget(ll);
    if (t.kind === 'last') { if (trk.pts.length >= 2) trackFinish(); return; }
    // regola di unicità: una stazione già toccata si rifiuta subito (la chiusura dell'anello è a parte)
    const used = t.station && trk.pts.some(v => Geo.same(v, t.station.geometry.coordinates));
    if (used) { UI.toast(`La linea passa già da «${t.station.properties.name}»: una stazione compare una sola volta in una linea (tranne la chiusura di una linea circolare)`, 'warn'); return; }
    if (t.kind === 'ring' && trk.pts.length + t.path.length < 4) return;   // anello degenere (andata e ritorno)
    trk.pts.push(...t.path);
    if (t.kind === 'ring') { trackFinish(); return; }
    trackRedraw();
  }

  function trackFinish() {
    const pts = trk.pts;
    trackClear();
    // i vertici sono già esatti (fermate, chiusura dell'anello): basta la tolleranza di Geo.same
    const id = pts.length >= 2 && Edit.createRailLine({ type: 'LineString', coordinates: pts }, 0.05);
    set('select');
    if (id) UI.select(id, { focus: true });
  }

  // Backspace durante la posa: toglie l'ultimo punto
  function undoPoint() {
    if (tool !== 'track' || !trk.pts.length) return false;
    trk.pts.pop();
    trackRedraw();
    return true;
  }

  // Zig-zag acceso o spento (anche a metà linea): ridisegna l'anteprima e il suggerimento
  function setZigzag(on) {
    Settings.zigzag = on; Settings.save();
    trackPreview();
    UI.onTool(tool);
  }

  // Invio: chiude l'area o termina la linea che si sta disegnando per punti
  function finishPolygon() {
    if (tool === 'track') { if (trk.pts.length >= 2) trackFinish(); return; }
    try {
      if (tool === 'polygon') map.pm.Draw.Polygon._finishShape();
      else if (tool === 'polyline') map.pm.Draw.Line._finishShape();
    } catch { /* troppo pochi punti */ }
  }

  return { init, set, escape, hint, finishPolygon, undoPoint, setZigzag, META, get tool() { return tool; } };
})();
