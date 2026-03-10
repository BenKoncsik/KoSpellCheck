#!/usr/bin/env bash
set -euo pipefail

# Provide a fallback implementation for the `ditto` command if it is not available.
# Historical versions of this script relied on `ditto` (a macOS utility) to create ZIP
# archives. On platforms where `ditto` does not exist (such as Windows runners),
# calling it would result in a `command not found` error. To avoid such failures
# in older workflows that still reference `ditto`, we define a function named
# `ditto` that mimics the archiving behavior using other available tools. The
# function accepts the same parameters as the original command and produces a
# ZIP archive of the given source directory at the specified destination.
if ! command -v ditto >/dev/null 2>&1; then
  ditto() {
    # Emulate: ditto -c -k --sequesterRsrc --keepParent <source> <destination>
    local args=("$@");
    local count=${#args[@]}
    local dest="${args[$((count - 1))]}"
    local src="${args[$((count - 2))]}"
    # Ensure source directory exists.
    if [[ ! -d "$src" ]]; then
      echo "[pack] error: source directory '$src' not found for ditto replacement." >&2
      return 1
    fi
    # Remove existing destination file if it exists.
    rm -f "$dest"
    # Prefer `zip` if available.
    if command -v zip >/dev/null 2>&1; then
      (cd "$src" && zip -rq "$dest" .)
    # Fallback to 7-Zip if installed.
    elif command -v 7z >/dev/null 2>&1; then
      (cd "$src" && 7z a -tzip "$dest" . >/dev/null)
    # Use PowerShell's Compress-Archive as a last resort on Windows.
    elif command -v powershell >/dev/null 2>&1; then
      (cd "$src" && powershell -Command "Compress-Archive -Path * -DestinationPath \"${dest}\" -Force")
    else
      echo "[pack] error: no archive utility available to replace 'ditto'." >&2
      return 1
    fi
  }
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS="$ROOT/artifacts"
VS2022_VSIX_OUT="$ARTIFACTS/vsix/KoSpellCheck.VS2022.vsix"
LEGACY_VS2022_VSIX_OUT="$ARTIFACTS/vsix/KoSpellCheck.vsix"
VSIX_STAGE="$ARTIFACTS/vsix/staging"
VSCODE_EXT_DIR="$ROOT/src/KoSpellCheck.VSCode"
VS2022_PROJECT="$ROOT/src/KoSpellCheck.VS2022/KoSpellCheck.VS2022.csproj"
REPO_VERSION="$(
  sed -n 's:.*<Version>\([^<]*\)</Version>.*:\1:p' "$ROOT/Directory.Build.props" \
    | head -n 1 \
    | tr -d '\r'
)"
if [[ -z "$REPO_VERSION" ]]; then
  echo "[pack] unable to resolve repository version from Directory.Build.props" >&2
  exit 1
fi
VS2022_VSIX_VERSIONED_OUT="$ARTIFACTS/vsix/KoSpellCheck.VS2022-${REPO_VERSION}.vsix"

resolve_vs2022_target_framework() {
  if [[ ! -f "$VS2022_PROJECT" ]]; then
    echo "[pack] VS2022 project file not found: $VS2022_PROJECT" >&2
    exit 1
  fi

  local tfm
  tfm="$(
    sed -n 's:.*<TargetFramework>\([^<]*\)</TargetFramework>.*:\1:p' "$VS2022_PROJECT" \
      | head -n 1 \
      | tr -d '\r'
  )"
  if [[ -z "$tfm" ]]; then
    local tfms
    tfms="$(
      sed -n 's:.*<TargetFrameworks>\([^<]*\)</TargetFrameworks>.*:\1:p' "$VS2022_PROJECT" \
        | head -n 1 \
        | tr -d '\r'
    )"
    tfm="${tfms%%;*}"
  fi

  if [[ -z "$tfm" ]]; then
    echo "[pack] unable to resolve VS2022 target framework from $VS2022_PROJECT" >&2
    exit 1
  fi

  echo "$tfm"
}

VS2022_TFM="$(resolve_vs2022_target_framework)"
VS2022_INTERMEDIATE_PATH="obj/Release/${VS2022_TFM}/"
VS2022_OUTDIR_PATH="bin/Release/${VS2022_TFM}/"

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

