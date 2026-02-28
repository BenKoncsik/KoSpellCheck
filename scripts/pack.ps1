#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path "$PSScriptRoot/..").Path
$Artifacts = Join-Path $Root 'artifacts'
$Vs2022VsixOut = Join-Path $Artifacts 'vsix/KoSpellCheck.VS2022.vsix'
$LegacyVs2022VsixOut = Join-Path $Artifacts 'vsix/KoSpellCheck.vsix'
$VsixStage = Join-Path $Artifacts 'vsix/staging'
$VsCodeExtDir = Join-Path $Root 'src/KoSpellCheck.VSCode'

function Test-RequiredAssets {
  $required = @(
    'tools/dictionaries/hu_HU/hu_HU.aff',
    'tools/dictionaries/hu_HU/hu_HU.dic',
    'tools/dictionaries/en_US/en_US.aff',
    'tools/dictionaries/en_US/en_US.dic',
    'tools/licenses/LICENSE_DICTIONARIES_HU.txt',
    'tools/licenses/LICENSE_DICTIONARIES_EN.txt',
    'tools/licenses/ATTRIBUTION_DICTIONARIES_EN_US.txt',
    'tools/licenses/LICENSE_DICTIONARIES_EN_WORDNET.txt',
    'tools/licenses/LICENSE_MPL_2_0.txt',
    'tools/licenses/LICENSE_LGPL_3_0.txt',
    'tools/licenses/ATTRIBUTION_HU_MAGYARISPELL.txt',
    'tools/licenses/LICENSE_HUNSPELL_ENGINE.txt'
  )

  $missing = @()
  foreach ($relative in $required) {
    if (-not (Test-Path (Join-Path $Root $relative))) {
      $missing += $relative
    }
  }

  return $missing
}

function Ensure-DictionaryAssets {
  $missing = Test-RequiredAssets
  if ($missing.Count -eq 0) {
    return
  }

  Write-Host '[pack] missing dictionary/license assets:'
  foreach ($item in $missing) {
    Write-Host "  - $item"
  }

  $fetchScript = Join-Path $Root 'tools/fetch-dictionaries.ps1'
  if (Test-Path $fetchScript) {
    Write-Host '[pack] running tools/fetch-dictionaries.ps1 to download missing assets'
    & $fetchScript
  }

  $missing = Test-RequiredAssets
  if ($missing.Count -eq 0) {
    return
  }

  throw "Dictionary assets are still missing. Run ./tools/fetch-dictionaries.ps1 (or ./tools/fetch-dictionaries.sh) and retry."
}

function Sync-ResourceTree {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Target
  )

  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  Get-ChildItem -Path $Target -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item -Path (Join-Path $Source '*') -Destination $Target -Recurse -Force
}

function Sync-PackResources {
  Sync-ResourceTree -Source (Join-Path $Root 'tools/dictionaries') -Target (Join-Path $Root 'src/KoSpellCheck.VSCode/resources/dictionaries')
  Sync-ResourceTree -Source (Join-Path $Root 'tools/licenses') -Target (Join-Path $Root 'src/KoSpellCheck.VSCode/resources/licenses')
  Sync-ResourceTree -Source (Join-Path $Root 'tools/dictionaries') -Target (Join-Path $Root 'src/KoSpellCheck.VS2022/Resources/Dictionaries')
  Sync-ResourceTree -Source (Join-Path $Root 'tools/licenses') -Target (Join-Path $Root 'src/KoSpellCheck.VS2022/Resources/Licenses')
}

Ensure-DictionaryAssets
Sync-PackResources

& (Join-Path $Root 'scripts/build.ps1')

New-Item -ItemType Directory -Force -Path (Join-Path $Artifacts 'vsix') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Artifacts 'vscode') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Artifacts 'nuget') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Artifacts 'logs') | Out-Null

Write-Host '[pack] dotnet nuget packs'
dotnet pack (Join-Path $Root 'src/KoSpellCheck.Core/KoSpellCheck.Core.csproj') -c Release -o (Join-Path $Artifacts 'nuget')
dotnet pack (Join-Path $Root 'src/KoSpellCheck.LanguagePack.HuEn/KoSpellCheck.LanguagePack.HuEn.csproj') -c Release -o (Join-Path $Artifacts 'nuget')

