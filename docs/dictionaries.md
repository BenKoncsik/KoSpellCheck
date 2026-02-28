# Dictionaries

## Források

### HU (Hunspell / Magyar Ispell)

- Upstream dictionary repo: <https://github.com/LibreOffice/dictionaries>
- Átvett fájlok:
  - `hu_HU/hu_HU.aff`
  - `hu_HU/hu_HU.dic`
  - `hu_HU/README_hu_HU.txt` (attribúció + licenc információ)
- Magyarispell referencia: <https://github.com/laszlonemeth/magyarispell>
- Licenc alapok:
  - MPL 2.0 (LibreOffice/core `COPYING.MPL`)
  - LGPL 3.0+ (LibreOffice/core `COPYING.LGPL`)

### EN (Hunspell en_US)

- Upstream dictionary repo: <https://github.com/LibreOffice/dictionaries>
- Átvett fájlok:
  - `en/en_US.aff`
  - `en/en_US.dic`
  - `en/license.txt`
  - `en/README_en_US.txt`
  - `en/WordNet_license.txt`

### Hunspell engine wrapper attribution

- Upstream repo: <https://github.com/aarondandy/WeCantSpell.Hunspell>
- Átvett fájl:
  - `license.txt`

## Reproducibility

- A fixen rögzített refek/commitok és fájllista automatikusan generálódik ide:
  - `tools/dictionaries/SOURCES.md`
- Letöltés:
  - Linux/macOS: `./tools/fetch-dictionaries.sh`
  - Windows: `./tools/fetch-dictionaries.ps1`
- Opcionális ref override támogatott a fetch script paraméterekkel.

## Repo elhelyezés

- Dictionary runtime fájlok:
  - `tools/dictionaries/hu_HU/hu_HU.aff`
  - `tools/dictionaries/hu_HU/hu_HU.dic`
  - `tools/dictionaries/en_US/en_US.aff`
  - `tools/dictionaries/en_US/en_US.dic`
- Licencek és attribúciók:
  - `tools/licenses/LICENSE_DICTIONARIES_HU.txt`
  - `tools/licenses/LICENSE_DICTIONARIES_EN.txt`
  - `tools/licenses/ATTRIBUTION_DICTIONARIES_EN_US.txt`
  - `tools/licenses/LICENSE_DICTIONARIES_EN_WORDNET.txt`
  - `tools/licenses/LICENSE_MPL_2_0.txt`
  - `tools/licenses/LICENSE_LGPL_3_0.txt`
  - `tools/licenses/ATTRIBUTION_HU_MAGYARISPELL.txt`
  - `tools/licenses/LICENSE_HUNSPELL_ENGINE.txt`

## Pack folyamat

A `scripts/pack.sh` és `scripts/pack.ps1`:

- ellenőrzi a szükséges dictionary/license fájlok meglétét;
- hiány esetén automatikusan futtatja a `tools/fetch-dictionaries.*` scriptet;
- VS Code csomaghoz bemásolja a fájlokat:
  - `src/KoSpellCheck.VSCode/resources/dictionaries`
  - `src/KoSpellCheck.VSCode/resources/licenses`
- VS2022 VSIX csomaghoz bemásolja a fájlokat:
  - `src/KoSpellCheck.VS2022/Resources/Dictionaries`
  - `src/KoSpellCheck.VS2022/Resources/Licenses`
  - majd a VSIX-be `Resources/Dictionaries` és `Resources/Licenses` útvonalon kerülnek.
