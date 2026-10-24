// Mappa base: tiles generate da uNmINeD (cartella del render accanto a viewer/).
const RENDER = 'render_zoomin1_zoomout6_webp-lossless_shadows-false';

const Basemap = (() => {
  const loadScript = src => new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => ko(new Error(src));
    document.head.appendChild(s);
  });

  const load = () => Promise.all([
    loadScript(`../${RENDER}/unmined.map.properties.js`),
    loadScript(`../${RENDER}/unmined.map.regions.js`)
  ]);

  let regions;

  function create(el) {
    const P = UnminedMapProperties;
    const TILE_ROOT = `../${RENDER}/tiles`;

    // Insieme delle regioni esistenti (UnminedRegions: gruppi 32x32 regioni, bitmap a 32 bit)
    regions = new Set();
    for (const g of UnminedRegions) {
      for (let i = 0; i < 1024; i++) {
        if (g.m[i >> 5] & (1 << (i & 31))) regions.add(`${g.x * 32 + (i & 31)},${g.z * 32 + (i >> 5)}`);
      }
    }

    // Una tile esiste se copre almeno una regione renderizzata (evita richieste 404)
    function tileHasData(x, y, z) {
      const blocks = 256 / Math.pow(2, z);
      const r0x = Math.floor(x * blocks / 512), r0z = Math.floor(y * blocks / 512);
      const n = Math.max(1, Math.ceil(blocks / 512));
      for (let rx = r0x; rx < r0x + n; rx++)
        for (let rz = r0z; rz < r0z + n; rz++)
          if (regions.has(`${rx},${rz}`)) return true;
      return false;
    }

    // CRS.Simple: 1 unità = 1 blocco; lat = -Z, lng = X.
    // A zoom Leaflet z la griglia coincide con quella di uNmINeD (tile 256px, 2^z px per blocco).
    const UnminedLayer = L.TileLayer.extend({
      createTile(coords, done) {
        const img = document.createElement('img');
        img.alt = '';
        if (!tileHasData(coords.x, coords.y, coords.z)) {
          setTimeout(() => done(null, img), 0);
          img.style.visibility = 'hidden';
          return img;
        }
        img.onload = () => done(null, img);
        img.onerror = () => { img.style.visibility = 'hidden'; done(null, img); };
        img.src = `${TILE_ROOT}/zoom.${coords.z}/${Math.floor(coords.x / 10)}/${Math.floor(coords.y / 10)}/tile.${coords.x}.${coords.y}.${P.imageFormat}`;
        return img;
      }
    });

    const map = L.map(el, {
      crs: L.CRS.Simple,
      minZoom: P.minZoom,
      maxZoom: P.maxZoom + 3,          // oltre il livello nativo Leaflet ingrandisce le tile
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      attributionControl: false,
      zoomControl: false,
      boxZoom: false,
      doubleClickZoom: false
    });

    new UnminedLayer('', {
      tileSize: 256,
      minNativeZoom: P.minZoom,
      maxNativeZoom: P.maxZoom,
      minZoom: P.minZoom,
      maxZoom: P.maxZoom + 3,
      noWrap: true,
      pmIgnore: true
    }).addTo(map);

    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Ingrandisci', zoomOutTitle: 'Riduci' }).addTo(map);

    const [hx, hz, hzoom] = location.hash.slice(1).split(',').map(Number);
    if ([hx, hz, hzoom].every(Number.isFinite)) map.setView(Geo.ll([hx, hz]), hzoom);
    else map.setView(Geo.ll([P.centerX, P.centerZ]), -3);

    map.on('moveend', () => {
      const c = map.getCenter();
      history.replaceState(null, '', `#${Math.round(c.lng)},${Math.round(-c.lat)},${map.getZoom()}`);
    });
    return map;
  }

  // "Isole": gruppi di regioni contigue, per saltare alle zone lontane dall'origine
  function clusters() {
    const seen = new Set(), out = [];
    for (const key of regions) {
      if (seen.has(key)) continue;
      const stack = [key]; seen.add(key);
      let n = 0, sx = 0, sz = 0;
      while (stack.length) {
        const [x, z] = stack.pop().split(',').map(Number);
        n++; sx += x; sz += z;
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const k = `${x + dx},${z + dz}`;
          if (regions.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
        }
      }
      out.push({ n, x: Math.round(sx / n * 512 + 256), z: Math.round(sz / n * 512 + 256) });
    }
    return out.sort((a, b) => b.n - a.n);
  }

  return { load, create, clusters };
})();
