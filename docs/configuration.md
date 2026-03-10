# Configuration

A konfiguráció két forrásból töltődik:

1. `.editorconfig`
2. `kospellcheck.json`

A JSON felülírja az `.editorconfig` értékeit.

## `.editorconfig` kulcsok

- `kospellcheck_enabled = true|false`
- `kospellcheck_languages = hu,en`
- `kospellcheck_allow_mixed_languages = true|false`
- `kospellcheck_treat_as_hungarian_when_ascii_only = true|false`
- `kospellcheck_ignore_words = Async,SignalR`
- `kospellcheck_project_dictionary = KoSpellCheck,MyDomainWord`
- `kospellcheck_ignore_patterns = ^https?://,^[0-9a-f]{8}-`
- `kospellcheck_min_token_length = 2`
- `kospellcheck_max_token_length = 64`
- `kospellcheck_ignore_all_caps_length_threshold = 4`
- `kospellcheck_suggestions_max = 5`
- `kospellcheck_prefer_terms = model:modell,endpoint:végpont`
- `kospellcheck_workspace_storage_path = /abs/path/to/storage`
- `kospellcheck_style_learning = true|false`
- `kospellcheck_style_learning_max_files = 2000`
- `kospellcheck_style_learning_max_tokens = 200000`
- `kospellcheck_style_learning_time_budget_ms = 2000`
- `kospellcheck_style_learning_file_extensions = cs,ts,js,tsx,jsx,json,md`
- `kospellcheck_style_learning_cache_path = .kospellcheck/style-profile.json`
- `kospellcheck_style_learning_min_token_length = 3`
- `kospellcheck_style_learning_ignore_folders = bin,obj,node_modules,.git,.vs,artifacts`
- `kospellcheck_local_typo_acceleration_mode = off|auto|on`
- `kospellcheck_local_typo_acceleration_model = auto|<modelId>`
- `kospellcheck_local_typo_acceleration_show_detection_prompt = true|false`
- `kospellcheck_local_typo_acceleration_verbose_logging = true|false`
- `kospellcheck_local_typo_acceleration_auto_download_runtime = true|false`

## `kospellcheck.json` séma (MVP)

```json
{
  "enabled": true,
  "languages": ["hu", "en"],
  "allowMixedLanguages": true,
  "preferTerms": {
    "model": "modell"
  },
  "workspaceStoragePath": "/abs/path/to/storage",
  "treatAsHungarianWhenAsciiOnly": true,
  "ignoreWords": ["Async", "SignalR", "STM32"],
  "projectDictionary": ["KoSpellCheck"],
  "ignorePatterns": [
    "^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$",
    "^https?://"
  ],
  "minTokenLength": 2,
  "maxTokenLength": 64,
  "ignoreAllCapsLengthThreshold": 4,
  "suggestionsMax": 5,
  "maxTokensPerDocument": 2000,
  "styleLearningEnabled": true,
  "styleLearningMaxFiles": 2000,
  "styleLearningMaxTokens": 200000,
  "styleLearningTimeBudgetMs": 2000,
  "styleLearningFileExtensions": ["cs", "ts", "js", "tsx", "jsx", "json", "md"],
  "styleLearningCachePath": ".kospellcheck/style-profile.json",
  "styleLearningMinTokenLength": 3,
  "styleLearningIgnoreFolders": ["bin", "obj", "node_modules", ".git", ".vs", "artifacts"],
  "localTypoAcceleration": {
    "mode": "auto",
    "model": "auto",
    "showDetectionPrompt": true,
    "verboseLogging": false,
    "autoDownloadRuntime": true
  }
}
```

## preferTerms példák

- Magyarosítás: `{ "model": "modell" }`
- Angolosítás: `{ "modell": "model" }`

## Hungarian ASCII policy

Ha `treatAsHungarianWhenAsciiOnly = true`, akkor a HU szótárra történik ASCII-fold ellenőrzés, így pl. `homerseklet` elfogadható a `hőmérséklet` alapján.

## Style Learning

- A projekt stílusprofil workspace rootonként épül (`ProjectStyleProfile`).
- A profil cache alapból: `.kospellcheck/style-profile.json`.
- Ha `workspaceStoragePath` meg van adva, a `.kospellcheck/*` relatív artifactok átkerülnek a megadott gyökér alá, projektenként külön (`<workspaceStoragePath>/project-<hash>/...`).
- A tanulás csak rangsorolást végez a javaslatokra, nem ad új szót a dictionaryhez.
- `preferTerms` mindig felülírja a tanult stílust.

## Local Typo Acceleration (optional)

- A gyorsító útvonal teljesen opcionális, alapértelmezetten safe fallback módban fut (`auto`).
- A klasszifikáció mindig lokális; nincs cloud feltöltés.
- `mode = off`: soha nem próbál gyorsítót.
- `mode = auto`: csak akkor használja, ha kompatibilis helyi runtime + eszköz elérhető.
- `mode = on`: a felhasználó explicit kéri; ha nem elérhető, non-blocking fallback történik.
- `model = auto|<modelId>`: kiválasztja a runtime manifestben elérhető modell-ID-t (vagy `auto` esetén a default modellt).
- `autoDownloadRuntime = true`: runtime hiány esetén megpróbálja letölteni a platformhoz tartozó csomagot a KoSpellCheck repo `Coral-tpu/<Platform>` mappájából.
- `runtimeDownloadStatus`: információs állapot mező (VS Code Settings), amely mutatja a letöltés aktuális fázisát/progress állapotát.
- `availableModels`: információs állapot mező (VS Code Settings), a telepített runtime alapján elérhető modellek listájával.
- `manualDownloadNow = true`: kézi letöltés trigger (VS Code Settings); a letöltés indítása után automatikusan `false`-ra áll vissza.
- Ha gyorsító nem elérhető (vagy később kiesik), KoSpellCheck automatikusan a meglévő nem-gyorsított spell-check útvonalra áll vissza.
- A runtime csomagnak tartalmaznia kell:
  - `bin/coral-typo-classifier` vagy `bin/coral-typo-classifier-native`
  - `lib/libtensorflowlite_c.dylib` (natív adapter tényleges TFLite C futáshoz)
  - legalább egy valódi kvantált int8 modellfájlt a `runtime-manifest.json` `models` listájából (például `Models/typo_classifier_edgetpu.tflite`)

### Saját modell készítés (CLI)

Példa:

```bash
./scripts/coral-model.sh build \
  --input ./samples/training.txt \
  --model-id typo_classifier_custom_v1 \
  --display-name \"Custom Typo Model v1\" \
  --file-name typo_classifier_custom \
  --preset balanced \
  --outdir Coral-tpu/MacOs/Models \
  --manifest Coral-tpu/MacOs/runtime-manifest.json \
  --add-to-manifest
```

Megjegyzés:
- A CLI profile-backed `.tflite` csomagot generál a KoSpellCheck runtime flow-hoz.
- Valódi EdgeTPU-compiled modellekhez külön (külső) tréning/compile pipeline szükséges.
