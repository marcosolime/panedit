// Avvio dell'editor
Basemap.load().then(() => {
  const map = Basemap.create('map');
  Render.init(map);
  Overlays.init(map);
  Tools.init(map);
  UI.init(map);

  const r = IO.loadInitial();
  if (r.restored) {
    const when = new Date(r.restored).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    UI.toast(`Ripristinate le modifiche non salvate del ${when}`, 'info', {
      label: 'Scarta',
      fn: () => IO.newMap()
    });
  }
}, err => {
  document.getElementById('map').innerHTML =
    `<p class="fatal">Render non trovato: ${Render.esc(err.message)}</p>`;
});
