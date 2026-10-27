# Word Crawler

Un ragno che legge al posto tuo. Apre PDF, documenti Word e pagine web, sottolinea le frasi chiave, cerchia nomi e concetti, riquadra numeri e date e alla fine ti lascia il sunto. Quello che ha segnato si può salvare in un archivio o esportare.
L'app desktop ha anche uno **scanner del PC**: un ragno percorre in sola lettura un disco o una cartella e alla fine fa un rapporto completo (spazio per estensione e per tipo, file e cartelle più grandi, duplicati, file vuoti, percorsi troppo lunghi…).

**Niente intelligenza artificiale e niente internet.** Parole chiave e sunto sono calcolati con metodi statistici classici (frequenze, nomi propri, grafi di parole vicine, TextRank). Tutto resta sul computer.

## Cosa c'è dentro

| Cartella | Contenuto |
|---|---|
| `core/` | Il motore condiviso: lettura dei formati, analisi del testo, ragno animato, lettore, risultati, archivio |
| `desktop/` | App per Windows, macOS e Linux (Electron): finestra, scanner del disco, collegamento sicuro al sistema |
| `extension/` | Estensione per Chrome, Edge e Brave: pannello laterale, lettore di documenti, archivio |
| `tests/` | Test automatici e file di prova in tutti i formati |
| `scripts/` | Preparazione dell'estensione (`build-extension.js`) |
| `.github/workflows/` | Compilazione automatica su GitHub per i tre sistemi |

## Formati letti

PDF · Word (.docx, .docm, .dotx e il vecchio .doc) · OpenDocument (.odt, .odp, .ods) · PowerPoint (.pptx) · Excel (.xlsx) · EPUB · RTF · HTML · Markdown · testo (anche con codifiche Windows) · sottotitoli (.srt, .vtt) · CSV/TSV · pagine web.
Restano esclusi i PDF scansionati (sono solo immagini: servirebbe l'OCR) e i vecchi .ppt/.xls (vanno salvati come .pptx/.xlsx).

## Usarlo

### App desktop in sviluppo (serve Node.js 18 o più recente)

```bash
npm install      # scarica Electron, PDF.js e gli strumenti di build
npm start        # apre l'app
```

### Creare il programma installabile

Sul tuo computer (crea il pacchetto per il sistema che stai usando):

```bash
npm run dist     # Windows: .exe di installazione + versione portatile; macOS: .dmg; Linux: .AppImage e .deb
```

I file finiscono in `dist/`.

Con GitHub (crea i pacchetti per tutti e tre i sistemi):
1. Carica la cartella in un repository GitHub.
2. Crea un tag che inizia con `v`, per esempio `git tag v2.0.0 && git push --tags`, oppure vai in **Actions → Build → Run workflow**.
3. In 10–15 minuti trovi .exe, .dmg, .AppImage, .deb e lo zip dell'estensione in **Releases** (se hai usato un tag) o negli **Artifacts** dell'esecuzione.

I programmi non sono firmati digitalmente:
- su Windows, SmartScreen può dire "App non riconosciuta": premi *Ulteriori informazioni → Esegui comunque*;
- su macOS, la prima volta apri l'app con tasto destro → *Apri*.

### Estensione per il browser

```bash
npm install
npm run build:extension   # crea dist/word-crawler-extension.zip (con PDF.js dentro)
```

Poi estrai lo zip, apri `chrome://extensions`, attiva *Modalità sviluppatore* e premi *Carica estensione non pacchettizzata*. Scegli la cartella `word-crawler-extension`.
Clicca l'icona del ragno: si apre il pannello laterale. **Alt+Shift+K** avvia o ferma il ragno sulla pagina.

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
| Lunghezza | Quota di frasi nel sunto |
| Varietà | Quanto evitare frasi ripetitive (MMR) |
| Peso dell'inizio | Importanza delle prime frasi di ogni paragrafo |

## Test

```bash
npm test                        # analisi, formati, scanner, processo principale
npm run test:ui -- /usr/share   # interfaccia desktop completa in Chromium (screenshot in tests/screenshots)
npm run fixtures                # ricrea i file di prova (servono LibreOffice e pandoc)
```

## Sicurezza e privacy

- La finestra dell'app non ha accesso diretto al sistema: usa solo le funzioni esposte da `desktop/preload.js`, che vengono controllate in `desktop/main.js` (isolamento del contesto, sandbox, protocollo interno `app://`).
- Lo scanner usa solo operazioni di lettura. Non segue i collegamenti simbolici e salta gli altri dischi se non lo chiedi. I test verificano che date e contenuti dei file restino identici.
- Impostazioni, archivio e rapporti si salvano solo nella cartella dati dell'app, oppure dove scegli tu quando esporti.
