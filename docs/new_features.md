# Nuove funzioni (richieste di Raj)

Piano per quattro modifiche all'editor chieste da Raj.
Stato: **fasi 0–4 completate**, fase 5 da fare (31/10/2026).

> - Protettorato, inclusione di più regni (es. Avalon-Papasan) con mix di colori se 2 regni ne fanno parte
> - Creazione di linee di confine tipo dmz, vedi Green Line o Blackline (aggiungerei una categoria sotto territori
>   che permetta la creazione di una riga dritta con il nome ripetuto almeno un paio di volte da entrambi i lati dx e sx)
> - Ripetizione a un tot di distanza del nome di un fiume più volte almeno 2 o 3 in base alla lunghezza.
> - Inoltre è possibile avere una specie di filtro di luminosità della mappa? il background è molto luminoso e
>   faccio fatica con i colori

## Requisiti concordati

| Tema | Decisione |
|---|---|
| Filtro mappa | due slider, **luminosità** e **saturazione**, solo sullo sfondo |
| Fiumi | nome ripetuto **in automatico** in base alla lunghezza, nessun numero scelto a mano |
| DMZ | categoria dei **territori**: una **linea principale** con un campo **margine** in blocchi |
| Margine della DMZ | **default 0**: la DMZ nasce come semplice linea divisoria; il margine si aumenta o diminuisce dall'ispettore e allarga la fascia cuscinetto |
| Nome della DMZ | **lungo la linea principale**, ripetuto: le ripetizioni **crescono con la lunghezza** |
| Protettorato | può appartenere a **più regni**, senza limite di numero |
| Colori del protettorato | **righe alternate**, una striscia per colore di regno (niente colori mescolati) |
| Pannello Protettorati | il protettorato compare **sotto ciascun regno proprietario**, duplicato se i regni sono più di uno; accanto al nome, in corsivo grigio, la scritta *condiviso* |
| Ispettore del protettorato | mostra i regni proprietari e permette di **aggiungerne e toglierne** |

Come per le ferrovie ([ferrovie.md](ferrovie.md)), il repo non è ancora stato distribuito al Consiglio e non
esistono mappe da migrare: il formato si estende restando alla `version: 1`, con campi nuovi facoltativi
che i file attuali semplicemente non hanno.

## Modello dati

### Territorio: categoria DMZ

`KINDS.territorio` ([viewer/js/model.js](../viewer/js/model.js)) riceve le categorie e accetta anche le linee.

| Campo | Valori |
|---|---|
| `subtype` | `area` (default, i territori di oggi) · `dmz` |
| geometria | Polygon / MultiPolygon / Point come oggi; **LineString** solo per `dmz` |
| `margin` | solo `dmz`: blocchi **per lato** dalla linea principale, default `0` (larghezza totale = 2 × `margin`) |

```json
{ "type": "Feature", "id": "territorio-green-line-x7k2pa",
  "properties": { "id": "territorio-green-line-x7k2pa", "kind": "territorio", "subtype": "dmz", "name": "Green Line",
                  "color": "#3a8f3a", "margin": 0, "notes": "", "label": { … } },
  "geometry": { "type": "LineString", "coordinates": [[1200, -400], [1650, -380]] } }
```

### Protettorato: più regni

| Campo | Significato |
|---|---|
| `kingdoms` | `[id, id, …]`: i regni proprietari, nell'ordine delle strisce |
| `kingdom` | resta, sempre uguale a `kingdoms[0]` (o `null`), così il codice e i file attuali continuano a funzionare |

Un file senza `kingdoms` si legge come `kingdoms = [kingdom]` (o `[]`). Un protettorato è **condiviso** quando
`kingdoms.length ≥ 2`.

## Fasi

Ogni fase si chiude con un commit e funziona da sola. Le fasi 2 e 3 vanno in quest'ordine (la DMZ riusa le
etichette multiple dei fiumi); la fase 4 è indipendente e si può anticipare.

### Fase 0: preparazione ✔

