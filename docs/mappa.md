# Mappa base (render di uNmINeD)

Contesto e scelte sulla mappa di sfondo dell'editor: da dove arriva, come la legge l'editor, cosa cambia con il
nuovo render. Aggiornato al 03/11/2026 (dati del render completo del nuovo mondo).

## Come funziona

- Le immagini della mappa ("tiles", 256 × 256 px, formato webp) sono generate da **uNmINeD** a partire dal mondo di
  gioco, in una cartella `render_…/` nella radice del progetto, accanto a `viewer/`.
- La cartella usata è scritta in una sola costante, `RENDER`, in [viewer/js/basemap.js](../viewer/js/basemap.js).
- Dalla cartella l'editor legge due file generati da uNmINeD:
  - `unmined.map.properties.js`: tra l'altro `minZoom` / `maxZoom`, i livelli di zoom disponibili, e il formato
    delle immagini;
  - `unmined.map.regions.js`: le regioni (512 × 512 blocchi) davvero renderizzate, per non chiedere immagini che non
    esistono.
- Le immagini stanno in `tiles/zoom.<z>/<x/10>/<y/10>/tile.<x>.<y>.webp`.
- Livelli di zoom: a zoom *z* un blocco è largo 2^z pixel (zoom 0 = 1 px per blocco, zoom 2 = 4 px, zoom −6 = un
  pixel ogni 64 blocchi). L'editor usa `CRS.Simple` di Leaflet con 1 unità = 1 blocco, quindi i livelli di Leaflet
  coincidono con quelli di uNmINeD.
- **Oltre il livello più dettagliato del render** (`maxZoom` di uNmINeD, per Leaflet `maxNativeZoom`) l'editor non
  ha immagini nuove: ingrandisce ("stira") quelle dell'ultimo livello, che diventano via via più sgranate.
- Il render **non è nel repository** (è ignorato da git, regola `render_*/` in `.gitignore`): si distribuisce a parte
  come zip, da estrarre nella radice del progetto senza rinominare la cartella.

## Nomi delle cartelle

Convenzione (dal 03/11/2026): **`render_AAAA-MM-GG_z<N>[_varianti]`**

- `AAAA-MM-GG`: data del render, con i trattini come nei nomi dei file delle mappe (`panera_AAAA-MM-GG_hhmm_…`);
  le cartelle si ordinano da sole in ordine cronologico;
- `z<N>`: livello di zoom più dettagliato (lo `zoomin` di uNmINeD, il `maxZoom` di `unmined.map.properties.js`);
- `_varianti` (facoltative): scelte di render diverse dal solito, per esempio `noluci` = fonti luminose trasparenti.

Le impostazioni comuni a tutti i render non compaiono nel nome: zoomout 6 (livello minimo −6), immagini webp
lossless, ombre disattivate.

| Cartella | Nome originale di uNmINeD |
|---|---|
| `render_2026-10-24_z1` | `render_zoomin1_zoomout6_webp-lossless_shadows-false` |
| `render_2026-11-03_z2_noluci` | `render_zoomin2_zoomout6_webp-lossless_shadows-false_luci-trasparenti` |

La regola `render_*/` del `.gitignore` copre anche i nuovi nomi. Cambiando il nome della cartella cambia l'indirizzo
delle immagini, quindi il browser le riscarica una volta; bozze e preferenze non ne risentono.

## I due render

| | Vecchio | Nuovo |
|---|---|---|
| Cartella | `render_2026-10-24_z1` | `render_2026-11-03_z2_noluci` |
| Livelli | da −6 a **1** | da −6 a **2** |
| Fonti luminose (torce, lanterne…) | quadrati gialli sparsi ovunque | **trasparenti** |
| Immagini | circa 47.000 | **184.251** (137.326 solo a zoom 2) |
| Peso | circa 730 MB | **1,07 GB** |
| Tempo di render | circa 8 minuti | **28 min 35 s** |
| Regioni renderizzate | — | identiche al vecchio (`unmined.map.regions.js` uguale) |

