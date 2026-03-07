# KoSpellCheck VS2022 Extension

KoSpellCheck is a Hungarian language spell checker extension for Visual Studio 2022. It provides Hungarian spelling dictionaries and highlights misspelled words in your code comments and strings. This extension is part of the KoSpellCheck project and integrates with the Visual Studio IDE to offer real‑time spell checking and quick fixes.

For more information, visit the [KoSpellCheck repository](https://github.com/BenKoncsik/KoSpellCheck).

## Optional Local Typo Acceleration

KoSpellCheck VS2022 includes an optional local typo acceleration capability layer. It is:
- local-only (no cloud upload),
- safe-by-default (automatic fallback when unavailable),
- non-mandatory (normal spell-check path always remains active).

Configuration is workspace-based (`kospellcheck.json` / `.editorconfig`) via:
- `localTypoAcceleration.mode` (`off|auto|on`)
- `localTypoAcceleration.showDetectionPrompt`
- `localTypoAcceleration.verboseLogging`
