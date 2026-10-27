# Changelog

All notable changes to Word Crawler are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.0] - 2026-10-27

### Added
- **Study** (Library tab): spaced repetition over the whole knowledge base, built from what the library already extracted — no AI, no generated text.
  - Questions are made mechanically from the material: a term and its definition, the same definition with the term blanked out, an "is a type of" relation read from a definition, or a sentence where the concept appears. Every question cites its document, page and slide, and opens the Reader at that passage.
  - Answers can be typed (accents, case, plurals and a single typo are tolerated, with the stems of six languages) or revealed and graded by hand with four grades. Keyboard: space reveals, 1–4 grade.
  - Intervals grow with an SM-2 schedule: each concept keeps its ease, interval and next-review date; forgetting drops it back to one day and lowers its ease. Progress is saved next to the map edits, in the app's data folder.
  - **Study path**: concepts ordered from the most general to those that depend on them, following the "is a type of" relations of the graph; at the same level the more central concept comes first.
  - Only concepts worth knowing are asked about: defined terms, acronyms, proper names and multi-word terms — not frequent single words.
  - Progress survives merging, splitting and renaming concepts: a concept is recognised by any of its stems.
  - A badge on the tab shows how many concepts are due; counts for never seen, learning, solid and overall mastery.
  - Export the questions **for Anki** (tab-separated, with the source in the answer and one tag per document) or as a CSV.
- **Mastery on the map**: "Colour by mastery" shades every concept from grey (never seen) through amber to green (solid), and makes the ones due for review pulse.

### Changed
- The concept map is alive: a continuous simulation keeps the concepts settling instead of freezing after the first layout, dragging one makes its neighbours react, the camera glides instead of jumping and keeps scrolling after a flick, and new concepts grow in. Only the concepts in view are simulated, so thousands still run smoothly. **Reorder** (button or R) reshuffles everything that isn't pinned.
- Everything stops when the map is hidden or the window is in the background, and `prefers-reduced-motion` turns the movement off entirely.
- Menu: "Study the library" (Ctrl+Shift+S).

## [2.2.0] - 2026-10-27

### Added
- **Library** (desktop app): a local knowledge base built from many documents. Add files or whole folders (PDF, scanned PDF with OCR, Word, OpenDocument, PowerPoint, Excel, EPUB, RTF, HTML, Markdown, text); the originals are only read, never modified.
  - Each document is split into passages (paragraphs, headings, slides, list items, table rows, pieces of very long paragraphs) that keep their exact source: file, page, slide, section and, for PDFs, the position on the page.
  - Metadata for every file: path, type, size, dates, SHA-256 fingerprint, language, pages or slides, OCR pages, status and errors. Unchanged files are skipped on re-import, identical copies are recognised, and modified or missing files are flagged.
  - Removing a document from the library is reversible (undo, and the record is kept for 30 days); the file on disk is never touched.
- **Search across all documents**: BM25 ranking on word stems in six languages, passages matching more query words ranked first, exact phrases in quotes, filters by document and language, highlighted snippets and **Open at the exact position** in the Reader.
- **Concepts across documents**: keywords, names, defined terms and acronyms of every document become concepts; the same concept in different files is one node, and an acronym written with its long form ("Quadrature Amplitude Modulation (QAM)") is merged automatically. Searching for a concept also finds the passages that use its other forms.
- **Concept map**: interactive graph on canvas (zoom, pan, drag, find, filters for central concepts, multi-document concepts and a single document) with relations from co-occurrence and from definitions ("QAM is a type of digital modulation"); exports to PNG, Markdown with `[[links]]` (Obsidian) and JSON. Lays out 5,000 concepts in about two seconds.
- **Concept page**: aliases, definitions with sources, related concepts, every passage where it appears, edit history; rename, add or remove aliases, merge or split concepts, add or remove relations. Uncertain merges (an acronym and a long form in different documents, near-identical names) are only suggested and wait for confirmation.
- Presentation blocks now carry their slide number.

### Changed
- The Reader can open a document already read and scroll to a passage, highlighting it.
- Menu and shortcuts: Ctrl+2 opens the Library; Scanner and Archive move to Ctrl+3 and Ctrl+4; Ctrl+Shift+O adds documents to the library.

## [2.1.0] - 2026-10-27

### Added
- **Six document languages**: Italian, English, French, Spanish, German and Portuguese, detected automatically, each with its own stopwords, abbreviations, definition patterns and readability formula (Gulpease, Flesch, Kandel–Moles, Szigriszt–Pazos, Amstad, Flesch–Martins).
- **Word-frequency weighting**: common words count less than rare ones in keywords and summaries (FrequencyWords lists, CC BY-SA 4.0).
- **OCR with Tesseract** (tesseract.js 7) for scanned PDFs and images (PNG, JPG, WebP, BMP, GIF); the spider walks over the recognised words.
- **Long documents**: analysis in a Web Worker, lazily created DOM ranges and PDF pages extracted in parallel.
- **Review**: flashcards from definitions, fill-in-the-blank cards, multiple-choice quiz and Anki export.
- **Pen**: highlight, underline, numbered notes and eraser, on PDFs and web pages too; hand-made marks are saved in the archive.
- **Annotated export**: the marked document as Word (.docx, notes as comments), HTML and PDF.
- **Extension**: marks are restored automatically when a saved page is reopened.
- **Scanner**: squarified treemap, comparison between two scans and moving selected duplicates to the Trash after SHA-256 verification, confirmation and logging.
- **Project**: proprietary licence and copyright headers; English and Italian documentation with an architecture guide, contributing guide, security policy and code of conduct; `npm run lint` project checks; CI on Node.js 20 and 22; release workflow with SHA-256 checksums and notes from this changelog; Dependabot, issue and pull request templates.

### Changed
- Smoother summaries: leading connectives are removed and sentences that open with a reference to a previous one are penalised.
- German nouns are told apart from proper names using the frequency lists.
- The Windows portable build is named `Word-Crawler-Portable-<version>.exe`.

### Fixed
- The view no longer follows the spider after reading has finished.

## [2.0.0] - 2026-10-27

### Added
- Desktop app (Electron) for Windows, macOS and Linux with a sandboxed renderer and an internal `app://` protocol.
- Reader for PDF, Word (.docx and .doc), OpenDocument, PowerPoint, Excel, EPUB, RTF, HTML, Markdown, text, subtitles and CSV.
- Statistical analysis without AI: YAKE-style keywords with a co-occurrence graph, extractive summary with TextRank and MMR, definitions, names, numbers and dates.
- Animated spider that underlines, circles and boxes what it reads, with presets and fully explained settings.
- Read-only disk scanner with duplicates, largest files and folders and a full report.
- Browser extension (Manifest V3) with side panel, document reader and archive.
- Automated tests and a multi-platform build workflow.

[Unreleased]: https://github.com/davide0707/word-crawler/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/davide0707/word-crawler/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/davide0707/word-crawler/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/davide0707/word-crawler/releases/tag/v2.1.0
[2.0.0]: https://github.com/davide0707/word-crawler/commits/main
