#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path "$PSScriptRoot/..").Path
$Artifacts = Join-Path $Root 'artifacts'

New-Item -ItemType Directory -Force -Path (Join-Path $Artifacts 'vsix') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Artifacts 'vscode') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Artifacts 'nuget') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Artifacts 'logs') | Out-Null

Write-Host '[build] dotnet restore'
dotnet restore (Join-Path $Root 'KoSpellCheck.sln')

Write-Host '[build] dotnet build'
dotnet build (Join-Path $Root 'KoSpellCheck.sln') -c Release --no-restore

Write-Host '[build] vscode npm ci + build'
Push-Location (Join-Path $Root 'src/KoSpellCheck.VSCode')
try {
  npm ci
  npm run build
}
finally {
  Pop-Location
}

Write-Host '[build] completed'
