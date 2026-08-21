#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

APP_PATH="${MDV_NATIVE_APP:-$PWD/build/mdv.app}"
DOC_PATH="${MDV_NATIVE_DOC:-$PWD/test-docs/README.md}"
OUT_DIR="${MDV_NATIVE_OUT:-$PWD/parity-artifacts/native-mdv}"
RESET_SAVED_STATE="${MDV_RESET_SAVED_STATE:-0}"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/native-window.png" "$OUT_DIR/native-window.pdf" "$OUT_DIR/native-screen.png" "$OUT_DIR/native-mdv.log"

if [ ! -d "$APP_PATH" ]; then
  echo "native mdv app not found: $APP_PATH" >&2
  echo "build it with: make build" >&2
  exit 1
fi

if [ ! -f "$DOC_PATH" ]; then
  echo "native fixture not found: $DOC_PATH" >&2
  exit 1
fi

pkill -x mdv >/dev/null 2>&1 || true

if [ "$RESET_SAVED_STATE" = "1" ]; then
  state_dir="$HOME/Library/Saved Application State/com.mdv.app.savedState"
  if [ -d "$state_dir" ]; then
    backup_dir="/private/tmp/mdv-saved-state-backup"
    mkdir -p "$backup_dir"
    mv "$state_dir" "$backup_dir/com.mdv.app.savedState.$(date +%s)"
  fi
fi

export MDV_INSTRUMENT_NATIVE_WINDOW=1
export MDV_INSTRUMENT_NATIVE_DOC="$DOC_PATH"
export MDV_INSTRUMENT_NATIVE_CAPTURE="$OUT_DIR/native-window.png"
"$APP_PATH/Contents/MacOS/mdv" > "$OUT_DIR/native-mdv.log" 2>&1 &
native_pid="$!"
for _ in $(seq 1 40); do
  if [ -f "$MDV_INSTRUMENT_NATIVE_CAPTURE" ]; then
    if [ -f "${MDV_INSTRUMENT_NATIVE_CAPTURE%.png}-document.png" ]; then
      node scripts/composite-native-capture.mjs
    fi
    echo "captured native mdv window: $MDV_INSTRUMENT_NATIVE_CAPTURE"
    exit 0
  fi
  if ! kill -0 "$native_pid" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

osascript -e 'tell application "mdv" to activate' >/dev/null 2>&1 || true
sleep 1

osascript \
  -e 'tell application "System Events" to tell process "mdv" to return "frontmost=" & frontmost & ", visible=" & visible & ", windows=" & (count of windows) & ", names=" & (name of every window)' \
  > "$OUT_DIR/accessibility.txt" 2>&1 || true

swift - "$OUT_DIR/windows.tsv" <<'SWIFT'
import CoreGraphics
import Foundation

let output = URL(fileURLWithPath: CommandLine.arguments[1])
let windows = CGWindowListCopyWindowInfo(CGWindowListOption(arrayLiteral: .optionAll), kCGNullWindowID) as? [[String: Any]] ?? []
var lines: [String] = ["id\towner\tname\tlayer\tonscreen\tbounds"]

for window in windows {
    let owner = (window[kCGWindowOwnerName as String] as? String) ?? ""
    guard owner.localizedCaseInsensitiveContains("mdv") else { continue }

    let id = window[kCGWindowNumber as String] ?? ""
    let name = window[kCGWindowName as String] ?? ""
    let layer = window[kCGWindowLayer as String] ?? ""
    let onscreen = window[kCGWindowIsOnscreen as String] ?? ""
    let bounds = window[kCGWindowBounds as String] ?? ""
    lines.append("\(id)\t\(owner)\t\(name)\t\(layer)\t\(onscreen)\t\(bounds)")
}

try lines.joined(separator: "\n").write(to: output, atomically: true, encoding: .utf8)
SWIFT

window_id="$(awk 'NR == 2 { print $1 }' "$OUT_DIR/windows.tsv")"
if [ -n "${window_id:-}" ]; then
  screencapture -x -l "$window_id" "$OUT_DIR/native-window.png"
  echo "captured native mdv window: $OUT_DIR/native-window.png"
else
  screencapture -x "$OUT_DIR/native-screen.png" || true
  echo "native mdv exposed no CoreGraphics window; wrote diagnostics to $OUT_DIR" >&2
  exit 2
fi
