# Tauri Exact Parity Plan

This is the working parity plan for porting the existing Swift/AppKit mdv app to
Tauri + Rust + React. It is based on `README.md`, `mdv/Help.md`, `TYPOGRAPHY.md`,
`plans/CODEVIEW.md`, and targeted inspection of the Swift source.

The goal for this port is exact functional and visual parity with the Swift mdv
macOS app. The Swift app is the source of truth for behavior, menu structure,
toolbar contents, pane layout, visual styling, and packaging semantics. No
feature, control, shortcut, menu item, or visual affordance should be invented in
the Tauri app unless the plan first records an intentional divergence and the
reason for it.

The rule for this port: every feature gets an automated parity check before it is
called done. Prefer narrow tests that describe the user workflow. Visual parity
must be checked with high-fidelity captures of the real Swift app and the real
Tauri macOS app. Browser-only Playwright screenshots are allowed for renderer
regression tests, but they are not sufficient evidence for titlebar, toolbar,
menu, or native-window parity.

## Exact Parity Gates

Every completed slice must satisfy these gates:

- Functional workflows pass through `npm run test:parity`.
- The native menu surface matches `mdv/mdvApp.swift`; any menu item present in
  Tauri must do real work or be absent.
- The toolbar matches `mdv/ContentView.swift` exactly:
  - Open.
  - Edit.
  - Theme menu.
  - Bookmark.
  - Inspector.
  - No toolbar Back/Forward, Folder, or Zoom controls.
- `npm run compare:visual` captures both real apps, not a browser stand-in for
  Tauri, and compares the same fixture, window size, pane visibility, and theme.
- Remaining visual drift must be written down before moving to another phase.

Current high-priority exact-parity gaps from the latest captures:

- Remove native-capture compositing artifacts or isolate document-rendering
  comparisons so black outline artifacts do not mask real drift.
- Match inspector typography/spacing and collapsed Bookmarks placement.
- Replace approximate SVG toolbar symbols with closer SF Symbol equivalents or a
  native toolbar strategy if web SVG parity remains visibly off.
- Implement true top-visible block tracking.

Recently completed exact-parity slices:

- Active TOC heading tracking now follows the top visible rendered heading in the
  viewer and marks the matching inspector row with `aria-current="location"`.
  Covered by the Playwright parity test `tracks the active heading in the table
  of contents`.
- The bookmarks section now defaults expanded and persists the user collapsed
  state through `mdv.bookmarksExpanded`, matching the inspector's always-present
  bookmarks-below-TOC structure more closely.
- Real Tauri app visual capture no longer uses a browser stand-in or black
  screen-capture fallback. The app writes its own AppKit PNG capture when
  `MDV_INSTRUMENT_TAURI_CAPTURE` is set, and the default Tauri window uses light
  native chrome so the titlebar matches the Swift capture gate.
- History/search/bookmark rows now use Swift-sized row typography, 16 pt icon
  slots, 5 px selected-row radius, history head truncation, filename-only
  bookmark subtitles, Swift-like bookmark empty-state copy, and a count badge.
  Covered by the Playwright parity test `sidebar and bookmark rows preserve
  Swift visual density`.
- Bookmarks now track the current opened bookmark independently from the current
  file, persist reordered sort order through a Rust/Tauri command, support
  drag-to-reorder in the inspector, and preserve slot shortcut semantics after a
  reorder. Covered by the Rust bookmark order test and the Playwright parity test
  `bookmarks track current selection and can be reordered`.
- The bookmarks pane now has the Swift-style 12 px resize divider, clamps to a
  minimum useful height while preserving TOC room, and persists its height in
  `mdv.bookmarksHeight`. Covered by the Playwright parity test `bookmarks pane
  resizes and persists its height`.

## Current Tauri Baseline

Implemented so far:

- Tauri 2 app shell with Rust command backend.
- Strict TypeScript, React 19, Zustand, Vite 8, Tailwind 4, Biome.
- Markdown rendering with `markdown-it`.
- Basic document open through dialog.
- Basic durable SQLite history and FTS-backed history search.
- Basic bookmarks.
- Basic TOC extraction and click-to-scroll.
- TOC filtering in the right inspector.
- SQLite-backed scroll position persistence with mtime validation.
- Local, data URI, missing, and blocked-remote image handling.
- Basic theme cycling and zoom.
- Parity harness:
  - `npm run build`
  - `npm run lint`
  - `npm test`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `npm run test:e2e`
  - `npm run test:parity`
  - `npm run compare:visual` regenerates native and Tauri 2x captures, then
    compares three-panel structure, region luminance, and visible-text density.
