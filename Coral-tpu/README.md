# Coral TPU Runtime Layout

KoSpellCheck VS Code runtime downloader loads manifests from this repository path:

- `Coral-tpu/MacOs/runtime-manifest.json`
- `Coral-tpu/Linux/runtime-manifest.json`
- `Coral-tpu/Windows/runtime-manifest.json`

Each manifest should contain downloadable runtime files with optional SHA-256 checksums.

Example manifest:

```json
{
  "schemaVersion": 1,
  "platform": "darwin",
  "arch": "arm64",
  "runtimeVersion": "2026-03-07",
  "files": [
    {
      "path": "lib/libedgetpu.1.dylib",
      "url": "lib/libedgetpu.1.dylib",
      "sha256": "replace-with-real-sha256"
    }
  ]
}
```

Notes:
- `url` can be relative (resolved from the manifest URL) or absolute.
- Paths must be relative and must not include `..`.
- Until valid files are listed, KoSpellCheck will keep fallback mode active.

Current repo status:
- `MacOs` contains an arm64 runtime manifest with local binaries:
  - `lib/libedgetpu.1.dylib`
  - `lib/libusb-1.0.0.dylib`
- `Linux` and `Windows` are placeholders for now.

Important:
- This runtime package is optional and only used by the local typo acceleration capability.
- If runtime or compatible Coral hardware is not available, KoSpellCheck falls back automatically.
