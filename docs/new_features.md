# Modifiche in programma

Stato al 30/10/2026: **solo pianificazione, nessun codice scritto**. Le richieste arrivano da Raj:

> - Protettorato, inclusione di più regni (es. Avalon-Papasan) con mix di colori se 2 regni ne fanno parte
> - Creazione di linee di confine tipo dmz, vedi Green Line o Blackline (aggiungerei una categoria sotto territori
>   che permetta la creazione di una riga dritta con il nome ripetuto almeno un paio di volte da entrambi i lati dx e sx)
> - Ripetizione a un tot di distanza del nome di un fiume più volte almeno 2 o 3 in base alla lunghezza.
> - Inoltre è possibile avere una specie di filtro di luminosità della mappa? il background è molto luminoso e
>   faccio fatica con i colori

## Ordine di lavoro

| # | Richiesta | Difficoltà | File coinvolti | Stato |
|---|---|---|---|---|
| 1 | Filtro luminosità dello sfondo | bassa | `basemap.js`, `ui.js`, `Settings` in `tools.js` | da fare |
| 2 | Nome dei fiumi ripetuto | media | `render.js`, `geo.js` | da fare |
| 3 | Linee di confine tipo DMZ | media (riusa il lavoro del punto 2) | `model.js`, `render.js`, `tools.js`, `ui.js` | da fare |
| 4 | Protettorato condiviso tra più regni | medio-alta | `model.js`, `render.js`, `ui.js`, `tools.js`, `README.md` | da fare |

Il punto 2 introduce le etichette multiple per entità, che servono anche al punto 3: va fatto prima.

## 1. Filtro luminosità dello sfondo

- `filter: brightness() saturate()` applicato **solo al pane delle tiles**: confini, colori ed etichette restano
  invariati, quindi lo sfondo si scurisce e i colori si leggono meglio.
- Slider in fondo al pannello di destra, accanto all'interruttore della griglia (`ui.js`, vicino a `#optGrid`).
- Valore salvato in `Settings` (`tools.js`): è una preferenza del browser di ciascuno e non va nel GeoJSON.
- Proposta: oltre alla luminosità, uno slider per la saturazione.

## 2. Nome dei fiumi ripetuto

Oggi ogni entità ha **una sola etichetta** (`it.label` / `it.el` in `render.js`), posizionata a metà linea da
`Geo.lineMid` (`geo.js`).

- **Etichette multiple**: passare a `it.labels[]` e adattare `create`, `destroy`, `refresh`, `updateLabels`
  e il trascinamento dell'etichetta. È la parte più delicata.
- **`Geo.lineAt(g, t)`**: generalizza `lineMid`, restituisce punto e angolo alla frazione `t` della linea.
- **Numero di ripetizioni**: N = 1–3 in base alla lunghezza in blocchi (non in pixel, così le etichette non si
  spostano zoomando), poste a `t = i/(N+1)`, ognuna ruotata secondo il tratto in cui cade.
- **Posizione manuale**: se l'etichetta è stata trascinata (`label.pos` impostato) si mostra solo quella.
  In alternativa, nuovo campo `label.repeat` (`null` = automatico, oppure un numero) nell'ispettore.
- Vale per tutte le acque lineari (fiume, torrente, canale).

## 3. Linee di confine tipo DMZ (Green Line, Blackline)

- **Modello**: `territorio` oggi non ha categorie e non accetta linee. Aggiungere
  `subtypes: { area, linea }` e `LineString` alle geometrie ammesse in `KINDS.territorio` (`model.js`).
- **Strumento**: linea per punti (clic, clic, Invio); con due clic si ottiene un segmento dritto.
  Oggi lo strumento `L` è solo a mano libera, e `targetKind` / `createLine` (`tools.js`) mandano ogni linea su
  `acqua`: vanno generalizzati.
- **Resa**: tratto spesso e riconoscibile (tratteggiato o doppio), colore dal campo `color`. Il nome si ripete
  parallelo alla linea **su entrambi i lati**, spostato in perpendicolare a destra e a sinistra, almeno 2 volte
  per lato. Usa le etichette multiple del punto 2, con in più uno spostamento laterale.

## 4. Protettorato condiviso tra più regni

- **Modello**: nuovo campo `kingdoms: [id, id, …]` per i protettorati, mantenendo `kingdom = kingdoms[0]` per
  compatibilità. I file vecchi si aprono senza conversioni. `kingdom` è letto in molti punti, da controllare tutti:
  - raggruppamento e trascinamento delle righe nei pannelli (`ui.js`);
  - eliminazione di un regno, che azzera i riferimenti (`tools.js`);
  - validazione dei riferimenti in `Store.load` (`model.js`);
  - evidenziazione delle entità del regno selezionato (`restyle` in `render.js`);
  - sottotitolo "(Regno)" nelle etichette (`labelHtml` in `render.js`).
- **Colori**: invece di mescolare i colori (che produce un colore spento, magari uguale a un terzo regno),
  **righe alternate** nel tratteggio, una striscia per regno. Si estende `Defs.hatch(color)` in
  `Defs.hatch(colors[])` (`render.js`); funziona anche con 3 o più regni.
- **Ispettore**: il menu "Regno" diventa una selezione multipla a chip.
- **Pannello**: il protettorato compare sotto ciascuno dei suoi regni, oppure in un gruppo "Condivisi".
- **Etichetta**: "(Avalon · Papasan)".
- **Comportamento**: selezionando un regno si evidenziano anche i protettorati condivisi. L'estensione del regno
  resta calcolata solo dalle marche.
- **Documentazione**: aggiornare la tabella del formato nel `README.md` principale; valutare `version: 2`
  nei metadata.

## Domande aperte per Raj

1. **Protettorato**: righe alternate o colore mescolato? Massimo 2 regni o anche di più?
2. **DMZ**: basta una linea, o serve una fascia con una larghezza (la Green Line di Cipro è una zona cuscinetto)?
   Le ripetizioni del nome sono fisse (2 per lato) o crescono con la lunghezza?
3. **Fiumi**: ripetizioni automatiche o numero scelto a mano per ogni fiume?
4. **Luminosità**: basta la luminosità o serve anche la saturazione?

## Note

- Il `README.md` principale dice che all'avvio si carica `data/panera.geojson`, ma in `data/` c'è solo
  `panera_tmp.geojson`, che è anche ignorato da git (regola `data/panera_*.geojson`): all'avvio l'editor non
  trova dati da caricare. Da sistemare o chiarire prima di testare le modifiche.