- Keep `npm run test:parity` green before starting each new feature slice.

## Feature Inventory From Swift mdv

### File Opening And App Integration

- Open file dialog: `Cmd+O`.
- Open file in new window: `Cmd+Shift+O`.
- App delegate opens files passed by LaunchServices.
- File association for `.md`, `.markdown`, `.mdown`.
- CLI helper install from app menu.
- CLI path opens a file in the app.
- Drag/drop a markdown file onto the app/viewer.
- Drag/drop a directory:
  - Prefer `README.md`, case-insensitive.
  - Otherwise choose alphabetically-first markdown file.
  - Seed sibling markdown files into history.
- Plain text is allowed by the native open panel.
- Multiple windows are supported.

### History

- Durable recently opened file list.
- Max 100 entries in Swift `HistoryManager`.
- Reopening a file moves it to the top.
- Sidebar history survives restart.
- Delete one history row via swipe/action.
- Clear all history.
- Context menu: reveal in Finder.
- History files are indexed into SQLite FTS for global search.

### Global Search

- `Cmd+Shift+F` opens sidebar history search.
- Search across indexed history content.
- FTS query supports token prefix matching.
- Search results include snippets with highlighted matched terms.
- Selecting a search hit opens the file.
- Context menu on hit: open, reveal in Finder.
- Search is async/tokened so stale results are discarded.
- `Cmd+F` routes to global search if sidebar search is already focused.

### In-Document Find

- `Cmd+F` opens document find.
- Escape closes find.
- Matches are block-aware.
- Match count is shown.
- Current match is tracked.
- Next/previous match navigation.
- Current match scrolls into view.
- Matched blocks get a background tint.
- Text matches inside simple prose blocks get inline yellow highlights.
- Complex blocks fall back to block-level highlight:
  - Code fences.
  - Tables.
  - Blocks containing images.
- Find rendering avoids smart typography so character offsets stay valid.

### Markdown Rendering

- MarkdownUI-based block rendering in Swift.
- Rendered block-by-block to support hover, visible-block tracking, find
  highlights, bookmarks, and scroll anchors.
- Common markdown constructs from `test-docs`:
  - Headings.
  - Paragraphs and emphasis.
  - Lists and task lists.
  - Blockquotes.
  - Tables.
  - Links.
  - Code blocks.
  - Horizontal rules.
  - Footnotes.
  - Escaping.
  - Unicode.
- Raw HTML behavior follows MarkdownUI/Safari-style constraints.

### Link Navigation

- Local markdown links open inside mdv.
- Relative markdown links resolve against the current document directory.
- Same-document `#fragment` links scroll to the matching heading.
- Cross-document fragments load the file, then scroll after render.
- Fragment slug matching is GitHub-style:
  - Lowercase.
  - Keep letters, digits, `-`, `_`.
  - Whitespace collapses to `-`.
  - Trim trailing `-` / `_`.
- Local non-markdown files fall through to system handler.
- HTTP, mailto, custom schemes fall through to the system handler.
- Broken links fall through to system behavior.
- Same-document fragment clicks push a browser-style back-stack snapshot.

### Browser-Style Navigation

- `Cmd+Left`: back.
- `Cmd+Right`: forward.
- Back/forward stack stores:
  - File entry.
  - Top visible block index.
- Cross-document navigation pushes file+scroll snapshots.
- Same-document jumps push scroll snapshots.
- Walking back/forward suppresses self-push.
- Forward stack clears when branching.

### Scroll Persistence

- Per-file scroll position persisted in SQLite.
- Persisted anchor stores:
  - Block index.
  - Block fingerprint.
  - File mtime.
- Restore only if file mtime still matches.
- Fingerprint can relocate after small edits.
- File watcher reloads do not yank scroll position.

### TOC / Inspector

- Inspector/sidebar with TOC generated from h1/h2/h3.
- TOC row click scrolls to heading.
- Current visible heading is tracked.
- TOC can be searched/filtered.
- TOC search has an animated compact field.
- Inspector visibility persists.
- Right inspector contains bookmarks below TOC.
- Bookmarks panel height persists and is resizable.
- Bookmarks panel can collapse/expand.

### Bookmarks And Placeholder

