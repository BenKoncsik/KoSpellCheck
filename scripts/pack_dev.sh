#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACK_SCRIPT="$ROOT/scripts/pack.sh"

if [[ ! -x "$PACK_SCRIPT" ]]; then
  echo "[pack_dev] pack script not found or not executable: $PACK_SCRIPT" >&2
  exit 1
fi

PACKAGE_JSON="$ROOT/src/KoSpellCheck.VSCode/package.json"
PACKAGE_LOCK_JSON="$ROOT/src/KoSpellCheck.VSCode/package-lock.json"
BUILD_PROPS="$ROOT/Directory.Build.props"
VSIX_MANIFEST="$ROOT/src/KoSpellCheck.VS2022/source.extension.vsixmanifest"

TMP_DIR="$(mktemp -d)"
FILES_TO_RESTORE=(
  "$PACKAGE_JSON"
  "$PACKAGE_LOCK_JSON"
  "$BUILD_PROPS"
  "$VSIX_MANIFEST"
)

restore_files() {
  local status=$?
  for file in "${FILES_TO_RESTORE[@]}"; do
    local backup="$TMP_DIR/$(basename "$file").bak"
    if [[ -f "$backup" ]]; then
      cp "$backup" "$file"
    fi
  done
  rm -rf "$TMP_DIR"
  return $status
}
trap restore_files EXIT

for file in "${FILES_TO_RESTORE[@]}"; do
  cp "$file" "$TMP_DIR/$(basename "$file").bak"
done

BASE_VERSION="$(
  node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(p.version||''));" "$PACKAGE_JSON"
)"

if [[ ! "$BASE_VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "[pack_dev] unsupported base version in package.json: '$BASE_VERSION' (expected x.y.z)" >&2
  exit 1
fi

BASE_MAJOR="${BASH_REMATCH[1]}"
BASE_MINOR="${BASH_REMATCH[2]}"
DEV_PATCH="$((30000 + RANDOM % 30000))"
DEV_VERSION="${BASE_MAJOR}.${BASE_MINOR}.${DEV_PATCH}"
ASSEMBLY_VERSION="${DEV_VERSION}.0"

node - "$PACKAGE_JSON" "$PACKAGE_LOCK_JSON" "$BUILD_PROPS" "$VSIX_MANIFEST" "$DEV_VERSION" "$ASSEMBLY_VERSION" <<'NODE'
const fs = require('fs');

const [packageJsonPath, packageLockPath, buildPropsPath, vsixManifestPath, devVersion, assemblyVersion] = process.argv.slice(2);

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
packageJson.version = devVersion;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
packageLock.version = devVersion;
if (packageLock.packages && packageLock.packages['']) {
  packageLock.packages[''].version = devVersion;
}
fs.writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`, 'utf8');

let buildProps = fs.readFileSync(buildPropsPath, 'utf8');
buildProps = buildProps.replace(/(<Version>)([^<]+)(<\/Version>)/, `$1${devVersion}$3`);
buildProps = buildProps.replace(/(<AssemblyVersion>)([^<]+)(<\/AssemblyVersion>)/, `$1${assemblyVersion}$3`);
buildProps = buildProps.replace(/(<FileVersion>)([^<]+)(<\/FileVersion>)/, `$1${assemblyVersion}$3`);
fs.writeFileSync(buildPropsPath, buildProps, 'utf8');

let vsixManifest = fs.readFileSync(vsixManifestPath, 'utf8');
vsixManifest = vsixManifest.replace(/(<Identity\\b[^>]*\\bVersion=")([^"]+)(")/s, `$1${devVersion}$3`);
fs.writeFileSync(vsixManifestPath, vsixManifest, 'utf8');
NODE

echo "[pack_dev] dev version: $DEV_VERSION"
"$PACK_SCRIPT"