ensure_vs2022_pkgdef_fallback() {
  local pkgdef_path="$1"

  if [[ -f "$pkgdef_path" ]]; then
    return 0
  fi

  local pkgdef_dir
  pkgdef_dir="$(dirname "$pkgdef_path")"
  mkdir -p "$pkgdef_dir"

  cat > "$pkgdef_path" <<'EOF'
; Fallback-generated pkgdef for non-Windows packaging.
[$RootKey$\Packages\{b3ec2daa-5989-46cf-9eaa-74b50e38b4c6}]
@="KoSpellCheck"
"InprocServer32"="$WinDir$\\System32\\mscoree.dll"
"Class"="KoSpellCheck.VS2022.Dashboard.KoSpellCheckDashboardPackage"
"CodeBase"="$PackageFolder$\\KoSpellCheck.VS2022.dll"
"ID"=dword:00000001
"MinEdition"="Pro"
"AllowsBackgroundLoading"=dword:00000001
"ProductName"="KoSpellCheck (VS2022)"

[$RootKey$\Menus]
"{b3ec2daa-5989-46cf-9eaa-74b50e38b4c6}"=", 1000, 1"

[$RootKey$\ToolWindows\{8c0dde8b-af41-4ae1-80f4-b94f0e42d4a5}]
@="KoSpellCheck Dashboard"
"Package"="{b3ec2daa-5989-46cf-9eaa-74b50e38b4c6}"
EOF

  if [[ -f "$pkgdef_path" ]]; then
    echo "[pack] warning: generated fallback pkgdef for non-Windows packaging: $pkgdef_path" >&2
    return 0
  fi

  return 1
}

package_vs2022_manual_zip() {
  echo "[pack] non-Windows fallback packaging in use (manual ZIP)."
  echo "[pack] warning: this VSIX was created with fallback packaging and may miss VSIX v3 marker files."
  echo "[pack] warning: non-Windows fallback builds do not compile VSCT command tables, so VS2022 dashboard/settings menu commands can be unavailable."
  rm -rf "$VSIX_STAGE"
  mkdir -p "$VSIX_STAGE"
  cp "$ROOT/src/KoSpellCheck.VS2022/source.extension.vsixmanifest" "$VSIX_STAGE/extension.vsixmanifest"
  cp "$ROOT/src/KoSpellCheck.VS2022/[Content_Types].xml" "$VSIX_STAGE/[Content_Types].xml"
  VS2022_BIN="$ROOT/src/KoSpellCheck.VS2022/bin/Release/${VS2022_TFM}"
  if [[ ! -d "$VS2022_BIN" ]]; then
    echo "[pack] expected build output missing: $VS2022_BIN" >&2
    return 1
  fi
  cp "$VS2022_BIN"/*.dll "$VSIX_STAGE/"
  if compgen -G "$VS2022_BIN/*.pdb" > /dev/null; then
    cp "$VS2022_BIN"/*.pdb "$VSIX_STAGE/"
  fi
  mkdir -p "$VSIX_STAGE/Resources/Dictionaries" "$VSIX_STAGE/Resources/Licenses"
  cp -R "$ROOT/src/KoSpellCheck.VS2022/Resources/Dictionaries/." "$VSIX_STAGE/Resources/Dictionaries/"
  cp -R "$ROOT/src/KoSpellCheck.VS2022/Resources/Licenses/." "$VSIX_STAGE/Resources/Licenses/"
  pushd "$VSIX_STAGE" >/dev/null
  # Use zip first; fallback to 7z or PowerShell to create the VSIX archive.
  if command -v zip >/dev/null 2>&1; then
    zip -rq "$VS2022_VSIX_OUT" .
  elif command -v 7z >/dev/null 2>&1; then
    7z a -tzip "$VS2022_VSIX_OUT" . >/dev/null
  elif command -v powershell >/dev/null 2>&1; then
    powershell -Command "Compress-Archive -Path * -DestinationPath \"${VS2022_VSIX_OUT}\" -Force"
  else
    # As a last resort, try the fallback `ditto` implementation defined above.
    ditto -c -k --sequesterRsrc --keepParent . "$VS2022_VSIX_OUT"
  fi
  popd >/dev/null
}

fail_or_manual_vs2022_fallback() {
  local reason="$1"
  local allow_unsafe_raw="${PACK_ALLOW_UNSAFE_VS2022_MANUAL_ZIP:-auto}"
  local allow_unsafe
  allow_unsafe="$(printf '%s' "$allow_unsafe_raw" | tr '[:upper:]' '[:lower:]')"

  case "$allow_unsafe" in
    true|1|yes|on)
      echo "[pack] warning: $reason" >&2
      echo "[pack] warning: PACK_ALLOW_UNSAFE_VS2022_MANUAL_ZIP=true, continuing with local-only fallback packaging." >&2
      package_vs2022_manual_zip
      return 0
      ;;
    false|0|no|off)
      echo "[pack] error: $reason" >&2
      echo "[pack] error: PACK_ALLOW_UNSAFE_VS2022_MANUAL_ZIP=false, refusing local-only fallback packaging." >&2
      return 1
      ;;
    auto|"")
      echo "[pack] error: $reason" >&2
      echo "[pack] error: refusing non-Windows fallback packaging by default because VS2022 menu commands can be missing." >&2
      echo "[pack] error: set PACK_ALLOW_UNSAFE_VS2022_MANUAL_ZIP=true to force local-only fallback packaging." >&2
      return 1
      ;;
    *)
      echo "[pack] error: invalid PACK_ALLOW_UNSAFE_VS2022_MANUAL_ZIP value '$allow_unsafe_raw' (expected true/false/auto)." >&2
      return 1
      ;;
  esac
}

validate_vsix_content_types() {
  local vsix_path="$1"

  if [[ ! -f "$vsix_path" ]]; then
    echo "[pack] generated VS2022 VSIX is missing: $vsix_path" >&2
    return 1
  fi

  if ! command -v unzip >/dev/null 2>&1; then
    echo "[pack] warning: unzip not found, skipping VS2022 VSIX content-type validation."
    return 0
  fi

  local file_extensions content_type_extensions missing_extensions

  file_extensions="$(
    unzip -Z1 "$vsix_path" \
      | awk '!/\/$/ && $0 != "[Content_Types].xml" { print }' \
      | sed -n 's|.*\.\([A-Za-z0-9_+-]*\)$|\1|p' \
      | tr '[:upper:]' '[:lower:]' \
      | sort -u
  )"

  content_type_extensions="$(
    {
      unzip -p "$vsix_path" "[[]Content_Types].xml" 2>/dev/null \
        | grep -o 'Extension="[^"]\+"' \
        | sed 's/Extension="//; s/"$//' || true

      unzip -p "$vsix_path" "[[]Content_Types].xml" 2>/dev/null \
        | grep -o 'PartName="[^"]\+"' \
        | sed 's/PartName="//; s/"$//' \
        | sed -n 's|.*/[^/]*\.\([A-Za-z0-9_+-]*\)$|\1|p' || true
    } \
      | tr '[:upper:]' '[:lower:]' \
      | sort -u
  )"

  missing_extensions="$(
    comm -23 \
      <(printf "%s\n" "$file_extensions") \
      <(printf "%s\n" "$content_type_extensions") \
      | sed '/^$/d'
  )"

  if [[ -n "$missing_extensions" ]]; then
    echo "[pack] generated VS2022 VSIX is invalid: missing [Content_Types].xml mappings for extensions:" >&2
    while IFS= read -r extension; do
      echo "  - .$extension" >&2
    done <<< "$missing_extensions"
    return 1
  fi
}

