// Rete ferroviaria: funzioni pure su linee e stazioni (regole in docs/ferrovie.md).
// Le fermate di una linea sono le stazioni che coincidono con i suoi vertici (tolleranza di Geo.same).
const Rail = (() => {
  // Linea circolare: LineString chiusa (ultimo vertice = primo)
  const isRing = c => c.length > 2 && Geo.same(c[0], c[c.length - 1]);

  // Fermate di una linea, nell'ordine dei vertici: [{ i (indice del vertice), station }]
  function stops(coords, stations = Store.all('stazione')) {
    const out = [];
    coords.forEach((v, i) => {
      const station = stations.find(s => Geo.same(s.geometry.coordinates, v));
      if (station) out.push({ i, station });
    });
    return out;
  }

  // Regola di unicità: una stazione compare una sola volta in una linea, tranne la chiusura di un anello.
  // Restituisce la stazione ripetuta, o null se la regola è rispettata.
  function duplicate(coords, stations = Store.all('stazione')) {
    const ring = isRing(coords), seen = new Set();
    for (const { i, station } of stops(coords, stations)) {
      if (ring && i === coords.length - 1) continue;
      if (seen.has(station.id)) return station;
      seen.add(station.id);
    }
    return null;
  }

  // Linee che hanno un vertice nel punto c (cioè che fermano lì, se c'è una stazione)
  const linesAt = c => Store.all('linea').filter(l => l.geometry?.type === 'LineString' && l.geometry.coordinates.some(v => Geo.same(v, c)));

  // Distanza lungo il binario dal primo vertice fino a ciascun vertice
  function cumulative(c) {
    const out = [0];
    for (let i = 1; i < c.length; i++) out.push(out[i - 1] + Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]));
    return out;
  }

  // Riepilogo di una linea: fermate con la progressiva `at` (blocchi lungo il binario dal primo vertice), segmenti
  // tra fermate consecutive (nell'anello anche ultima → prima, con il tratto di chiusura), lunghezza totale e avvisi
  // se un capolinea o il punto di chiusura non è una stazione. Nell'anello la prima fermata compare una volta sola.
  function lineInfo(line, stations = Store.all('stazione')) {
    const c = line.geometry.coordinates, ring = isRing(c), cum = cumulative(c), total = cum[cum.length - 1];
    const st = stops(c, stations).filter(s => !(ring && s.i === c.length - 1)).map(s => ({ ...s, at: cum[s.i] }));
    const segments = st.slice(1).map((s, k) => ({ from: st[k].station, to: s.station, length: s.at - st[k].at }));
    if (ring && st.length > 1) segments.push({ from: st.at(-1).station, to: st[0].station, length: total - st.at(-1).at + st[0].at });
    const warnings = [];
    if (ring) { if (st[0]?.i !== 0) warnings.push('Il punto di chiusura della linea circolare non è una stazione'); }
    else {
      if (st[0]?.i !== 0) warnings.push('Il capolinea di partenza non è una stazione');
      if (st.at(-1)?.i !== c.length - 1) warnings.push('Il capolinea di arrivo non è una stazione');
    }
    return { ring, stops: st, segments, total, warnings };
  }

  // Linee che fermano in una stazione, ognuna con la fermata precedente e la successiva e la lunghezza dei due
  // segmenti (null = capolinea; nell'anello si gira intorno)
  function stationInfo(station, stations = Store.all('stazione')) {
    return linesAt(station.geometry.coordinates).map(line => {
      const info = lineInfo(line, stations), st = info.stops, n = st.length;
      const k = st.findIndex(s => s.station.id === station.id);
      const adj = (j, length) => ({ station: st[j].station, length });
      let prev = k > 0 ? adj(k - 1, st[k].at - st[k - 1].at) : null;
      let next = k >= 0 && k < n - 1 ? adj(k + 1, st[k + 1].at - st[k].at) : null;
      if (info.ring && n > 1) {
        const closing = info.segments.at(-1).length;
        if (k === 0) prev = adj(n - 1, closing);
        if (k === n - 1) next = adj(0, closing);
      }
      return { line, prev, next, ring: info.ring };
    });
  }

  return { isRing, stops, duplicate, linesAt, lineInfo, stationInfo };
})();
