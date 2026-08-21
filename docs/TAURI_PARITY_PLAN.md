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

- None from the current parity gate. Re-run native/Tauri captures after each new
  slice and record any new visual drift before moving on.

Recently completed exact-parity slices:

- Rendered markdown copy now supports both rich and markdown forms. `Cmd+C`
  inside the markdown body writes `text/html` plus markdown `text/plain` so rich
  paste targets preserve formatting while plain targets receive source markdown.
  Right-clicking rendered markdown exposes `Copy Rich` and `Copy Markdown`, and
  heading-click markdown section copy now shows a transient `Markdown copied`
  HUD in addition to the section flash. Code block copy remains plain text.
- The left History pane now keeps its title/search header fixed while only the
  history row list scrolls. The panel itself owns the sidebar height and hides
  overflow; `history-list` owns row scrolling. Covered by the Playwright
  workflow `history header stays fixed while only history rows scroll`.
- Charcoal now sets a readable chrome text token instead of inheriting the light
  theme's near-black `--chrome-text`, and the theme suite now checks computed
  document, sidebar, TOC, and muted-text contrast under Charcoal. Bookmark drag
  overlay drop animation is disabled so the dragged row does not perform the
  default library fly-to/fly-back motion on release; sortable row movement uses a
  short 120ms ease-out transform.
- Bookmark drag-and-drop now uses `@dnd-kit` sortable rows instead of the prior
  hand-rolled pointer reorder path. Dragging shows a real drag overlay item,
  target rows expose an accent drop-location indicator, the existing row button
  remains the single accessible action target, and overflowing bookmark lists
  keep their own scroll range. Covered by the Playwright workflow `bookmarks
  track current selection and can be reordered` plus `bookmarks pane scrolls when
  saved bookmarks overflow`.
- Completed a PR-by-PR audit of the closed upstream `tqbf/mdv` PR history in
  `docs/UPSTREAM_PR_PARITY_AUDIT.md`. Mermaid PRs #27 and #29 remain explicitly
  ignored by request. The audit pass added SQLite `SQLITE_OPEN_FULLMUTEX`
  parity, heading-click source-section copy, thematic-break smart-typography
  regression coverage, and shared history/bookmark refresh events for
  multi-window state.
- Latest parity gate run: `npm run lint`, `npm test`, `npm run build`,
  `cargo test --manifest-path src-tauri/Cargo.toml`, `CI=1 npm run
  test:parity` (193 passed, 2 skipped), and `npm run compare:visual` all pass.
  The visual comparator captured both real apps and reported three-panel
  structure for both native and Tauri captures.
- Removed the invented history-search `Clear` button; Swift exposes row removal
  through row actions, not a clear-history command inside the search pod.
- TOC, search, bookmarks, right inspector, and left history sidebar collapse now
  use animated mdv panes. The left sidebar keeps a stable desktop split-view
  column and collapses to the 6pt edge gutter with the same 0.22s shell
  animation observed in Swift `ContentView.swift`.
- Smart Typography now has explicit browser parity coverage proving it rerenders
  the current document immediately, changing quotes/dashes when enabled and
  restoring literal punctuation when toggled off.
- Smart Typography and Load Remote Images are now native checkbox menu items,
  matching Swift `Toggle` menu semantics. The Tauri app now synchronizes checked
  state, disabled state, Smart Typography's theme-specific alternate title,
  Back/Forward enablement, editor/document action enablement, sidebar show/hide
  labels, and bookmark-slot labels from renderer state.
- Navigation now records and restores Swift-style history snapshots across
  sidebar selection, search hits, bookmark jumps, placeholder jumps, native open
  requests, drag/drop, local links, and TOC clicks. Same-file jumps restore
  visible block, fragment, or scroll position without unnecessarily closing and
  reopening the document.
- History deletion now clears its persisted scroll-position record, matching the
  Swift history cleanup behavior.
