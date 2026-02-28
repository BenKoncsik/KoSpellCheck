#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if dotnet tool list -g 2>/dev/null | grep -q 'dotnet-format'; then
  echo "[lint] dotnet format"
  dotnet format "$ROOT/KoSpellCheck.sln" --verify-no-changes || true
else
  echo "[lint] dotnet-format not installed, skipping"
fi

echo "[lint] eslint"
pushd "$ROOT/src/KoSpellCheck.VSCode" >/dev/null
if [[ -d node_modules ]]; then
  npm run lint || true
else
  echo "[lint] node_modules missing, skipping eslint"
fi
popd >/dev/null
