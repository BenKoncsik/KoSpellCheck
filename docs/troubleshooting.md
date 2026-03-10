# Troubleshooting

## VS Code extension nem jelez hibát

- Ellenőrizd, hogy a `KoSpellCheck` extension aktiválódott-e.
- Nézd meg a `kospellcheck.enabled` vagy `kospellcheck.json` `enabled` értékét.
- Futtasd: `npm run build` a `src/KoSpellCheck.VSCode` mappában.

## VSIX csomag nem épül

- A VS Code csomag `vsce package` paranccsal készül.
- Windows + VS2022 esetén ellenőrizd, hogy telepítve van-e a szükséges workload.

## VS2022 telepítésnél: `Found setup instance ... not in launchable state` / `Cannot find setup engine instance`

Ez tipikusan nem VSIX tartalomhiba, hanem a cél Visual Studio instance telepítési állapot-problémája.

Jellemző naplórészlet:

- `Found setup instance <id> but not in launchable state`
- `Install Error : System.InvalidOperationException: Cannot find setup engine instance`

Lépések:

1. Zárd be teljesen a Visual Studio-t és a Visual Studio Installer-t.
2. Indítsd el a Visual Studio Installer-t, és a VS2022 instance-en futtasd az `Update` vagy `Repair` műveletet.
3. Reboot után indítsd el egyszer a VS2022-t normálisan, majd zárd be.
4. Ezután telepítsd újra a VSIX-et (`artifacts/vsix/KoSpellCheck.VS2022.vsix`).
5. Ha továbbra is fennáll, futtasd a VSIX telepítőt emelt jogosultsággal, és ellenőrizd, hogy maga a VS2022 instance "launchable" állapotban van-e az Installerben.

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
- VS Code Command Palette: `KoSpellCheck: Local Typo model kiválasztása` a telepített runtime modellek közül választ.
- Ha az auto letöltés kell: `kospellcheck.localTypoAcceleration.autoDownloadRuntime = true`.
- Letöltési állapot a Settingsben: `kospellcheck.localTypoAcceleration.runtimeDownloadStatus`.
- Elérhető modellek a Settingsben: `kospellcheck.localTypoAcceleration.availableModels`.
- Aktív modell: `kospellcheck.localTypoAcceleration.model` (`auto` vagy konkrét modell-ID).
- Kézi letöltés Settingsből: `kospellcheck.localTypoAcceleration.manualDownloadNow = true` (a bővítmény visszaállítja `false`-ra indítás után).
- Ellenőrizd az állapot parancsban a `TPU inferencia` sort:
  - `Aktív` csak akkor lesz, ha az adapter ezt jelenti (`--health` alapján).
  - ha az adapter vagy modell hiányzik, fallback `heuristic-local` backendre vált.
  - ha `delegate init failed`, akkor tipikusan nincs aktív Coral USB eszköz vagy a régi adapter build csak `delegateType=0`-t próbál. Friss runtime letöltés szükséges.
- Ugyanitt külön sorban látszik: `TFLite C runtime: loaded/not loaded/unknown`.
- Ugyanitt külön sorban látszik: `Model betölthető: igen/nem/ismeretlen`.
- Ugyanitt külön sorban látszik: `Model placeholder`.
  - normál esetben most már `nem`. Ha mégis `igen`, akkor egy régi placeholder modell maradt a runtime-ban.
- Ha `TFLite C runtime = loaded` és `Model betölthető = igen`, de `TPU inferencia = inaktív`, akkor a valódi int8 TFLite modell CPU fallback úton már használható.
- Ha a részletes logban `edge tpu compile pending` vagy `edgeTpuCompiled=no` látszik, akkor a modell valós és betölthető, de még nincs EdgeTPU compilerrel lefordítva, ezért a Coral hardverre nem offloadolható.
- Natív adapter health kézzel:
  - `Coral-tpu/MacOs/bin/coral-typo-classifier-native --health --model Coral-tpu/MacOs/Models/typo_classifier_edgetpu.tflite`
- TensorFlow Lite C runtime frissítése:
  - `./scripts/sync-tflite-c-runtime.sh`
- Saját modell építés:
  - `./scripts/coral-model.sh build --input ./mintaszoveg.txt --model-id sajat_modell_v1 --file-name sajat_modell --add-to-manifest`
  - ez valódi, kvantált int8 `.tflite` modellt készít; EdgeTPU használathoz opcionálisan külön `--compile-edgetpu` futtatás kell, ha a compiler elérhető.
