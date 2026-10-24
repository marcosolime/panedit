// Avvio dell'editor
Basemap.load().then(async () => {
  const map = Basemap.create('map');
  Render.init(map);
  Overlays.init(map);
  Tools.init(map);
  UI.init(map);

  const r = await IO.loadInitial();
  if (r.restored) {
    const when = new Date(r.restored).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    UI.toast(`Ripristinate le modifiche non salvate del ${when}`, 'info', {
      label: 'Scarta',
      fn: () => IO.reloadDefault().catch(() => IO.newMap())
    });
  } else if (r.empty) {
    UI.toast("Impossibile leggere data/panera.geojson: avvia l'editor con avvia-editor.bat oppure usa Apri", 'warn');
  }
}, err => {
  document.getElementById('map').innerHTML =
    `<p class="fatal">Render non trovato: ${Render.esc(err.message)}</p>`;
});
