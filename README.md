# Editor cartografico di Panera

Editor web per disegnare la carta politica e geografica di Panera sopra le tiles generate da uNmINeD.
I dati cartografici stanno in file GeoJSON: l'editor si apre con una mappa vuota, da cui se ne crea una nuova
oppure se ne apre una esistente con **Apri** (o trascinando il file sulla finestra).

## Avvio

L'unico requisito è **Python 3.7 o successivo** (nessun pacchetto da installare; le librerie dell'editor
sono già nella cartella `viewer/lib/`). Browser consigliati: Chrome o Edge.

| Sistema | Come avviare |
|---|---|
| Windows | doppio clic su `avvia-editor.bat` |
| Linux / macOS | `sh avvia-editor.sh` (oppure, una volta, `chmod +x avvia-editor.sh` e poi doppio clic / `./avvia-editor.sh`) |
| Ovunque | `python3 avvia-editor.py` (su Windows `py avvia-editor.py`) |

Si apre `http://localhost:8765/viewer/index.html`; chiudendo la finestra del terminale il server si ferma.
Bozze e preferenze sono salvate nel browser per indirizzo: se la porta 8765 è occupata l'avviatore usa la
successiva, ma lì non si vedranno le bozze salvate sulla 8765.

Per installare Python: su Windows da <https://www.python.org/downloads/> (spuntando "Add python.exe to PATH");
su Linux è quasi sempre già presente, altrimenti `sudo apt install python3` (o l'equivalente della distribuzione).

Aprendo direttamente `viewer/index.html` dal disco l'editor funziona lo stesso.

## Cartelle

| Percorso | Contenuto |
|---|---|
| `render_…/` | tiles di uNmINeD (la cartella usata è indicata in `viewer/js/basemap.js`) |
| `viewer/` | l'editor (`index.html`, `css/`, `js/`, librerie in `lib/`, tutto in locale) |
| `data/` | le mappe GeoJSON (vedi sotto per i nomi dei file) |

## Uso

- **Pannelli a sinistra**: uno per tipo di entità (Regni, Marche, Protettorati, Territori, Regioni, Continenti,
  Acque, Località), più **Ferrovie**, che raccoglie linee ferroviarie e stazioni in due sezioni. I tasti 1–9 aprono
  i pannelli. Da ciascuno si crea una nuova entità, si filtra l'elenco, si nascondono o bloccano quei tipi
  sulla mappa. Passando sopra una riga l'entità si evidenzia sulla mappa; clic per selezionarla e centrarla.
- **Marche e regni**: nel pannello Marche le marche sono raggruppate per regno; trascina una riga su un altro
  regno per riassegnarla. Il colore di una marca è quello del suo regno.
- **Protettorati condivisi**: un protettorato può appartenere a più regni (nell'ispettore: chip dei regni
  proprietari, × per toglierne uno, *+ Aggiungi regno…*). Sulla mappa ha righe alternate nei colori dei regni ed
  etichetta "(Avalon · Papasan)"; nel pannello compare sotto ogni suo regno con la scritta *condiviso*.
  Trascinandone una copia su un altro regno si sostituisce solo il regno da cui la si è presa.
- **Hover e selezione**: passando sulla mappa le entità si mettono in rilievo; clic per selezionarle.
  Compaiono i vertici del confine: trascinali per modificarlo, clic su un lato per aggiungere un vertice,
  tasto destro su un vertice per toglierlo. L'etichetta selezionata si può trascinare.
- **Pannelli richiudibili**: le linguette a freccia sui bordi della mappa chiudono e riaprono i pannelli.
  A sinistra, da chiuso resta la colonna dei tipi: un clic su un tipo apre il suo pannello, un nuovo clic
  sullo stesso tipo lo richiude. L'ispettore a destra si chiude del tutto e si riapre da solo quando crei
  una nuova entità, per darle il nome.
- **Ispettore a destra**: nome, tipo, regno, categoria, colore, etichetta (dimensione, rotazione, posizione),
  misure, note.
- **Ferrovie**: dal pannello *Ferrovie* (tasto 9) si creano stazioni e linee. Una **stazione** si crea anche con il
  Punto (K) e **Crea** su *Stazione*: è un cerchio con il nome accanto, bianco e bordato di nero se è un
  interscambio (ci fermano due o più linee). Una **linea** si traccia con *Linea per punti* (D) e **Crea** su
  *Linea ferroviaria*; nella barra si scelgono categoria (*con fermate* / *direttissima*) e colore della prossima
  linea. Durante il disegno:
  - clic su una stazione = **fermata** (il vertice va esattamente sulla stazione); clic altrove = curva del binario;
  - clic sul **primo punto** = chiude una **linea circolare** e termina;
  - clic sull'ultimo punto, doppio clic o Invio = fine;
  - un capolinea fuori da una stazione **crea la stazione** (da rinominare).

  Nell'**ispettore**: una linea mostra capolinea (o *Circolare*), le fermate in ordine con la progressiva in km e la
  lunghezza di ogni tratto, la lunghezza totale e un avviso se un capolinea non è una stazione; una stazione mostra
  le linee che ci fermano (e se è un interscambio), con la fermata precedente e la successiva e la distanza lungo il
  binario. Le distanze sono in km con i blocchi tra parentesi (1 blocco = 1 m); clic su un nome per andarci.

  **Calcolatore di percorso**: nel pannello Ferrovie si scelgono **Partenza** e **Arrivo** (⇅ le scambia) e si
  preme **Calcola**. Il percorso è il più corto in blocchi lungo i binari; a parità di distanza, quello con meno
  cambi. Sulla mappa i tratti percorsi si evidenziano; nel pannello compaiono il totale (km e blocchi), il numero di
  cambi e l'itinerario linea per linea ("Costiera: Porto Vecchio → Bivio Nord · 3 fermate", poi "cambio a …").
  Il risultato si aggiorna da solo se si modifica la rete; × lo toglie.

  **Schema della rete**: dal pannello Ferrovie, *Schema della rete (SVG / PDF)* apre lo schema "metropolitana"
  (linee a 0°, 45° e 90°, disposizione automatica a partire dalle posizioni reali, linee affiancate sui tratti
  comuni, interscambi come cerchi bianchi bordati di nero, legenda divisa per categoria). **Esporta SVG** scarica
  il file (rifinibile in Inkscape); **Esporta PDF** apre la stampa del browser su un foglio A3 orizzontale: scegli
  *Salva come PDF*. Esc chiude lo schema.

  Modificando la rete:
  - **spostare una stazione** (trascinandola o dalle coordinate) sposta con lei le linee che ci fermano;
    **trascinare un vertice-fermata** di una linea sposta anche la stazione e le altre linee che ci fermano;
  - una **stazione posata su un binario** diventa una fermata di ogni linea che passa di lì (direttissime comprese);
  - **eliminando una stazione** il vertice resta come semplice curva, con un avviso se era una fermata o un capolinea;
  - per **prolungare** una linea si trascina il capolinea (la stazione lo segue) e si aggiungono vertici;
  - una stazione compare **una sola volta** in una linea (tranne la chiusura di una linea circolare): le modifiche
    che violerebbero la regola vengono annullate con un avviso.
- **DMZ** (Green Line, Blackline…): da **+ Nuovo territorio** → *DMZ (linea per punti)*, oppure con lo strumento
  *Linea per punti* (D) e **Crea** su *Territorio*, si traccia la linea principale. Nasce come semplice linea divisoria; nell'ispettore il campo **Margine** (blocchi per lato)
  la allarga in una fascia cuscinetto larga il doppio del margine. Il nome si ripete lungo la linea. Nel pannello
  Territori le DMZ hanno un gruppo a parte.
- **Sfondo**: in fondo al pannello di destra, accanto alla griglia dei chunk, gli slider di **luminosità** e
  **saturazione** scuriscono o spengono le tiles lasciando invariati confini, colori ed etichette (doppio clic
  per tornare al 100 %). Sono preferenze del browser e non finiscono nel file.

### Strumenti

| Tasto | Strumento |
|---|---|
| V | Seleziona e modifica |
| F | Area a mano libera (tieni premuto e disegna il contorno) |
| P | Area per punti (clic sul primo punto o Invio per chiudere) |
| L | Linea a mano libera (fiumi) |
| D | Linea per punti (DMZ, linee ferroviarie, linee dritte): clic per i punti, due clic = linea dritta, Invio o clic sull'ultimo punto per finire |
| K | Punto: una località, oppure una stazione con **Crea** su *Stazione* (sono gli unici tipi che si creano come punto) |
| B / E | Pennello / gomma: aggiunge o toglie area all'entità selezionata |
| R | Ridisegna l'intero confine dell'entità selezionata |
| Spazio | tenuto premuto, sposta la mappa mentre disegni |
| Esc · Canc · Z | annulla lo strumento / deseleziona · elimina · centra la selezione |
| [ · ] | chiude/apre il pannello di sinistra · di destra (anche con le linguette a freccia sui bordi della mappa) |
| G | mostra/nasconde la griglia dei chunk (anche dall'interruttore in fondo al pannello di destra) |
| Ctrl+Z · Ctrl+Y · Ctrl+S · Ctrl+K | annulla · ripeti · salva · cerca |

Il menu **Crea** sceglie il tipo di entità prodotto dagli strumenti e propone solo i tipi compatibili con lo
strumento attivo (per esempio, con il Punto solo *Località* e *Stazione*); **Regno** sceglie il regno delle nuove marche.

**Sovrapposizioni** (solo marche e protettorati):
- *si ferma ai confini*: la nuova area viene ritagliata sui confini esistenti, così due marche confinanti
  combaciano senza buchi né sovrapposizioni. Basta disegnare un po' oltre il confine del vicino.
- *ruba ai vicini*: la nuova area viene tolta alle marche confinanti. È il modo più rapido per spostare un
  confine: seleziona una marca, pennello (B), disegna la porzione da annettere.
- *consentite*: nessun controllo.

**Confini collegati**: i confini comuni hanno gli stessi vertici; trascinandone uno si sposta anche quello
della marca vicina. **Aggancio**: i vertici trascinati si agganciano a quelli delle altre entità.

### Salvataggio

- **Salva** riscrive il file aperto (in Chrome/Edge, dopo il primo consenso); altrimenti chiede dove salvare.
- **Salva come…** crea sempre un nuovo file e propone il nome `panera_AAAA-MM-GG_hhmm.geojson`, da completare
  con autore e stato (vedi sotto).
- Ogni modifica viene anche salvata come bozza nel browser: se chiudi senza salvare, alla riapertura
  l'editor la ripristina (con l'opzione *Scarta*, che riparte da una mappa vuota).

### Nomi dei file

Le mappe da pubblicare sul repo si salvano in `data/` con il nome
`panera_AAAA-MM-GG_hhmm_<autore>_<stato>.geojson`, per esempio `panera_2026-10-30_1420_marco_official.geojson`
(`<stato>`: `official` per la versione ufficiale, `draft` per una bozza). Git tiene solo i file con questo nome:
gli altri GeoJSON in `data/` (prove, copie) restano locali.

## Formato del file

Un normale `FeatureCollection` GeoJSON, leggibile anche da QGIS e simili. Le coordinate sono coordinate di
gioco **[x, z] in blocchi** (z cresce verso sud), non latitudine/longitudine.

```json
{
  "type": "FeatureCollection",
  "name": "Panera",
  "metadata": { "format": "panera-map", "version": 1, "updated": "2026-10-24T10:00:00.000Z" },
  "features": [
    { "type": "Feature", "id": "regno-tabor",
      "properties": { "id": "regno-tabor", "kind": "regno", "name": "Tabor", "color": "#e8d81c", "label": { … } },
      "geometry": null },
    { "type": "Feature", "id": "marca-nakano-a1b2c3",
      "properties": { "id": "marca-nakano-a1b2c3", "kind": "marca", "name": "Nakano", "kingdom": "regno-tabor",
                      "notes": "", "label": { "show": true, "size": null, "rotation": null, "pos": null, "showKingdom": true } },
      "geometry": { "type": "Polygon", "coordinates": [[[120, -300], [180, -310], …, [120, -300]]] } }
  ]
}
```

| `kind` | Geometria | Proprietà specifiche |
|---|---|---|
| `regno` | `null` (l'estensione è l'unione delle sue marche) | `color` |
| `marca` | Polygon / MultiPolygon | `kingdom` |
| `protettorato` | Polygon / MultiPolygon | `kingdoms` (uno o più regni) · `kingdom` (= il primo di `kingdoms`) |
| `territorio` | Polygon / MultiPolygon / LineString | `color` (facoltativo) · `subtype`: `area`, oppure `dmz` per le linee · `margin` (solo DMZ) |
| `regione` | Polygon / MultiPolygon | `color` (facoltativo) |
| `continente` | Polygon / MultiPolygon | `color` (facoltativo) |
| `acqua` | LineString / Polygon | `subtype`: fiume, torrente, canale, lago, laguna, mare, oceano, golfo, baia, stretto |
| `localita` | Point | `subtype`: capitale, citta, villaggio, castello, porto, luogo · `kingdom` (facoltativo) |
| `linea` | LineString | linea ferroviaria: `color` · `subtype`: `fermate` (con fermate), `direttissima` |
| `stazione` | Point | — (una linea ferma nelle stazioni che coincidono con i suoi vertici) |

Un territorio LineString è una DMZ: `margin` è la distanza in blocchi della fascia cuscinetto da ciascun lato
della linea (`0` = solo la linea). La categoria `area` / `dmz` si ricava dalla geometria.

Proprietà comuni: `id` (univoco, usato come riferimento da `kingdom` e `kingdoms`), `name`, `notes`, `color`
(`null` = automatico) e `label`:

| Campo di `label` | Significato |
|---|---|
| `show` | mostra il nome sulla mappa |
| `size` | altezza del testo in blocchi, minimo 2 (`null` = calcolata dall'area o dalla lunghezza) |
| `rotation` | gradi (`null` = automatica: 0, oppure lungo il fiume) |
| `pos` | `[x, z]` del nome (`null` = punto più interno dell'area; sulle linee lunghe il nome si ripete lungo il tracciato) |
| `repeat` | solo linee: numero di copie del nome lungo la linea, da 1 a 10 (`null` = automatico, in base alla lunghezza) |
| `showKingdom` | mostra "(Regno)" sotto il nome di marche e località |
| `anchor` | solo località e stazioni: `right`, `left`, `top`, `bottom` |

Un file con `metadata.version` più recente di quella che l'editor conosce si apre (con un avviso) ma non si
può salvare: serve una versione aggiornata dell'editor.

Un file GeoJSON qualsiasi viene comunque aperto: le feature senza `kind` diventano località (punti),
acque (linee) o marche (poligoni). Lo stesso vale per una feature la cui geometria non è ammessa dal suo
`kind`: per esempio un continente salvato come punto diventa una località di categoria `luogo`.
