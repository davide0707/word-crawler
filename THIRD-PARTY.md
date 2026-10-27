# Third-party components

Word Crawler uses the components below. Their licences continue to apply to the parts that contain them;
they are not covered by the reservation of rights in [LICENSE](LICENSE).

| Component | Used for | Licence | Where |
|---|---|---|---|
| [PDF.js](https://github.com/mozilla/pdf.js) (Mozilla) | reading and rendering PDFs | Apache 2.0 | npm dependency `pdfjs-dist`; copied into `lib/` of the extension |
| [tesseract.js](https://github.com/naptha/tesseract.js) and [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | OCR (text recognition in images) | Apache 2.0 | npm dependency; copied into `lib/tesseract/` of the extension |
| [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) and its language data ([tessdata](https://github.com/tesseract-ocr/tessdata)) | OCR engine and language models | Apache 2.0 | language data is downloaded on first use from cdn.jsdelivr.net |
| [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave, from [OpenSubtitles](https://www.opensubtitles.org) 2018 | word frequencies in six languages | data: CC BY-SA 4.0 (code: MIT) | `core/freq/*.js` |
| [Electron](https://www.electronjs.org) | desktop app runtime | MIT | npm dependency (development and packages) |
| [electron-builder](https://www.electron.build) | installers and packages | MIT | npm dependency (development) |
| [Playwright](https://playwright.dev) | browser tests | Apache 2.0 | npm dependency (tests only) |

## Word frequencies (CC BY-SA 4.0)

The files `core/freq/it.js`, `en.js`, `fr.js`, `es.js`, `de.js` and `pt.js` contain the 20,000 most frequent
words of each language, in order of frequency, derived from FrequencyWords
(Hermit Dave, https://github.com/hermitdave/FrequencyWords).

Changes: words lower-cased and stripped of accents; entries with digits or symbols removed; only the first
of identical forms kept; counts removed.

These files are distributed under the same licence as the source data:
Creative Commons Attribution-ShareAlike 4.0 International (https://creativecommons.org/licenses/by-sa/4.0/).

---

*Italiano* — I componenti elencati sopra mantengono le proprie licenze. I file di frequenza in `core/freq/`
derivano da FrequencyWords di Hermit Dave (parole in minuscolo e senza accenti, tolte quelle con cifre o
segni, tenuta solo la prima di ogni forma uguale, rimossi i conteggi) e sono distribuiti con licenza
Creative Commons Attribuzione – Condividi allo stesso modo 4.0 Internazionale.
