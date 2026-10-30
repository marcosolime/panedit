// Apertura e salvataggio dei file GeoJSON, bozza automatica nel browser.
const IO = (() => {
  const DRAFT_KEY = 'panera-editor-draft';
  const TYPES = [{ description: 'Mappa GeoJSON', accept: { 'application/geo+json': ['.geojson', '.json'] } }];
  const NEW_NAME = 'nuova-mappa.geojson';
  let handle = null, fileName = NEW_NAME, draftTimer = null;
  const listeners = [];

  const notify = () => listeners.forEach(fn => fn());
  const stamp = () => {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  // JSON leggibile ma compatto: una coppia di coordinate per riga non serve, le teniamo inline
  function serialize() {
    Store.commit();
    const fc = Model.toFeatureCollection({ name: fileName.replace(/\.(geo)?json$/i, '') });
    return JSON.stringify(fc, null, 2)
      .replace(/\[\s+(-?[\d.e+-]+),\s+(-?[\d.e+-]+)\s+\]/g, '[$1, $2]')
      .replace(/\[\s+((?:\[-?[\d.e+-]+, -?[\d.e+-]+\],?\s*)+)\]/g, (m, inner) => '[' + inner.replace(/\s+/g, ' ').trim() + ']');
  }

  function parse(text, name) {
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`${name} non è un file JSON valido`); }
    if (json.type === 'Feature') json = { type: 'FeatureCollection', features: [json] };
    if (json.type !== 'FeatureCollection' || !Array.isArray(json.features)) throw new Error(`${name} non è una FeatureCollection GeoJSON`);
    return json;
  }

  function loadData(json, name, h = null) {
    Store.load(json);
    fileName = name;
    handle = h;
    writeDraft(false);
    notify();
  }

  // All'avvio la mappa è vuota; si ripristina solo una bozza con modifiche non salvate
  function loadInitial() {
    const draft = readDraft();
    if (draft && draft.dirty) {
      Store.load(draft.data);
      fileName = draft.fileName || fileName;
      Store.setDirty(true);
      notify();
      return { restored: draft.savedAt };
    }
    newMap();
    return {};
  }

  async function open() {
    if (window.showOpenFilePicker) {
      try {
        const [h] = await showOpenFilePicker({ types: TYPES, multiple: false });
        const file = await h.getFile();
        loadData(parse(await file.text(), file.name), file.name, h);
        return true;
      } catch (e) {
        if (e.name === 'AbortError') return false;
        if (e.message && !/SecurityError|NotAllowed/.test(e.name)) throw e;
      }
    }
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.geojson,.json,application/geo+json,application/json';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return resolve(false);
        try { await openFile(file); resolve(true); } catch (e) { reject(e); }
      };
      input.click();
    });
  }

  async function openFile(file) {
    loadData(parse(await file.text(), file.name), file.name);
  }

  async function writeTo(h, text) {
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
  }

  // Salva: riscrive il file aperto se possibile, altrimenti chiede dove salvare
  async function save(asNew = false) {
    const text = serialize();
    if (!asNew && handle) {
      try { await writeTo(handle, text); return saved(); } catch (e) { if (e.name === 'AbortError') return false; }
    }
    // Il nome proposto va completato a mano: panera_AAAA-MM-GG_hhmm_<autore>_<stato>.geojson
    const suggestedName = asNew || fileName === NEW_NAME ? `panera_${stamp()}.geojson` : fileName;
    if (window.showSaveFilePicker) {
      try {
        const h = await showSaveFilePicker({ suggestedName, types: TYPES });
        await writeTo(h, text);
        handle = h; fileName = h.name;
        return saved();
      } catch (e) {
        if (e.name === 'AbortError') return false;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/geo+json' }));
    a.download = suggestedName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    fileName = suggestedName;
    return saved();
  }
  function saved() {
    Store.setDirty(false);
    writeDraft(false);
    notify();
    return true;
  }

  function newMap() {
    loadData({ type: 'FeatureCollection', features: [] }, NEW_NAME);
  }

  // ---- bozza automatica ----
  function readDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { return null; }
  }
  let draftState = '';
  function writeDraft(dirty = Store.dirty) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: new Date().toISOString(), fileName, dirty, data: Model.toFeatureCollection()
      }));
      draftState = dirty ? `Bozza salvata alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : '';
    } catch {
      draftState = 'Bozza non salvata (spazio del browser esaurito)';
    }
    notify();
  }
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => writeDraft(), 1200);
  }

  return {
    loadInitial, open, openFile, save, newMap, scheduleDraft, serialize,
    onChange: fn => listeners.push(fn),
    get fileName() { return fileName; }, get draftState() { return draftState; }, get hasHandle() { return !!handle; }
  };
})();
