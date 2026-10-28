// Geometria. Le coordinate salvate nel GeoJSON sono coordinate di gioco [x, z] in blocchi
// (z cresce verso sud). In Leaflet (CRS.Simple) lat = -z, lng = x.
const Geo = (() => {
  const r1 = v => Math.round(v * 10) / 10;
  const ll = p => L.latLng(-p[1], p[0]);
  const xz = l => [r1(l.lng), r1(-l.lat)];
  const same = (a, b, eps = 0.05) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
  const isPoly = g => !!g && (g.type === 'Polygon' || g.type === 'MultiPolygon');
  const isLine = g => !!g && (g.type === 'LineString' || g.type === 'MultiLineString');

  const openRing = r => (r.length > 1 && same(r[0], r[r.length - 1], 0)) ? r.slice(0, -1) : r;
  const closeRing = r => (!r.length || same(r[0], r[r.length - 1], 0)) ? r : [...r, [r[0][0], r[0][1]]];

  // ---- conversioni GeoJSON <-> Leaflet ----
  function toLatLngs(g) {
    switch (g.type) {
      case 'Point': return ll(g.coordinates);
      case 'LineString': return g.coordinates.map(ll);
      case 'MultiLineString': return g.coordinates.map(l => l.map(ll));
      case 'Polygon': return g.coordinates.map(r => openRing(r).map(ll));
      case 'MultiPolygon': return g.coordinates.map(p => p.map(r => openRing(r).map(ll)));
    }
  }

  function fromLayer(layer) {
    if (layer.getLatLng) return { type: 'Point', coordinates: xz(layer.getLatLng()) };
    const lls = layer.getLatLngs();
    if (layer instanceof L.Polygon) {
      if (L.LineUtil.isFlat(lls)) return { type: 'Polygon', coordinates: [closeRing(lls.map(xz))] };
      if (L.LineUtil.isFlat(lls[0])) return { type: 'Polygon', coordinates: lls.map(r => closeRing(r.map(xz))) };
      const parts = lls.filter(p => p.length && p[0].length >= 3);
      if (parts.length === 1) return { type: 'Polygon', coordinates: parts[0].map(r => closeRing(r.map(xz))) };
      return { type: 'MultiPolygon', coordinates: parts.map(p => p.map(r => closeRing(r.map(xz)))) };
    }
    if (L.LineUtil.isFlat(lls)) return { type: 'LineString', coordinates: lls.map(xz) };
    return { type: 'MultiLineString', coordinates: lls.map(l => l.map(xz)) };
  }

  // ---- visite ----
  function eachCoord(g, fn) {
    if (!g) return;
    const c = g.coordinates;
    switch (g.type) {
      case 'Point': fn(c); break;
      case 'LineString': c.forEach(fn); break;
      case 'MultiLineString': case 'Polygon': c.forEach(l => l.forEach(fn)); break;
      case 'MultiPolygon': c.forEach(p => p.forEach(r => r.forEach(fn))); break;
    }
  }

  // Applica fn a ogni "linea" (anello o polilinea) restituendo una nuova geometria
  function mapLines(g, fn) {
    const c = g.coordinates;
    switch (g.type) {
      case 'LineString': return { type: g.type, coordinates: fn(c, false) };
      case 'MultiLineString': return { type: g.type, coordinates: c.map(l => fn(l, false)) };
      case 'Polygon': return { type: g.type, coordinates: c.map(r => fn(r, true)) };
      case 'MultiPolygon': return { type: g.type, coordinates: c.map(p => p.map(r => fn(r, true))) };
      default: return g;
    }
  }

  const polygons = g => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];

  function bbox(g) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    eachCoord(g, p => {
      if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1];
      if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1];
    });
    return b;
  }
  const bboxHit = (a, b, m = 0) => a[0] - m <= b[2] && b[0] - m <= a[2] && a[1] - m <= b[3] && b[1] - m <= a[3];
  const bounds = g => { const b = bbox(g); return L.latLngBounds(ll([b[0], b[1]]), ll([b[2], b[3]])); };

  // Negli anelli dei poligoni l'ultima coordinata ripete la prima: non è un vertice a sé
  function countVertices(g) {
    let n = 0;
    if (isPoly(g)) polygons(g).forEach(p => p.forEach(r => n += r.length - 1));
    else eachCoord(g, () => n++);
    return n;
  }

  // ---- misure (planari, in blocchi) ----
  function ringArea(r) {
    let s = 0;
    for (let i = 0, n = r.length; i < n; i++) {
      const a = r[i], b = r[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  }
  const polyArea = p => p.reduce((s, r, i) => s + (i ? -1 : 1) * ringArea(r), 0);
  const area = g => polygons(g).reduce((s, p) => s + polyArea(p), 0);

  function lineLength(l) {
    let s = 0;
    for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
    return s;
  }
  function length(g) {
    if (!g) return 0;
    if (g.type === 'LineString') return lineLength(g.coordinates);
    if (g.type === 'MultiLineString') return g.coordinates.reduce((s, l) => s + lineLength(l), 0);
    let s = 0; polygons(g).forEach(p => p.forEach(r => s += lineLength(r)));
    return s;
  }

  // ---- pulizia ----
  // Arrotonda, elimina punti doppi, anelli degeneri e frammenti più piccoli di minArea blocchi²
  function clean(g, minArea = 4) {
    if (!g) return null;
    const ring = r => {
      const out = [];
      for (const p of r) {
        const q = [r1(p[0]), r1(p[1])];
        if (!out.length || !same(out[out.length - 1], q, 0)) out.push(q);
      }
      const c = closeRing(out);
      return c.length >= 4 && ringArea(c) >= minArea ? c : null;
    };
    const polys = [];
    for (const p of polygons(g)) {
      const outer = ring(p[0]);
      if (!outer) continue;
      polys.push([outer, ...p.slice(1).map(ring).filter(Boolean)]);
    }
    if (!polys.length) return null;
    return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
  }

  // ---- operazioni booleane (turf / polyclip, planari) ----
  const feat = g => ({ type: 'Feature', properties: {}, geometry: g });
  const fc = gs => ({ type: 'FeatureCollection', features: gs.map(feat) });
  function safe(op, fallback) {
    try { return op(); } catch (err) { console.warn('Operazione geometrica fallita', err); return fallback; }
  }
  const union = (a, b) => !a ? b : !b ? a : safe(() => clean(turf.union(fc([a, b]))?.geometry), a);
  const unionAll = gs => gs.length < 2 ? (gs[0] || null) : safe(() => clean(turf.union(fc(gs))?.geometry), gs[0]);
  const diff = (a, b) => !a ? null : !b ? a : safe(() => clean(turf.difference(fc([a, b]))?.geometry), a);
  // Ripara auto-intersezioni (es. un tratto a mano libera che si incrocia)
  const fix = g => safe(() => clean(turf.union(fc([g, g]))?.geometry), clean(g));

  function simplify(g, tolerance) {
    if (!g || g.type === 'Point') return g;
    const s = safe(() => turf.simplify(feat(g), { tolerance, highQuality: true }).geometry, g);
    return isPoly(s) ? (clean(s) || g) : s;
  }

  // Ramer–Douglas–Peucker su punti {x, y} (coordinate schermo)
  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    // Tratto chiuso (fine ≈ inizio): si divide nel punto più lontano, altrimenti la corda è nulla
    const f = pts[0], l = pts[pts.length - 1];
    if (Math.hypot(l.x - f.x, l.y - f.y) <= eps) {
      let k = 1, dmax = -1;
      pts.forEach((p, i) => { const d = Math.hypot(p.x - f.x, p.y - f.y); if (d > dmax) { dmax = d; k = i; } });
      if (k > 0 && k < pts.length - 1) return [...rdp(pts.slice(0, k + 1), eps), ...rdp(pts.slice(k), eps).slice(1)];
    }
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [i, j] = stack.pop();
      const a = pts[i], b = pts[j];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      let best = -1, dmax = eps;
      for (let k = i + 1; k < j; k++) {
        const d = Math.abs(dy * pts[k].x - dx * pts[k].y + b.x * a.y - b.y * a.x) / len;
        if (d > dmax) { dmax = d; best = k; }
      }
      if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // ---- confini condivisi ----
  // Inserisce nei lati di g i vertici di ref che vi cadono sopra, così due aree confinanti
  // hanno esattamente gli stessi vertici lungo il confine (e si possono trascinare insieme).
  function stitch(g, ref, eps = 0.06) {
    if (!isPoly(g) || !ref) return g;
    const rb = bbox(ref);
    const pts = [];
    eachCoord(ref, p => pts.push(p));
    let added = 0;
    const out = mapLines(g, (ring, closed) => {
      const res = [];
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        res.push(a);
        if (Math.max(a[0], b[0]) < rb[0] - eps || Math.min(a[0], b[0]) > rb[2] + eps ||
            Math.max(a[1], b[1]) < rb[1] - eps || Math.min(a[1], b[1]) > rb[3] + eps) continue;
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        if (!l2) continue;
        const ins = [];
        for (const p of pts) {
          const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
          if (t <= 0.0001 || t >= 0.9999) continue;
          const qx = a[0] + t * dx, qy = a[1] + t * dy;
          if (Math.abs(qx - p[0]) > eps || Math.abs(qy - p[1]) > eps) continue;
          if (same(p, a) || same(p, b)) continue;
          ins.push([t, p]);
        }
        ins.sort((u, v) => u[0] - v[0]);
        for (const [, p] of ins) if (!same(res[res.length - 1], p)) { res.push([p[0], p[1]]); added++; }
      }
      res.push(ring[ring.length - 1]);
      return res;
    });
    return added ? out : g;
  }

  // Sposta i vertici di g che coincidono con 'from'
  function moveVertex(g, from, to) {
    let moved = 0;
    const out = mapLines(g, l => l.map(p => same(p, from) ? (moved++, [to[0], to[1]]) : p));
    return moved ? out : null;
  }

  // ---- posizionamento etichette ----
  // Polo di inaccessibilità (algoritmo "polylabel" di Mapbox, ISC): il punto interno più lontano dai bordi
  function polylabel(poly, precision) {
    const b = bbox({ type: 'Polygon', coordinates: poly });
    const w = b[2] - b[0], h = b[3] - b[1], size = Math.min(w, h);
    if (!size) return [b[0], b[1]];
    precision = precision || Math.max(1, size / 200);
    const dist = (x, y) => {
      let inside = false, min = Infinity;
      for (const r of poly) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const a = r[i], c = r[j];
          if ((a[1] > y) !== (c[1] > y) && x < (c[0] - a[0]) * (y - a[1]) / (c[1] - a[1]) + a[0]) inside = !inside;
          min = Math.min(min, segDist2(x, y, a, c));
        }
      }
      return (inside ? 1 : -1) * Math.sqrt(min);
    };
    const cell = (x, y, hh) => { const d = dist(x, y); return { x, y, h: hh, d, max: d + hh * Math.SQRT2 }; };
    const heap = new Heap((a, b) => b.max - a.max);
    const half = size / 2;
    for (let x = b[0]; x < b[2]; x += size)
      for (let y = b[1]; y < b[3]; y += size) heap.push(cell(x + half, y + half, half));
    let best = cell(b[0] + w / 2, b[1] + h / 2, 0);
    let guard = 0;
    while (heap.size && guard++ < 20000) {
      const c = heap.pop();
      if (c.d > best.d) best = c;
      if (c.max - best.d <= precision) continue;
      const hh = c.h / 2;
      heap.push(cell(c.x - hh, c.y - hh, hh)); heap.push(cell(c.x + hh, c.y - hh, hh));
      heap.push(cell(c.x - hh, c.y + hh, hh)); heap.push(cell(c.x + hh, c.y + hh, hh));
    }
    return [r1(best.x), r1(best.y)];
  }
  function segDist2(x, y, a, b) {
    let px = a[0], py = a[1], dx = b[0] - px, dy = b[1] - py;
    if (dx || dy) {
      const t = ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy);
      if (t > 1) { px = b[0]; py = b[1]; } else if (t > 0) { px += dx * t; py += dy * t; }
    }
    dx = x - px; dy = y - py;
    return dx * dx + dy * dy;
  }
  class Heap {
    constructor(cmp) { this.a = []; this.cmp = cmp; }
    get size() { return this.a.length; }
    push(v) {
      const a = this.a; a.push(v);
      let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (this.cmp(a[i], a[p]) >= 0) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && this.cmp(a[l], a[m]) < 0) m = l;
          if (r < a.length && this.cmp(a[r], a[m]) < 0) m = r;
          if (m === i) break;
          [a[i], a[m]] = [a[m], a[i]]; i = m;
        }
      }
      return top;
    }
  }

  // Punto etichetta della parte più grande di un'area
  function labelPoint(g) {
    const ps = polygons(g);
    if (!ps.length) return null;
    let best = ps[0], ba = -1;
    for (const p of ps) { const a = polyArea(p); if (a > ba) { ba = a; best = p; } }
    return polylabel(best);
  }

  // Punto a metà lunghezza di una linea, con l'angolo del tratto (gradi, leggibile)
  function lineMid(g) {
    const l = g.type === 'MultiLineString'
      ? g.coordinates.reduce((m, c) => lineLength(c) > lineLength(m) ? c : m, g.coordinates[0])
      : g.coordinates;
    const half = lineLength(l) / 2;
    let acc = 0;
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + d >= half) {
        const t = d ? (half - acc) / d : 0;
        let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
        if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
        return { pos: [r1(a[0] + t * (b[0] - a[0])), r1(a[1] + t * (b[1] - a[1]))], angle: Math.round(ang) };
      }
      acc += d;
    }
    return { pos: l[0], angle: 0 };
  }

  return {
    r1, ll, xz, same, isPoly, isLine, toLatLngs, fromLayer, eachCoord, mapLines, polygons,
    bbox, bboxHit, bounds, countVertices, area, length, clean, union, unionAll, diff, fix, simplify,
    rdp, stitch, moveVertex, polylabel, labelPoint, lineMid, closeRing
  };
})();