- Latest parity gate run: `npm run lint`, `npm test`, `npm run build`,
  `cargo test --manifest-path src-tauri/Cargo.toml`, `CI=1 npm run
  test:parity` (181 passed, 2 skipped), and `npm run compare:visual` all pass.
  The visual comparator captured both real apps and reported three-panel
  structure for both native and Tauri captures.
- Editing the current file now keeps the document open in mdv and reloads editor
  saves in place. Same-file native open/drop events are treated as reloads
  instead of fresh opens, and the macOS editor launcher prefers the selected
  app's bundle identifier before falling back to `open -a`. Covered by the
  Playwright workflow `editing the current file keeps it open and reloads editor
  saves`.
- The history search pod now uses the compact mdv search-field treatment with
  SF-symbol search/close affordances and theme-aware dark-mode background/border
  colors. Covered by the cross-browser Playwright test `history search field
  stays compact and legible in dark themes`.
- The bookmarks pane now keeps its inner list scrollable when saved bookmarks
  overflow the pane height, including through the animated collapse wrapper.
  Covered by the Playwright test `bookmarks pane scrolls when saved bookmarks
  overflow`.
- Latest parity gate run: `npm run lint`, `npm test`, `npm run build`,
  `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run test:parity`
  (170 passed, 1 skipped), and `npm run compare:visual` all pass. The visual
  comparator captured both real apps and reported three-panel structure for both
  native and Tauri captures.
- The `test-docs/tables.md` corpus now has explicit rendering parity coverage
  for table count, alignment, header/body styling, inline formatting inside
  cells, and horizontal overflow for the wide-table case. Tables now render with
  rounded mdv document chrome, subtle header/background treatment, alternating
  rows, preserved alignment, and local horizontal scrolling instead of pushing
  the document column.
- Local link handling now resolves local non-markdown links to absolute file
  paths before handing them to the system opener, and missing local markdown
  targets fall through to the system opener after a failed in-app load. Covered
  by the `test-docs/links.md` corpus links for local PNGs and missing
  `.markdown` files.
- Latest parity gate run: `npm run lint`, `npm test`, `npm run build`,
  `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run test:parity`
  (161 passed, 1 skipped), and `npm run compare:visual` all pass. The visual
  comparator captured both real apps and reported three-panel structure for both
  native and Tauri captures.
- Markdown rendering now restores visible unordered/ordered list markers after
  Tailwind preflight, preserves nested marker styles and Markdown spacing, and
  routes raw HTML `<img>` tags through mdv's existing local/data/remote/missing
  image policy. Covered by renderer unit tests, fixture coverage for
  `test-docs/images.md`, and Playwright checks for native-style list markers and
  loaded HTML image tags.
- Row-level file actions now match Swift-style contextual workflows instead of
  exposing invented hover buttons: history rows, global search hits,
  placeholders, and bookmarks use context menus for open/reveal/remove/reorder
  actions, and the oversized hover `Reveal` button has been removed. Covered by
  the Playwright deletion, missing-bookmark, and reveal-in-Finder workflows.
- The desktop shell now has a Swift-style three-panel split view with a
  resizable left history sidebar, hover-revealed collapse control, collapsed
  edge gutter, animated right inspector collapse, and animated history search,
  TOC filter, and bookmarks open/collapse pods. Mobile keeps the viewer usable
  with capped responsive pane heights. Covered by cross-browser Playwright split
  and animation tests.
- Navigate menu accelerators now use Tauri/muda's supported `Cmd+ArrowLeft` and
  `Cmd+ArrowRight` syntax while preserving Swift back/forward behavior. Covered
  by Tauri config contract tests plus browser hotkey and menu-command parity
  checks.
- Latest parity gate run: `npm run lint`, `npm test`, `npm run build`,
  `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run test:parity`
  (158 passed, 1 skipped), and `npm run compare:visual` all pass. The visual
  comparator captured both real apps and reported three-panel structure for both
  native and Tauri captures.