- `Cmd+D`: bookmark current/hovered spot.
- Bookmark title comes from nearest preceding heading within a lookback window,
  otherwise the block’s first useful line.
- Bookmark anchor stores:
  - File path.
  - Title.
  - Block index.
  - Block fingerprint.
- Multiple bookmarks per file are allowed.
- Missing bookmark files remain listed but dimmed.
- Bookmark rows show hotkey slots for first five entries.
- `Cmd+1` through `Cmd+5`: jump to bookmark slots.
- Bookmark list can be reordered:
  - Drag/drop.
  - Move up/down.
  - Move to top/bottom.
- Remove bookmark.
- Reveal bookmark target in Finder.
- Current bookmark is visually highlighted.
- Transient placeholder:
  - `Cmd+Shift+0`: set placeholder at current spot.
  - `Cmd+0`: jump to placeholder.
  - In-memory only.
  - Can be cleared from context menu.
  - Has its own active/current visual state.

### Images

- Relative images resolve against the markdown file’s directory.
- Local file images render at intrinsic max size and shrink responsively.
- Missing images render a visible placeholder.
- `data:` URI images render.
- Invalid data URI images render a placeholder.
- Remote images are blocked by default.
- View menu has persistent “Load Remote Images” toggle.
- Blocked remote images render a clickable placeholder.
- Clicking blocked placeholder opens the View menu at the remote-images item.
- Enabled remote images load through custom async fetcher.
- Remote image cache is in-memory.
- Remote loading failure renders an explicit error placeholder.

### Code Blocks

- Syntax highlighting via SwiftTreeSitter and vendored grammars:
  - Bash.
  - C.
  - Go.
  - JavaScript.
  - Python.
  - Ruby.
  - Rust.
  - TOML.
  - YAML.
- Alias mapping:
  - `js`, `jsx`, `javascriptreact`, `node`.
  - `sh`, `zsh`, `shell`.
  - `py`, `python3`.
  - `rb`.
  - `yml`.
  - `rs`.
  - `golang`.
  - `h`, `objective-c`, `objc`.
- Per-theme code palettes.
- Code renderer cache keyed by language, theme, code.
- Unknown language falls back to plain monospace.
- Code block chrome:
  - Always-visible language label.
  - Copy button.
  - Wrap toggle.
  - Right-click menu.
  - Copy without prompts for shell-like blocks.
- Shell prompt stripping removes `$ ` and `# ` prefixes.
- Horizontal scroll by default.
- Soft-wrap is per-block state.

### Themes, Typography, And Zoom

- Theme system has system/light/dark resolution and explicit theme selection.
- Theme choice persists.
- System appearance changes update the active system theme.
- Zoom controls:
  - Zoom in: `Cmd+=`.
  - Zoom out: `Cmd+-`.
  - Actual size menu item.
  - Zoom HUD after changes.
  - Font scale persists.
- Smart typography:
  - Persistent user preference.
  - Disabled automatically for themes that opt out.
  - Converts quotes, dashes, ellipses, etc.
- Bundled font registration:
  - Alegreya.
  - Besley.
  - OpenDyslexic.
- Dyslexie fallback detection for Standard Erin themes.
- Theme catalog:
  - High Contrast.
  - Sevilla.
  - Charcoal.
  - Solarium Daylight.
  - Solarium Moonlight.
  - Phosphor.
  - Twilight.
  - Standard Erin Light.
  - Standard Erin Dark.
- Per-theme:
  - Palette.
  - Body font.
  - Body size.
  - Line spacing.
  - Column max width.
  - Heading scale and weight.
  - Strong text color/weight.
  - Code palette.
  - Accent color.

### External Editor

- `Cmd+E`: edit current file.
- If no editor is configured, first edit action opens editor picker.
- File menu has:
  - Edit Current File.
  - Choose Editor.
  - Forget Editor.
- Editor path persists.
- Uses selected editor app to open current file.
- Error dialog offers to choose a different editor.
- File watcher reloads viewer after external saves.

### Live Reload

- File watcher watches current file.
- Debounced reload after writes.
- Handles file deletion/move by cancelling or reading empty.
- Does not restore saved scroll on watcher reload.
- Avoids duplicate reloads when content is unchanged.

### Window, Sidebar, And UI Chrome

- Unified macOS toolbar/titlebar styling.
- Theme applied to window titlebar/toolbar background.
- Left history sidebar:
  - Resizable width.
  - Collapsible.
  - Persistent collapse state.
  - Hover reveal controls.