- **Avvio con mappa vuota**: l'editor non carica più `data/panera.geojson` all'avvio (via `DEFAULT_URL` e
  `reloadDefault` da [io.js](../viewer/js/io.js), via l'avviso in [main.js](../viewer/js/main.js)). Si crea una
  mappa nuova o se ne apre una con **Apri** / trascinamento. Resta il ripristino della bozza con modifiche non
  salvate; *Scarta* riporta alla mappa vuota.
- **Nomi dei file**: `panera_AAAA-MM-GG_hhmm_<autore>_<stato>.geojson`, con `<stato>` sempre presente
  (`official` o `draft`). **Salva come…** (e il primo **Salva** di una mappa nuova) propone
  `panera_AAAA-MM-GG_hhmm.geojson`: autore e stato si aggiungono a mano.
- **[.gitignore](../.gitignore)**: ignora tutti i GeoJSON in `data/` tranne quelli con il nome della convenzione.
  `data/panera.geojson`, usato per gli esperimenti, resta locale.
- **[README.md](../README.md)**: avvio, cartelle, salvataggio e sezione "Nomi dei file" aggiornati.
- Mappa di prova per le fasi successive: `data/panera.geojson` (locale), da arricchire con un fiume lungo e
  tortuoso disegnato a mano libera, un fiume corto e un protettorato vicino ad Avalon e Papasan.

**Fatta quando**: l'editor si avvia su una mappa vuota, apre `data/panera.geojson` con **Apri**, e
`git status` non mostra i GeoJSON di prova.

### Fase 1: filtro luminosità e saturazione ✔

- `filter: brightness(…) saturate(…)` sul **solo pane delle tiles** (`tilePane`, in
  [basemap.js](../viewer/js/basemap.js)): confini, colori, etichette e griglia restano invariati.
- Due slider in fondo al pannello di destra, accanto a "Griglia dei chunk" (`#optGrid` in
  [index.html](../viewer/index.html) e [ui.js](../viewer/js/ui.js)):
  - **Luminosità**: 30–100 %, default 100;
  - **Saturazione**: 0–100 %, default 100 (a 0 lo sfondo è in bianco e nero e i colori politici risaltano).
- Doppio clic su uno slider: torna al 100 %.
- Valori in `Settings` ([tools.js](../viewer/js/tools.js)), nuovi campi `bgBrightness` e `bgSaturation`: è una
  preferenza del browser di ciascuno e non va nel GeoJSON.

**Fatta quando**: abbassando i due slider lo sfondo si scurisce e si spegne mentre i colori dei regni restano
identici, e ricaricando la pagina i valori restano.

### Fase 2: etichette multiple e nome dei fiumi ripetuto ✔

- **Etichette multiple** in [render.js](../viewer/js/render.js): da `it.label` / `it.el` a `it.labels[]` /
  `it.els[]` (funzioni `addLabels`, `removeLabels`, `labelDrag`), adattando `create`, `destroy`, `refresh`,
  `updateLabels` e il trascinamento. Le entità con un'etichetta sola (quasi tutte) hanno un array di un elemento;
  per i punti l'unica etichetta resta la forma stessa (`it.pointShape`).
- **`Geo.lineAt(g, t, span)`** in [geo.js](../viewer/js/geo.js) sostituisce `lineMid`: punto alla frazione `t`
  della linea, angolo e lunghezza. Con `span` l'angolo è quello della **corda** lunga `span` blocchi centrata sul
  punto (si usa la larghezza del nome): le linee a mano libera hanno segmenti cortissimi e l'angolo del singolo
  segmento "balla".
- **Numero di ripetizioni** (`labelPlacements` in `render.js`): N = `clamp(floor(lunghezza / (3,5 × larghezza
  del nome)), 1, 6)`, con la larghezza stimata come `dimensione × caratteri × 0,8`. Posizioni a `t = i/(N+1)`.
  Tutto in blocchi: le etichette non si spostano zoomando.
- **Niente diradamento allo zoom**: distanza tra le copie e larghezza del testo sono entrambe in blocchi e
  scalano insieme, quindi se non si toccano a uno zoom non si toccano a nessuno.
- **Dimensione automatica delle linee**: prima cresceva in proporzione alla lunghezza (le ripetizioni sarebbero
  state sempre lo stesso numero); ora cresce con la **radice** della lunghezza, `clamp(√L × 0,8 / max(1,
  caratteri/8), 10, 60)`. Riguarda solo le linee con dimensione "auto"; quelle con `label.size` fissata non
  cambiano.
- **Posizione e rotazione manuali**: trascinando una qualsiasi copia si fissa `label.pos` e resta solo quella;
  "reimposta" nell'ispettore ripristina le ripetizioni. `label.rotation`, se impostata, vale per tutte le copie.
- Vale per tutte le linee (oggi fiume, torrente, canale; domani la DMZ). Nessun campo nuovo nel file.

**Fatta quando**: sulla mappa di prova il fiume lungo mostra 2–3 nomi che seguono l'andamento del fiume senza
storture, il fiume corto uno solo, e trascinare / reimpostare l'etichetta funziona.

### Fase 2b: dimensione delle etichette ✔

Richiesta emersa durante i lavori: le etichette vanno quasi sempre ridotte sotto i 30 blocchi, e lì lo slider
era poco preciso (8–2000 blocchi in 100 scatti, solo interi: la fascia 8–30 occupava un quarto della corsa).
Vale per tutte le entità.

- **Slider** ([ui.js](../viewer/js/ui.js)): logaritmico da **2 a 150 blocchi** in 1000 scatti; la fascia 2–30
  occupa circa due terzi della corsa. Precisione di mezzo blocco sotto i 20, un blocco sopra.
- **Campo numerico** accanto allo slider: valore esatto, frecce ±0,5 sotto i 20 e ±1 sopra, accetta fino a
  2000 blocchi (oceani e simili). Slider e campo restano allineati.
- **Dimensione automatica ricalibrata** ([render.js](../viewer/js/render.js), `autoSize`) sulle dimensioni
  scelte a mano in `panera.geojson`: coefficiente delle aree da 0,11 a 0,08, minimi molto più bassi (marche
  da 22 a 6, continenti da 120 a 15), località circa ÷3 (città 32 → 10), linee `clamp(√L × 0,6 / …, 4, 40)`.
  Cambia l'aspetto delle etichette in "auto"; quelle con dimensione fissata non cambiano.
- **Rotazione a quadrante**: al posto dello slider, un semicerchio con la lancetta (in alto 0°, a sinistra -90°,
  a destra +90°). Clic o trascinamento con precisione di 1° (Shift: scatti di 15°), frecce da tastiera ±1° / ±15°,
  doppio clic o tasto 0 per tornare a 0°. Con "auto" la lancetta è attenuata.
- "Mostra il nome sulla mappa": l'entità selezionata mostrava sempre il nome, quindi la spunta sembrava non fare
  nulla; ora il nome nascosto si vede attenuato finché l'entità è selezionata. Nelle località la spunta nasconde
  solo il nome, non più anche il pallino.
- Corretto di passaggio: alla fine del trascinamento degli slider Dimensione e Rotazione si creava un passo di
  annullamento vuoto ("Etichetta").
- Nota: un'etichetta compare solo da 7 px a schermo (8 per le località), quindi quelle piccole si vedono solo
  zoomando: 3 blocchi = visibile dallo zoom +2.

**Fatta quando**: si impostano con lo slider valori come 3, 4,5, 7 senza fatica; il campo numerico e lo slider
restano allineati; le etichette in "auto" della mappa di prova sono vicine a quelle scelte a mano.

### Fase 3: DMZ (linea con margine) ✔

- **Modello** ([model.js](../viewer/js/model.js)): `territorio` accetta `LineString` e ha
  `subtypes: { area, dmz }`. La categoria non si sceglie: la ricava `Model.fitProps` dalla geometria (linea = DMZ),
  sia alla creazione sia all'apertura dei file e al cambio di tipo nell'ispettore. Le DMZ hanno `margin`
  (blocchi per lato, default `0`); sugli altri territori il campo non c'è. I file esistenti si aprono come prima
  (i territori ricevono `subtype: 'area'`).
- **Strumento Linea per punti** (tasto **D**, [tools.js](../viewer/js/tools.js)): disegno per punti di
  Leaflet-Geoman, con aggancio; due clic = linea dritta; clic sull'ultimo punto o Invio per finire.
  `targetKind` / `createLine` hanno un ripiego per le linee: con **Crea** su un tipo che non accetta linee, la
  linea a mano libera (L) diventa un fiume e quella per punti (D) una DMZ. Lo strumento è generico e servirà
  anche alle ferrovie.
- **Resa** ([render.js](../viewer/js/render.js)):
  - `margin = 0`: linea divisoria piena, spessa 3,5 px, nel colore della DMZ (default verde `#4f9a3a`,
    modificabile);
  - `margin > 0`: la linea principale diventa sottile, chiara e tratteggiata; sotto, la fascia è fatta di due
    polyline larghe `2 · margin · 2^zoom` px (bordo chiaro + riempimento) nel pane `dmzBand` al 45 % di opacità,
    ricalcolate a ogni `zoomend`. Estremità e angoli arrotondati: equivale a un buffer vero, senza `turf.buffer`.
  - Pane propri (`dmzBand`, `dmz`) sopra le marche. Anche la fascia si evidenzia e si seleziona col clic.
- **Nome**: lungo la linea principale, con le ripetizioni della fase 2.
- **Ispettore** ([ui.js](../viewer/js/ui.js)): campo **Margine** (blocchi per lato, frecce ±1) con l'indicazione
  "fascia larga N blocchi" / "solo la linea"; la fascia si aggiorna mentre si cambia il valore, in un solo passo
  di annullamento. Per i territori non compare il menu Categoria. Misure: lunghezza e vertici.
- **Pannello Territori**: le righe sono divise nei gruppi *Area* e *DMZ*.
- **Sovrapposizioni**: la DMZ non è un'entità politica, quindi non ritaglia e non viene ritagliata dalle marche.

**Fatta quando**: si traccia una DMZ con due clic, nasce come linea, portando il margine a 20 diventa una fascia
larga 40 blocchi a ogni zoom (verificabile con la griglia dei chunk), il nome si ripete lungo la linea, e il file
salvato e riaperto è identico.

### Fase 3b: punti solo per le località ✔

Richiesta emersa durante i lavori: un punto (strumento K) ha senso solo come località, non come territorio,
regione, continente o specchio d'acqua.

- `Point` tolto dalle geometrie di `territorio`, `regione`, `continente` e `acqua` ([model.js](../viewer/js/model.js)).
  Lo strumento K crea sempre una località; nel menu "+ Nuovo" degli altri tipi non compare più "Solo il nome (punto)".
- I nomi di mari e oceani vanno sull'area: l'etichetta si posiziona da sola al centro e si può trascinare.
- **File esistenti**: `normalize` porta le feature con una geometria non ammessa dal loro `kind` al tipo adatto
  alla geometria; i punti diventano località di categoria `luogo`, con nome ed etichetta conservati.
  Nelle mappe attuali non ce ne sono.

### Fase 4: protettorato condiviso ✔

- **Modello** ([model.js](../viewer/js/model.js)): i protettorati hanno `kingdoms: [id, …]` (i regni proprietari,
  nell'ordine delle strisce) e `kingdom`, sempre uguale a `kingdoms[0]`, così il resto del codice e i file attuali
  continuano a funzionare. Due funzioni condivise, `Model.kingdomIds(p)` e `Model.setKingdoms(p, ids)`, leggono e
  scrivono i regni tenendo allineati i due campi (senza doppioni); `fitProps` le applica alla creazione,
  all'apertura e al cambio di tipo (un protettorato che diventa marca tiene solo il primo regno). I file senza
  `kingdoms` si leggono come `[kingdom]`; `Store.load` toglie gli id di regni inesistenti.
- **Operazioni** ([tools.js](../viewer/js/tools.js)): `addKingdom`, `removeKingdom`, `moveKingdom` (ognuna un passo
  di annullamento). Eliminando un regno lo si toglie solo dalla lista: un protettorato Avalon-Papasan resta di
  Avalon.
- **Righe alternate** ([render.js](../viewer/js/render.js)): `Defs.hatch(colors[])` crea un pattern largo
  `10 × N`, ruotato di 45°, con una striscia per regno; l'id del pattern dipende dai colori, quindi cambiando il
  colore di un regno si rigenera da solo. Con un solo regno la resa è identica a prima. Il bordo puntinato dei
  condivisi è neutro (grigio chiaro).
- **Etichetta**: "(Avalon · Papasan)". Anche ricerca, intestazione dell'ispettore e riquadro al passaggio del
  mouse mostrano tutti i regni.
- **Pannello Protettorati** ([ui.js](../viewer/js/ui.js)): il protettorato compare sotto **ogni** regno
  proprietario, con *condiviso* in corsivo grigio accanto al nome. Trascinare una copia su un altro regno
  sostituisce solo il regno da cui la si è presa (se il regno d'arrivo è già proprietario la copia sparisce;
  su "Senza regno" quel regno viene tolto).
- **Ispettore**: al posto del menu "Regno", i **regni proprietari** come chip nel colore del regno (clic sul nome:
  va al regno; ×: lo toglie) e il menu **+ Aggiungi regno…** (con *+ Nuovo regno…*).
- **Comportamento**: selezionando un regno, o passando sul suo gruppo nel pannello, si evidenziano anche i
  protettorati condivisi; l'elenco "Domini" del regno li comprende. L'estensione del regno resta calcolata solo
  dalle marche.

**Fatta quando**: un protettorato Avalon-Papasan mostra righe blu e del colore di Papasan, compare sotto entrambi
i regni con *condiviso*, eliminando Papasan torna un protettorato del solo Avalon con la resa di prima, e Ctrl+Z
annulla ogni passaggio.

### Fase 5: documentazione e rifiniture

- [README.md](../README.md): tabella del formato (`subtype` e `margin` dei territori, `kingdoms` dei
  protettorati), nuovo strumento linea per punti nella tabella dei tasti, slider dello sfondo, protettorati
  condivisi nella sezione "Uso".
- Taratura finale su mappa reale: passo delle ripetizioni, spessore e colori della DMZ.

**Fatta quando**: Raj prova le quattro funzioni sulla mappa vera senza bisogno di spiegazioni oltre al README.

## File coinvolti

| File | Fasi |
|---|---|
| [viewer/js/basemap.js](../viewer/js/basemap.js): filtro sul pane delle tiles | 1 |
| [viewer/js/tools.js](../viewer/js/tools.js): `Settings`, strumento linea per punti, `targetKind` / `createLine`, eliminazione regno | 1, 3, 4 |
| [viewer/js/geo.js](../viewer/js/geo.js): `lineAt` | 2 |
| [viewer/js/render.js](../viewer/js/render.js): etichette multiple, resa della DMZ, `Defs.hatch(colors[])`, `labelHtml`, `restyle` | 2, 3, 4 |
| [viewer/js/model.js](../viewer/js/model.js): `KINDS.territorio`, `margin`, `kingdoms`, `normalize`, `Store.load` | 3, 4 |
| [viewer/js/ui.js](../viewer/js/ui.js): slider, campo Margine, pannello e ispettore dei protettorati | 1, 3, 4 |
| [viewer/index.html](../viewer/index.html), [viewer/css/editor.css](../viewer/css/editor.css) | 1, 3, 4 |
| [README.md](../README.md) | 5 |

## Punti di attenzione

- **Etichette multiple.** È il cambiamento più invasivo: tocca tutto il ciclo di vita delle etichette in
  `render.js`. Va fatto senza cambiare la resa delle entità con un'etichetta sola.
- **Spessore della DMZ.** Con `weight` in pixel ricalcolato allo zoom, durante l'animazione dello zoom la fascia
  potrebbe "saltare" per un attimo: se dà fastidio, aggiornarla anche sull'evento `zoom` oltre che su `zoomend`.
- **Righe del protettorato.** Con molti regni le strisce diventano strette: la larghezza della singola striscia
  resta fissa e il pattern si allarga.
- **Coerenza `kingdom` / `kingdoms`.** Ogni operazione che cambia `kingdoms` deve aggiornare anche `kingdom`,
  altrimenti le parti del codice che leggono solo `kingdom` vedono un regno sbagliato.
- **Ferrovie.** Lo strumento linea per punti e le etichette multiple servono anche al piano delle ferrovie
  ([ferrovie.md](ferrovie.md)): conviene scriverli in modo generico fin da qui.
