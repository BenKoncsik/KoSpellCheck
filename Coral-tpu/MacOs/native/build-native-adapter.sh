#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MACOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$SCRIPT_DIR/coral_tpu_adapter.cc"
OUT="$MACOS_DIR/bin/coral-typo-classifier-native"

mkdir -p "$(dirname "$OUT")"

clang++ \
  -std=c++17 \
  -O2 \
  -Wall \
  -Wextra \
  -Werror \
  "$SRC" \
  -o "$OUT"

chmod +x "$OUT"
echo "Built: $OUT"
