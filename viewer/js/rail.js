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

  return { isRing, stops, duplicate, linesAt };
})();
