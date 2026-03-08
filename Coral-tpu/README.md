# Coral TPU Runtime Layout

KoSpellCheck VS Code runtime downloader loads manifests from this repository path:

- `Coral-tpu/MacOs/runtime-manifest.json`
- `Coral-tpu/Linux/runtime-manifest.json`
- `Coral-tpu/Windows/runtime-manifest.json`

Each manifest should contain downloadable runtime files with optional SHA-256 checksums.
The manifest can also expose a model catalog (`models`) so VS Code can list selectable models.

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
  ],
  "models": [
    {
      "id": "typo_classifier_edgetpu_v1",
      "displayName": "Typo Classifier - Balanced v1",
      "path": "Models/typo_classifier_edgetpu.tflite",
      "format": "edgetpu-ready-int8",
      "default": true
    }
  ]
}
```

Notes:
- `url` can be relative (resolved from the manifest URL) or absolute.
- Paths must be relative and must not include `..`.
- Until valid files are listed, KoSpellCheck will keep fallback mode active.

Current repo status:
- `MacOs` contains an arm64 runtime manifest with local binaries and model catalog:
  - `lib/libedgetpu.1.dylib`
  - `lib/libusb-1.0.0.dylib`
  - `lib/libtensorflowlite_c.dylib`
  - `bin/coral-typo-classifier`
  - `bin/coral-typo-classifier-native`
  - `model/typo_classifier_edgetpu.tflite` (legacy compatibility path)
  - `Models/*` model files + sidecar metadata
- `Linux` and `Windows` are placeholders for now.

## Native macOS adapter skeleton

Native adapter source:
- `Coral-tpu/MacOs/native/coral_tpu_adapter.cc`

Build command (macOS):

```bash
./Coral-tpu/MacOs/native/build-native-adapter.sh
```

Output binary:
- `Coral-tpu/MacOs/bin/coral-typo-classifier-native`

If you rebuild the binary, update its SHA-256 in:
- `Coral-tpu/MacOs/runtime-manifest.json`

Health check:

```bash
Coral-tpu/MacOs/bin/coral-typo-classifier-native --health --model Coral-tpu/MacOs/Models/typo_classifier_edgetpu.tflite
```

## TensorFlow Lite C runtime packaging

Sync command (updates local runtime package + manifest checksum):

```bash
./scripts/sync-tflite-c-runtime.sh
```

Current default source:
- `https://github.com/tphakala/tflite_c/releases/download/v2.17.1/tflite_c_v2.17.1_darwin_arm64.tar.gz`

Attribution:
- `tools/licenses/ATTRIBUTION_TFLITE_C_PREBUILT.txt`

## Custom model builder CLI

CLI tool:
- `Coral-tpu/tools/koscoral-model-cli.mjs`

Wrapper scripts:
- `./scripts/coral-model.sh` (Linux/macOS)
- `./scripts/coral-model.ps1` (PowerShell)

Example (`txt` -> `.tflite` + `.meta.json` + manifest update):

```bash
./scripts/coral-model.sh build \
  --input ./samples/training.txt \
  --model-id typo_classifier_myteam_v1 \
  --display-name \"My Team Typo Model v1\" \
  --preset balanced \
  --outdir Coral-tpu/MacOs/Models \
  --manifest Coral-tpu/MacOs/runtime-manifest.json \
  --add-to-manifest
```

Important:
- The CLI now creates a real, quantized int8 TensorFlow Lite FlatBuffer model for this runtime flow.
- The produced model is EdgeTPU-friendly, but actual Coral offload still requires an additional EdgeTPU compiler step.

Important:
- This runtime package is optional and only used by the local typo acceleration capability.
- If runtime or compatible Coral hardware is not available, KoSpellCheck falls back automatically.
