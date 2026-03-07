# Troubleshooting

## VS Code extension nem jelez hibát

- Ellenőrizd, hogy a `KoSpellCheck` extension aktiválódott-e.
- Nézd meg a `kospellcheck.enabled` vagy `kospellcheck.json` `enabled` értékét.
- Futtasd: `npm run build` a `src/KoSpellCheck.VSCode` mappában.

## VSIX csomag nem épül

- A VS Code csomag `vsce package` paranccsal készül.
- Windows + VS2022 esetén ellenőrizd, hogy telepítve van-e a szükséges workload.

## `Extract: extension/package.json not found inside zip`

Ez akkor történik, ha VS Code-ba nem a VS Code-os VSIX-et telepíted.

- VS Code-hoz ezt használd: `artifacts/vscode/KoSpellCheck.VSCode.vsix`
- A `artifacts/vsix/KoSpellCheck.VS2022.vsix` csak Visual Studio 2022-höz való.

## Debug logok bekapcsolása (VS Code)

1. Nyisd meg a Settings-et és keresd: `kospellcheck.debugLogging`
2. Kapcsold be.
3. `Developer: Reload Window`
4. `View -> Output`, majd a legördülőből válaszd: `KoSpellCheck`

## Magyar ékezet nélküli token nem fogadott el

- `treatAsHungarianWhenAsciiOnly` legyen `true`.
- Ellenőrizd, hogy a HU dictionary fájlok tényleg bekerültek-e a futási mappába.

## Lassú ellenőrzés

- Csökkentsd a `maxTokensPerDocument` értéket.
- Növeld a debounce időt (VS Code extensionben).

## Local typo acceleration nem aktiválódik

- Ez a funkció opcionális; a KoSpellCheck nélküle is teljesen működik.
- Ellenőrizd a `localTypoAcceleration.mode` értéket (`off|auto|on`).
- Ha `auto` vagy `on`, de a runtime/hardver nem elérhető, automatikus fallback történik.
- Nincs szükség külön Python/pip/Docker/CLI telepítésre; ha a szükséges helyi runtime nincs a buildben, a funkció biztonságosan kikapcsolva marad.
- VS Code alatt kapcsold be a `kospellcheck.localTypoAcceleration.verboseLogging` opciót a részletes detektálási logokhoz.
- VS Code Command Palette: `KoSpellCheck: Local Typo Accelerator állapot` parancs megmutatja az aktuális detektálási állapotot és engedi a `off/auto/on` váltást.
- VS Code Command Palette: `KoSpellCheck: Local Typo Runtime letöltése` kézzel indítja a GitHub-os runtime letöltést.
- Ha az auto letöltés kell: `kospellcheck.localTypoAcceleration.autoDownloadRuntime = true`.
