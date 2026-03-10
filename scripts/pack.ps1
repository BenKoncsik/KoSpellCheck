#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path "$PSScriptRoot/..").Path
$Artifacts = Join-Path $Root 'artifacts'
$Vs2022VsixOut = Join-Path $Artifacts 'vsix/KoSpellCheck.VS2022.vsix'
$LegacyVs2022VsixOut = Join-Path $Artifacts 'vsix/KoSpellCheck.vsix'
$VsixStage = Join-Path $Artifacts 'vsix/staging'
$VsCodeExtDir = Join-Path $Root 'src/KoSpellCheck.VSCode'
$Vs2022Project = Join-Path $Root 'src/KoSpellCheck.VS2022/KoSpellCheck.VS2022.csproj'

function Resolve-VS2022TargetFramework {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectPath
  )

  [xml]$projectXml = Get-Content -LiteralPath $ProjectPath
  $propertyGroups = @($projectXml.Project.PropertyGroup)

  foreach ($group in $propertyGroups) {
    $targetFramework = [string]$group.TargetFramework
    if (-not [string]::IsNullOrWhiteSpace($targetFramework)) {
      return $targetFramework.Trim()
    }
  }

  foreach ($group in $propertyGroups) {
    $targetFrameworks = [string]$group.TargetFrameworks
    if (-not [string]::IsNullOrWhiteSpace($targetFrameworks)) {
      return (($targetFrameworks -split ';')[0]).Trim()
    }
  }

  throw "Unable to resolve VS2022 target framework from '$ProjectPath'."
}

$Vs2022TargetFramework = Resolve-VS2022TargetFramework -ProjectPath $Vs2022Project
$Vs2022IntermediatePath = "obj/Release/$Vs2022TargetFramework/"
$Vs2022OutDirPath = "bin/Release/$Vs2022TargetFramework/"

[xml]$propsXml = Get-Content (Join-Path $Root 'Directory.Build.props')
$versionNodes = @($propsXml.Project.PropertyGroup | Where-Object { $_.Version } | ForEach-Object { [string]$_.Version })
$RepoVersion = $versionNodes | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($RepoVersion)) {
  throw 'Unable to resolve repository version from Directory.Build.props.'
}
$Vs2022VersionedVsixOut = Join-Path $Artifacts ("vsix/KoSpellCheck.VS2022-{0}.vsix" -f $RepoVersion)

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

function Test-VsixContentTypes {
  param(
    [Parameter(Mandatory = $true)][string]$VsixPath
  )

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($VsixPath)

  try {
    $contentTypesEntry = $zip.Entries | Where-Object { $_.FullName -eq '[Content_Types].xml' } | Select-Object -First 1
    if (-not $contentTypesEntry) {
      throw 'Generated VS2022 VSIX is invalid: [Content_Types].xml missing.'
    }

    $stream = $contentTypesEntry.Open()
    $reader = [System.IO.StreamReader]::new($stream)
    try {
      [xml]$contentTypesXml = $reader.ReadToEnd()
    }
    finally {
      $reader.Dispose()
      $stream.Dispose()
    }

    $declaredExtensions = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($defaultNode in @($contentTypesXml.Types.Default)) {
      $extension = [string]$defaultNode.Extension
      if (-not [string]::IsNullOrWhiteSpace($extension)) {
        $null = $declaredExtensions.Add($extension.TrimStart('.').ToLowerInvariant())
      }
    }

    foreach ($overrideNode in @($contentTypesXml.Types.Override)) {
      $partName = [string]$overrideNode.PartName
      if ([string]::IsNullOrWhiteSpace($partName)) {
        continue
      }

      $partFileName = [System.IO.Path]::GetFileName($partName.TrimStart('/'))
      $overrideExtension = [System.IO.Path]::GetExtension($partFileName)
      if (-not [string]::IsNullOrWhiteSpace($overrideExtension)) {
        $null = $declaredExtensions.Add($overrideExtension.TrimStart('.').ToLowerInvariant())
      }
    }

    $missingExtensions = New-Object System.Collections.Generic.List[string]
    foreach ($entry in $zip.Entries) {
      if ($entry.FullName.EndsWith('/')) {
        continue
      }

      $entryExtension = [System.IO.Path]::GetExtension($entry.FullName).TrimStart('.').ToLowerInvariant()
      if ([string]::IsNullOrWhiteSpace($entryExtension)) {
        continue
      }

      if (-not $declaredExtensions.Contains($entryExtension)) {
        $missingExtensions.Add($entryExtension)
      }
    }

    $missingUnique = @($missingExtensions | Sort-Object -Unique)
    if ($missingUnique.Count -gt 0) {
      $formatted = ($missingUnique | ForEach-Object { ".$_" }) -join ', '
      throw "Generated VS2022 VSIX is invalid: missing [Content_Types].xml mappings for extensions: $formatted"
    }
  }
  finally {
    $zip.Dispose()
  }
}