- View menu toggle for sidebar visibility.
- Pane focus tracking so `Cmd+F` routes between document find and history search.
- Help command opens bundled help markdown as a normal document.

### Packaging / Release

- SwiftPM build.
- `.app` bundle assembly.
- App icon.
- Font/resource bundling.
- CLI helper bundled in app resources.
- Local install target.
- Developer ID signing/notarization release targets.

## Parity Implementation Phases

### Phase 0 — Stabilize The Harness

Status: complete for the current harness gate.

Goal: keep the test harness green before adding new behavior.

- Fixed failing bookmark deletion workflow.
- Moved the history Clear action out of the search label so it has reliable
  button semantics.
- Defer generated parity status reporting until the matrix gets large enough
  to justify it; this document is the source of truth for now.
- Ensure `npm run test:parity` is the gate after every phase.

Done when:

- `npm run test:parity` passes.

### Phase 1 — Core File And History Parity

Status: complete for the current harness gate.

Goal: make opening files and history behave like mdv.

- Done: directory open behavior in Rust and the React/Tauri surface:
  - README preference.
  - Alphabetical fallback.
  - Sibling seeding.
- Done: supported extension normalization: `.md`, `.markdown`, `.mdown`, `.mkd`,
  `.txt` where Swift accepts text.
- Done: history remove/clear UI.
- Done: drag/drop file and directory handling in React/Tauri.
- Done: history, search result, and bookmark reveal-in-Finder through the
  opener plugin.
- Done: LaunchServices/runtime opened-file event handling and startup pending
  path draining for CLI/file-association opens.

Tests:

- Done: Rust tests for directory selection rules.
- Done: Playwright tests for file open, directory open, history seeding,
  delete, and clear.
- Done: Playwright tests for drag/drop and reveal action behavior.
- Done: Playwright coverage for pending launch paths and runtime native open
  requests.

### Phase 2 — Document Navigation And Links

Status: in progress. Core link interception, fragments, back/forward, and
scroll persistence are implemented and covered.

Goal: make documents navigate like a browser.

- Done: local markdown link interception.
- Done: relative links resolve against the current document directory.
- Done: same-document and cross-document fragment routing at the document
  state level.
- Done: Swift/GitHub-style heading slug behavior.
- Done: browser-style back/forward stacks for file and fragment navigation.
- Done: `Cmd+Left` / `Cmd+Right` keyboard shortcuts for back/forward.
- Done: persisted scroll positions keyed by file, block estimate, fingerprint,
  and file mtime.
- Remaining: use true top-visible block tracking for navigation snapshots.

Tests:

- Done: unit tests for slug generation.
- Done: Playwright tests for relative links, same-document fragments, external
  link fallthrough, Back button, `Cmd+Left`, and `Cmd+Right`.
- Done: Playwright coverage for restoring scroll when reopening a document.
- Add Playwright coverage for cross-document fragments.

### Phase 2.5 — TOC / Inspector

Status: in progress. Core TOC rendering, click-to-scroll, persisted visibility,
and filtering are covered.

Goal: match mdv’s right inspector behavior without manual visual checks.

- Done: right inspector visible by default for visual parity.
- Done: TOC generated from rendered headings.
- Done: TOC row click scrolls to the heading.
- Done: compact TOC filter control.
- Remaining: current visible heading tracking.
- Remaining: bookmarks pane resize/collapse persistence.

Tests:

- Done: Playwright tests for TOC creation and filter behavior.
- Add Playwright tests for active heading state and bookmarks pane persistence.

### Phase 3 — Find And Global Search Parity

Goal: replace the current simple find with mdv’s usable search behavior.

- In-document find overlay with `Cmd+F`, Escape, next/previous.
- Inline highlights for simple blocks.
- Block-level highlights for code/table/image blocks.
- Match counter and current-match state.
- Route `Cmd+F` to history search when sidebar search is focused.
- Global search UI with highlighted snippets.
- Open/reveal actions on global hits.

Tests:

- Unit tests for match calculation and highlight eligibility.
- Playwright tests for keyboard find, next/previous, Escape, global search,
  snippet highlighting, and stale-query behavior.

### Phase 4 — Scroll Anchors, Bookmarks, Placeholder

Goal: make reading position and saved spots durable.

- Partially done: scroll positions persist with block estimate, fingerprint,
  and mtime.
