<div align="center">

<img src="docs/images/logo.svg" width="112" alt="Logo di Word Crawler">

# Word Crawler

**Un ragno che legge per te.** Sottolinea, cerchia e riassume documenti e pagine web, trasforma una cartella di dispense in una base di conoscenza dove cercare e vedere la mappa dei concetti, prepara le schede di ripasso e fa la mappa del disco — con la statistica, senza intelligenza artificiale.

[![CI](https://github.com/davide0707/word-crawler/actions/workflows/ci.yml/badge.svg)](https://github.com/davide0707/word-crawler/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/davide0707/word-crawler?label=versione&color=2f4bff)](https://github.com/davide0707/word-crawler/releases)
![Piattaforme](https://img.shields.io/badge/piattaforme-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Chrome-3fd8ff)
![Lingue](https://img.shields.io/badge/lingue%20dei%20documenti-6-5de07f)
[![Licenza](https://img.shields.io/badge/licenza-tutti%20i%20diritti%20riservati-lightgrey)](LICENSE)

[English](README.md) · **Italiano**

<img src="docs/images/reader-study.webp" alt="Il ragno legge un documento Word in modalità Studio: frasi chiave sottolineate, nomi cerchiati, date nei riquadri" width="100%">

</div>

## Indice

- [In breve](#in-breve)
- [Libreria: la tua base di conoscenza](#libreria-la-tua-base-di-conoscenza)
- [Studio: quello che sai e quello che non sai](#studio-quello-che-sai-e-quello-che-non-sai)
- [Immagini](#immagini)
- [Scaricare](#scaricare)
- [Come funziona](#come-funziona)
- [Formati e lingue](#formati-e-lingue)
- [Privacy e sicurezza](#privacy-e-sicurezza)
- [Sviluppo](#sviluppo)
- [Stato del progetto](#stato-del-progetto)
- [Licenza](#licenza)

## In breve

| | |
|---|---|
| **Legge tutto** | PDF (anche scansionati, con l'OCR), Word (.docx e il vecchio .doc), OpenDocument, PowerPoint, Excel, EPUB, RTF, HTML, Markdown, testo, sottotitoli, CSV, immagini e pagine web. |
| **Segna quello che conta** | Sottolinea frasi chiave e definizioni, cerchia nomi e concetti, mette nei riquadri numeri e date — e lo disegna con un ragno animato. |
| **Riassume senza AI** | Parole chiave con statistiche in stile YAKE, rarità delle parole e grafo delle parole vicine; riassunto estrattivo con TextRank e MMR. Ogni numero è calcolato, niente è inventato. |
| **Aiuta a studiare** | Schede dalle definizioni, frasi da completare, quiz a scelta multipla ed esportazione per Anki. |
| **La tua penna** | Evidenzia, sottolinea, annota e cancella, anche sui PDF e sulle pagine web. |
| **Scrive dentro il tuo PDF** | Evidenziazioni e note si possono scrivere dentro una copia del PDF originale come annotazioni vere: Acrobat, Anteprima e i browser le leggono, le spostano e le cancellano. I byte di partenza non vengono toccati. |
| **Esporta il documento segnato** | Word (.docx, con le note come commenti), pagina web e PDF, più riepiloghi in Markdown, testo, JSON e Anki. |
| **Ricorda le pagine** | L'estensione rimette i segni quando riapri una pagina salvata. |
| **Costruisce una base di conoscenza** | La Libreria legge tanti file insieme, anche cartelle intere: cerchi in tutti i documenti insieme, vedi come si collegano i concetti su una mappa interattiva e apri ogni risultato alla pagina giusta. |
| **Trova quello che intendevi** | Ricerca per significato, non solo per parola: chiedi «quanto veloce va la rete» e saltano fuori anche i passaggi che dicono *throughput*. Il senso delle parole lo impara dai tuoi documenti: niente da scaricare, niente esce dal computer. Anche lo scanner del disco cerca i nomi dei file così. |
| **Un cervello per materia** | La libreria non è una sola: ogni cervello ha i suoi documenti, i suoi concetti, la sua mappa e i suoi progressi, con nome, icona e colore. Lo duplichi, lo esporti in JSON aperto, lo reimporti. |
| **Sa quanto sai** | Lo Studio ti interroga sui concetti dei tuoi documenti, allunga l'intervallo tra un ripasso e l'altro man mano che li sai, li mette in ordine dal generale allo specifico e colora la mappa in base a quanto conosci ognuno. |
| **Fa la mappa del disco** | Scanner in sola lettura con mappa a riquadri, duplicati, file e cartelle più grandi, confronto tra scansioni e spostamento sicuro dei duplicati nel Cestino. |
| **Regge i documenti lunghi** | L'analisi gira in un Web Worker e le pagine dei PDF si leggono in parallelo: circa 25.000 parole lette e analizzate in 1,3 s. |

L'interfaccia è in italiano. I documenti possono essere in italiano, inglese, francese, spagnolo, tedesco o portoghese.

## Libreria: la tua base di conoscenza

<img src="docs/images/library-search.webp" alt="Ricerca nella Libreria su nove documenti: la domanda «Dove ho parlato di QAM?» trova passaggi in tre file, anche negli appunti che usano solo la forma estesa «Quadrature Amplitude Modulation»" width="100%">

Aggiungi dispense, slide, libri, scansioni e pagine salvate — uno alla volta o una cartella intera — e la Libreria ne fa un'unica base di conoscenza sul tuo computer. I file originali vengono solo letti, mai modificati.

Puoi tenere **più cervelli**: uno per esame, uno per progetto, uno per il lavoro. Ognuno ha i suoi documenti, i suoi concetti, le sue modifiche alla mappa e i suoi progressi, con nome, icona e colore; dal selettore nella barra laterale passi dall'uno all'altro. Un cervello si può duplicare, esportare in un file JSON aperto e reimportare: niente resta chiuso dentro l'app. Eliminandone uno, la sua cartella resta recuperabile a mano per 30 giorni, e almeno un cervello resta sempre.

- **Passaggi con la fonte esatta.** Ogni documento si divide in passaggi (paragrafi, titoli, slide, voci di elenco, righe di tabella) che ricordano file, pagina, slide, sezione e, nei PDF, la posizione sulla pagina. **Apri alla posizione esatta** porta al passaggio nel Lettore e lo evidenzia.
- **Cerca in tutto insieme.** Classifica BM25 sulle radici delle parole in sei lingue, prima i passaggi che contengono più parole della domanda, frasi esatte tra virgolette, filtri per documento e lingua. Chiedi *«Dove ho parlato di QAM?»* e trova anche gli appunti che dicono solo *Quadrature Amplitude Modulation*.
- **Concetti uniti tra i file.** Parole chiave, nomi, termini definiti e sigle diventano concetti. Singolare e plurale, lo stesso termine in file diversi e una sigla scritta con la sua forma estesa sono un concetto solo. I casi incerti — una sigla in un file e la forma estesa in un altro, due nomi quasi uguali — sono solo suggeriti: decidi tu.
- **Una mappa dei concetti interattiva.** I concetti sono collegati quando compaiono negli stessi passaggi, e le definizioni aggiungono relazioni con un nome (*QAM — è un tipo di → modulazione digitale*). I concetti centrali sono blu, quelli presenti in più documenti viola. Ingrandisci, spostati, trascina i nodi, filtra ed esporta in PNG, in Markdown con i `[[collegamenti]]` per Obsidian o in JSON.
- **L'ultima parola è tua.** Rinomina i concetti, aggiungi alias, unisci o separa, aggiungi o togli collegamenti: ogni modifica resta, finisce nella cronologia del concetto e si riapplica quando aggiungi altri documenti. Un documento tolto si può rimettere.
- **Quello che nota da solo.** Lacune (concetti che usi spesso e che nessun documento spiega), contraddizioni fra due fonti, concetti isolati, funzioni citate negli appunti che nel codice non esistono. Ogni segnalazione dice il perché e porta alle frasi da cui viene.
- **Spiega.** Una spiegazione di un concetto costruita soltanto con le frasi dei tuoi documenti, ognuna con la sua fonte, da salvare come riassunto del ramo.
- **Confronti.** Due versioni dello stesso documento messe a fianco passaggio per passaggio, e due cervelli confrontati per vedere che cosa hanno in comune.
- **Una mappa viva.** I concetti continuano ad assestarsi invece di bloccarsi dopo la prima disposizione: ne trascini uno e i vicini reagiscono, la telecamera scorre invece di saltare, i concetti nuovi crescono al loro posto. Si simula solo quello che è inquadrato, così anche migliaia di concetti restano fluidi — e con `prefers-reduced-motion` il movimento si spegne.

| | |
|:---:|:---:|
| <img src="docs/images/library-map.webp" alt="Mappa dei concetti con due gruppi: telecomunicazioni e guerra fredda"><br>**Mappa dei concetti** | <img src="docs/images/library-concept.webp" alt="Scheda del concetto QAM con alias, definizione e fonte, concetti collegati e passaggi"><br>**Scheda del concetto con le fonti** |

La Libreria fa parte dell'app desktop. Tutto si calcola sul tuo computer, senza intelligenza artificiale e senza internet; gli algoritmi sono descritti in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#library) (in inglese).

## Studio: quello che sai e quello che non sai

<img src="docs/images/library-study.webp" alt="Scheda Studio: quanti concetti sono mai visti, in corso e saldi, e il percorso di studio che va dai concetti generali a quelli che ne dipendono" width="100%">

Quando i documenti sono nella Libreria, può interrogarti. Le domande non le scrive un modello: nascono da quello che la libreria ha già estratto, e ognuna cita il documento, la pagina e la slide da cui viene.

- **Quattro tipi di domanda, tutte dai tuoi appunti.** Un termine e la sua definizione; la stessa definizione col termine oscurato; una relazione *è un tipo di* letta in una definizione; oppure una frase dove il concetto compare, con il concetto tolto. Una domanda per concetto a sessione, a rotazione, così lo stesso concetto non chiede sempre la stessa cosa.
- **Scrivi la risposta, o giudicati da solo.** La risposta scritta tollera accenti, maiuscole, plurali (con le radici di sei lingue) e un errore di battitura. Altrimenti riveli la risposta e la voti con quattro bottoni. Barra spaziatrice per vedere, da 1 a 4 per il voto.
- **Intervalli che crescono.** Uno schema SM-2 tiene per ogni concetto una facilità, un intervallo e la data del prossimo ripasso. Se lo sai torna più tardi; se lo dimentichi torna domani, con la facilità più bassa. Una pastiglia sulla scheda dice quanti sono scaduti.
- **Un percorso, non un mucchio di schede.** I concetti sono ordinati dai più generali a quelli che ne dipendono, seguendo le relazioni *è un tipo di* del grafo: prima *modulazione digitale*, poi *QAM*. A pari livello viene prima il concetto più centrale.
- **Solo quello che vale sapere.** Si chiede dei termini definiti, delle sigle, dei nomi propri e dei termini di più parole; non delle parole singole frequenti.
- **Sulla mappa.** «Colora per padronanza» sfuma ogni concetto dal grigio (mai visto) all'ambra fino al verde (saldo), e quelli da ripassare pulsano.
- **Te la porti dietro.** Esporta le domande per **Anki** (con la fonte dentro la risposta e un'etichetta per documento) o in CSV.

I progressi si salvano accanto alle modifiche della mappa, nella cartella dati dell'app, e sopravvivono a unioni, separazioni e rinomine dei concetti.

## Immagini

| | |
|:---:|:---:|
| <img src="docs/images/library-brains.webp" alt="Gestione dei cervelli: quello aperto con il numero di documenti e le azioni per rinominarlo, cambiargli colore, duplicarlo ed esportarlo"><br>**Più cervelli, uno per materia** | <img src="docs/images/library-study.webp" alt="Scheda Studio con i riquadri e il percorso di studio"><br>**Studio: percorso e progressi** |
| <img src="docs/images/library-question.webp" alt="Una frase da completare costruita da una frase degli appunti dell'utente, con la risposta scritta controllata e la fonte"><br>**Studio: una domanda dai tuoi appunti** | <img src="docs/images/library-mastery.webp" alt="Mappa dei concetti colorata per padronanza: grigio per i mai visti, verde per quelli saldi"><br>**La mappa colorata per padronanza** |
| <img src="docs/images/review-quiz.webp" alt="Scheda Ripasso con un quiz a scelta multipla"><br>**Schede di ripasso e quiz** | <img src="docs/images/pen.webp" alt="Penna con un'evidenziazione e una nota numerata"><br>**Penna: evidenziazioni e note** |
| <img src="docs/images/ocr.webp" alt="PDF scansionato riconosciuto con l'OCR, con i segni sulle parole della scansione"><br>**OCR sui PDF scansionati** | <img src="docs/images/reader-paper.webp" alt="Tema carta per studiare"><br>**Tema carta** |
| <img src="docs/images/scanner-running.webp" alt="Scanner del disco: il ragno cammina sulla mappa delle cartelle"><br>**Scanner del disco** | <img src="docs/images/scanner-treemap.webp" alt="Mappa a riquadri delle dimensioni delle cartelle"><br>**Mappa a riquadri** |
| <img src="docs/images/scanner-duplicates.webp" alt="Duplicati scelti e spostati nel Cestino"><br>**Duplicati nel Cestino** | <img src="docs/images/scanner-compare.webp" alt="Confronto tra due scansioni"><br>**Confronto tra scansioni** |
| <img src="docs/images/extension-restored.webp" alt="L'estensione rimette i segni su una pagina web salvata"><br>**Estensione: segni ritrovati** | <img src="docs/images/archive.webp" alt="Archivio delle letture salvate"><br>**Archivio** |
| <img src="docs/images/library-merge.webp" alt="Unione suggerita: OFDM e Orthogonal Frequency Division Multiplexing"><br>**Libreria: le unioni le confermi tu** | <img src="docs/images/library-open.webp" alt="Un risultato aperto nel Lettore alla pagina giusta, con il passaggio evidenziato"><br>**Libreria: apri alla posizione esatta** |

## Scaricare

I programmi pronti sono nella pagina [**Releases**](https://github.com/davide0707/word-crawler/releases).

| Sistema | File | Note |
|---|---|---|
| Windows 10/11 | `Word-Crawler-Setup-<versione>.exe` | Installazione. C'è anche un `.exe` portatile che non va installato. |
| macOS 11+ | `Word-Crawler-<versione>-arm64.dmg` / `-x64.dmg` | Mac con chip Apple e Mac Intel. |
| Linux | `.AppImage` o `.deb` | x64. |
| Chrome, Edge, Brave | `word-crawler-extension.zip` | Estrai lo zip, apri `chrome://extensions`, attiva *Modalità sviluppatore*, poi *Carica estensione non pacchettizzata*. |

I programmi non firmati mostrano un avviso la prima volta: su Windows scegli *Ulteriori informazioni → Esegui comunque*; su macOS fai clic destro sull'app e scegli *Apri*. Quando nel repository ci sono i certificati, i programmi vengono firmati in automatico (vedi [Firma digitale](#firma-digitale)).

## Come funziona

```mermaid
flowchart LR
  A[File o pagina web] --> B[Lettori dei formati<br/>PDF.js · ZIP/XML · CFB · OCR Tesseract]
  B --> C[Parole con la loro posizione]
  C --> D[Analisi<br/>lingua · parole chiave · riassunto · definizioni · schede]
  D --> E[Motore del ragno<br/>disegno sopra la pagina]
  D --> F[Pannello dei risultati<br/>riassunto · segni · ripasso · statistiche]
  E --> G[Penna]
  F --> H[Archivio ed esportazioni<br/>Word · pagina web · PDF · Anki]
  C --> L[Libreria<br/>passaggi · indice BM25 · grafo dei concetti]
  L --> M[Ricerca · mappa dei concetti · apri alla posizione]
```

Un unico motore (`core/`) serve sia l'app desktop sia l'estensione. Algoritmi, mappa dei moduli e modello di sicurezza sono descritti in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (in inglese).

## Formati e lingue

| Documenti | Note |
|---|---|
| PDF | PDF di testo con PDF.js; le pagine senza testo si leggono con l'OCR di Tesseract |
| Word | .docx, .docm, .dotx e il vecchio .doc (Word 97–2003) |
| OpenDocument | .odt, .odp, .ods |
| Office | .pptx, .xlsx |
| Libri e testo formattato | EPUB, RTF, HTML, Markdown |
| Testo | .txt (UTF-8, UTF-16, Windows-1252), sottotitoli .srt/.vtt, CSV/TSV |
| Immagini | PNG, JPG, WebP, BMP, GIF (OCR) |

| Lingua | Indice di leggibilità | Parole da ignorare, abbreviazioni, definizioni | Frequenze delle parole |
|---|---|---|---|
| Italiano | Gulpease | sì | 20.000 parole |
| Inglese | Flesch Reading Ease | sì | 20.000 parole |
| Francese | Kandel–Moles | sì | 20.000 parole |
| Spagnolo | Szigriszt–Pazos | sì | 20.000 parole |
| Tedesco | Amstad | sì, con il riconoscimento dei nomi comuni | 20.000 parole |
| Portoghese | Flesch (Martins) | sì | 20.000 parole |

## Privacy e sicurezza

- **Tutto in locale.** I documenti non lasciano il computer e non c'è telemetria. L'unico accesso a internet che l'app fa da sola è lo scaricamento, la prima volta, dei dati delle lingue per l'OCR (2–4 MB per lingua, da `cdn.jsdelivr.net`), e solo quando si apre una pagina scansionata o un'immagine.
- **App desktop protetta.** Isolamento del contesto, finestra in sandbox, Content Security Policy rigida, protocollo interno `app://` e un ponte minimo verso il sistema, con i dati controllati nel processo principale.
- **Libreria in sola lettura.** I file aggiunti alla Libreria vengono solo letti; testo, concetti e fonti si salvano nella cartella dati dell'app. Togliere un documento dalla Libreria non tocca mai il file.
- **Scanner in sola lettura.** La scansione elenca, misura e legge i file e basta. Lo spostamento dei duplicati nel Cestino è un'azione a parte: accetta solo file trovati da quella scansione dentro la cartella analizzata, lascia sempre una copia per gruppo, controlla con SHA-256 che il contenuto sia identico byte per byte, chiede conferma e scrive un registro.
- **Esportazioni sicure.** I PDF con i segni si stampano da una finestra nascosta con JavaScript disattivato.

Le vulnerabilità vanno segnalate in privato, come spiegato in [SECURITY.md](SECURITY.md).

## Sviluppo

Serve **Node.js 20+** (consigliato il 22, vedi `.nvmrc`). Non c'è una fase di compilazione: il motore è JavaScript semplice che gira uguale in Electron, nell'estensione e in Node.

```bash
git clone https://github.com/davide0707/word-crawler.git
cd word-crawler
npm install          # Electron, PDF.js, Tesseract e gli strumenti dei test
npm start            # avvia l'app desktop
```

| Comando | Cosa fa |
|---|---|
| `npm start` | Avvia l'app desktop |
| `npm test` | Controlli del progetto e prove di unità, di integrazione e nel browser |
| `npm run lint` | Sintassi, fine riga, intestazioni, JSON e versioni coerenti |
| `npm run test:extension` | Carica l'estensione vera in Chromium (serve uno schermo; su Linux senza schermo usare `xvfb-run -a`) |
| `npm run test:library` | Prove del motore della Libreria e della scheda Libreria completa in Chromium (anche in `npm test`) |
| `npm run test:ui -- <cartella>` | Prova completa dell'interfaccia desktop con una scansione vera, salvando le immagini |
| `npm run build:extension` | Crea `dist/word-crawler-extension.zip` con PDF.js e Tesseract |
| `npm run dist` | Crea il programma per il sistema in uso, in `dist/` |
| `npm run fixtures` / `fixtures:ocr` | Rigenera i documenti di prova (LibreOffice, pandoc) e le pagine per l'OCR (Tesseract) |

### Struttura

```
core/                 motore condiviso: lingue, formati, analisi, OCR, ragno, penna, lettore, esportazioni, libreria
  freq/               frequenze delle parole (CC BY-SA 4.0)
desktop/              processo principale di Electron, ponte preload, scanner del disco, strumenti di scansione
  ui/                 finestra dell'app: schede, libreria, scanner, rapporto, guida
extension/            estensione per Chrome/Edge/Brave (Manifest V3)
scripts/              creazione dell'estensione, controlli del progetto, scrittura ZIP
tests/                prove automatiche, documenti di prova e sostituti dei moduli esterni
docs/                 architettura e immagini
.github/              CI, pubblicazione delle versioni, modelli per segnalazioni e pull request
```

### Prove automatiche

Più di 130 controlli automatici coprono l'analisi in sei lingue, la Libreria (passaggi, concetti, unioni, ricerca, modifiche, una mappa di 5.000 concetti e la scheda Libreria completa in Chromium con il vero PDF.js), tutti i formati dei documenti, le esportazioni (i file Word si verificano aprendo lo zip), l'OCR con l'uscita vera di Tesseract, lo scanner del disco e le sue regole di sicurezza, il processo principale di Electron (con un modulo `electron` finto), il lettore in Chromium con il vero PDF.js e l'estensione vera caricata in Chromium. La CI li esegue a ogni push e pull request.

### Versioni e firma digitale

Pubblicare una release su GitHub (tag `vX.Y.Z`) avvia [`release.yml`](.github/workflows/release.yml): prova il codice, crea i programmi per Windows, macOS e Linux e l'estensione, e li allega alla release con le note prese da [CHANGELOG.md](CHANGELOG.md). <a id="firma-digitale"></a>I programmi vengono firmati se nel repository ci sono questi segreti:

| Segreto | A cosa serve |
|---|---|
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Certificato di firma (.p12/.pfx in base64) e la sua password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Autenticazione (notarizzazione) di Apple per macOS |

Le regole per contribuire sono in [CONTRIBUTING.md](CONTRIBUTING.md); la storia delle versioni in [CHANGELOG.md](CHANGELOG.md).

## Stato del progetto

Versione **2.3.1**. Limiti noti:

- Il motore OCR (tesseract.js) è provato nei test con l'uscita registrata di Tesseract; il motore WebAssembly vero gira solo nell'app e nell'estensione.
- Non si aprono i vecchi .ppt/.xls né le immagini TIFF (salvarli come .pptx/.xlsx o PNG/PDF).
- I riassunti sono estrattivi: le frasi vengono scelte e ripulite, mai riscritte.
- L'estensione non funziona su iOS.
- La Libreria c'è solo nell'app desktop. La ricerca è sulle parole (radici) più concetti e alias: non usa embedding, quindi due sinonimi che non compaiono mai insieme si collegano solo se li aggiungi come alias.
- Archivi ZIP, cartelle controllate e rilevamento delle contraddizioni tra documenti arriveranno in una versione successiva.

## Licenza

Copyright © 2026 Davide Di Filippo. **Tutti i diritti riservati.** Il codice è pubblicato solo per la consultazione; vedi [LICENSE](LICENSE).
I componenti di terze parti mantengono le proprie licenze — vedi [THIRD-PARTY.md](THIRD-PARTY.md). Le frequenze delle parole in `core/freq/` vengono da [FrequencyWords](https://github.com/hermitdave/FrequencyWords) di Hermit Dave e sono distribuite con licenza CC BY-SA 4.0.
