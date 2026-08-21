# Upstream PR Parity Audit

Source: closed PR history for `tqbf/mdv` at
<https://github.com/tqbf/mdv/pulls?q=is%3Apr+is%3Aclosed>. Mermaid rendering is
intentionally ignored for the Tauri port.

| PR | Upstream change | Tauri parity status |
| --- | --- | --- |
| [#1](https://github.com/tqbf/mdv/pull/1) | FTS5 search across history | Implemented: SQLite FTS history search and sidebar search parity tests. |
| [#2](https://github.com/tqbf/mdv/pull/2) | Position-anchored bookmarks, hotkey slots, placeholder | Implemented: anchored bookmarks, `Cmd+1`-`Cmd+5`, `Cmd+0`, missing-file state, pane sizing, and tests. |
| [#3](https://github.com/tqbf/mdv/pull/3) | Selectable document themes | Implemented: full Swift theme catalog, font assets, persistence, toolbar palette, and screenshot coverage. |
| [#4](https://github.com/tqbf/mdv/pull/4) | Bookmark context-menu reorder | Implemented: Move Up/Down/Top/Bottom context menu with disabled end states. |
| [#5](https://github.com/tqbf/mdv/pull/5) | macOS 14 bookmark drag-reorder fix | Implemented in web drag/drop plus persisted reorder tests. |
| [#6](https://github.com/tqbf/mdv/pull/6) | Syntax highlighting and code-block chrome | Implemented with `highlight.js` for the same language surface, themed palettes, copy/wrap chrome, shell prompt stripping, and tests. |
| [#7](https://github.com/tqbf/mdv/pull/7) | SwiftPM build, themed chrome, live reload, inline find, persistence | Implemented or mapped to Tauri: Tauri build pipeline, themed panes/chrome, external edit reload, inline find highlighting, persisted UI state. |
| [#8](https://github.com/tqbf/mdv/pull/8) | Local image provider | Implemented: Markdown and raw HTML image tags resolve local/data/remote/missing states through the same policy. |
| [#9](https://github.com/tqbf/mdv/pull/9) | Link handling, `Cmd+Left`/`Cmd+Right`, fragments, test corpus | Implemented: local/internal/external links, fragments, navigation snapshots, and fixture corpus coverage. |
| [#10](https://github.com/tqbf/mdv/pull/10) | CI and latest prerelease | Implemented for the Tauri port with build/release workflow coverage. |
| [#11](https://github.com/tqbf/mdv/pull/11) | Sign/notarize/package/upload release pipeline | Implemented for Tauri DMG release workflow; real notarization depends on configured repository secrets. |
| [#12](https://github.com/tqbf/mdv/pull/12) | CLI installer, in-app help, System appearance theme | Implemented: bundled CLI/helper resources, Help menu, CLI install command, and System theme. |
| [#13](https://github.com/tqbf/mdv/pull/13) | Scroll positions in back/forward stacks; fragment jumps create entries | Implemented: navigation snapshots carry block/fragment/scroll state across links, TOC, search, bookmarks, and history. |
| [#14](https://github.com/tqbf/mdv/pull/14) | Standard Erin themes | Implemented: Standard Erin Light/Dark themes and smart-typography opt-outs. |
| [#15](https://github.com/tqbf/mdv/pull/15) | macOS 14 Swift crash fix | Not applicable to Tauri; no `NSApp` force unwrap or Swift font lookup path exists in the port. |
| [#16](https://github.com/tqbf/mdv/pull/16) | Solarized renamed to Solarium Daylight/Moonlight | Implemented with Swift-era alias migration for stored theme IDs. |
| [#17](https://github.com/tqbf/mdv/pull/17) | Per-file scroll position across launches | Implemented: persisted block/fingerprint/scroll restoration and deletion cleanup. |
| [#18](https://github.com/tqbf/mdv/pull/18) | Smart Typography toggle | Implemented: View menu checkbox, theme opt-outs, live rerender, and punctuation tests. |
| [#19](https://github.com/tqbf/mdv/pull/19) | Collapsible left sidebar | Implemented: animated left sidebar collapse, edge gutter, and resize behavior. |
| [#20](https://github.com/tqbf/mdv/pull/20) | Block remote images by default; load toggle | Implemented: blocked placeholders by default, View toggle, enabled failure placeholder, and tests. |
| [#21](https://github.com/tqbf/mdv/pull/21) | SQLite `SQLITE_OPEN_FULLMUTEX` | Implemented in this audit pass with `STORE_OPEN_FLAGS` and Rust coverage. |
| [#22](https://github.com/tqbf/mdv/pull/22) | View zoom, zoom HUD, theme menu checkmarks | Implemented: View zoom commands, HUD, persisted zoom, toolbar theme checkmark parity. |
| [#23](https://github.com/tqbf/mdv/pull/23) | Skip smartening for GFM tables | Implemented by parser-stage typography plus explicit table fixture coverage. |
| [#24](https://github.com/tqbf/mdv/pull/24) | Block-level selection and copy as markdown | Superseded upstream by #25; intentionally not implemented. |
| [#25](https://github.com/tqbf/mdv/pull/25) | Heading-click copies section; normal text selection restored | Implemented in this audit pass with heading-click source markdown copy and flash coverage. |
| [#26](https://github.com/tqbf/mdv/pull/26) | Parse markdown once per document load | Implemented by storing rendered HTML, TOC, and block arrays in Zustand per document render instead of parsing on scroll. |
| [#27](https://github.com/tqbf/mdv/pull/27) | Mermaid rendering proposal | Ignored by explicit project instruction. |
| [#29](https://github.com/tqbf/mdv/pull/29) | Mermaid rendering | Ignored by explicit project instruction. |
| [#30](https://github.com/tqbf/mdv/pull/30) | Thematic-break smart typography fix | Superseded by #32; covered in this audit pass via `test-docs/thematic-break.md`. |
| [#32](https://github.com/tqbf/mdv/pull/32) | Thematic-break fix plus O(n^2) DoS fix | Implemented by parser-stage typography and locked with thematic-break fixture/unit/browser coverage. |

Open follow-up from this audit:

- No Mermaid parity work by request.
