#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS="$ROOT/artifacts"

mkdir -p "$ARTIFACTS/vsix" "$ARTIFACTS/vscode" "$ARTIFACTS/nuget" "$ARTIFACTS/logs"

echo "[build] dotnet restore"
dotnet restore "$ROOT/KoSpellCheck.sln"

echo "[build] dotnet build"
dotnet build "$ROOT/KoSpellCheck.sln" -c Release --no-restore

echo "[build] vscode npm ci + build"
pushd "$ROOT/src/KoSpellCheck.VSCode" >/dev/null
npm ci
npm run build
popd >/dev/null

echo "[build] completed"
