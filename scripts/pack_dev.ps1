#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path "$PSScriptRoot/..").Path
$PackScript = Join-Path $Root 'scripts/pack.ps1'

if (-not (Test-Path $PackScript)) {
  throw "pack script not found: $PackScript"
}

$PackageJsonPath = Join-Path $Root 'src/KoSpellCheck.VSCode/package.json'
$PackageLockPath = Join-Path $Root 'src/KoSpellCheck.VSCode/package-lock.json'
$BuildPropsPath = Join-Path $Root 'Directory.Build.props'
$VsixManifestPath = Join-Path $Root 'src/KoSpellCheck.VS2022/source.extension.vsixmanifest'

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("kospellcheck-packdev-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $TempDir | Out-Null

$FilesToRestore = @(
  $PackageJsonPath,
  $PackageLockPath,
  $BuildPropsPath,
  $VsixManifestPath
)

foreach ($file in $FilesToRestore) {
  Copy-Item -LiteralPath $file -Destination (Join-Path $TempDir ([System.IO.Path]::GetFileName($file) + '.bak')) -Force
}

try {
  $packageJson = Get-Content -LiteralPath $PackageJsonPath -Raw | ConvertFrom-Json
  $baseVersion = [string]$packageJson.version
  if ($baseVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
    throw "Unsupported base version in package.json: '$baseVersion' (expected x.y.z)"
  }

  $baseMajor = [int]$Matches[1]
  $baseMinor = [int]$Matches[2]
  $devPatch = Get-Random -Minimum 30000 -Maximum 60000
  $devVersion = "{0}.{1}.{2}" -f $baseMajor, $baseMinor, $devPatch
  $assemblyVersion = "$devVersion.0"

  $packageJson.version = $devVersion
  $packageJson | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $PackageJsonPath -Encoding UTF8

  $packageLock = Get-Content -LiteralPath $PackageLockPath -Raw | ConvertFrom-Json
  $packageLock.version = $devVersion
  if ($null -ne $packageLock.packages -and $null -ne $packageLock.packages.'') {
    $packageLock.packages.''.version = $devVersion
  }
  $packageLock | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $PackageLockPath -Encoding UTF8

  [xml]$buildPropsXml = Get-Content -LiteralPath $BuildPropsPath
  $propsGroups = @($buildPropsXml.Project.PropertyGroup)
  if ($propsGroups.Count -eq 0) {
    throw 'Directory.Build.props does not contain PropertyGroup.'
  }

  foreach ($group in $propsGroups) {
    if ($group.Version) {
      $group.Version = $devVersion
    }
    if ($group.AssemblyVersion) {
      $group.AssemblyVersion = $assemblyVersion
    }
    if ($group.FileVersion) {
      $group.FileVersion = $assemblyVersion
    }
  }
  $buildPropsXml.Save($BuildPropsPath)

  [xml]$vsixManifestXml = Get-Content -LiteralPath $VsixManifestPath
  $identityNode = $vsixManifestXml.PackageManifest.Metadata.Identity
  if ($null -eq $identityNode) {
    throw 'source.extension.vsixmanifest is missing Metadata/Identity node.'
  }
  $identityNode.Version = $devVersion
  $vsixManifestXml.Save($VsixManifestPath)

  Write-Host "[pack_dev] dev version: $devVersion"
  & $PackScript
}
finally {
  foreach ($file in $FilesToRestore) {
    $backupPath = Join-Path $TempDir ([System.IO.Path]::GetFileName($file) + '.bak')
    if (Test-Path $backupPath) {
      Copy-Item -LiteralPath $backupPath -Destination $file -Force
    }
  }

  if (Test-Path $TempDir) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force
  }
}
