# Rete ferroviaria (The Railway Company)

Piano per aggiungere all'editor la rete ferroviaria di Panera, gestita da Davide (The Railway Company).
Stato: **fase 1 completata**, fasi 2–6 da fare (31/10/2026). Le nuove
funzioni di [new_features.md](new_features.md) hanno già preparato alcuni pezzi: vedi sotto.

## Obiettivo

- Un nuovo tipo nel pannello di sinistra (icona del treno) con stazioni e linee ferroviarie, sulla stessa mappa e
  nello stesso file delle altre entità (marche, regioni, continenti…).
- Si creano le stazioni e si tracciano le linee; una stazione può essere servita da più linee.
- Nell'ispettore: la distanza di ogni segmento stazione–stazione e, scelte partenza e arrivo, il percorso più
  breve con il chilometraggio.
- Esportazione della rete in PDF con la classica rappresentazione "metropolitana": linee a 0°, 45° e 90°, nomi
  delle stazioni, colori delle linee.

## Requisiti concordati con Davide

| Tema | Decisione |
|---|---|
| Mondo | Overworld: coordinate di gioco normali, 1 blocco = 1 m, km = blocchi / 1000 |
| Percorso "più rapido" | quello con meno blocchi; a parità di distanza, quello con meno cambi |
| Categorie di linea | **Direttissima** e **Con fermate** (anche le direttissime hanno fermate) |
| Binari | ogni linea ha il suo binario: nessun tratto è condiviso tra linee |
| Diramazioni | nessuna: una linea è un'unica sequenza di stazioni |
| Linee circolari | esistono |
| Verso di percorrenza | tutte le linee si percorrono in entrambi i versi |
| Dimensione | alcune decine di stazioni |

Il repo non è ancora stato distribuito al Consiglio: non esistono mappe da migrare, quindi il formato si estende
restando alla `version: 1`.

## Decisioni per lo sviluppo (31/10/2026)

| Tema | Decisione |
|---|---|
| Pannello | **un solo pannello "Ferrovie"** (icona del treno) con due sezioni, *Linee* e *Stazioni*: va adattata la logica attuale "un pannello per tipo", compresi i tasti 1–9 |
| Creare una stazione | **strumento Punto (K)**: crea una stazione se **Crea** è su *Stazione*, altrimenti una località |
| Menu Crea | segue lo strumento attivo e propone **solo i tipi compatibili**: con Punto solo *Località* e *Stazione*; con le linee solo i tipi che accettano linee; con le aree solo quelli che accettano aree |
| Tracciare una linea | **strumento Linea per punti (D)** con **Crea** su *Linea ferroviaria*: in quel caso si applicano le regole ferroviarie (fermate, anello, stazioni ai capolinea). "+ Nuova linea" nel pannello lo attiva già impostato |
| Aspetto delle stazioni | **cerchi con il nome accanto, come le località**: stessa etichetta (posizione del nome a destra / sinistra / sopra / sotto con `label.anchor`, dimensione, "Mostra il nome") e stesso comportamento allo zoom; interscambi bianchi con il bordo nero |
| Nome delle linee sulla mappa | **mostrato**, lungo il tracciato come per fiumi e DMZ (ripetizioni automatiche o da 1 a 10 con *Ripetizioni del nome*, dimensione, rotazione); si nasconde con **"Mostra il nome sulla mappa"** come per tutte le etichette |
| Categoria delle linee | **`subtype`** (`direttissima` · `fermate`) con il meccanismo esistente: menu Categoria nell'ispettore e gruppi nel pannello già pronti; default in `Model.fitProps` |

## Modello dati

Due nuovi `kind` in `KINDS` ([viewer/js/model.js](../viewer/js/model.js)), aggiunti anche a `KIND_ORDER`.

| `kind` | Geometria | Proprietà specifiche |
|---|---|---|
| `stazione` | Point | — (in fase 6: `schema`) |
| `linea` | LineString | `color`, `subtype`: `direttissima` · `fermate` |

Proprietà comuni come per gli altri tipi: `id`, `name`, `notes`, `label`.

