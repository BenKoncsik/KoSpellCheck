#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEFAULT_LO_DICT_REF="589a31b2c7e8a592270012e111a51a80d0176f6e"
DEFAULT_LO_CORE_REF="491a0a302adafb0c44a943e217c86d81dff73a22"
DEFAULT_MAGYARISPELL_REF="1ecfd0b086fecb4d02b38148bceeb00b86dd3b6e"
DEFAULT_WECANTSPELL_REF="ab5709d95b2d23541984d22baa0ab2d1e783582f"

LO_DICT_REF="$DEFAULT_LO_DICT_REF"
LO_CORE_REF="$DEFAULT_LO_CORE_REF"
MAGYARISPELL_REF="$DEFAULT_MAGYARISPELL_REF"
WECANTSPELL_REF="$DEFAULT_WECANTSPELL_REF"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lo-dict-ref)
      LO_DICT_REF="$2"
      shift 2
      ;;
    --lo-core-ref)
      LO_CORE_REF="$2"
      shift 2
      ;;
    --magyarispell-ref)
      MAGYARISPELL_REF="$2"
      shift 2
      ;;
    --wecantspell-ref)
      WECANTSPELL_REF="$2"
      shift 2
      ;;
    --help|-h)
      cat <<'USAGE'
Usage: ./tools/fetch-dictionaries.sh [options]

Options:
  --lo-dict-ref <commit-or-tag>      Override LibreOffice/dictionaries ref
  --lo-core-ref <commit-or-tag>      Override LibreOffice/core ref
  --magyarispell-ref <commit-or-tag> Override laszlonemeth/magyarispell ref
  --wecantspell-ref <commit-or-tag>  Override aarondandy/WeCantSpell.Hunspell ref
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

DICTIONARY_DIR="$ROOT/tools/dictionaries"
HU_DIR="$DICTIONARY_DIR/hu_HU"
EN_DIR="$DICTIONARY_DIR/en_US"
LICENSE_DIR="$ROOT/tools/licenses"
SOURCES_FILE="$DICTIONARY_DIR/SOURCES.md"

mkdir -p "$HU_DIR" "$EN_DIR" "$LICENSE_DIR"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kospell-dicts.XXXXXX")"