## Render del nuovo mondo (`render_2026-11-03_z2_noluci`)

Render del mondo intero completato: **184.251 tiles, 1,07 GB, 28 min 35 s**, senza chunk falliti né warning.
Numero di tiles e tempo corrispondono alle stime; il peso è un po' sotto la forbice prevista.

| Livello | Tiles | Dimensione |
|---|---|---|
| z2 | 137.326 | 369 MB |
| z1 | 34.502 | 308 MB |
| z0 | 8.710 | 254 MB |
| z−1 … z−6 | 3.713 | 167 MB |
| **Totale** | **184.251** | **1,07 GB** |

Rispetto al render precedente (`render_2026-10-24_z1`):
- **z2 aggiunge 369 MB e circa 20 minuti di render**: è il costo del dettaglio in più;
- **z1 e z0 pesano il 2% in meno**, grazie alle luci trasparenti (meno dettagli da comprimere al posto dei quadrati
  gialli).

## Scelte

1. **L'editor usa il nuovo render.** `RENDER` vale `'render_2026-11-03_z2_noluci'`. Livelli di zoom e formato si leggono dal
   suo `unmined.map.properties.js`, quindi lo zoom nativo massimo diventa 2 da solo, senza altre modifiche.
2. **Lo zoom massimo dell'editor resta 4** (16 px per blocco), ora fissato nella costante `MAX_ZOOM` invece di essere
   "zoom nativo + 3". Con il nuovo render la regola vecchia avrebbe portato il massimo a 5; si è preferito non
   cambiare l'esperienza d'uso. Il guadagno è la nitidezza:

   | Zoom dell'editor | Vecchio render | Nuovo render |
   |---|---|---|
   | 0, 1 | immagini vere | immagini vere |
   | 2 | z1 ingrandito ×2 | **immagini vere** |
   | 3 | z1 ingrandito ×4 | z2 ingrandito ×2 |
   | 4 | z1 ingrandito ×8 | z2 ingrandito ×4 |

   Per permettere di zoomare ancora di più basta aumentare `MAX_ZOOM` (a 5 il nuovo render è ingrandito ×8, come il
   vecchio a 4).
3. **Il resto dell'editor non dipende dal render.** Etichette, griglia dei chunk, filtro di luminosità e saturazione,
   zoom di apertura (0) e inquadrature lavorano in blocchi o in livelli di zoom assoluti, quindi non cambiano.
4. **Il vecchio render resta sul disco** finché il nuovo non è stato verificato; poi si può cancellare. L'editor non
   lo usa più.

## Da verificare

- **Luci trasparenti.** Dietro le immagini la mappa ha uno sfondo blu scuro (`#0b1220`, regola `#map` in
  `editor.css`). Se uNmINeD lascia davvero trasparenti i pixel delle luci, al posto dei quadrati gialli comparirebbero
  piccoli punti scuri; se invece disegna il blocco sottostante, non si vede nulla. Nel primo caso si può scegliere
  uno sfondo più neutro.
- **Distribuzione.** Il render pesa 1,07 GB in 184.251 file: lo zip per il Consiglio sarà più grande e più lento da
  estrarre di quello attuale (circa 47.000 file). Le webp sono già compresse, quindi lo zip non si ridurrà molto
  rispetto a 1,07 GB.
- **Bozze e preferenze** non dipendono dal render: restano valide.

## Cambiare render in futuro

1. Generare il render con uNmINeD ed estrarlo nella radice del progetto.
2. Rinominare la cartella secondo la convenzione (`render_AAAA-MM-GG_z<N>[_varianti]`), a editor chiuso.
3. Mettere il nome della cartella in `RENDER` ([viewer/js/basemap.js](../viewer/js/basemap.js)).
4. Se il render arriva a un livello più dettagliato, valutare `MAX_ZOOM`; il resto si adatta da solo.
5. Aggiornare questo documento e il commento in `.gitignore` (dimensione e numero di file dello zip).
