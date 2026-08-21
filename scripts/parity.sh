#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "node_modules is missing. Run: npm install"
  exit 1
fi

echo "== TypeScript build =="
npm run build

echo "== Renderer/unit parity =="
npm test

echo "== Rust backend parity =="
cargo test --manifest-path src-tauri/Cargo.toml

echo "== Browser workflow parity =="
npm run test:e2e
