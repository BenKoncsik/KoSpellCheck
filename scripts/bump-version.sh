#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSCODE_DIR="$ROOT/src/KoSpellCheck.VSCode"
VS2022_MANIFEST="$ROOT/src/KoSpellCheck.VS2022/source.extension.vsixmanifest"
BUILD_PROPS="$ROOT/Directory.Build.props"

usage() {
  cat >&2 <<'EOF'
Usage:
  ./scripts/bump-version.sh [patch|minor|major]
  ./scripts/bump-version.sh --set <x.y.z>
EOF
  exit 1
}

if [[ $# -gt 2 ]]; then
  usage
fi

MODE="patch"
TARGET_VERSION=""

if [[ "${1:-}" == "--set" ]]; then
  [[ $# -eq 2 ]] || usage
  MODE="set"
  TARGET_VERSION="$2"
elif [[ $# -eq 1 ]]; then
  MODE="$1"
fi

case "$MODE" in
  patch|minor|major|set) ;;
  *) usage ;;
esac

CURRENT_VERSION="$(
  cd "$VSCODE_DIR"
  node -p "require('./package.json').version"
)"

if ! [[ "$CURRENT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Current version is not valid semver (x.y.z): $CURRENT_VERSION" >&2
  exit 1
fi

if [[ "$MODE" == "set" ]]; then
  NEXT_VERSION="$TARGET_VERSION"
else
  NEXT_VERSION="$(
    node -e '
      const [current, bump] = process.argv.slice(1);
      const parts = current.split(".").map((v) => Number(v));
      if (parts.length !== 3 || parts.some((v) => Number.isNaN(v))) {
        process.exit(1);
      }

      let [major, minor, patch] = parts;
      if (bump === "major") {
        major += 1;
        minor = 0;
        patch = 0;
      } else if (bump === "minor") {
        minor += 1;
        patch = 0;
      } else {
        patch += 1;
      }

      process.stdout.write(`${major}.${minor}.${patch}`);
    ' "$CURRENT_VERSION" "$MODE"
  )"
fi

if ! [[ "$NEXT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Target version is not valid semver (x.y.z): $NEXT_VERSION" >&2
  exit 1
fi

(
  cd "$VSCODE_DIR"
  npm version "$NEXT_VERSION" --no-git-tag-version --allow-same-version >/dev/null
)

node - "$VS2022_MANIFEST" "$BUILD_PROPS" "$NEXT_VERSION" <<'NODE'
const fs = require("node:fs");

const manifestPath = process.argv[2];
const propsPath = process.argv[3];
const nextVersion = process.argv[4];

const manifestContent = fs.readFileSync(manifestPath, "utf8");
const updatedManifest = manifestContent.replace(
  /(<Identity\b[^>]*\bVersion=")([^"]+)(")/s,
  (_match, prefix, _current, suffix) => `${prefix}${nextVersion}${suffix}`,
);

if (updatedManifest === manifestContent) {
  console.error("Failed to update VS2022 manifest version.");
  process.exit(1);
}

fs.writeFileSync(manifestPath, updatedManifest);

const assemblyVersion = `${nextVersion}.0`;
let propsContent = fs.readFileSync(propsPath, "utf8");

const replacements = [
  ["Version", nextVersion],
  ["AssemblyVersion", assemblyVersion],
  ["FileVersion", assemblyVersion],
];

for (const [tag, value] of replacements) {
  const regex = new RegExp(`<${tag}>[^<]*</${tag}>`);
  if (!regex.test(propsContent)) {
    console.error(`Failed to locate <${tag}> in ${propsPath}`);
    process.exit(1);
  }
  propsContent = propsContent.replace(regex, `<${tag}>${value}</${tag}>`);
}

fs.writeFileSync(propsPath, propsContent);
NODE

if ! grep -q "Version=\"$NEXT_VERSION\"" "$VS2022_MANIFEST"; then
  echo "Failed to update VS2022 manifest version." >&2
  exit 1
fi

if ! grep -q "<Version>$NEXT_VERSION</Version>" "$BUILD_PROPS"; then
  echo "Failed to update Directory.Build.props version." >&2
  exit 1
fi

echo "[version] $CURRENT_VERSION -> $NEXT_VERSION" >&2
echo "$NEXT_VERSION"
