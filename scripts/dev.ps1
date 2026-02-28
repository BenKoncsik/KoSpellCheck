#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path "$PSScriptRoot/..").Path

Write-Host '[dev] dotnet build'
dotnet build (Join-Path $Root 'KoSpellCheck.sln') -c Debug

Write-Host '[dev] vscode watch'
Push-Location (Join-Path $Root 'src/KoSpellCheck.VSCode')
try {
  if (-not (Test-Path 'node_modules')) {
    npm ci
  }
  npm run watch
}
finally {
  Pop-Location
}
