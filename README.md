# mdv

mdv is a desktop Markdown viewer built with Tauri, Rust, React, and TypeScript.

It renders local Markdown documents with a persistent history, full-text history search, bookmarks, a table of contents, live reload, themes, syntax-highlighted code blocks, local images, and in-app navigation between Markdown files.

## Development

Install the current Node.js LTS release, Rust stable, and the platform prerequisites from the [Tauri setup guide](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run tauri:dev
```

The frontend can also run in a browser with mocked native APIs for development and tests:

```sh
npm run dev
```

## Checks

```sh
npm run lint
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:e2e
```

Run the complete validation suite with:

```sh
npm run test:all
```

The Playwright suite uses the documents in `test-docs/` as a rendering and workflow regression corpus. Install its browsers once with `npx playwright install`.

## Build

```sh
npm run tauri:build
```

Tauri writes platform-specific bundles under `src-tauri/target/release/bundle/`.

## Project Layout

- `src/` - React UI, state, and Markdown rendering
- `src-tauri/` - Rust backend and Tauri configuration
- `assets/` - bundled fonts and help content
- `test-docs/` - Markdown rendering regression corpus
- `tests/e2e/` - browser-level workflow and rendering tests
- `tests/fixtures/` - regression corpus expectations