validate_vsix_marketplace_markers() {
  local vsix_path="$1"
  local strict_mode="${2:-false}"

  if [[ ! -f "$vsix_path" ]]; then
    echo "[pack] generated VS2022 VSIX is missing: $vsix_path" >&2
    return 1
  fi

  if ! command -v unzip >/dev/null 2>&1; then
    echo "[pack] warning: unzip not found, skipping VS2022 VSIX marker validation."
    return 0
  fi

  local missing=()
  local required_entries=(
    "manifest.json"
    "catalog.json"
  )

  local entry
  for entry in "${required_entries[@]}"; do
    if ! unzip -Z1 "$vsix_path" | grep -Fx "$entry" >/dev/null; then
      missing+=("$entry")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    if [[ "$strict_mode" == "true" ]]; then
      echo "[pack] generated VS2022 VSIX is invalid for Visual Studio Marketplace: missing VSIX v3 marker files:" >&2
      for entry in "${missing[@]}"; do
        echo "  - $entry" >&2
      done
      return 1
    fi

    echo "[pack] warning: generated VS2022 VSIX is missing VSIX v3 marker files (${missing[*]})." >&2
    echo "[pack] warning: Visual Studio Marketplace upload compatibility may vary with current validation rules." >&2
  fi
}

ensure_dictionary_assets
sync_pack_resources

"$ROOT/scripts/build.sh"

mkdir -p "$ARTIFACTS/vsix" "$ARTIFACTS/vscode" "$ARTIFACTS/nuget" "$ARTIFACTS/logs"