- Done: restore only when mtime matches.
- Track exact visible/top block in the React viewer.
- Bookmark actual hovered/top block, not first match.
- Implement bookmark slot shortcuts `Cmd+1` through `Cmd+5`.
- Implement bookmark jump-to-anchor with fingerprint relocation.
- Implement reorder/move top/bottom.
- Implement transient placeholder `Cmd+Shift+0` / `Cmd+0`.
- Add current bookmark/placeholder visual state.

Tests:

- Done: Rust tests for scroll persistence and stale mtime rejection.
- Unit tests for fingerprint relocation.
- Done: Playwright test for scroll restore.
- Playwright tests for bookmark slots, reorder, missing file, placeholder
  set/jump/clear.

### Phase 5 — Images And Privacy

Status: in progress. Local, data URI, missing-file, and blocked-remote image
states are implemented and covered. Opt-in remote loading remains.

Goal: match mdv image behavior and remote-image privacy.

- Done: implement local image rendering in markdown output.
- Done: resolve relative image paths against document directory.
- Done: render missing image placeholders.
- Done: render data URI images.
- Done: block remote images by default.
- Add persistent Load Remote Images toggle.
- Add remote loading state, error state, and in-memory cache.

Tests:

- Done: unit tests for image source classification.
- Done: Rust tests for local image URL resolution and missing-file detection.
- Done: Playwright tests for relative images, data URI images, missing images,
  and remote-blocked placeholders.
- Add tests for enabled remote image state and failed remote load.

### Phase 6 — Code Block Parity

Goal: bring over the “awesome code blocks” work.

- Decide engine:
  - Likely `highlight.js` short-term, tree-sitter/WASM or Rust-side highlighter
    later if exact capture palettes matter.
- Implement language label.
- Implement copy button.
- Implement wrap toggle.
- Implement copy-without-prompts for shell blocks.
- Implement right-click/menu equivalent.
- Add per-theme code palettes.
- Reduce bundle cost by loading language highlighters selectively.

Tests:

- Unit tests for language aliasing and shell prompt stripping.
- Playwright tests for label, copy, wrap, shell copy, long-line scroll, and
  each fixture language.

### Phase 7 — Themes, Typography, Fonts, Zoom

Goal: match the reading experience.

- Port the full theme catalog and tokens.
- Add system theme mode.
- Add persistent theme menu/selector.
- Add zoom keyboard shortcuts, reset, and HUD.
- Add smart typography toggle and theme opt-outs.
- Bundle/load web font equivalents for Alegreya, Besley, OpenDyslexic.
- Implement Standard Erin font fallback where possible.
- Tune markdown CSS per theme:
  - Measure.
  - Heading scale.
  - Line spacing.
  - Strong color/weight.
  - Code palette.

Tests:

- Unit tests for theme resolution and smart typography.
- Playwright visual/screenshot assertions for every theme across desktop and
  mobile.

### Phase 8 — External Editor And Live Reload

Goal: support the edit/read loop.

- Add editor picker using Tauri dialog or Rust native command.
- Persist editor app path.
- Open current file in editor.
- Add forget editor.
- Add file watcher via Rust `notify`.
- Debounce reloads.
- Preserve current scroll on watcher reload.

Tests:

- Rust tests for watcher debounce logic where possible.
- Playwright tests using mocked API for editor state.
- Integration test that modifies a temp markdown file and verifies reload.

### Phase 9 — Native App Integration And Packaging

Goal: make the Tauri app replace the Swift app operationally.

- File associations for `.md`, `.markdown`, `.mdown`, `.mkd`, optionally `.txt`.
- App-opened file event handling.
- New window support.
- Help document command.
- CLI installer equivalent or a Tauri-native CLI strategy.
- App icon and bundle metadata.
- Release signing/notarization pipeline.

Tests:

- Tauri build check.
- Scripted bundle metadata checks.
- CLI smoke test.
- App open event smoke test if automatable.

## Working Method

For each phase:

1. Add or update parity tests that fail for the missing behavior.
2. Implement the narrowest backend/API/store/UI change.
3. Run:
   - `npm run lint`
   - `npm run build`
   - `npm test`
   - `cargo test --manifest-path src-tauri/Cargo.toml`
   - `npm run test:e2e`
4. Run `npm run test:parity` before marking the phase done.
5. Update this plan with status and any behavior intentionally diverging from
   Swift mdv.