- The Tauri native menu now matches Swift mdv's custom command labels exactly,
  including ellipsis and bookmark-slot dash punctuation, and has a source-level
  contract test for every custom command id, label, shortcut, and renderer
  dispatch path. Rendering fixture coverage now checks text extracted from the
  rendered Markdown output rather than only checking source fixture content.
- Every Swift mdv theme now has Playwright screenshot coverage across the
  existing desktop, WebKit, and mobile parity projects. The test cycles the full
  theme catalog, verifies the active theme state, and asserts the rendered
  markdown capture is nonblank.
- Theme resolution and smart-typography opt-outs now have direct unit coverage:
  stored Swift-era aliases (`paper`, `solarized`) normalize to the Tauri theme
  IDs, invalid stored values fall back to High Contrast, and Phosphor plus
  Standard Erin themes disable smart typography.
- Cross-document fragment links now have browser-level parity coverage: clicking
  `syntax.md#escaping` from the links fixture opens the target document, records
  `data-current-fragment="escaping"`, and verifies the target heading is
  scrolled into view.
- The Tauri release pipeline now has a macOS GitHub Actions workflow that builds
  Apple Silicon and Intel DMGs with `tauri-apps/tauri-action@v1`, uploads draft
  release/workflow artifacts, and passes Apple certificate plus App Store
  Connect API-key secrets through to Tauri for signing and notarization. Covered
  by the Tauri workflow contract test in `src/tauriConfig.test.ts`; actual
  notarization requires the GitHub repository secrets documented in the workflow.
- `Open in New Window...` now follows the Swift flow: it runs a separate file
  picker, creates a new Tauri document window at Swift's default/minimum window
  sizes, seeds only that window with the selected document, and leaves the
  current window untouched. Covered by Rust target-validation/URL-encoding
  tests, a store isolation test, a Tauri capability contract test, and the
  Playwright parity test `open in new window keeps the current document and
  delegates to native window creation`.
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
- Rendered Markdown top-level blocks now carry stable `data-mdv-block-index`
  metadata, and bookmarks/scroll persistence use the actual top visible rendered
  block instead of a pixel-height approximation. Covered by the unit test
  `marks rendered top-level blocks with mdv block indices` and the Playwright
  parity test `bookmarks and scroll persistence use the top visible rendered
  block`.
- The inspector now uses Swift-sized 11 px uppercase section headings with 0.6 px
  tracking, compact 26 px TOC rows, the custom compact heading filter field, and
  collapsed Bookmarks placement without a resize divider. Covered by the
  Playwright parity test `inspector typography and spacing match the Swift pane`.
- The toolbar now exposes and tests the exact Swift `Image(systemName:)` symbol
  contract: `plus`, `pencil`, `paintpalette`, `bookmark`/`bookmark.fill`, and
  `sidebar.right`, with no extra Back/Forward/Folder/Zoom controls. Filled
  bookmark rendering no longer draws a hollow stroke over the filled state.
  Covered by the Playwright parity test `toolbar uses the exact Swift mdv action
  symbols`.
- The visual comparator now reports raw document-region luminance but gates
  document drift on an inset `documentInterior` region, isolating known
  native-capture compositing outlines from real Markdown-pane differences.
  `npm run compare:visual` still captures both real apps and validates titlebar,
  left pane, document interior, right pane, three-panel structure, and text
  density.

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
- Removed the invented history search `Clear` button; Swift exposes row removal
  through row actions, not a clear-history command inside the search pod.
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

Status: complete for the current harness gate. Core link interception,
fragments, back/forward, visible-block snapshots, and scroll persistence are
implemented and covered.

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
- Done: navigation snapshots store and restore the true top visible rendered
  block when moving back/forward across documents.

Tests:

- Done: unit tests for slug generation.
- Done: Playwright tests for relative links, same-document fragments, external
  link fallthrough, Back button, `Cmd+Left`, `Cmd+Right`, and visible-block
  snapshot restoration.
- Done: Playwright coverage for restoring scroll when reopening a document.
- Done: Playwright coverage for cross-document fragments.

