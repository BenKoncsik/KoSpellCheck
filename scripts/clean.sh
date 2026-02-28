#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[clean] removing build outputs"
find "$ROOT" -type d \( -name bin -o -name obj -o -name out -o -name node_modules \) -prune -exec rm -rf {} +
rm -rf "$ROOT/artifacts"
mkdir -p "$ROOT/artifacts/vsix" "$ROOT/artifacts/vscode" "$ROOT/artifacts/nuget" "$ROOT/artifacts/logs"

echo "[clean] completed"
