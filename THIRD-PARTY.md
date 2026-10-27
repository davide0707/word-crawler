# Componenti di terze parti

Word Crawler usa questi componenti. Le loro licenze restano valide per le parti che li contengono.

| Componente | Uso | Licenza | Dove |
|---|---|---|---|
| [PDF.js](https://github.com/mozilla/pdf.js) (Mozilla) | lettura e disegno dei PDF | Apache 2.0 | dipendenza npm `pdfjs-dist`; copiato in `lib/` dell'estensione |
| [tesseract.js](https://github.com/naptha/tesseract.js) e [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | OCR (riconoscimento del testo nelle immagini) | Apache 2.0 | dipendenza npm; copiato in `lib/tesseract/` dell'estensione |
| [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) e i dati delle lingue ([tessdata](https://github.com/tesseract-ocr/tessdata)) | motore OCR e modelli delle lingue | Apache 2.0 | i dati delle lingue si scaricano al primo uso da cdn.jsdelivr.net |
| [FrequencyWords](https://github.com/hermitdave/FrequencyWords) di Hermit Dave, dai sottotitoli di [OpenSubtitles](https://www.opensubtitles.org) 2018 | frequenza delle parole in sei lingue | dati: CC BY-SA 4.0 (codice: MIT) | `core/freq/*.js` |
| [Electron](https://www.electronjs.org) | app desktop | MIT | dipendenza npm (sviluppo e pacchetti) |
| [electron-builder](https://www.electron.build) | creazione dei programmi installabili | MIT | dipendenza npm (sviluppo) |
| [Playwright](https://playwright.dev) | test automatici nel browser | Apache 2.0 | dipendenza npm (solo test) |

## Frequenze delle parole (CC BY-SA 4.0)

I file `core/freq/it.js`, `en.js`, `fr.js`, `es.js`, `de.js` e `pt.js` contengono le 20.000 parole più frequenti di ogni lingua,
in ordine di frequenza, ricavate da FrequencyWords (Hermit Dave, https://github.com/hermitdave/FrequencyWords).
Modifiche: parole scritte in minuscolo e senza accenti, tolte quelle con cifre o segni, tenuta solo la prima di ogni forma uguale,
rimossi i conteggi. Questi file sono distribuiti con la stessa licenza dei dati di partenza:
Creative Commons Attribuzione – Condividi allo stesso modo 4.0 Internazionale (https://creativecommons.org/licenses/by-sa/4.0/deed.it).
