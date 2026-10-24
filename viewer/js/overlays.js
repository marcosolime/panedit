// Sovrapposizioni di servizio: griglia dei chunk e barra della scala.
const Overlays = (() => {
  const CHUNK = 16, REGION = 512;

  // Griglia disegnata su un canvas grande quanto la mappa, ridisegnata a ogni spostamento.
  // Le linee dei chunk compaiono solo quando un chunk è abbastanza grande da leggersi;
  // quelle delle regioni (32×32 chunk) sono più marcate e restano visibili più a lungo.
  const ChunkGrid = L.Layer.extend({
    onAdd(map) {
      this._canvas = L.DomUtil.create('canvas', 'pe-grid');
      map.getPane('grid').appendChild(this._canvas);
      map.on('move resize zoomend viewreset', this._redraw, this);
      map.on('zoomstart', this._hide, this);
      this._redraw();
    },
    onRemove(map) {
      map.off('move resize zoomend viewreset', this._redraw, this);
      map.off('zoomstart', this._hide, this);
      this._canvas.remove();
    },
    _hide() { this._canvas.style.visibility = 'hidden'; },
    _redraw() {
      const map = this._map, c = this._canvas, size = map.getSize(), dpr = window.devicePixelRatio || 1;
      L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
      c.style.width = size.x + 'px'; c.style.height = size.y + 'px';
      c.width = size.x * dpr; c.height = size.y * dpr;
      c.style.visibility = '';
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ppb = Math.pow(2, map.getZoom());          // pixel per blocco
      const tl = map.containerPointToLatLng([0, 0]);
      const x0 = tl.lng, z0 = -tl.lat;                 // blocco nell'angolo in alto a sinistra
      const lines = (step, color, width) => {
        if (step * ppb < 6) return false;
        const off = (n0, n) => (Math.ceil(n0 / step) * step - n0) * ppb;
        ctx.beginPath();
        for (let x = off(x0); x <= size.x; x += step * ppb) { const px = Math.round(x) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, size.y); }
        for (let y = off(z0); y <= size.y; y += step * ppb) { const py = Math.round(y) + 0.5; ctx.moveTo(0, py); ctx.lineTo(size.x, py); }
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
        return true;
      };
      lines(CHUNK, 'rgba(0, 0, 0, 0.28)', 1);
      lines(REGION, 'rgba(0, 0, 0, 0.55)', 1.5);
    }
  });

  let map, grid;

  function setGrid(on) {
    if (on && !grid) grid = new ChunkGrid().addTo(map);
    else if (!on && grid) { grid.remove(); grid = null; }
  }

  // Barra della scala: lunghezza "tonda" (1, 2, 5 × 10ⁿ blocchi) di al massimo ~200 px,
  // divisa in 4 segmenti alterni. 1 blocco = 1 metro.
  function updateScale() {
    const el = document.getElementById('scalebar');
    const bpp = Math.pow(2, -map.getZoom());          // blocchi per pixel
    const max = 200 * bpp;
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    const nice = [5, 2, 1].map(m => m * pow).find(v => v <= max) || pow;
    const width = nice / bpp;
    const fmt = v => v >= 1000 ? `${(v / 1000).toLocaleString('it-IT')} km` : `${v.toLocaleString('it-IT')} m`;
    el.style.width = Math.round(width) + 'px';
    el.querySelector('.sb-bar').innerHTML = '<i></i><i></i><i></i><i></i>';
    el.querySelector('.sb-labels').innerHTML =
      `<span>0</span><span>${fmt(nice / 2)}</span><span>${fmt(nice)}</span>`;
    el.title = `${fmt(nice)} = ${nice.toLocaleString('it-IT')} blocchi`;
  }

  function init(m) {
    map = m;
    map.createPane('grid').style.zIndex = 300;        // sopra le tiles, sotto confini ed etichette
    map.getPane('grid').style.pointerEvents = 'none';
    map.on('zoom zoomend', updateScale);
    updateScale();
    setGrid(Settings.grid);
  }

  return { init, setGrid, CHUNK };
})();