### Phase 2.5 — TOC / Inspector

Status: complete for the current harness gate. Core TOC rendering,
click-to-scroll, active heading tracking, compact filtering, persisted
visibility, and bookmark pane behavior are covered.

Goal: match mdv’s right inspector behavior without manual visual checks.

- Done: right inspector visible by default for visual parity.
- Done: TOC generated from rendered headings.
- Done: TOC row click scrolls to the heading.
- Done: compact TOC filter control.
- Done: current visible heading tracking.
- Done: bookmarks pane resize/collapse persistence.

Tests:

- Done: Playwright tests for TOC creation and filter behavior.
- Done: Playwright tests for active heading state and bookmarks pane
  persistence.

### Phase 3 — Find And Global Search Parity

Status: complete for current harness. In-document find, contextual `Cmd+F`,
inline highlights for eligible blocks, block-level fallback highlights, global
search snippets, opening hits into find, and stale-query protection are covered.

Goal: replace the current simple find with mdv’s usable search behavior.

- Done: in-document find overlay with `Cmd+F`, Escape, next/previous.
- Done: inline highlights for simple blocks.
- Done: block-level highlights for matched rendered blocks.
- Done: match counter and current-match state.
- Done: next/previous scrolls to the current match by rendered block index.
- Done: route `Cmd+F` to history search when sidebar search is focused.
- Done: global search UI with highlighted snippets.
- Done: open/reveal actions on global hits.
- Done: opening a global hit seeds the in-document find query.
- Done: stale global-search responses are discarded.

Tests:

- Done: unit tests for match calculation and highlight eligibility.
- Done: Playwright tests for keyboard find, next/previous, block highlighting,
  current-match state, and rendered-block scrolling.
- Done: Rust tests for FTS prefix/sanitizing and Swift-style snippet markers.
- Done: unit coverage for stale-query behavior.
- Done: Playwright coverage for global search snippets and opening hits into
  in-document find.
- Done: Playwright coverage for Escape and contextual `Cmd+F` routing.
- Done: Playwright coverage for inline highlight rendering.

### Phase 4 — Scroll Anchors, Bookmarks, Placeholder

Status: complete for current harness. Scroll restore, visible-block tracking,
bookmark slot jumps, bookmark fingerprint relocation, drag reorder, context-menu
move commands, transient placeholder row, bookmark title fidelity, and
missing-file bookmark states are covered.

Goal: make reading position and saved spots durable.

- Done: scroll positions persist with block estimate, fingerprint,
  and mtime.
- Done: restore only when mtime matches.
- Done: track exact visible/top block in the React viewer.
- Done: bookmark actual hovered/top block, not first match.
- Done: bookmark titles use the nearest heading for the captured block.
- Done: implement bookmark slot shortcuts `Cmd+1` through `Cmd+5`.
- Done: implement bookmark jump-to-anchor with fingerprint relocation.
- Done: implement reorder/move top/bottom.
- Done: implement transient placeholder `Cmd+Shift+0` / `Cmd+0`.
- Done: add current bookmark/placeholder visual state.
- Done: placeholder appears as a pinned row, can jump, reveal, and clear.
- Done: missing bookmark rows are dimmed, inert, and removable.

Tests:

- Done: Rust tests for scroll persistence and stale mtime rejection.
- Done: unit tests for fingerprint relocation.
- Done: Playwright test for scroll restore.
- Done: Playwright tests for bookmark slots, reorder, and placeholder
  set/jump/reveal/clear.
- Done: Playwright coverage that active find matches do not override the
  visible block when bookmarking.
- Done: Playwright coverage for missing-file bookmark states.
- Done: Playwright coverage for move top/bottom commands.

### Phase 5 — Images And Privacy

Status: complete for current harness. Local, data URI, missing-file,
blocked-remote, enabled-remote loaded/error states, persistent opt-in, and
in-memory successful remote URL caching are implemented and covered.

Goal: match mdv image behavior and remote-image privacy.

