# Security policy

## Supported versions

Security fixes are made for the latest release only.

| Version | Supported |
|---|---|
| 2.1.x | Yes |
| < 2.1 | No |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report them privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability** ([direct link](https://github.com/davide0707/word-crawler/security/advisories/new)).
Include:

- the affected version and platform (Windows, macOS, Linux or the browser extension);
- the steps or a sample file that reproduce the problem;
- what an attacker could achieve.

You will receive an answer within 7 days. Once the issue is confirmed, a fix is prepared and released,
and the advisory is published with credit to the reporter unless they prefer otherwise.

## Scope

Of particular interest:

- a crafted document (PDF, Word, OpenDocument, EPUB, RTF, HTML, image…) that runs code, reads or writes
  files, or reaches the network from the desktop app or the extension;
- a way for the renderer to call the preload bridge with paths or arguments that the main process
  should have rejected;
- any way for the disk scanner to modify, move or delete files, or for "Move duplicates to the Trash"
  to touch a file that was not selected, not inside the scanned folder or not byte-for-byte identical
  to the copy that is kept;
- a web page that can read or alter the extension's archive or settings.

## Security model in short

- **Desktop app**: `contextIsolation`, `sandbox` and no Node.js integration in the window; app files are
  served from an internal `app://` protocol with a strict Content Security Policy; the preload bridge
  exposes a small set of functions whose arguments are validated in the main process; only files chosen
  by the user are opened, and files are written only where the user chooses or in the app's data folder.
- **Disk scanner**: uses only directory listing, `lstat` and read-only file access; does not follow
  symbolic links or Windows junctions. Moving duplicates to the Trash is a separate, confirmed action
  with the checks described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#disk-scanner).
- **Annotated PDF export**: rendered in a hidden window with JavaScript disabled.
- **Extension**: Manifest V3, no remote code; a page is read only when the user starts the spider on it or
  reopens a page they saved; the small content script that runs on every page only asks whether the
  current address is among the saved readings.
- **Network**: no telemetry; the only automatic download is the Tesseract language data from
  `cdn.jsdelivr.net`, the first time OCR is needed.
