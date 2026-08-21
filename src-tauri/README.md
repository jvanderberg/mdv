# mdvx

`mdvx` is the Cargo distribution of [mdv](https://github.com/jvanderberg/mdv), a desktop Markdown viewer built with Tauri, Rust, React, and TypeScript.

```sh
cargo install mdvx
mdvx
```

Building a Tauri application requires the platform packages documented in the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

The Cargo package installs a standalone application binary. Native installers, desktop file associations, and release bundles are available from the project repository.

On macOS, startup diagnostics are written to `~/Library/Logs/mdvx-startup.log`.

Licensed under the MIT License.
