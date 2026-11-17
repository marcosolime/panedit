// Schema "metropolitana" della rete ferroviaria (docs/ferrovie.md, fasi 5 e 6): disposizione ottilineare delle
// stazioni (tratti a 0°, 45°, 90°) e disegno in SVG, con le linee affiancate dove corrono insieme. Euristica pensata
// per alcune decine di stazioni.
// Le stazioni sistemate a mano nella vista Schema hanno properties.schema = [x, y] (unità di griglia) e restano ferme.
const Schema = (() => {
  const GRID = 14;            // pixel per unità di griglia
  const UNIT = 5;             // unità di griglia per la lunghezza mediana di un tratto
  const MIN = 3;              // distanza minima tra due stazioni (unità di griglia)
  const LW = 6, LW_DIRECT = 9, GAP = 9;   // spessore delle linee (direttissime più spesse), distanza tra linee affiancate
  const FS = 12;              // dimensione del testo dei nomi
  const esc = s => Render.esc(s);

  // ---- rete: linee con almeno due fermate, stazioni servite, tratti tra stazioni consecutive ----
  function network() {
    const stations = Store.all('stazione'), used = new Set(), lines = [];
    for (const line of Store.all('linea')) {
      if (line.geometry?.type !== 'LineString') continue;
      const info = Rail.lineInfo(line, stations);
      if (info.stops.length < 2) continue;
      const seq = info.stops.map(s => s.station.id);
      if (info.ring) seq.push(seq[0]);
      seq.forEach(id => used.add(id));
      lines.push({ line, seq, ring: info.ring, color: Render.colorOf(line), direct: line.properties.subtype === 'direttissima', uses: [] });
    }
    const nodes = stations.filter(s => used.has(s.id)).map(s => ({
      id: s.id, name: s.properties.name || '—', ox: s.geometry.coordinates[0], oy: s.geometry.coordinates[1], lines: new Set(),
      fixed: Array.isArray(s.properties.schema) ? s.properties.schema : null
    }));
    const byId = new Map(nodes.map(n => [n.id, n]));
    // un tratto per coppia di stazioni; più linee (o passaggi) sullo stesso tratto si disegnano affiancate
    const edges = new Map();
    lines.forEach((l, li) => {
      for (let k = 1; k < l.seq.length; k++) {
        const u = l.seq[k - 1], v = l.seq[k], [a, b] = u < v ? [u, v] : [v, u], key = a + '|' + b;
        if (!edges.has(key)) edges.set(key, { a: byId.get(a), b: byId.get(b), uses: [] });
        const e = edges.get(key);
        l.uses.push({ e, slot: e.uses.length, rev: u !== a });
        e.uses.push(li);
        byId.get(u).lines.add(li); byId.get(v).lines.add(li);
      }
    });
    return { nodes, edges: [...edges.values()], lines };
  }

  // ---- disposizione ----
  // 1. coordinate reali, scalate in modo che il tratto mediano sia lungo UNIT
  // 2. ogni tratto riceve la direzione reale arrotondata al multiplo di 45° più vicino
  // 3. giri di aggiustamento: le due stazioni di ogni tratto si avvicinano alla direzione voluta; le stazioni troppo
  //    vicine si respingono
  // 4. allineamento alla griglia; due stazioni nella stessa cella: la seconda va nella cella libera più vicina
  // Le stazioni fissate (n.fixed) non si muovono: le altre partono allineate a loro e si dispongono attorno.
  function layout({ nodes, edges }) {
    const d = (a, b) => Math.hypot(b.ox - a.ox, b.oy - a.oy);
    const lens = edges.map(e => d(e.a, e.b)).filter(x => x > 0).sort((x, y) => x - y);
    const med = lens[Math.floor(lens.length / 2)] || 1;
    const mean = (ns, f) => ns.reduce((s, n) => s + f(n), 0) / ns.length;
    nodes.forEach(n => { n.x = n.ox / med * UNIT; n.y = n.oy / med * UNIT; });
    // le stazioni libere partono sempre dalle coordinate reali centrate (le posizioni fissate sono salvate nello stesso
    // riferimento): spostarne una non trascina le altre, sono gli aggiustamenti a collegarle a quelle fissate vicine
    const tx = -mean(nodes, n => n.x), ty = -mean(nodes, n => n.y);
    nodes.forEach(n => { n.x += tx; n.y += ty; });
    const fixed = nodes.filter(n => n.fixed);
    fixed.forEach(n => { n.x = n.fixed[0]; n.y = n.fixed[1]; });
    edges.forEach(e => { e.dir = Math.round(Math.atan2(e.b.oy - e.a.oy, e.b.ox - e.a.ox) / (Math.PI / 4)); });
    const w = n => n.fixed ? 0 : 1;   // quota di spostamento: le stazioni fissate non si muovono

    const ROUNDS = 240;
    for (let it = 0; it < ROUNDS; it++) {
      const k = 0.6 * (1 - it / ROUNDS) + 0.05;
      for (const e of edges) {
        const ux = Math.cos(e.dir * Math.PI / 4), uy = Math.sin(e.dir * Math.PI / 4);
        const wa = w(e.a), wb = w(e.b);
        if (!wa && !wb) continue;
        const len = Math.max((e.b.x - e.a.x) * ux + (e.b.y - e.a.y) * uy, MIN);
        const dx = (e.a.x + ux * len - e.b.x) * k, dy = (e.a.y + uy * len - e.b.y) * k;
        e.b.x += dx * wb / (wa + wb); e.b.y += dy * wb / (wa + wb); e.a.x -= dx * wa / (wa + wb); e.a.y -= dy * wa / (wa + wb);
      }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
        if (dist >= MIN) continue;
        const wa = w(a), wb = w(b);
        if (!wa && !wb) continue;
        if (dist < 1e-6) { dx = 1; dy = 0.3; dist = Math.hypot(dx, dy); }
        const push = (MIN - dist) / dist / (wa + wb);
        a.x -= dx * push * wa; a.y -= dy * push * wa; b.x += dx * push * wb; b.y += dy * push * wb;
      }
    }
    const taken = new Set(fixed.map(n => n.x + ',' + n.y));
    for (const n of nodes) {
      if (n.fixed) continue;
      let x = Math.round(n.x), y = Math.round(n.y);
      for (let r = 1; taken.has(x + ',' + y) && r < 20; r++) {
        const free = [];
        for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (!taken.has((x + i) + ',' + (y + j))) free.push([x + i, y + j]);
        if (free.length) [x, y] = free.sort((p, q) => Math.hypot(p[0] - n.x, p[1] - n.y) - Math.hypot(q[0] - n.x, q[1] - n.y))[0];
      }
      taken.add(x + ',' + y);
      n.x = x; n.y = y;
    }
    nodes.forEach(n => { n.px = n.x * GRID; n.py = n.y * GRID; });
  }

  // Tracciato ottilineare tra due stazioni, in unità di griglia: dritto se già a 0°/45°/90°, altrimenti con una sola
  // curva (prima il tratto nella direzione voluta: diagonale se dir è diagonale, dritto altrimenti)
  function octiPath(a, b, dir) {
    const dx = b.x - a.x, dy = b.y - a.y, ax = Math.abs(dx), ay = Math.abs(dy), sx = Math.sign(dx), sy = Math.sign(dy);
    if (!ax || !ay || ax === ay) return [[a.x, a.y], [b.x, b.y]];
    const m = Math.min(ax, ay);
    const mid = Math.abs(dir) % 2 === 1 ? [a.x + sx * m, a.y + sy * m]
      : ax > ay ? [a.x + sx * (ax - ay), a.y] : [a.x, a.y + sy * (ay - ax)];
    return [[a.x, a.y], mid, [b.x, b.y]];
  }

  // Corsie, come negli schemi delle metropolitane: il tracciato di ogni linea si scompone in passi di una cella (dritti
  // o in diagonale). Le linee che percorrono lo stesso passo (nello stesso tratto tra due stazioni o in tratti diversi
  // che si sovrappongono, per esempio una direttissima accanto a una linea con fermate) sono affiancate, ognuna nella
  // sua corsia, distanti GAP pixel e sempre nello stesso ordine (quello delle linee), così non si scambiano di posto.
  // Il lato si misura rispetto a una direzione fissa del passo, quindi è lo stesso nei due versi di percorrenza.
  const forward = d => d[0] > 0 || (d[0] === 0 && d[1] > 0);
  function lanes(net) {
    const steps = net.lines.map(l => {
      const pts = [];
      for (const { e, rev } of l.uses) {
        let p = octiPath(e.a, e.b, e.dir);
        if (rev) p = p.slice().reverse();
        pts.push(...(pts.length ? p.slice(1) : p));
      }
      const out = [];
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], d = [Math.sign(x2 - x1), Math.sign(y2 - y1)];
        for (let k = 0, n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)); k < n; k++) out.push({ p: [x1 + d[0] * k, y1 + d[1] * k], d });
      }
      return out;
    });
    const users = new Map();
    steps.forEach((ss, li) => ss.forEach(s => {
      const a = forward(s.d) ? s.p : [s.p[0] + s.d[0], s.p[1] + s.d[1]];
      s.key = `${a[0]},${a[1]},${Math.abs(s.d[0])},${forward(s.d) ? s.d[1] : -s.d[1]}`;
      if (!users.has(s.key)) users.set(s.key, []);
      s.slot = users.get(s.key).push(li) - 1;
    }));
    // corsia di ogni passo: estremi in pixel spostati di lato
    steps.forEach(ss => ss.forEach(s => {
      const c = forward(s.d) ? s.d : [-s.d[0], -s.d[1]], len = Math.hypot(c[0], c[1]);
      const o = (s.slot - (users.get(s.key).length - 1) / 2) * GAP, ox = -c[1] / len * o, oy = c[0] / len * o;
      s.n = users.get(s.key).length;
      s.a = [s.p[0] * GRID + ox, s.p[1] * GRID + oy];
      s.b = [(s.p[0] + s.d[0]) * GRID + ox, (s.p[1] + s.d[1]) * GRID + oy];
    }));
    return steps;
  }

  // Polilinea di una linea dalle sue corsie: stessa direzione e corsia = si prosegue; curva = punto d'incontro delle due
  // corsie (spigolo, arrotondato dal disegno); cambio di corsia sulla stessa direzione = raccordo a 45°
  function joinLanes(ss) {
    const meet = (a, d, b, e) => {
      const den = d[0] * e[1] - d[1] * e[0];
      if (!den) return null;
      const t = ((b[0] - a[0]) * e[1] - (b[1] - a[1]) * e[0]) / den;
      return [a[0] + d[0] * t, a[1] + d[1] * t];
    };
    const pts = [ss[0].a];
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i], t = ss[i + 1];
      if (!t) { pts.push(s.b); break; }
      const same = s.d[0] === t.d[0] && s.d[1] === t.d[1], gap = Math.hypot(s.b[0] - t.a[0], s.b[1] - t.a[1]);
      if (same && gap < 0.01) continue;
      const x = same ? null : meet(s.a, s.d, t.a, t.d);
      if (x) { pts.push(x); continue; }
      if (same) {
        const l = Math.hypot(s.d[0], s.d[1]), u = [s.d[0] / l * gap / 2, s.d[1] / l * gap / 2];
        pts.push([s.b[0] - u[0], s.b[1] - u[1]], [t.a[0] + u[0], t.a[1] + u[1]]);
      } else pts.push(s.b, t.a);   // inversione di marcia (raro)
    }
    return pts;
  }

  // Segmento [p, q] che attraversa il rettangolo r = [x, y, w, h] (Liang-Barsky)
  function hits(p, q, r) {
    let t0 = 0, t1 = 1;
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const ok = (pp, qq) => {
      if (Math.abs(pp) < 1e-9) return qq >= 0;
      const t = qq / pp;
      if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
      return true;
    };
    return ok(-dx, p[0] - r[0]) && ok(dx, r[0] + r[2] - p[0]) && ok(-dy, p[1] - r[1]) && ok(dy, r[1] + r[3] - p[1]);
  }
  const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

  // ---- SVG ----
  // Rete disposta, pronta da disegnare (null se non c'è una linea con almeno due fermate)
  function prepare() {
    const net = network();
    if (!net.lines.length) return null;
    layout(net);
    return net;
  }
  const build = () => { const net = prepare(); return net && render(net).svg; };

  // SVG della rete disposta: { svg, box (il riquadro [x, y, w, h] del disegno) }.
  // opts.edit: anteprima modificabile (stazioni con data-id, anello tratteggiato sulle fissate);
  // opts.box: riquadro da usare al posto di quello calcolato (mentre si trascina, lo schema non cambia scala)
  function render(net, opts = {}) {

    // tracciati delle linee, ognuna nelle sue corsie
    const steps = lanes(net), segs = [];
    const paths = net.lines.map((l, li) => {
      const pts = joinLanes(steps[li]);
      for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
      return { l, pts };
    });

    // stazioni: interscambio (due o più linee) = cerchio bianco bordato di nero; fermata = pallino nel colore della
    // linea. Il segno copre solo le corsie delle linee che fermano nella stazione: quelle che passano senza fermarsi
    // (per esempio una direttissima) non lo allargano e gli corrono accanto.
    const at = (s, n) => (s.p[0] === n.x && s.p[1] === n.y) ? s.a
      : (s.p[0] + s.d[0] === n.x && s.p[1] + s.d[1] === n.y) ? s.b : null;
    const marks = net.nodes.map(n => {
      const inter = n.lines.size > 1;
      const pts = [...n.lines].flatMap(li => steps[li].map(s => at(s, n)).filter(Boolean));
      if (!pts.length) pts.push([n.px, n.py]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const spread = Math.max(...pts.map(p => Math.hypot(p[0] - cx, p[1] - cy)));
      return { n, inter, r: inter ? 7 + spread : 4.5, cx, cy, color: inter ? '#111' : net.lines[[...n.lines][0]].color };
    });

    // nomi: per ogni stazione la posizione (8 attorno al cerchio) che copre meno linee, cerchi e altri nomi; nelle
    // linee circolari i nomi vanno preferibilmente all'esterno dell'anello
    const ringCenter = new Map();
    net.lines.filter(l => l.ring).forEach(l => {
      const ns = l.seq.slice(1).map(id => net.nodes.find(n => n.id === id));
      const c = [ns.reduce((s, n) => s + n.px, 0) / ns.length, ns.reduce((s, n) => s + n.py, 0) / ns.length];
      ns.forEach(n => ringCenter.set(n.id, c));
    });
    const placed = [];
    const labels = marks.slice().sort((a, b) => b.n.lines.size - a.n.lines.size).map(m => {
      const { n, r, cx, cy } = m, w = n.name.length * FS * 0.6 + 4, h = FS * 1.25, g = r + 4, q = g * 0.75;
      const cands = [
        ['start', cx + g, cy - h / 2, 0], ['end', cx - g - w, cy - h / 2, 0.5],
        ['middle', cx - w / 2, cy - g - h, 1], ['middle', cx - w / 2, cy + g, 1],
        ['start', cx + q, cy - q - h, 1.5], ['end', cx - q - w, cy - q - h, 1.5],
        ['start', cx + q, cy + q, 1.5], ['end', cx - q - w, cy + q, 1.5]
      ].map(([anchor, x, y, pref]) => {
        const box = [x, y, w, h];
        let score = pref;
        for (const [p, q2] of segs) if (hits(p, q2, box)) score += 10;
        for (const o of marks) if (o !== m && overlap(box, [o.cx - o.r, o.cy - o.r, 2 * o.r, 2 * o.r])) score += 15;
        for (const b of placed) if (overlap(box, b)) score += 25;
        const c = ringCenter.get(n.id);
        if (c && (x + w / 2 - cx) * (cx - c[0]) + (y + h / 2 - cy) * (cy - c[1]) < 0) score += 6;
        return { anchor, box, score };
      });
      const best = cands.reduce((a, b) => b.score < a.score ? b : a);
      placed.push(best.box);
      const [x, y, bw] = best.box;
      return { n, anchor: best.anchor, x: best.anchor === 'start' ? x + 2 : best.anchor === 'end' ? x + bw - 2 : x + bw / 2, y: y + FS * 0.95 };
    });

    // ingombro e titolo (solo la rete: niente legenda delle linee)
    const xs = [], ys = [];
    paths.forEach(p => p.pts.forEach(([x, y]) => { xs.push(x); ys.push(y); }));
    marks.forEach(m => { xs.push(m.cx - m.r, m.cx + m.r); ys.push(m.cy - m.r, m.cy + m.r); });
    placed.forEach(([x, y, w, h]) => { xs.push(x, x + w); ys.push(y, y + h); });
    const M = 40, minX = Math.min(...xs) - M, maxX = Math.max(...xs) + M, top = Math.min(...ys) - M - 46, bottom = Math.max(...ys) + M;
    const height = bottom - top, width = Math.max(maxX - minX, 320);

    const day = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    const f = v => Math.round(v * 10) / 10;
    const d = pts => 'M' + pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L');
    const box = [minX, top, width, height], [bx, by, bw, bh] = opts.box || box;
    const hit = m => opts.edit ? ` data-id="${esc(m.n.id)}"` : '';
    const ring = m => opts.edit && m.n.fixed
      ? `\n    <circle cx="${f(m.cx)}" cy="${f(m.cy)}" r="${f(m.r + 5)}" fill="none" stroke="#e0b84f" stroke-width="2" stroke-dasharray="3 3"/>` : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(bx)} ${f(by)} ${f(bw)} ${f(bh)}" width="${f(bw)}" height="${f(bh)}" class="schema${opts.edit ? ' editing' : ''}">
  <style>
    text { font-family: Inter, 'Segoe UI', Arial, sans-serif; fill: #14181f; }
    .st { font-size: ${FS}px; font-weight: 600; paint-order: stroke; stroke: #fff; stroke-width: 3px; stroke-linejoin: round; }
    .tt { font-size: 22px; font-weight: 800; } .sub { font-size: 12px; fill: #5b6470; }
  </style>
  <rect x="${f(bx)}" y="${f(by)}" width="${f(bw)}" height="${f(bh)}" fill="#fff"/>
  <text x="${f(minX + M)}" y="${f(top + 30)}" class="tt">Rete ferroviaria di Panera</text>
  <text x="${f(minX + M)}" y="${f(top + 48)}" class="sub">The Railway Company · ${esc(day)}</text>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
${paths.map(p => `    <path d="${d(p.pts)}" stroke="${p.l.color}" stroke-width="${p.l.direct ? LW_DIRECT : LW}"/>`).join('\n')}
  </g>
  <g>
${marks.map(m => (m.inter
    ? `    <circle cx="${f(m.cx)}" cy="${f(m.cy)}" r="${f(m.r)}" fill="#fff" stroke="#111" stroke-width="2.5"${hit(m)}/>`
    : `    <circle cx="${f(m.cx)}" cy="${f(m.cy)}" r="${m.r}" fill="#fff" stroke="${m.color}" stroke-width="2.5"${hit(m)}/>`) + ring(m)).join('\n')}
  </g>
  <g>
${labels.map(t => `    <text x="${f(t.x)}" y="${f(t.y)}" text-anchor="${t.anchor}" class="st">${esc(t.n.name)}</text>`).join('\n')}
  </g>
</svg>`;
    return { svg, box };
  }

  // Posizione (in unità di griglia) per la stazione n trascinata nel punto (rx, ry): la cella più vicina, oppure, se
  // si è a meno di 0,6 celle, il punto che la allinea a 0°/45°/90° con una stazione collegata. null se la cella è
  // occupata da un'altra stazione.
  function snap(net, n, rx, ry) {
    let best = [Math.round(rx), Math.round(ry)], bestD = 0.6;
    const nbs = net.edges.flatMap(e => e.a === n ? [e.b] : e.b === n ? [e.a] : []);
    for (const m of nbs) for (let k = 0; k < 8; k++) {
      const ux = Math.round(Math.cos(k * Math.PI / 4)), uy = Math.round(Math.sin(k * Math.PI / 4));
      const t = ((rx - m.x) * ux + (ry - m.y) * uy) / (ux * ux + uy * uy);
      if (t < 0.5) continue;
      const c = [m.x + Math.round(t) * ux, m.y + Math.round(t) * uy], dist = Math.hypot(c[0] - rx, c[1] - ry);
      if (dist < bestD) { best = c; bestD = dist; }
    }
    return net.nodes.some(o => o !== n && o.x === best[0] && o.y === best[1]) ? null : best;
  }

  return { GRID, build, prepare, render, snap };
})();
