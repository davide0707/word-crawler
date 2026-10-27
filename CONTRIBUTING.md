# Contributing

Thank you for your interest in Word Crawler. The project is **proprietary** (see [LICENSE](LICENSE)):
the source code is public so that it can be read and reviewed, but it is developed by its author.

## Ways to help

- **Bug reports** — open an [issue](https://github.com/davide0707/word-crawler/issues/new/choose) with the
  version, the platform and, if possible, a document that shows the problem.
- **Ideas** — open a feature request and describe the use case before the solution.
- **Security problems** — never in a public issue; follow [SECURITY.md](SECURITY.md).

## Pull requests

Pull requests are welcome for fixes that have been discussed in an issue first. By opening a pull request
you confirm that the contribution is your own work and you grant Davide Di Filippo a perpetual,
worldwide, royalty-free, irrevocable licence to use, modify, relicense and distribute it as part of
Word Crawler.

Before opening one:

1. Fork the repository and create a branch from `main` (`fix/short-description`, `feat/short-description`).
2. Run `npm test` — it must pass. If you changed the extension or the reader, also run
   `npm run test:extension` (on headless Linux: `xvfb-run -a npm run test:extension`).
3. Add or update tests for the behaviour you changed.
4. Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md).
5. Fill in the pull request template.

## Conventions

**Code**
- Plain JavaScript without a build step. Files in `core/` run in the browser, in Web Workers and in Node,
  so they use the `(function (g) { … })(globalThis)` pattern and must not depend on Node or on
  the DOM at load time.
- Two-space indentation, single quotes, semicolons, LF line endings and a final newline
  (see [.editorconfig](.editorconfig)).
- Every source file starts with the copyright header:
  `// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.`
- The user interface and code comments are in Italian; documentation for GitHub is in English, with an
  Italian README.
- No AI services and no network calls on the user's documents: analysis stays statistical and local.
- The disk scanner must stay read-only. Anything that changes files belongs in `desktop/scan-tools.js`,
  behind an explicit user action, a confirmation and the existing safety checks.

**Commits** — [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `test:`, `build:`, `ci:`, `refactor:`, `perf:`, `chore:`, with an optional scope,
for example `fix(scanner): skip Windows junctions`.

**Versions** — [Semantic Versioning](https://semver.org/). `package.json` and
`extension/manifest.json` always carry the same version; `npm run lint` checks it.

## Releasing (maintainer)

1. Move the `Unreleased` entries in `CHANGELOG.md` under a new `## [x.y.z] - YYYY-MM-DD` heading.
2. Update the version in `package.json` and `extension/manifest.json`, then run `npm test`.
3. Commit (`chore(release): x.y.z`), push, and publish a GitHub release with the tag `vx.y.z`.
   The release workflow builds and signs the packages, writes `SHA256SUMS.txt` and attaches everything
   to the release with the notes from the changelog.