```json
{ "type": "Feature", "id": "stazione-porto-vecchio-k3m9qa",
  "properties": { "id": "stazione-porto-vecchio-k3m9qa", "kind": "stazione", "name": "Porto Vecchio", "notes": "", "label": { … } },
  "geometry": { "type": "Point", "coordinates": [1250, -340] } },
{ "type": "Feature", "id": "linea-costiera-p2x8vd",
  "properties": { "id": "linea-costiera-p2x8vd", "kind": "linea", "name": "Costiera", "color": "#c4101c",
                  "subtype": "fermate", "notes": "", "label": { … } },
  "geometry": { "type": "LineString", "coordinates": [[1250, -340], [1400, -360], [1610, -300], …] } }
```

### Regole

- **Fermate.** Le fermate di una linea sono le stazioni che coincidono con un suo vertice, entro la tolleranza
  di `Geo.same`. L'ordine è quello dei vertici. Non si salva un elenco separato, per non avere due fonti di
  verità: l'ispettore della linea mostra sempre le fermate, così un aggancio sbagliato si vede subito.
- **Direttissime.** Avendo un binario proprio, non toccano le stazioni dove non fermano: la distinzione tra
  fermata e transito viene dalla geometria, senza campi in più.
- **Capolinea.** Primo e ultimo vertice di una linea aperta devono essere stazioni.
- **Linea circolare.** È una LineString chiusa: il primo vertice coincide con l'ultimo, e lì c'è una stazione.
  Non serve un campo `circular`, si ricava dalla geometria. Resta una LineString e non un Polygon, così non ha
  riempimento e le misure sono lunghezze.
- **Unicità.** In una linea ogni stazione compare una volta sola, tranne la stazione di chiusura di un anello.
  Questo esclude anche le forme "a lazo", che sarebbero di fatto una diramazione.