echo "[pack] dotnet nuget packs"
dotnet pack "$ROOT/src/KoSpellCheck.Core/KoSpellCheck.Core.csproj" -c Release --no-build -o "$ARTIFACTS/nuget"
dotnet pack "$ROOT/src/KoSpellCheck.LanguagePack.HuEn/KoSpellCheck.LanguagePack.HuEn.csproj" -c Release --no-build -o "$ARTIFACTS/nuget"

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

VS2022_PACKED="false"
set +e
(
  set -euo pipefail
  echo "[pack] vs2022 vsix"
  rm -f "$VS2022_VSIX_OUT" "$LEGACY_VS2022_VSIX_OUT" "$ARTIFACTS"/vsix/KoSpellCheck.VS2022-*.vsix
  VSIX_MARKER_STRICT="false"

  if [[ "${OS:-}" == "Windows_NT" ]]; then
    echo "[pack] using VSSDK CreateVsixContainer (Marketplace-compatible VSIX v3)"
    VS2022_DLL_PATH="src/KoSpellCheck.VS2022/bin/Release/${VS2022_TFM}/KoSpellCheck.VS2022.dll"
    PKGDEF_PATH="src/KoSpellCheck.VS2022/obj/Release/${VS2022_TFM}/KoSpellCheck.VS2022.pkgdef"

    dotnet msbuild "$VS2022_PROJECT" \
      -t:Build \
      -p:Configuration=Release \
      -p:IntermediateOutputPath="$VS2022_INTERMEDIATE_PATH" \
      -p:OutDir="$VS2022_OUTDIR_PATH"

    if [[ ! -f "$ROOT/$VS2022_DLL_PATH" ]]; then
      echo "[pack] expected VS2022 assembly not found after Build: $VS2022_DLL_PATH" >&2
      exit 1
    fi

    dotnet msbuild "$VS2022_PROJECT" \
      -t:GeneratePkgDef \
      -p:Configuration=Release \
      -p:IntermediateOutputPath="$VS2022_INTERMEDIATE_PATH" \
      -p:OutDir="$VS2022_OUTDIR_PATH" \
      -p:CreatePkgDefAssemblyToProcess="${VS2022_OUTDIR_PATH}KoSpellCheck.VS2022.dll"

    if [[ ! -f "$ROOT/$PKGDEF_PATH" ]]; then
      echo "[pack] expected VS2022 pkgdef not found after GeneratePkgDef: $PKGDEF_PATH" >&2
      exit 1
    fi

    dotnet msbuild "$VS2022_PROJECT" \
      -t:CreateVsixContainer \
      -p:Configuration=Release \
      -p:IntermediateOutputPath="$VS2022_INTERMEDIATE_PATH" \
      -p:OutDir="$VS2022_OUTDIR_PATH" \
      -p:TemplateOutputDirectory="$VS2022_INTERMEDIATE_PATH" \
      -p:TargetVsixContainerName="KoSpellCheck.VS2022.vsix"

    mapfile -d '' VSIX_CANDIDATES < <(find "$ROOT/src/KoSpellCheck.VS2022/bin/Release" -type f -name "KoSpellCheck.VS2022.vsix" -print0)
    if [[ ${#VSIX_CANDIDATES[@]} -eq 0 ]]; then
      echo "[pack] expected VSSDK-generated VSIX not found under src/KoSpellCheck.VS2022/bin/Release" >&2
      exit 1
    fi
    GENERATED_VSIX="$(ls -1t "${VSIX_CANDIDATES[@]}" | head -n 1)"
    if [[ -z "$GENERATED_VSIX" || ! -f "$GENERATED_VSIX" ]]; then
      echo "[pack] expected VSSDK-generated VSIX not found under src/KoSpellCheck.VS2022/bin/Release" >&2
      exit 1
    fi
    cp "$GENERATED_VSIX" "$VS2022_VSIX_OUT"
    VSIX_MARKER_STRICT="true"
  else
    VSIXUTIL="$HOME/.nuget/packages/microsoft.vssdk.buildtools/17.14.2120/tools/vssdk/bin/VsixUtil.exe"
    VSSDK_SCHEMAS="$HOME/.nuget/packages/microsoft.vssdk.buildtools/17.14.2120/tools/vssdk/schemas"

    if command -v mono >/dev/null 2>&1 && [[ -f "$VSIXUTIL" ]] && [[ -d "$VSSDK_SCHEMAS" ]]; then
      echo "[pack] using Mono + VSSDK VsixUtil packaging (Marketplace-compatible VSIX v3)"

      dotnet msbuild "$VS2022_PROJECT" \
        -t:Build \
        -p:Configuration=Release \
        -p:IntermediateOutputPath="$VS2022_INTERMEDIATE_PATH" \
        -p:OutDir="$VS2022_OUTDIR_PATH"

      dotnet msbuild "$VS2022_PROJECT" \
        -t:GenerateFileManifest \
        -p:Configuration=Release \
        -p:IntermediateOutputPath="$VS2022_INTERMEDIATE_PATH" \
        -p:OutDir="$VS2022_OUTDIR_PATH"

      SOURCE_MANIFEST="src/KoSpellCheck.VS2022/obj/Release/${VS2022_TFM}/extension.vsixmanifest"
      FILES_JSON="src/KoSpellCheck.VS2022/obj/Release/${VS2022_TFM}/files.json"
      PKGDEF_PATH="src/KoSpellCheck.VS2022/obj/Release/${VS2022_TFM}/KoSpellCheck.VS2022.pkgdef"
      PKGDEF_FULL_PATH="$ROOT/$PKGDEF_PATH"

      if [[ ! -f "$PKGDEF_FULL_PATH" ]]; then
        ensure_vs2022_pkgdef_fallback "$PKGDEF_FULL_PATH" || true
      fi

      if [[ ! -f "$ROOT/$SOURCE_MANIFEST" || ! -f "$ROOT/$FILES_JSON" || ! -f "$PKGDEF_FULL_PATH" ]]; then
        echo "[pack] warning: required VSSDK manifest inputs are missing for ${VS2022_TFM}." >&2
        echo "[pack] warning: sourceManifest='$SOURCE_MANIFEST' exists=$([[ -f "$ROOT/$SOURCE_MANIFEST" ]] && echo true || echo false)" >&2
        echo "[pack] warning: filesJson='$FILES_JSON' exists=$([[ -f "$ROOT/$FILES_JSON" ]] && echo true || echo false)" >&2
        echo "[pack] warning: pkgdef='$PKGDEF_PATH' exists=$([[ -f "$PKGDEF_FULL_PATH" ]] && echo true || echo false)" >&2
        fail_or_manual_vs2022_fallback "cannot build marketplace-compatible VS2022 VSIX on non-Windows because required VSSDK inputs are missing."
      else
        ln -sfn "$VSSDK_SCHEMAS" "$ROOT/.tmp-vssdk-schemas"

        pushd "$ROOT" >/dev/null
        set +e
        mono "$VSIXUTIL" package \
          -sourceManifest "$SOURCE_MANIFEST" \
          -files "$FILES_JSON" \
          -outputPath artifacts/vsix/KoSpellCheck.VS2022.vsix \
          -is64BitBuild \
          -vsixSchemaPath .tmp-vssdk-schemas
        VSIXUTIL_STATUS=$?
        set -e
        popd >/dev/null
        rm -f "$ROOT/.tmp-vssdk-schemas"

        if [[ "$VSIXUTIL_STATUS" -ne 0 ]]; then
          fail_or_manual_vs2022_fallback "VsixUtil packaging failed (status=$VSIXUTIL_STATUS)."
        else
          VSIX_MARKER_STRICT="true"
        fi
      fi
    else
      fail_or_manual_vs2022_fallback "mono + Microsoft.VSSDK.BuildTools not found; marketplace-compatible VSIX v3 packaging is unavailable."
    fi
  fi

  validate_vsix_content_types "$VS2022_VSIX_OUT"
  validate_vsix_marketplace_markers "$VS2022_VSIX_OUT" "$VSIX_MARKER_STRICT"
  cp "$VS2022_VSIX_OUT" "$VS2022_VSIX_VERSIONED_OUT"
)
VS2022_PACK_STATUS=$?
set -e

if [[ "$VS2022_PACK_STATUS" -eq 0 ]]; then
  VS2022_PACKED="true"
elif [[ "${PACK_ALLOW_VS2022_FAILURE:-false}" == "true" ]]; then
  echo "[pack] warning: VS2022 VSIX packaging failed, but continuing because PACK_ALLOW_VS2022_FAILURE=true." >&2
  rm -f "$VS2022_VSIX_OUT" "$VS2022_VSIX_VERSIONED_OUT"
else
  echo "[pack] VS2022 VSIX packaging failed." >&2
  exit 1
fi

echo "[pack] completed"
echo "[pack] VS Code:  $VSCODE_VSIX_ALIAS"
if [[ "$VS2022_PACKED" == "true" ]]; then
  echo "[pack] VS2022:   $VS2022_VSIX_OUT"
  echo "[pack] VS2022 versioned: $VS2022_VSIX_VERSIONED_OUT"
else
  echo "[pack] VS2022:   skipped"
fi