function Test-VsixMarketplaceMarkers {
  param(
    [Parameter(Mandatory = $true)][string]$VsixPath
  )

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($VsixPath)

  try {
    $entryNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $zip.Entries) {
      $null = $entryNames.Add($entry.FullName)
    }

    $requiredEntries = @(
      'manifest.json',
      'catalog.json'
    )

    $missingEntries = @()
    foreach ($required in $requiredEntries) {
      if (-not $entryNames.Contains($required)) {
        $missingEntries += $required
      }
    }

    if ($missingEntries.Count -gt 0) {
      $formatted = $missingEntries -join ', '
      throw "Generated VS2022 VSIX is invalid for Visual Studio Marketplace: missing VSIX v3 marker files: $formatted"
    }
  }
  finally {
    $zip.Dispose()
  }
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

  $entryNames = $zip.Entries | ForEach-Object { $_.FullName }
  $requiredRuntimeFiles = @(
    'extension/node_modules/nspell/lib/index.js',
    'extension/node_modules/is-buffer/index.js'
  )
  foreach ($runtimeFile in $requiredRuntimeFiles) {
    if (-not ($entryNames -contains $runtimeFile)) {
      throw "Generated VS Code VSIX is invalid: missing runtime file $runtimeFile."
    }
  }
}
finally {
  $zip.Dispose()
}

$VsCodeAlias = Join-Path $Artifacts 'vscode/KoSpellCheck.VSCode.vsix'
Copy-Item -LiteralPath $VsCodeOut -Destination $VsCodeAlias -Force

Write-Host '[pack] vs2022 vsix'
if (Test-Path $Vs2022VsixOut) {
  Remove-Item -Force $Vs2022VsixOut
}
if (Test-Path $LegacyVs2022VsixOut) {
  Remove-Item -Force $LegacyVs2022VsixOut
}
Get-ChildItem -Path (Join-Path $Artifacts 'vsix/KoSpellCheck.VS2022-*.vsix') -ErrorAction SilentlyContinue | Remove-Item -Force

$Vs2022AssemblyPath = Join-Path $Root "src/KoSpellCheck.VS2022/bin/Release/$Vs2022TargetFramework/KoSpellCheck.VS2022.dll"
$Vs2022PkgDefPath = Join-Path $Root "src/KoSpellCheck.VS2022/obj/Release/$Vs2022TargetFramework/KoSpellCheck.VS2022.pkgdef"
dotnet msbuild $Vs2022Project `
  /t:Build `
  /p:Configuration=Release `
  /p:IntermediateOutputPath=$Vs2022IntermediatePath `
  /p:OutDir=$Vs2022OutDirPath

if (-not (Test-Path -LiteralPath $Vs2022AssemblyPath)) {
  throw "Expected VS2022 assembly not found after Build: $Vs2022AssemblyPath"
}

$Vs2022PkgDefAssemblyToProcess = "$Vs2022OutDirPath" + "KoSpellCheck.VS2022.dll"
dotnet msbuild $Vs2022Project `
  /t:GeneratePkgDef `
  /p:Configuration=Release `
  /p:IntermediateOutputPath=$Vs2022IntermediatePath `
  /p:OutDir=$Vs2022OutDirPath `
  /p:CreatePkgDefAssemblyToProcess=$Vs2022PkgDefAssemblyToProcess

if (-not (Test-Path -LiteralPath $Vs2022PkgDefPath)) {
  throw "Expected VS2022 pkgdef not found after GeneratePkgDef: $Vs2022PkgDefPath"
}

dotnet msbuild $Vs2022Project `
  /t:CreateVsixContainer `
  /p:Configuration=Release `
  /p:IntermediateOutputPath=$Vs2022IntermediatePath `
  /p:OutDir=$Vs2022OutDirPath `
  /p:TemplateOutputDirectory=$Vs2022IntermediatePath `
  /p:TargetVsixContainerName=KoSpellCheck.VS2022.vsix

$GeneratedVsix = Get-ChildItem -Path (Join-Path $Root 'src/KoSpellCheck.VS2022/bin/Release') -Filter 'KoSpellCheck.VS2022.vsix' -Recurse |
  Sort-Object -Property LastWriteTime -Descending |
  Select-Object -First 1

if (-not $GeneratedVsix) {
  throw 'Expected VSSDK-generated VSIX not found under src/KoSpellCheck.VS2022/bin/Release.'
}

Copy-Item -LiteralPath $GeneratedVsix.FullName -Destination $Vs2022VsixOut -Force
Test-VsixContentTypes -VsixPath $Vs2022VsixOut
Test-VsixMarketplaceMarkers -VsixPath $Vs2022VsixOut
Copy-Item -LiteralPath $Vs2022VsixOut -Destination $Vs2022VersionedVsixOut -Force

Write-Host '[pack] completed'
Write-Host "[pack] VS Code:  $VsCodeAlias"
Write-Host "[pack] VS2022:   $Vs2022VsixOut"
Write-Host "[pack] VS2022 versioned: $Vs2022VersionedVsixOut"
