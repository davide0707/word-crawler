# Changelog

All notable changes to Word Crawler are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/davide0707/word-crawler/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/davide0707/word-crawler/releases/tag/v2.1.0
[2.0.0]: https://github.com/davide0707/word-crawler/commits/main