- **Segmento.** È il tratto di linea tra due fermate consecutive. La sua lunghezza è la lunghezza del binario
  (non la distanza in linea d'aria) e si calcola al momento, senza salvarla nel file. In un anello esiste anche
  il segmento "ultima fermata → prima fermata".
- **Interscambio.** È una stazione in cui fermano due o più linee.

### Grafo per il percorso più breve

- Nodi: le stazioni.
- Archi: un arco per ogni segmento di ogni linea, non orientato, con peso uguale alla lunghezza del segmento.
  Ogni arco appartiene a una sola linea, quindi i cambi si leggono direttamente dalla sequenza degli archi.
- Algoritmo: Dijkstra sulla distanza. A parità di distanza vince il percorso con meno cambi (solo come regola per
  i pareggi). Con alcune decine di stazioni il calcolo è istantaneo e non servono librerie.
- In un anello Dijkstra sceglie da solo il verso più corto.

## Fasi

Prima di distribuire l'editor al Consiglio conviene completare almeno le fasi 1 e 2, così il formato del file è
stabile. Le fasi successive aggiungono funzioni senza toccare il formato (la fase 6 aggiunge solo un campo
facoltativo).

### Fase 1: stazioni e linee sulla mappa

**Fase 1 fatta** (31/10/2026).
- *Prima parte*: tipi `linea` / `stazione` (`pointLabel` in `KINDS` per località e stazioni), `PANELS` e pannello
  "Ferrovie" con due sezioni (tasti 1–9), menu Crea filtrato per strumento (`targetOptions` in `ui.js`), disegno
  di linee (pane `linea`, direttissime più spesse, colore libero della tavolozza a ogni nuova linea) e stazioni
  (cerchio con il nome accanto, interscambi calcolati da `isInterchange` in `render.js`).
- *Seconda parte*: le stazioni sono punti di aggancio (`snapIgnore: false`); `Edit.createRailLine` in
  `tools.js` porta esattamente sulla stazione i vertici entro 14 px, chiude l'anello se l'ultimo punto è sul primo
  (un clic sul primo punto termina il disegno: Leaflet-Geoman non aggiunge quel vertice, lo aggiunge `pm:create`
  riconoscendo dove è avvenuto l'ultimo clic), crea le stazioni mancanti ai
  capolinea (con un avviso per dar loro un nome) e toglie i vertici doppi del doppio clic; barra degli strumenti
  con categoria e colore della prossima linea (`Settings.railType` / `railColor`, il colore vale per una linea
  sola); `Geo.countVertices` non conta due volte il vertice di chiusura; `Model.FORMAT_VERSION` e controllo in
  `io.js` (un file più recente si apre con un avviso e non si salva, anche dalla bozza).
- Il doppio clic per finire non ha richiesto codice: in Leaflet-Geoman il secondo clic cade sull'ultimo vertice,
  che termina la linea.

- `stazione` (geom `Point`) e `linea` (geom `LineString`, `subtypes: { direttissima, fermate }`, default in
  `Model.fitProps`) in `KINDS` e `KIND_ORDER`, icona del treno in [icons.js](../viewer/js/icons.js).
- **Pannello "Ferrovie"**: una sola voce nella colonna di sinistra per i due tipi, con le sezioni *Linee*
  (raggruppate per categoria) e *Stazioni*, e i pulsanti "+ Nuova linea" / "+ Nuova stazione". Oggi
  [ui.js](../viewer/js/ui.js) ha un pannello per tipo (`panel`, `showPanel`, `updateRail`, tasti 1–8 su
  `KIND_ORDER`, nascondi/blocca per tipo): serve un elenco di pannelli separato da `KIND_ORDER`, in cui
  "Ferrovie" raggruppa `linea` e `stazione` (nascondi e blocca agiscono su entrambi).
- **Stazione con lo strumento Punto (K)**: crea una stazione se **Crea** è su *Stazione*, altrimenti una località
  (`createPoint` / `targetKind` funzionano già così, basta che `stazione` ammetta `Point`).
- **Menu Crea filtrato**: propone solo i tipi compatibili con lo strumento attivo (Punto → Località, Stazione;
  linee → Acque, Territorio, Linea ferroviaria; aree → i tipi con poligoni). Cambiando strumento, se il tipo
  scelto non è compatibile si passa al primo compatibile. Vale anche per gli strumenti esistenti.
- **Aggancio alle stazioni**: oggi tutti i punti sono creati con `snapIgnore: true` (`makeLabel` in
  [render.js](../viewer/js/render.js)), quindi Leaflet-Geoman non li aggancerebbe: per le stazioni va tolto.
- **Strumento Linea = Linea per punti (D)** con **Crea** su *Linea ferroviaria*. Esiste già: disegno per punti di
  Leaflet-Geoman, aggancio, Invio per finire (`finishPolygon`), creazione con `Edit.createLine(want, g, fallback)`.
  Da aggiungere, solo quando si crea una `linea`, le regole qui sotto (fermate, chiusura dell'anello, stazioni
  automatiche ai capolinea).
  - Clic su una stazione: fermata. Clic altrove: curva del binario.
  - Invio o doppio clic: fine della linea.
  - Clic sulla stazione di partenza: chiude la linea circolare e termina il disegno (non è ambiguo, perché una
    linea aperta non torna mai sulla prima stazione).
  - Un capolinea creato fuori da una stazione genera automaticamente la stazione.
  - La categoria e il colore delle nuove linee si scelgono dalla barra degli strumenti, come oggi il regno delle
    nuove marche.
- **Disegno**: linee con il loro colore e uno stile per categoria (per esempio direttissime più spesse);
  stazioni come cerchi con il **nome accanto, come le località** (stesso markup `pe-label-localita` con
  pallino e testo, `label.anchor` e menu "Posizione del nome" nell'ispettore, stessa visibilità allo zoom in
  `updateLabels`), con uno stile proprio del cerchio; interscambi bianchi con il bordo nero. In `render.js` /
  `ui.js` i controlli `kind === 'localita'` vanno estesi alle stazioni (meglio con una proprietà in `KINDS`,
  per esempio `pointLabel: true`), e `defaultLabel` deve dare `anchor: 'right'` anche alle stazioni.
- `Geo.countVertices` esteso alle LineString chiuse: oggi conta due volte il vertice di chiusura, lo stesso
  problema già corretto per gli anelli dei poligoni.
- `normalize` e `Store.load`: valori di default per `subtype` (già coperti da `Model.fitProps`).
- Controllo della versione del file: l'editor rifiuta di **salvare** un file con `metadata.version` più recente
  di quella che conosce (lo apre e avvisa). Non serve oggi, ma protegge le mappe del Consiglio dalla prima
  modifica futura del formato. Oggi [io.js](../viewer/js/io.js) non legge `metadata.version`.
- README: nuovi `kind` nella sezione "Formato del file" e nuovi strumenti nella tabella dei tasti.

**Fatta quando**: si traccia una rete di prova (almeno 5 stazioni, 2 linee con un interscambio, 1 linea
circolare), la si salva e il file riaperto è identico.

### Fase 2: modifica della rete

- **Spostare una stazione** sposta i vertici coincidenti di tutte le linee che ci fermano, in un solo passo di
  annullamento. È il meccanismo dei confini collegati (`Geo.moveVertex`, `Edit.vertexDragStart` /
  `vertexDragEnd`); nella linea circolare sposta insieme primo e ultimo vertice.
- **Vertici-fermata bloccati**: trascinando la linea, i vertici che coincidono con una stazione non si staccano
  da soli; si spostano solo spostando la stazione.
- **Stazione inserita su una linea esistente**: se la nuova stazione cade sul binario, si aggiunge un vertice in
  quel punto (come `Geo.stitch` applicato a un solo punto) e diventa una fermata.
- **Eliminare una stazione**: sulle linee il vertice resta come semplice curva; si avvisa che la fermata sparisce
  e, se era un capolinea, che la linea resta senza capolinea.
- **Prolungamento** da un capolinea (non disponibile sulle linee circolari).
- Controllo della regola di unicità durante il disegno e la modifica.

**Fatta quando**: spostare, inserire ed eliminare stazioni non lascia mai linee staccate dalle loro fermate, e
Ctrl+Z annulla ogni operazione in un passo solo.

### Fase 3: ispettori

- **Linea**: nome, colore, categoria (menu Categoria già esistente); "Circolare" al posto dei capolinea se è un anello; fermate in ordine con il
  chilometraggio progressivo (in un anello la prima fermata compare una volta e il totale comprende il tratto di
  chiusura); lunghezza totale; avvisi se un capolinea o il punto di chiusura non è una stazione.
- **Stazione**: le linee che ci fermano e, per ognuna, le fermate adiacenti con la distanza del segmento;
  coordinate; indicazione di interscambio.
- Formato delle distanze: km con i blocchi tra parentesi, per esempio `3,42 km (3 420 blocchi)`.

**Fatta quando**: per ogni stazione si leggono le distanze verso le fermate adiacenti e i totali delle linee
coincidono con `Geo.length`.

### Fase 4: calcolatore di percorso

- Nuovo modulo `viewer/js/rail.js` con funzioni pure (come `Geo`): fermate di una linea, segmenti con le loro
  lunghezze, costruzione del grafo, Dijkstra, interscambi.
- Nel pannello Ferrovie: menu **Partenza** e **Arrivo** e pulsante "Calcola".
- Risultato:
  - i segmenti del percorso evidenziati sulla mappa;
  - l'itinerario per linee, per esempio "Costiera: Porto Vecchio → Bivio Nord, 12,4 km · cambio · Direttissima
    Est: Bivio Nord → Altafonte, 3,1 km";
  - il totale in km e in blocchi.

**Fatta quando**: sulla rete di prova i risultati coincidono con quelli calcolati a mano, compreso un percorso su
una linea circolare in cui conviene il verso "all'indietro".

### Fase 5: schema ottilineare ed esportazione

- Nuovo modulo `viewer/js/schema.js`.
- **Disposizione automatica** (euristica, sufficiente per alcune decine di stazioni):
  1. si parte dalle coordinate reali;
  2. la direzione di ogni segmento si arrotonda al multiplo di 45° più vicino;
  3. con alcuni giri di aggiustamento si spostano le stazioni per rispettare quelle direzioni;
  4. le stazioni si allineano a una griglia e si separano quelle troppo vicine.
- Gli anelli devono restare poligoni chiusi con lati a 0°, 45° e 90°, senza incrociarsi; i nomi delle loro
  stazioni vanno all'esterno.
- **Disegno in SVG**: linee spesse colorate con angoli arrotondati, fermate come trattini o pallini, interscambi
  come cerchi bianchi bordati, nomi a 0° o 45°, legenda divisa per categoria.
- **Esportazione**:
  - "Esporta SVG", rifinibile in Inkscape;
  - "Esporta PDF" con la stampa del browser e un foglio di stile dedicato, senza librerie. Se servirà un pulsante
    diretto: jsPDF + svg2pdf copiate in `viewer/lib/`, come le altre librerie.

**Fatta quando**: il PDF dell'intera rete è leggibile su un foglio A3 senza nomi sovrapposti, o con pochi casi da
sistemare a mano.

Riferimento per approfondire: il disegno ottilineare ottimo è un problema noto in letteratura (Nöllenburg e
Wolff, programmazione lineare intera); qui non serve, ma è utile se le euristiche non bastano.

### Fase 6: rifiniture (facoltative)

- **Vista Schema** con ritocco manuale: si trascinano le stazioni con aggancio a griglia e a 45°; la posizione si
  salva nella stazione come `schema: [x, y]`, così lo schema resta stabile tra un'esportazione e l'altra.
- Ricerca (Ctrl+K) estesa a stazioni e linee.

## File coinvolti

| File | Fasi |
|---|---|
| [viewer/js/model.js](../viewer/js/model.js): `KINDS`, `KIND_ORDER`, `make`, `normalize`, `Store.load` | 1 |
| [viewer/js/io.js](../viewer/js/io.js): controllo della versione del file | 1 |
| [viewer/js/geo.js](../viewer/js/geo.js): `countVertices` per le LineString chiuse | 1 |
| [viewer/js/tools.js](../viewer/js/tools.js): strumenti Stazione e Linea, operazioni in `Edit` | 1, 2 |
| [viewer/js/render.js](../viewer/js/render.js): stile di linee e stazioni, evidenziazione del percorso | 1, 3, 4 |
| [viewer/js/ui.js](../viewer/js/ui.js): pannello, ispettori, calcolatore di percorso, esportazione | 1, 3, 4, 5 |
| [viewer/js/icons.js](../viewer/js/icons.js), [viewer/index.html](../viewer/index.html), [viewer/css/editor.css](../viewer/css/editor.css) | 1, 4, 5 |
| `viewer/js/rail.js` (nuovo): fermate, segmenti, grafo, Dijkstra | 3, 4 |
| `viewer/js/schema.js` (nuovo): disposizione ottilineare, SVG, PDF | 5, 6 |
| [README.md](../README.md) | ogni fase |

Il progetto resta com'è: JavaScript puro senza compilazione, librerie copiate in locale in `viewer/lib/`.

## Punti di attenzione

- **Aggancio alle stazioni.** Lo strumento Linea si appoggia allo snapping di Leaflet-Geoman: va verificato che
  aggancia in modo affidabile i marker delle stazioni e, se serve, forzare il vertice sulle coordinate esatte
  della stazione dopo l'aggancio.
- **Tolleranza.** Le fermate dipendono dalla coincidenza tra vertice e stazione: la tolleranza di `Geo.same`
  (0,05 blocchi) e l'arrotondamento a 0,1 di `Geo.r1` devono restare coerenti in tutte le operazioni.
- **Fallback di `normalize`.** Una feature senza `kind` riconosciuto diventa località (Point) o acqua
  (LineString), e lo stesso succede a una feature la cui geometria non è ammessa dal suo `kind`: le stazioni e
  le linee devono sempre avere il loro `kind` scritto nel file, e `KINDS` deve ammettere le loro geometrie
  (`Point` per `stazione`, `LineString` per `linea`).
- **Etichette delle linee.** Deciso: il nome delle linee ferroviarie si mostra lungo il tracciato, come per
  fiumi e DMZ (`labelPlacements` in [render.js](../viewer/js/render.js), `Geo.lineAt` in
  [geo.js](../viewer/js/geo.js), `label.repeat` per il numero di copie), e si nasconde con "Mostra il nome sulla
  mappa". Non serve codice nuovo: basta uno stile CSS per `pe-label-linea` (per esempio nel colore della linea)
  e, se serve, un intervallo di visibilità in `PX`.
- **Pane e livelli.** Le DMZ hanno pane propri (`dmzBand`, `dmz`) sopra le marche; le ferrovie andranno in un
  pane loro, probabilmente sopra le DMZ e sotto le etichette (`PANES` in `render.js`).