Write-Host '[pack] vscode vsix'
$VsCodePackage = Get-Content (Join-Path $VsCodeExtDir 'package.json') -Raw | ConvertFrom-Json
$VsCodeVersion = [string]$VsCodePackage.version
if ([string]::IsNullOrWhiteSpace($VsCodeVersion)) {
  throw 'Unable to resolve VS Code extension version from package.json.'
}

$VsCodeOut = Join-Path $Artifacts ("vscode/KoSpellCheck.VSCode-{0}.vsix" -f $VsCodeVersion)
Get-ChildItem -Path (Join-Path $Artifacts 'vscode/KoSpellCheck.VSCode-*.vsix') -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem -Path (Join-Path $Artifacts 'vscode/kospellcheck-*.vsix') -ErrorAction SilentlyContinue | Remove-Item -Force
Remove-Item -LiteralPath (Join-Path $Artifacts 'vscode/KoSpellCheck.VSCode.vsix') -ErrorAction SilentlyContinue

Push-Location $VsCodeExtDir
try {
  npm ci
  npm run build
  npx --no-install vsce package --allow-missing-repository --out $VsCodeOut
}
finally {
  Pop-Location
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($VsCodeOut)
try {
  $hasPackage = $zip.Entries | Where-Object { $_.FullName -eq 'extension/package.json' } | Select-Object -First 1
  if (-not $hasPackage) {
    throw 'Generated VS Code VSIX is invalid: extension/package.json missing.'
  }
}
finally {
  $zip.Dispose()
}

$VsCodeAlias = Join-Path $Artifacts 'vscode/KoSpellCheck.VSCode.vsix'
Copy-Item -LiteralPath $VsCodeOut -Destination $VsCodeAlias -Force

Write-Host '[pack] vs2022 vsix'
if (Test-Path $VsixStage) {
  Remove-Item -Recurse -Force $VsixStage
}
New-Item -ItemType Directory -Force -Path $VsixStage | Out-Null

Copy-Item -LiteralPath (Join-Path $Root 'src/KoSpellCheck.VS2022/source.extension.vsixmanifest') -Destination (Join-Path $VsixStage 'extension.vsixmanifest')
Copy-Item -LiteralPath (Join-Path $Root 'src/KoSpellCheck.VS2022/[Content_Types].xml') -Destination (Join-Path $VsixStage '[Content_Types].xml')

$VsBin = Join-Path $Root 'src/KoSpellCheck.VS2022/bin/Release/netstandard2.0'
if (-not (Test-Path $VsBin)) {
  throw "Expected build output missing: $VsBin"
}

Copy-Item (Join-Path $VsBin '*.dll') $VsixStage -Force
$Pdbs = Get-ChildItem (Join-Path $VsBin '*.pdb') -ErrorAction SilentlyContinue
if ($Pdbs) {
  Copy-Item $Pdbs.FullName $VsixStage -Force
}

New-Item -ItemType Directory -Force -Path (Join-Path $VsixStage 'Resources/Dictionaries') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $VsixStage 'Resources/Licenses') | Out-Null
Copy-Item (Join-Path $Root 'src/KoSpellCheck.VS2022/Resources/Dictionaries/*') (Join-Path $VsixStage 'Resources/Dictionaries') -Recurse -Force
Copy-Item (Join-Path $Root 'src/KoSpellCheck.VS2022/Resources/Licenses/*') (Join-Path $VsixStage 'Resources/Licenses') -Recurse -Force

if (Test-Path $Vs2022VsixOut) {
  Remove-Item -Force $Vs2022VsixOut
}
if (Test-Path $LegacyVs2022VsixOut) {
  Remove-Item -Force $LegacyVs2022VsixOut
}

Compress-Archive -Path (Join-Path $VsixStage '*') -DestinationPath $Vs2022VsixOut

Write-Host '[pack] completed'
Write-Host "[pack] VS Code:  $VsCodeAlias"
Write-Host "[pack] VS2022:   $Vs2022VsixOut"
