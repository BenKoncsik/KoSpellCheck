#!/usr/bin/env bash
    set -euo pipefail

    ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    ARTIFACTS="$ROOT/artifacts"
    VS2022_VSIX_OUT="$ARTIFACTS/vsix/KoSpellCheck.VS2022.vsix"
    LEGACY_VS2022_VSIX_OUT="$ARTIFACTS/vsix/KoSpellCheck.vsix"
    VSIX_STAGE="$ARTIFACTS/vsix/staging"
    VSCODE_EXT_DIR="$ROOT/src/KoSpellCheck.VSCode"

    required_dictionary_files=(
      "tools/dictionaries/hu_HU/hu_HU.aff"
      "tools/dictionaries/hu_HU/hu_HU.dic"
      "tools/dictionaries/en_US/en_US.aff"
      "tools/dictionaries/en_US/en_US.dic"
    )

    required_license_files=(
      "tools/licenses/LICENSE_DICTIONARIES_HU.txt"
      "tools/licenses/LICENSE_DICTIONARIES_EN.txt"
      "tools/licenses/ATTRIBUTION_DICTIONARIES_EN_US.txt"
      "tools/licenses/LICENSE_DICTIONARIES_EN_WORDNET.txt"
      "tools/licenses/LICENSE_MPL_2_0.txt"
      "tools/licenses/LICENSE_LGPL_3_0.txt"
      "tools/licenses/ATTRIBUTION_HU_MAGYARISPELL.txt"
      "tools/licenses/LICENSE_HUNSPELL_ENGINE.txt"
    )

    check_required_assets() {
      local missing=()
      local file

      for file in "${required_dictionary_files[@]}" "${required_license_files[@]}"; do
        if [[ ! -f "$ROOT/$file" ]]; then
          missing+=("$file")
        fi
      done

      if [[ ${#missing[@]} -eq 0 ]]; then
        return 0
      fi

      echo "[pack] missing dictionary/license assets:" >&2
      for file in "${missing[@]}"; do
        echo "  - $file" >&2
      done
      return 1
    }

    ensure_dictionary_assets() {
      if check_required_assets; then
        return 0
      fi

      if [[ -x "$ROOT/tools/fetch-dictionaries.sh" ]]; then
        echo "[pack] running tools/fetch-dictionaries.sh to download missing assets"
        if "$ROOT/tools/fetch-dictionaries.sh"; then
          if check_required_assets; then
            return 0
          fi
        fi
      fi

      echo "[pack] dictionary assets are still missing." >&2
      echo "[pack] manual step: run ./tools/fetch-dictionaries.sh (or ./tools/fetch-dictionaries.ps1 on Windows) and retry." >&2
      exit 1
    }

    sync_resource_tree() {
      local src="$1"
      local dst="$2"

      mkdir -p "$dst"
      find "$dst" -mindepth 1 -delete
      cp -R "$src/." "$dst/"
    }

    sync_pack_resources() {
      sync_resource_tree "$ROOT/tools/dictionaries" "$ROOT/src/KoSpellCheck.VSCode/resources/dictionaries"
      sync_resource_tree "$ROOT/tools/licenses" "$ROOT/src/KoSpellCheck.VSCode/resources/licenses"
      sync_resource_tree "$ROOT/tools/dictionaries" "$ROOT/src/KoSpellCheck.VS2022/Resources/Dictionaries"
      sync_resource_tree "$ROOT/tools/licenses" "$ROOT/src/KoSpellCheck.VS2022/Resources/Licenses"
    }

    ensure_dictionary_assets
    sync_pack_resources

    "$ROOT/scripts/build.sh"

    mkdir -p "$ARTIFACTS/vsix" "$ARTIFACTS/vscode" "$ARTIFACTS/nuget" "$ARTIFACTS/logs"

    echo "[pack] dotnet nuget packs"
    dotnet pack "$ROOT/src/KoSpellCheck.Core/KoSpellCheck.Core.csproj" -c Release -o "$ARTIFACTS/nuget"
    dotnet pack "$ROOT/src/KoSpellCheck.LanguagePack.HuEn/KoSpellCheck.LanguagePack.HuEn.csproj" -c Release -o "$ARTIFACTS/nuget"

    echo "[pack] vscode vsix"
    pushd "$VSCODE_EXT_DIR" >/dev/null
    npm ci
    npm run build
    VSCODE_VERSION="$(node -p "require('./package.json').version")"
    if [[ -z "$VSCODE_VERSION" ]]; then
      echo "[pack] unable to resolve VS Code extension version from package.json" >&2
      exit 1
    fi

    VSCODE_VSIX_OUT="$ARTIFACTS/vscode/KoSpellCheck.VSCode-${VSCODE_VERSION}.vsix"
    rm -f "$ARTIFACTS"/vscode/KoSpellCheck.VSCode-*.vsix "$ARTIFACTS"/vscode/kospellcheck-*.vsix "$ARTIFACTS"/vscode/KoSpellCheck.VSCode.vsix
    npx --no-install vsce package --allow-missing-repository --out "$VSCODE_VSIX_OUT"
    popd >/dev/null

    if command -v unzip >/dev/null 2>&1; then
      if ! unzip -Z1 "$VSCODE_VSIX_OUT" | grep -Fx "extension/package.json" >/dev/null; then
        echo "[pack] generated VS Code VSIX is invalid: extension/package.json missing" >&2
        exit 1
      fi

      required_runtime_files=(
        "extension/node_modules/nspell/lib/index.js"
        "extension/node_modules/is-buffer/index.js"
      )
      for runtime_file in "${required_runtime_files[@]}"; do
        if ! unzip -Z1 "$VSCODE_VSIX_OUT" | grep -Fx "$runtime_file" >/dev/null; then
          echo "[pack] generated VS Code VSIX is invalid: missing runtime file $runtime_file" >&2
          exit 1
        fi
      done
    fi

    VSCODE_VSIX_ALIAS="$ARTIFACTS/vscode/KoSpellCheck.VSCode.vsix"
    cp "$VSCODE_VSIX_OUT" "$VSCODE_VSIX_ALIAS"

    echo "[pack] vs2022 vsix"
    rm -rf "$VSIX_STAGE"
    mkdir -p "$VSIX_STAGE"

    cp "$ROOT/src/KoSpellCheck.VS2022/source.extension.vsixmanifest" "$VSIX_STAGE/extension.vsixmanifest"
    cp "$ROOT/src/KoSpellCheck.VS2022/[Content_Types].xml" "$VSIX_STAGE/[Content_Types].xml"

    VS2022_BIN="$ROOT/src/KoSpellCheck.VS2022/bin/Release/netstandard2.0"
    if [[ ! -d "$VS2022_BIN" ]]; then
      echo "[pack] expected build output missing: $VS2022_BIN" >&2
      exit 1
    fi

    cp "$VS2022_BIN"/*.dll "$VSIX_STAGE/"
    if compgen -G "$VS2022_BIN/*.pdb" > /dev/null; then
      cp "$VS2022_BIN"/*.pdb "$VSIX_STAGE/"
    fi

    mkdir -p "$VSIX_STAGE/Resources/Dictionaries" "$VSIX_STAGE/Resources/Licenses"
    cp -R "$ROOT/src/KoSpellCheck.VS2022/Resources/Dictionaries/." "$VSIX_STAGE/Resources/Dictionaries/"
    cp -R "$ROOT/src/KoSpellCheck.VS2022/Resources/Licenses/." "$VSIX_STAGE/Resources/Licenses/"

    rm -f "$VS2022_VSIX_OUT" "$LEGACY_VS2022_VSIX_OUT"
    pushd "$VSIX_STAGE" >/dev/null
    if command -v zip >/dev/null 2>&1; then
      zip -rq "$VS2022_VSIX_OUT" .
    else
      powershell -Command "Compress-Archive -Path * -DestinationPath \"${VS2022_VSIX_OUT}\" -Force"
    fi
    popd >/dev/null

    echo "[pack] completed"
    echo "[pack] VS Code:  $VSCODE_VSIX_ALIAS"
    echo "[pack] VS2022:   $VS2022_VSIX_OUT"
