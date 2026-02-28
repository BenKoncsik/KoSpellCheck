#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

param(
  [string]$LoDictRef = '589a31b2c7e8a592270012e111a51a80d0176f6e',
  [string]$LoCoreRef = '491a0a302adafb0c44a943e217c86d81dff73a22',
  [string]$MagyarispellRef = '1ecfd0b086fecb4d02b38148bceeb00b86dd3b6e',
  [string]$WeCantSpellRef = 'ab5709d95b2d23541984d22baa0ab2d1e783582f'
)

$Root = (Resolve-Path "$PSScriptRoot/..").Path
$DictionaryDir = Join-Path $Root 'tools/dictionaries'
$HuDir = Join-Path $DictionaryDir 'hu_HU'
$EnDir = Join-Path $DictionaryDir 'en_US'
$LicenseDir = Join-Path $Root 'tools/licenses'
$SourcesFile = Join-Path $DictionaryDir 'SOURCES.md'

New-Item -ItemType Directory -Force -Path $HuDir | Out-Null
New-Item -ItemType Directory -Force -Path $EnDir | Out-Null
New-Item -ItemType Directory -Force -Path $LicenseDir | Out-Null

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("kospell-dicts-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

function Download-File {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Target
  )

  $tempTarget = Join-Path $tmpDir ([System.IO.Path]::GetFileName($Target))
  Write-Host "[fetch] $Url"
  Invoke-WebRequest -Uri $Url -OutFile $tempTarget
  Copy-Item -Path $tempTarget -Destination $Target -Force
}

try {
  # Dictionaries
  Download-File "https://raw.githubusercontent.com/LibreOffice/dictionaries/$LoDictRef/hu_HU/hu_HU.aff" (Join-Path $HuDir 'hu_HU.aff')
  Download-File "https://raw.githubusercontent.com/LibreOffice/dictionaries/$LoDictRef/hu_HU/hu_HU.dic" (Join-Path $HuDir 'hu_HU.dic')
  Download-File "https://raw.githubusercontent.com/LibreOffice/dictionaries/$LoDictRef/en/en_US.aff" (Join-Path $EnDir 'en_US.aff')
  Download-File "https://raw.githubusercontent.com/LibreOffice/dictionaries/$LoDictRef/en/en_US.dic" (Join-Path $EnDir 'en_US.dic')

  # License and attribution files
  Download-File "https://raw.githubusercontent.com/LibreOffice/dictionaries/$LoDictRef/hu_HU/README_hu_HU.txt" (Join-Path $LicenseDir 'LICENSE_DICTIONARIES_HU.txt')
  Download-File "https://raw.githubusercontent.com/LibreOffice/dictionaries/$LoDictRef/en/license.txt" (Join-Path $LicenseDir 'LICENSE_DICTIONARIES_EN.txt')
  Download-File "https://raw.githubusercontent.com/LibreOffice/dictionaries/$LoDictRef/en/README_en_US.txt" (Join-Path $LicenseDir 'ATTRIBUTION_DICTIONARIES_EN_US.txt')
  Download-File "https://raw.githubusercontent.com/LibreOffice/dictionaries/$LoDictRef/en/WordNet_license.txt" (Join-Path $LicenseDir 'LICENSE_DICTIONARIES_EN_WORDNET.txt')

  Download-File "https://raw.githubusercontent.com/LibreOffice/core/$LoCoreRef/COPYING.MPL" (Join-Path $LicenseDir 'LICENSE_MPL_2_0.txt')
  Download-File "https://raw.githubusercontent.com/LibreOffice/core/$LoCoreRef/COPYING.LGPL" (Join-Path $LicenseDir 'LICENSE_LGPL_3_0.txt')

  Download-File "https://raw.githubusercontent.com/laszlonemeth/magyarispell/$MagyarispellRef/README" (Join-Path $LicenseDir 'ATTRIBUTION_HU_MAGYARISPELL.txt')
  Download-File "https://raw.githubusercontent.com/aarondandy/WeCantSpell.Hunspell/$WeCantSpellRef/license.txt" (Join-Path $LicenseDir 'LICENSE_HUNSPELL_ENGINE.txt')

  $generatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

  $content = @"
# KoSpellCheck Dictionary Sources

Generated: $generatedAt

## Hungarian dictionary (hu_HU)

- Upstream repo: https://github.com/LibreOffice/dictionaries
- Ref: $LoDictRef
- Files:
  - hu_HU/hu_HU.aff
  - hu_HU/hu_HU.dic
  - hu_HU/README_hu_HU.txt
- License notes:
  - MPL 2.0: https://github.com/LibreOffice/core (COPYING.MPL @ $LoCoreRef)
  - LGPL 3.0+: https://github.com/LibreOffice/core (COPYING.LGPL @ $LoCoreRef)
- Additional Hungarian attribution source:
  - https://github.com/laszlonemeth/magyarispell (README @ $MagyarispellRef)

## English dictionary (en_US)

- Upstream repo: https://github.com/LibreOffice/dictionaries
- Ref: $LoDictRef
- Files:
  - en/en_US.aff
  - en/en_US.dic
  - en/license.txt
  - en/README_en_US.txt
  - en/WordNet_license.txt

## Hunspell engine wrapper attribution

- Upstream repo: https://github.com/aarondandy/WeCantSpell.Hunspell
- Ref: $WeCantSpellRef
- File:
  - license.txt

## Copied-to paths in this repo

- tools/dictionaries/hu_HU/hu_HU.aff
- tools/dictionaries/hu_HU/hu_HU.dic
- tools/dictionaries/en_US/en_US.aff
- tools/dictionaries/en_US/en_US.dic
- tools/licenses/LICENSE_DICTIONARIES_HU.txt
- tools/licenses/LICENSE_DICTIONARIES_EN.txt
- tools/licenses/ATTRIBUTION_DICTIONARIES_EN_US.txt
- tools/licenses/LICENSE_DICTIONARIES_EN_WORDNET.txt
- tools/licenses/LICENSE_MPL_2_0.txt
- tools/licenses/LICENSE_LGPL_3_0.txt
- tools/licenses/ATTRIBUTION_HU_MAGYARISPELL.txt
- tools/licenses/LICENSE_HUNSPELL_ENGINE.txt
"@

  Set-Content -Path $SourcesFile -Value $content -Encoding utf8

  Write-Host "[fetch] dictionaries and license files updated."
  Write-Host "[fetch] source manifest: $SourcesFile"
}
finally {
  if (Test-Path $tmpDir) {
    Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
