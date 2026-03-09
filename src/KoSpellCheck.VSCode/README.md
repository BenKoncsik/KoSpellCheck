# KoSpellCheck (VS Code)

Offline HU+EN spell checker extension with code-aware tokenization and quick fix suggestions.

## English
KoSpellCheck is an offline Hungarian + English spell checker for VS Code, designed for real coding workflows.
Instead of checking plain text only, it uses code-aware tokenization to understand source files better and reduce noisy false positives.

### Key Features
- Offline operation
No cloud dependency and no external API calls. Spell checking runs fully local.
- Hungarian + English dictionaries
Built for bilingual development teams and mixed-language projects.
- Code-aware tokenization
Splits identifiers and code tokens intelligently (for example: `camelCase`, `snake_case`, mixed symbols), so checks focus on meaningful words.
- Quick Fix suggestions
Detected misspellings can be corrected directly from VS Code's Quick Fix menu.
- Optional local typo acceleration layer
If a compatible local accelerator runtime + device is available, KoSpellCheck can use an extra local typo classifier gate. If unavailable, it silently falls back to the standard path.
- Developer-focused behavior
Better signal in comments, strings, docs, and naming-heavy codebases.

### Why KoSpellCheck?
Generic spell checkers often struggle in source code because variable names, technical terms, and mixed naming conventions generate too many irrelevant warnings.
KoSpellCheck is optimized for this environment: it keeps spell checking useful in real projects where Hungarian and English are used together.

Repository: https://github.com/BenKoncsik/KoSpellCheck

### Local Typo Acceleration settings (VS Code)

- `kospellcheck.localTypoAcceleration.mode = off | auto | on`
- `kospellcheck.localTypoAcceleration.model = auto | <modelId>`
- `kospellcheck.localTypoAcceleration.showDetectionPrompt = true | false`
- `kospellcheck.localTypoAcceleration.verboseLogging = false | true`
- `kospellcheck.localTypoAcceleration.autoDownloadRuntime = true | false`
- `kospellcheck.localTypoAcceleration.runtimeDownloadStatus` (információs, automatikusan frissül)
- `kospellcheck.localTypoAcceleration.availableModels` (információs, automatikusan frissül)
- `kospellcheck.localTypoAcceleration.manualDownloadNow = true | false` (kézi trigger)

Notes:
- Compatibility alias is also accepted: `koSpellCheck.localTypoAcceleration.*`
- Local-only: no source upload to cloud.
- No extra manual runtime install is required for baseline extension usage.
- If runtime/hardware is unavailable, KoSpellCheck keeps working with normal spell-check logic.
- Állapot ellenőrzés parancsból: `KoSpellCheck: Local Typo Accelerator állapot` (Command Palette).
- Manuális runtime letöltés parancsból: `KoSpellCheck: Local Typo Runtime letöltése`.
- Modell kiválasztás parancsból: `KoSpellCheck: Local Typo model kiválasztása`.
- A Settings oldalon a `runtimeDownloadStatus` mező mutatja, hol tart a letöltés.
- A Settings oldalon az `availableModels` mező mutatja a telepített runtime modelleket.
- A Settings oldalon a `manualDownloadNow=true` azonnal elindítja a letöltést, majd visszaáll `false`-ra.
- A macOS runtime csomag modelleket a `Coral-tpu/MacOs/Models` mappából kínál (`runtime-manifest.json -> models`).
- A runtime csomagnak tartalmaznia kell:
  - `bin/coral-typo-classifier` vagy `bin/coral-typo-classifier-native`
  - `lib/libtensorflowlite_c.dylib`
  - legalább egy modellfájlt a manifest `models` listájából (például `Models/typo_classifier_edgetpu.tflite`)
- Saját modell builder CLI:
  - `./scripts/coral-model.sh build --input <text.txt> --model-id <id> --add-to-manifest`
- TensorFlow Lite C runtime sync:
  - `./scripts/sync-tflite-c-runtime.sh`
- Runtime source path a repóban: `Coral-tpu/MacOs`, `Coral-tpu/Linux`, `Coral-tpu/Windows`.

### Project Convention CLI bridge settings (VS Code)

- `kospellcheck.projectConventions.coreCliPath` (optional)
  - Leave empty for automatic resolution from packaged CLI artifacts.
  - If needed, set it to an absolute path pointing to:
    - `KoSpellCheck.ProjectConventions.Cli.dll`, or
    - `KoSpellCheck.ProjectConventions.Cli.csproj`, or
    - a folder containing either of the above.

If dashboard logs show `project-conventions core-cli unavailable`, set `coreCliPath` explicitly to the CLI location.

## Magyar
A KoSpellCheck egy offline magyar + angol helyesiras-ellenorzo VS Code-hoz, amelyet kifejezetten fejlesztoi munkafolyamatokra terveztek.
Nem csak sima szoveget ellenoriz: kodtudatos tokenizalast hasznal, igy pontosabban kezeli a forraskod sajatossagait, es kevesebb teves talalatot ad.

### Fobb funkciok
- Offline mukodes
Nincs felhofuggoseg, nincs kulso API-hivas. Minden helyben tortenik.
- Magyar + angol szotar
Ketnyelvu fejlesztoi kornyezetre es vegyes nyelvu projektekre optimalizalva.
- Kodtudatos tokenizalas
Intelligensen bontja a kodtokeneket (pl. `camelCase`, `snake_case`, vegyes elnevezesek), igy a valodi szavakra fokuszal.
- Quick Fix javaslatok
Az elirasok kozvetlenul javithatok a VS Code Quick Fix menujebol.
- Fejlesztobarat mukodes
Kulonosen hasznos kommentekben, stringekben, dokumentacioban es nevkonvenciokban gazdag kodnal.

### Miert KoSpellCheck?
Az altalanos helyesiras-ellenorzok kodban gyakran tul sok irrelevans figyelmeztetest adnak.
A KoSpellCheck ezt kezeli: valoban hasznalhato helyesiras-ellenorzest ad ott, ahol a magyar es angol nyelv egyszerre jelenik meg a fejlesztes soran.

Repository: https://github.com/BenKoncsik/KoSpellCheck
