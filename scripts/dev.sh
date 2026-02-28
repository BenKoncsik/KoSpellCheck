#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[dev] dotnet build"
dotnet build "$ROOT/KoSpellCheck.sln" -c Debug

echo "[dev] vscode watch"
pushd "$ROOT/src/KoSpellCheck.VSCode" >/dev/null
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm run watch
popd >/dev/null
