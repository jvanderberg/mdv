#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

APP_PATH="${MDV_TAURI_APP:-$PWD/src-tauri/target/release/bundle/macos/mdv.app}"
DOC_PATH="${MDV_CAPTURE_DOC:-$PWD/test-docs/README.md}"
OUT_DIR="${MDV_TAURI_OUT:-$PWD/parity-artifacts/tauri}"
OUT_PATH="${MDV_TAURI_CAPTURE:-$OUT_DIR/tauri-window.png}"
BUILD_APP="${MDV_TAURI_BUILD_APP:-0}"

mkdir -p "$OUT_DIR"
rm -f "$OUT_PATH" "$OUT_DIR/tauri-screen.png" "$OUT_DIR/tauri-mdv.log" "$OUT_DIR/windows.tsv" "$OUT_DIR/sckit.err"

if [ "$BUILD_APP" = "1" ] || [ ! -d "$APP_PATH" ]; then
  npx tauri build --bundles app --no-sign
fi

if [ ! -d "$APP_PATH" ]; then
  echo "Tauri mdv app not found: $APP_PATH" >&2
  echo "build it with: npx tauri build --bundles app --no-sign" >&2
  exit 1
fi

if [ ! -f "$DOC_PATH" ]; then
  echo "Tauri fixture not found: $DOC_PATH" >&2
  exit 1
fi

pkill -x mdv >/dev/null 2>&1 || true
pkill -x mdv-tauri >/dev/null 2>&1 || true

DB_PATH="$OUT_DIR/mdv-tauri-capture.db"
rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"

APP_EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Contents/Info.plist")"
launchctl setenv MDV_TAURI_DB_PATH "$DB_PATH"
trap 'launchctl unsetenv MDV_TAURI_DB_PATH >/dev/null 2>&1 || true; pkill -x "$APP_EXECUTABLE" >/dev/null 2>&1 || true' EXIT
open -n "$APP_PATH" --args "$DOC_PATH" > "$OUT_DIR/tauri-mdv.log" 2>&1
launchctl unsetenv MDV_TAURI_DB_PATH >/dev/null 2>&1 || true

sleep 3
WINDOW_META="$(swift - <<'SWIFT'
import CoreGraphics
import Foundation

let display = CGMainDisplayID()
let displayWidth = CGDisplayBounds(display).width
let displayHeight = CGDisplayBounds(display).height
let windows = CGWindowListCopyWindowInfo(CGWindowListOption(arrayLiteral: .optionAll), kCGNullWindowID) as? [[String: Any]] ?? []
for window in windows {
    let owner = (window[kCGWindowOwnerName as String] as? String) ?? ""
    let name = (window[kCGWindowName as String] as? String) ?? ""
    let layer = (window[kCGWindowLayer as String] as? Int) ?? -1
    let onscreen = (window[kCGWindowIsOnscreen as String] as? Bool) ?? false
    guard owner == "mdv", layer == 0, onscreen else { continue }
    guard name == "mdv" || name.hasSuffix(".md") || name.hasSuffix(".markdown") || name.hasSuffix(".txt") else { continue }
    guard let bounds = window[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
    let width = bounds["Width"] ?? 0
    let height = bounds["Height"] ?? 0
    guard width > 700, height > 400 else { continue }
    if let id = window[kCGWindowNumber as String] as? Int,
       let x = bounds["X"],
       let y = bounds["Y"] {
        print("\(id)\t\(x)\t\(y)\t\(width)\t\(height)\t\(displayWidth)\t\(displayHeight)")
        exit(0)
    }
}
SWIFT
)"

if [ -z "$WINDOW_META" ]; then
  screencapture -x "$OUT_DIR/tauri-screen.png" || true
  echo "Tauri mdv exposed no CoreGraphics content window; wrote diagnostics to $OUT_DIR" >&2
  exit 2
fi

IFS=$'\t' read -r window_id window_x window_y window_w window_h display_w display_h <<< "$WINDOW_META"
SCKIT_HELPER="$OUT_DIR/capture-window-sckit"
mkdir -p "$OUT_DIR/swift-module-cache"
if swiftc -parse-as-library \
  -module-cache-path "$OUT_DIR/swift-module-cache" \
  scripts/capture-window-sckit.swift \
  -o "$SCKIT_HELPER" 2>"$OUT_DIR/sckit-build.err" &&
  "$SCKIT_HELPER" "$window_id" "$OUT_PATH" 2>"$OUT_DIR/sckit.err"; then
  echo "captured Tauri mdv window with ScreenCaptureKit: $OUT_PATH"
  exit 0
fi

if screencapture -x -l "$window_id" "$OUT_PATH" 2>"$OUT_DIR/screencapture.err"; then
  echo "captured Tauri mdv window: $OUT_PATH"
  exit 0
fi

FULL_SCREEN="$OUT_DIR/tauri-screen.png"
screencapture -x "$FULL_SCREEN"
node scripts/crop-window-capture.mjs "$FULL_SCREEN" "$OUT_PATH" "$window_x" "$window_y" "$window_w" "$window_h" "$display_w" "$display_h"
echo "Tauri ScreenCaptureKit capture failed; diagnostics in $OUT_DIR/sckit.err" >&2
echo "wrote legacy crop diagnostic to $OUT_PATH, but refusing to treat it as parity evidence" >&2
exit 3