cleanup() {
  if [[ -d "$TMP_DIR" ]]; then
    find "$TMP_DIR" -type f -delete >/dev/null 2>&1 || true
    find "$TMP_DIR" -depth -type d -exec rmdir {} + >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

download() {
  local url="$1"
  local out="$2"
  echo "[fetch] $url"
  curl -fL --retry 3 --retry-delay 1 --connect-timeout 15 "$url" -o "$out"
}

copy_download() {
  local url="$1"
  local target="$2"
  local tmpFile="$TMP_DIR/$(basename "$target")"
  download "$url" "$tmpFile"
  cp "$tmpFile" "$target"
}

# Dictionaries
copy_download "https://raw.githubusercontent.com/LibreOffice/dictionaries/${LO_DICT_REF}/hu_HU/hu_HU.aff" "$HU_DIR/hu_HU.aff"
copy_download "https://raw.githubusercontent.com/LibreOffice/dictionaries/${LO_DICT_REF}/hu_HU/hu_HU.dic" "$HU_DIR/hu_HU.dic"
copy_download "https://raw.githubusercontent.com/LibreOffice/dictionaries/${LO_DICT_REF}/en/en_US.aff" "$EN_DIR/en_US.aff"
copy_download "https://raw.githubusercontent.com/LibreOffice/dictionaries/${LO_DICT_REF}/en/en_US.dic" "$EN_DIR/en_US.dic"

# License and attribution files
copy_download "https://raw.githubusercontent.com/LibreOffice/dictionaries/${LO_DICT_REF}/hu_HU/README_hu_HU.txt" "$LICENSE_DIR/LICENSE_DICTIONARIES_HU.txt"
copy_download "https://raw.githubusercontent.com/LibreOffice/dictionaries/${LO_DICT_REF}/en/license.txt" "$LICENSE_DIR/LICENSE_DICTIONARIES_EN.txt"
copy_download "https://raw.githubusercontent.com/LibreOffice/dictionaries/${LO_DICT_REF}/en/README_en_US.txt" "$LICENSE_DIR/ATTRIBUTION_DICTIONARIES_EN_US.txt"
copy_download "https://raw.githubusercontent.com/LibreOffice/dictionaries/${LO_DICT_REF}/en/WordNet_license.txt" "$LICENSE_DIR/LICENSE_DICTIONARIES_EN_WORDNET.txt"

copy_download "https://raw.githubusercontent.com/LibreOffice/core/${LO_CORE_REF}/COPYING.MPL" "$LICENSE_DIR/LICENSE_MPL_2_0.txt"
copy_download "https://raw.githubusercontent.com/LibreOffice/core/${LO_CORE_REF}/COPYING.LGPL" "$LICENSE_DIR/LICENSE_LGPL_3_0.txt"

copy_download "https://raw.githubusercontent.com/laszlonemeth/magyarispell/${MAGYARISPELL_REF}/README" "$LICENSE_DIR/ATTRIBUTION_HU_MAGYARISPELL.txt"
copy_download "https://raw.githubusercontent.com/aarondandy/WeCantSpell.Hunspell/${WECANTSPELL_REF}/license.txt" "$LICENSE_DIR/LICENSE_HUNSPELL_ENGINE.txt"

GENERATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
cat > "$SOURCES_FILE" <<EOF2
# KoSpellCheck Dictionary Sources

Generated: ${GENERATED_AT}

## Hungarian dictionary (hu_HU)

- Upstream repo: https://github.com/LibreOffice/dictionaries
- Ref: ${LO_DICT_REF}
- Files:
  - hu_HU/hu_HU.aff
  - hu_HU/hu_HU.dic
  - hu_HU/README_hu_HU.txt
- License notes:
  - MPL 2.0: https://github.com/LibreOffice/core (COPYING.MPL @ ${LO_CORE_REF})
  - LGPL 3.0+: https://github.com/LibreOffice/core (COPYING.LGPL @ ${LO_CORE_REF})
- Additional Hungarian attribution source:
  - https://github.com/laszlonemeth/magyarispell (README @ ${MAGYARISPELL_REF})

## English dictionary (en_US)

- Upstream repo: https://github.com/LibreOffice/dictionaries
- Ref: ${LO_DICT_REF}
- Files:
  - en/en_US.aff
  - en/en_US.dic
  - en/license.txt
  - en/README_en_US.txt
  - en/WordNet_license.txt

## Hunspell engine wrapper attribution

- Upstream repo: https://github.com/aarondandy/WeCantSpell.Hunspell
- Ref: ${WECANTSPELL_REF}
- File:
  - license.txt

## Copied-to paths in this repo

- tools/dictionaries/hu_HU/hu_HU.aff
- tools/dictionaries/hu_HU/hu_HU.dic
- tools/dictionaries/en_US/en_US.aff
- tools/dictionaries/en_US/en_US.dic
- tools/licenses/LICENSE_DICTIONARIES_HU.txt
- tools/licenses/LICENSE_DICTIONARIES_EN.txt
- tools/licenses/ATTRIBUTION_DICTIONARIES_EN_US.txt
- tools/licenses/LICENSE_DICTIONARIES_EN_WORDNET.txt
- tools/licenses/LICENSE_MPL_2_0.txt
- tools/licenses/LICENSE_LGPL_3_0.txt
- tools/licenses/ATTRIBUTION_HU_MAGYARISPELL.txt
- tools/licenses/LICENSE_HUNSPELL_ENGINE.txt
EOF2

echo "[fetch] dictionaries and license files updated."
echo "[fetch] source manifest: $SOURCES_FILE"
