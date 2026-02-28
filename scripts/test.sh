#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[test] dotnet tests"
TARGET_FRAMEWORK="net8.0"
if dotnet --list-runtimes | grep -q "Microsoft.NETCore.App 9\\."; then
  TARGET_FRAMEWORK="net9.0"
elif dotnet --list-runtimes | grep -q "Microsoft.NETCore.App 8\\."; then
  TARGET_FRAMEWORK="net8.0"
fi
dotnet test "$ROOT/src/KoSpellCheck.Core.Tests/KoSpellCheck.Core.Tests.csproj" -c Release -f "$TARGET_FRAMEWORK"

echo "[test] vscode tests"
pushd "$ROOT/src/KoSpellCheck.VSCode" >/dev/null
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm run test
popd >/dev/null

echo "[test] completed"
