# Architecture

## Monorepo layout

- `KoSpellCheck.Core`: közös spell engine (tokenizálás, normalizálás, cache, diagnosztika)
- `KoSpellCheck.LanguagePack.HuEn`: HU+EN modul, hunspell dictionary path és manifest
- `KoSpellCheck.VS2022`: VS2022 analyzer + code fix (MVP)
- `KoSpellCheck.VSCode`: VS Code diagnostics + quick fixes

## Core pipeline

1. Input szöveg tokenizálása code-aware szabályokkal.
2. Token normalizálás (lowercase, unicode normalize, opcionális ASCII-fold HU ellenőrzéshez).
3. Composite dictionary ellenőrzés (HU + EN + project dictionary + ignore list).
4. preferTerms szabályok ráillesztése.
5. Project style ranking (`ProjectStyleProfile` + `ProjectStyleRanker`) a javaslatok sorrendjére.
6. (Opcionális) local typo acceleration gate: typo-vs-not-typo klasszifikáció, kizárólag lokálisan.
7. Diagnostic lista + javaslatok visszaadása.

## Performance

- LRU cache token-szinten
- Dokumentumonként token limit
- Opcionális `changedLines` alapú inkrementális ellenőrzés
- VS Code oldalon debounced futás
- Style learning: workspace-root cache (`.kospellcheck/style-profile.json`), max file/token/time budget

## Style Learning réteg

- `ProjectStyleDetector` háttérben profilozza a workspace releváns fájljait.
- A profil kulcsa normalizált token (`lowercase + unicode normalize + ASCII-fold`), a variánsok eredeti alakban tárolódnak.
- `ProjectStyleRanker` csak a javaslatok sorrendjét módosítja (nem változtatja a dictionary elfogadási logikát).
- `preferTerms` override pontszáma magasabb, mint az automatikus stílus tanulás.

## Local Typo Acceleration réteg (optional)

- Absztrakciók: `ILocalTypoClassifier`, `IAcceleratorAvailabilityService`, `IAcceleratorNotificationService`.
- A gyorsító réteg csak kapuzásra használható (typo / not-typo / uncertain kategorizálás).
- A tényleges quick-fix javaslatok továbbra is a meglévő KoSpellCheck logikából jönnek.
- Detektálás izolált, best-effort és nem-fatal, stabil állapotokkal:
  - `Available`
  - `Unavailable`
  - `UnavailableMissingRuntime`
  - `UnavailableUnsupportedPlatform`
  - `Error`
- Ha gyorsító kiesik, automatikus fallback történik a normál spell-check útvonalra.

## Language modules

A `KoSpellCheck.LanguagePack.HuEn` csak egy nyelvi modul.
Új nyelvhez külön `KoSpellCheck.LanguagePack.Xy` projekt hozható létre ugyanilyen mintával.