- Done: implement local image rendering in markdown output.
- Done: resolve relative image paths against document directory.
- Done: render missing image placeholders.
- Done: render data URI images.
- Done: block remote images by default.
- Done: add persistent Load Remote Images toggle.
- Done: add remote loading state, error state, and in-memory cache.

Tests:

- Done: unit tests for image source classification.
- Done: Rust tests for local image URL resolution and missing-file detection.
- Done: Playwright tests for relative images, data URI images, missing images,
  and remote-blocked placeholders.
- Done: tests for enabled remote image state and failed remote load.

### Phase 6 — Code Block Parity

Goal: bring over the “awesome code blocks” work.

- Done: Decide engine:
  - Done: `highlight.js` short-term renderer with Swift-compatible supported
    language aliases.
  - Future optional replacement: tree-sitter/WASM or Rust-side highlighter if
    exact capture palettes need another backend.
- Done: Implement language label.
- Done: Implement copy button.
- Done: Implement wrap toggle.
- Done: Implement copy-without-prompts for shell blocks.
- Done: Implement right-click/menu equivalent.
- Done: Add per-theme code palettes for the full Swift mdv theme catalog using
  Swift CodePalette values.
- Done: Reduce bundle cost by loading language highlighters selectively for
  supported mdv languages.

Tests:

- Done: unit tests for language aliasing and shell prompt stripping.
- Done: Playwright tests for label, copy, wrap, shell copy, and fixture
  language coverage.
- Done: Playwright coverage for code token palette changes across implemented
  themes.
- Done: explicit long-line scroll/wrap coverage.

### Phase 7 — Themes, Typography, Fonts, Zoom

Goal: match the reading experience.

- Done: Port the full theme catalog IDs, names, palette tokens, and primary
  typography tokens.
- Done: Add system theme mode with light/dark CSS resolution.
- Done: Add persistent theme menu/selector for the full Swift catalog.
- Done: Add zoom keyboard shortcuts, reset, and HUD.
- Done: Add smart typography toggle and theme opt-outs.
- Done: Bundle/load web font equivalents for Alegreya, Besley, OpenDyslexic.
- Done: Implement Standard Erin font fallback where possible.
- Done: Tune markdown CSS per theme:
  - Done: Measure.
  - Done: Heading scale.
  - Done: Line spacing.
  - Done: Strong color/weight.
  - Done: Code palette.

Tests:

- Done: Unit tests for theme resolution and smart typography.
- Done: Playwright visual/screenshot assertions for every theme across desktop
  and mobile.

### Phase 8 — External Editor And Live Reload

Goal: support the edit/read loop.

- Done: Add editor picker using Tauri dialog or Rust native command.
- Done: Persist editor app path.
- Done: Open current file in editor.
- Done: Add forget editor.
- Done: Add file signature watcher path using Tauri/Rust metadata polling.
- Done: Debounce reloads.
- Done: Preserve current scroll on watcher reload.

Tests:

- Done: Rust tests for watcher debounce logic where possible.
- Done: Playwright tests using mocked API for editor state.
- Done: Rust tests for file signature metadata.
- Done: Playwright test that modifies the mocked current document and verifies
  reload with scroll preservation.

### Phase 9 — Native App Integration And Packaging

Goal: make the Tauri app replace the Swift app operationally.

- Done: File associations for `.md`, `.markdown`, `.mdown`, `.mkd`, optionally `.txt`.
- Done: App-opened file event handling.
- Done: New window support.
- Done: Help document command.
- Done: CLI installer equivalent or a Tauri-native CLI strategy.
- Done: App icon and bundle metadata.
- Done: Release DMG/signing/notarization pipeline.

Tests:

- Done: Tauri `.app` build check.
- Done: Scripted bundle metadata checks.
- Done: CLI smoke test.
- Done: App open event smoke test if automatable.
- Done: New window menu smoke test with current-window isolation.
- Done: Release workflow contract test for DMG targets, signing/notarization
  environment, and artifact upload.

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
