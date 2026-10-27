# Word Crawler

Un ragno che legge al posto tuo. Apre PDF (anche scansionati), documenti Word, pagine web e foto di pagine, sottolinea le frasi chiave, cerchia nomi e concetti, riquadra numeri e date e alla fine ti lascia il sunto e le schede per ripassare. Quello che ha segnato, e quello che segni tu con la penna, si può salvare in un archivio o esportare, anche come documento Word con tutti i segni.

L'app desktop ha anche uno **scanner del PC**: un ragno percorre in sola lettura un disco o una cartella e alla fine fa un rapporto completo (spazio per estensione e per tipo, mappa a riquadri delle cartelle, file e cartelle più grandi, duplicati, file vuoti, percorsi troppo lunghi…), confrontabile con le scansioni precedenti.

**Niente intelligenza artificiale.** Parole chiave, sunto e schede sono calcolati con metodi statistici classici (frequenze, nomi propri, grafi di parole vicine, TextRank). Il testo nelle immagini si riconosce con Tesseract, un programma di OCR classico. Tutto resta sul computer.

## Novità della 2.1

- **Sei lingue**: italiano, inglese, francese, spagnolo, tedesco e portoghese, riconosciute da sole. Per ognuna: parole da ignorare, abbreviazioni, modi di scrivere una definizione, connettivi, indice di leggibilità adatto (Gulpease, Flesch, Kandel-Moles, Szigriszt-Pazos, Amstad, Flesch-Martins) e **frequenza delle parole**: una parola rara ripetuta nel testo conta più di una parola comune.
- **OCR con Tesseract** per i PDF scansionati e per le immagini (PNG, JPG, WebP, BMP, GIF): il ragno cammina sulle parole riconosciute, al posto giusto sulla pagina.
- **Documenti lunghi**: l'analisi va in un thread separato, le pagine dei PDF si leggono in parallelo, le parole delle pagine web non tengono oggetti pesanti in memoria (25.000 parole lette e analizzate in circa 1,5 secondi).
- **Sunti più scorrevoli**: niente "Inoltre," o "Tuttavia" all'inizio di una frase staccata dal suo contesto; le frasi che cominciano con "Questo…" pesano meno.
- **Ripasso**: schede dalle definizioni ("Che cos'è la cortina di ferro?") e frasi da completare, quiz a scelta multipla, esportazione per **Anki**.
- **Penna**: evidenzia, sottolinea, scrivi note, cancella. Funziona anche sui PDF e sulle pagine web.
- **Esportazione del documento segnato**: Word (.docx, con le note come commenti), pagina web e PDF.
- **Estensione**: quando riapri una pagina salvata in archivio, i segni ricompaiono da soli.
- **Scanner**: mappa a riquadri con zoom, confronto con una scansione precedente, duplicati nel Cestino con conferma e tanti controlli.
- **Firma digitale** facoltativa nella compilazione su GitHub.

## Cosa c'è dentro

| Cartella | Contenuto |
|---|---|
| `core/` | Il motore condiviso: lingue e frequenze, lettura dei formati, analisi, OCR, ragno animato, penna, lettore, risultati, esportazioni, archivio |
| `desktop/` | App per Windows, macOS e Linux (Electron): finestra, scanner del disco, confronto e Cestino, collegamento sicuro al sistema |
| `extension/` | Estensione per Chrome, Edge e Brave: pannello laterale, lettore di documenti, archivio, segni ritrovati |
| `tests/` | Test automatici e file di prova in tutti i formati |
| `scripts/` | Preparazione dell'estensione (`build-extension.js`) |
| `.github/workflows/` | Compilazione automatica su GitHub per i tre sistemi |

## Formati letti

