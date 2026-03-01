# KoSpellCheck

KoSpellCheck egy offline helyesírás-ellenőrző ökoszisztéma fejlesztői környezetekhez.

## Támogatott editorok

- Visual Studio 2022 (VSIX, C# analyzer + quick fix MVP)
- Visual Studio Code (TypeScript extension, diagnostics + code actions)

## Fő funkciók

- HU + EN párhuzamos ellenőrzés
- Code-aware tokenizálás: `camelCase`, `PascalCase`, `snake_case`, `kebab-case`, `dot.separated`
- Quick fix javaslatok
- `preferTerms` szabályok (pl. `model -> modell` vagy fordítva)
- Projekt-stílus tanulás (kapitalizáció/preferált alak) workspace szinten cache-elve
- Magyar ASCII-fold támogatás (pl. `homerseklet` elfogadása `hőmérséklet` alapú szótár mellett)
- Teljesen offline működés

## MVP scope megjegyzés

- VS2022 oldalon az MVP Roslyn analyzer + code fix alapú (C# identifier fókusz), amely squiggle + lightbulb javítást ad.
- A teljes Tools/Options UI panel a következő iterációban bővíthető.

## Repo szerkezet

- Core spell engine: `/src/KoSpellCheck.Core`
- HU+EN language pack: `/src/KoSpellCheck.LanguagePack.HuEn`
- VS2022 extension: `/src/KoSpellCheck.VS2022`
- VS Code extension: `/src/KoSpellCheck.VSCode`
- Build/test/pack script-ek: `/scripts`
- Szótárak és licencek: `/tools`

## Dictionaries / Attribution

- A HU + EN `.aff/.dic` fájlok automatikusan letölthetők:
  - Linux/macOS: `./tools/fetch-dictionaries.sh`
  - Windows: `./tools/fetch-dictionaries.ps1`
- Rögzített források és commitok: [tools/dictionaries/SOURCES.md](./tools/dictionaries/SOURCES.md)
- Szótárak:
  - `tools/dictionaries/hu_HU/hu_HU.aff`
  - `tools/dictionaries/hu_HU/hu_HU.dic`
  - `tools/dictionaries/en_US/en_US.aff`
  - `tools/dictionaries/en_US/en_US.dic`
- Licencek/attribúciók:
  - `tools/licenses/LICENSE_DICTIONARIES_HU.txt`
  - `tools/licenses/LICENSE_DICTIONARIES_EN.txt`
  - `tools/licenses/ATTRIBUTION_DICTIONARIES_EN_US.txt`
  - `tools/licenses/ATTRIBUTION_HU_MAGYARISPELL.txt`
  - `tools/licenses/LICENSE_MPL_2_0.txt`
  - `tools/licenses/LICENSE_LGPL_3_0.txt`

## Changelog

- 2026-02-28: Fix VS Code packaging: a VSIX most közvetlenül `vsce package`-gel készül, és garantáltan tartalmazza az `extension/package.json` fájlt.

## Fejlesztői build

### Linux / macOS

```bash
./scripts/build.sh
./scripts/test.sh
./scripts/pack.sh
```

### Windows (PowerShell 7)

```powershell
./scripts/build.ps1
./scripts/test.ps1
./scripts/pack.ps1
```

## VSIX telepítés

`./scripts/pack.sh` vagy `./scripts/pack.ps1` után két külön VSIX készül:

- VS Code: `artifacts/vscode/KoSpellCheck.VSCode.vsix`
- Visual Studio 2022: `artifacts/vsix/KoSpellCheck.VS2022.vsix`

VS Code-ban mindig a `artifacts/vscode/KoSpellCheck.VSCode.vsix` fájlt telepítsd (`Extensions: Install from VSIX...`).

## Konfiguráció példa

`.editorconfig`:

```ini
[*.{cs,ts,js,json,md}]
kospellcheck_enabled = true
kospellcheck_languages = hu,en
kospellcheck_allow_mixed_languages = true
kospellcheck_treat_as_hungarian_when_ascii_only = true
kospellcheck_ignore_words = Async,SignalR,STM32
kospellcheck_prefer_terms = model:modell
kospellcheck_style_learning = true
```

`kospellcheck.json`:

```json
{
  "enabled": true,
  "languages": ["hu", "en"],
  "allowMixedLanguages": true,
  "preferTerms": {
    "model": "modell"
  },
  "styleLearningEnabled": true,
  "ignoreWords": ["Async", "SignalR", "STM32"],
  "projectDictionary": ["KoSpellCheck"],
  "suggestionsMax": 5
}
```

Részletes leírás: [docs/configuration.md](./docs/configuration.md)
