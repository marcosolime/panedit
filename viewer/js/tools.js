// Preferenze dell'editor (ricordate nel browser)
const Settings = (() => {
  const KEY = 'panera-editor-settings';
  const s = { snap: true, link: true, grid: false, leftOpen: true, rightOpen: true, overlap: 'clip', target: 'marca', kingdom: null, simplify: 2, bgBrightness: 100, bgSaturation: 100,
    railType: 'fermate', railColor: null };   // categoria e colore (null = primo libero) della prossima linea ferroviaria
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
    const f = Model.make(kind, baseProps(kind), { type: 'Point', coordinates: pos });
    Store.put(f, { label: `Crea ${KINDS[kind].label.toLowerCase()}` });
    Store.commit();
    return f.id;
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
  let dragFrom = null;
  function vertexDragStart(id, from) { dragFrom = from; }
  function vertexDragEnd(id, to) {
    const from = dragFrom; dragFrom = null;
    const f = Store.get(id);
    if (!Settings.link || !from || !f || Geo.same(from, to, 0)) return;
    const group = political(f) ? POLITICAL : [f.properties.kind];
    for (const k of group) for (const o of Store.all(k)) {
      if (o.id === id || !o.geometry) continue;
      const g = Geo.moveVertex(o.geometry, from, to);
      if (g) { const c = clone(o); c.geometry = g; Store.put(c, { label: 'Sposta vertice' }); }
    }
  }
  function geometryEdited(id, g) {
    const f = clone(Store.get(id));
    if (!f) return;
    f.geometry = Geo.isPoly(g) ? (Geo.clean(g, 0) || f.geometry) : g;
    Store.put(f, { source: 'edit', label: 'Modifica confine' });
  }
  function labelMoved(id, pos, isShape) {
    const f = clone(Store.get(id));
    if (!f) return;
    if (isShape) f.geometry = { type: 'Point', coordinates: pos };
    else f.properties.label.pos = pos;
    Store.put(f, { source: 'edit', label: isShape ? 'Sposta' : 'Sposta etichetta' });
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
    if (f.properties.kind === 'regno') {
      for (const o of Store.all()) {
        const ks = Model.kingdomIds(o.properties);
        if (ks.includes(id)) { const c = clone(o); Model.setKingdoms(c.properties, ks.filter(k => k !== id)); Store.put(c); }
      }
    }
    Store.remove(id);
    Store.commit();
  }

  function simplify(id, tol) {
    const f = clone(Store.get(id));
    if (!f || !f.geometry) return 0;
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
    createArea, createLine, createRailLine, createPoint, createKingdom, addArea, subArea, replaceArea,
    vertexDragStart, vertexDragEnd, geometryEdited, labelMoved, update, setKingdom, addKingdom, removeKingdom, moveKingdom, remove, simplify,
    explode, targetKind, validKingdom
  };
})();

// Strumenti interattivi sulla mappa
const Tools = (() => {
  let map, tool = 'select', drawing = null, space = false, swallow = false;
  const SNAP_PX = 14;   // distanza di aggancio (pixel), come snapDistance di Leaflet-Geoman
  let lastDown = null;
  const FREEHAND = ['freehand', 'line', 'add', 'sub', 'redraw'];

  const META = {
    select:   { key: 'V', name: 'Seleziona e modifica' },
    freehand: { key: 'F', name: 'Area a mano libera' },
    polygon:  { key: 'P', name: 'Area per punti' },
    line:     { key: 'L', name: 'Linea a mano libera (fiumi)' },
    polyline: { key: 'D', name: 'Linea per punti (DMZ, linee dritte)' },
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
      case 'polyline': if (Edit.targetKind(Settings.target, 'LineString', 'territorio') === 'linea')
        return 'Clic su una stazione per una fermata, altrove per una curva · clic sul primo punto per chiudere una linea circolare · clic sull\'ultimo punto, doppio clic o Invio per finire · Esc per annullare';
        return `Clic per aggiungere i punti ${dmz ? 'della DMZ' : `della linea (${kindOf('LineString', 'territorio')})`} · due clic = linea dritta · clic sull'ultimo punto o Invio per finire · Esc per annullare`;
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
  }

  function escape() {
    if (drawing) { cancel(); return true; }
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
    // ultimo clic sulla mappa (serve a riconoscere la chiusura di una linea circolare)
    el.addEventListener('pointerdown', e => { lastDown = { p: map.mouseEventToContainerPoint(e), t: Date.now() }; }, true);

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
        const rail = Edit.targetKind(Settings.target, 'LineString', 'territorio') === 'linea';
        const ok = g && g.coordinates.length >= 2;
        // Leaflet-Geoman termina la linea quando si clicca il primo punto, ma senza aggiungerlo: se il clic che l'ha
        // terminata era sul primo punto, è una linea circolare e il vertice di chiusura lo si aggiunge qui
        if (rail && ok && g.coordinates.length >= 3 && lastDown && Date.now() - lastDown.t < 1000 &&
            map.latLngToContainerPoint(Geo.ll(g.coordinates[0])).distanceTo(lastDown.p) <= SNAP_PX)
          g.coordinates.push(g.coordinates[0].slice());
        const id = ok && (rail ? Edit.createRailLine(g, SNAP_PX * Math.pow(2, -map.getZoom())) : Edit.createLine(Settings.target, g, 'territorio'));
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
      } else if (tool === 'select') UI.select(null);
    });

    set('select');
  }

  // Invio: chiude l'area o termina la linea che si sta disegnando per punti
  function finishPolygon() {
    try {
      if (tool === 'polygon') map.pm.Draw.Polygon._finishShape();
      else if (tool === 'polyline') map.pm.Draw.Line._finishShape();
    } catch { /* troppo pochi punti */ }
  }

  return { init, set, escape, hint, finishPolygon, META, get tool() { return tool; } };
})();