PDF (anche scansionati, con l'OCR) · Word (.docx, .docm, .dotx e il vecchio .doc) · OpenDocument (.odt, .odp, .ods) · PowerPoint (.pptx) · Excel (.xlsx) · EPUB · RTF · HTML · Markdown · testo (anche con codifiche Windows) · sottotitoli (.srt, .vtt) · CSV/TSV · immagini (PNG, JPG, WebP, BMP, GIF) · pagine web.
Restano esclusi i vecchi .ppt/.xls (vanno salvati come .pptx/.xlsx) e le immagini TIFF (vanno salvate come PNG, JPG o PDF).

## Usarlo

### App desktop in sviluppo (serve Node.js 18 o più recente)

```bash
npm install      # scarica Electron, PDF.js, Tesseract e gli strumenti di build
npm start        # apre l'app
```

### Creare il programma installabile

Sul tuo computer (crea il pacchetto per il sistema che stai usando):

```bash
npm run dist     # Windows: .exe di installazione + versione portatile; macOS: .dmg; Linux: .AppImage e .deb
```

I file finiscono in `dist/`.

Con GitHub (crea i pacchetti per tutti e tre i sistemi):
1. Crea un tag che inizia con `v`, per esempio `git tag v2.1.0 && git push --tags`, oppure vai in **Actions → Build → Run workflow**.
2. In 15–20 minuti trovi .exe, .dmg, .AppImage, .deb e lo zip dell'estensione in **Releases** (se hai usato un tag) o negli **Artifacts** dell'esecuzione.

#### Firma digitale (facoltativa)

Senza firma i programmi funzionano lo stesso, ma:
- su Windows, SmartScreen può dire "App non riconosciuta": premi *Ulteriori informazioni → Esegui comunque*;
- su macOS, la prima volta apri l'app con tasto destro → *Apri*.

Per firmarli, in **Settings → Secrets and variables → Actions** del repository aggiungi:

| Segreto | Cosa contiene |
|---|---|
| `CSC_LINK` | il certificato di firma (.p12 o .pfx) codificato in base64 |
| `CSC_KEY_PASSWORD` | la password del certificato |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | solo per macOS: l'autenticazione ("notarizzazione") di Apple |

La compilazione li usa se ci sono; altrimenti crea programmi non firmati.

### Estensione per il browser

```bash
npm install
npm run build:extension   # crea dist/word-crawler-extension.zip (con PDF.js e Tesseract dentro)
```

Poi estrai lo zip, apri `chrome://extensions`, attiva *Modalità sviluppatore* e premi *Carica estensione non pacchettizzata*. Scegli la cartella `word-crawler-extension`.
Clicca l'icona del ragno: si apre il pannello laterale. **Alt+Shift+K** avvia o ferma il ragno sulla pagina. Con il tasto destro su un'immagine: *Leggi il testo di questa immagine (OCR)*.

## Modalità e parametri

- **Studio**: sottolinea le frasi chiave e le definizioni, cerchia nomi e concetti, riquadra numeri e date.
- **Riassunto**: sottolinea le frasi più importanti e le raccoglie nel sunto.
- **Ragnatela**: l'effetto del video, pensato per essere registrato.
- **Cerca**: trova parole, varianti (`nucle*`) e frasi esatte, con la frase in cui compaiono.

Ogni parametro dice nell'app cosa cambia. I principali:

| Parametro | Effetto reale |
|---|---|
| Velocità | Solo il ritmo dell'animazione |
| Zampe | Ampiezza del contesto per collegare le parole (finestra del grafo); nello scanner, cartelle lette in parallelo |
| Selettività | Quante parole chiave tenere |
| Lingua | Parole da ignorare, abbreviazioni, definizioni, leggibilità e frequenze delle parole |
| Lunghezza | Quota di frasi nel sunto |
| Varietà | Quanto evitare frasi ripetitive (MMR) |
| Peso dell'inizio | Importanza delle prime frasi di ogni paragrafo |
| OCR e lingua dell'OCR | Riconoscimento del testo nelle immagini e nei PDF scansionati |

## OCR

L'OCR usa [tesseract.js](https://github.com/naptha/tesseract.js) (Tesseract compilato in WebAssembly), incluso nell'app e nell'estensione. I dati di ogni lingua (2–4 MB) si scaricano la prima volta da `cdn.jsdelivr.net` e poi restano salvati: dalla volta dopo l'OCR funziona anche senza internet. È l'unico momento in cui Word Crawler si collega a internet per conto suo, e solo se apri un documento scansionato o un'immagine.

## Test

```bash
npm test                        # analisi, esportazioni, scanner, processo principale, formati, lettore (Chromium)
npm run test:extension          # l'estensione vera in Chromium (su Linux senza schermo: xvfb-run -a npm run test:extension)
npm run test:ui -- /usr/share   # interfaccia desktop completa in Chromium (screenshot in tests/screenshots)
npm run fixtures                # ricrea i file di prova (servono LibreOffice e pandoc)
npm run fixtures:ocr            # ricrea le pagine scansionate e la loro lettura con il vero Tesseract
```

I test dell'OCR nel browser usano l'uscita vera del programma `tesseract` (salvata in `tests/fixtures`) al posto di tesseract.js, così non serve scaricare niente.

## Sicurezza e privacy

- La finestra dell'app non ha accesso diretto al sistema: usa solo le funzioni esposte da `desktop/preload.js`, che vengono controllate in `desktop/main.js` (isolamento del contesto, sandbox, protocollo interno `app://`).
- Lo scanner usa solo operazioni di lettura. Non segue i collegamenti simbolici e salta gli altri dischi se non lo chiedi. I test verificano che date e contenuti dei file restino identici.
- Spostare i duplicati nel Cestino è un'azione a parte, solo su richiesta: il programma accetta solo file trovati come duplicati da quella scansione e dentro la cartella analizzata, tiene sempre almeno una copia per gruppo, ricontrolla che ogni file sia identico byte per byte alla copia che resta, chiede conferma e annota tutto in un registro. I file vanno nel Cestino, non vengono cancellati.
- Il PDF del documento segnato si stampa in una finestra nascosta senza JavaScript.
- Impostazioni, archivio e rapporti si salvano solo nella cartella dati dell'app, oppure dove scegli tu quando esporti.

## Componenti di terze parti

Vedi [THIRD-PARTY.md](THIRD-PARTY.md). In breve: PDF.js e tesseract.js (Apache 2.0), le frequenze delle parole da [FrequencyWords](https://github.com/hermitdave/FrequencyWords) di Hermit Dave (dati OpenSubtitles, licenza CC BY-SA 4.0: i file `core/freq/*.js` sono distribuiti con la stessa licenza).
