# mdv help

A "totally solved problem in computer science" rendered into a window. Here is what it does and how to make it do it.

## Opening files

- **Ctrl/⌘O** opens a file. **Ctrl/⌘⇧O** opens one in a new window.
- Drop a `.md` (or `.markdown`, or `.mdown`) onto the icon — works.
- Drop a *directory* onto the icon — picks `README.md` if it finds one, otherwise the alphabetically-first markdown, and seeds the rest into history as siblings.

## Moving around

- **Ctrl/⌘←** / **Ctrl/⌘→** — back and forward through files you have recently opened. Like a browser. The thing browsers do.
- Click a link to a sibling `.md` in the same directory — it loads. Click an `https://` link — it goes to your browser, where it belongs.
- `#fragment` links scroll to the matching heading. `[See above](#earlier-section)` actually does that.

## Find

- **Ctrl/⌘F** — find in the current document. The inline kind, with highlights and a counter, like every text app shipped after 1998.
- **Ctrl/⌘⇧F** — search across every file in your history. This is **TEXT SEARCH TECHNOLOGY**, which other Markdown viewers somehow do not ship. Patent pending.

## Bookmarks

Every program eventually evolves bookmarks. We did not fight it.

- **Ctrl/⌘D** — bookmark the spot you are looking at.
- **Ctrl/⌘1**..**Ctrl/⌘5** — jump to bookmark slots 1 through 5.
- **Ctrl/⌘⇧0** — drop a transient placeholder at the current spot. **Ctrl/⌘0** — jump back to it. The placeholder lives in memory only; restart the app and it is gone. That is a feature.
- This help file is copied into mdv's application data directory, which means you can bookmark sections of it like anything else. Welcome to the meta-help.

## Sidebars

- **TOC** — h1/h2/h3 headings, click to jump. Toggle from the toolbar.
- **History** — every file you have opened, ever, until you swipe one left and tap delete. Survives restart.

## Themes

A frustrated, untalented graphic designer (the author) could not resist letting two LLMs argue with him about typography. The result is several themes. Pick one from the toolbar. Do not @ me about font choices.

## Editor integration

- **Ctrl/⌘E** — open the current file in your external editor.
- **File → Edit → Choose Editor…** — pick which editor. **Forget Editor** clears it.

## When things go sideways

If links do not go where you expect or fragments do not scroll, file an issue. Or yell at the author about zoning reform. Either works.
