#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path "$PSScriptRoot/..").Path

$formatInstalled = dotnet tool list -g 2>$null | Select-String 'dotnet-format'
if ($formatInstalled) {
  Write-Host '[lint] dotnet format'
  dotnet format (Join-Path $Root 'KoSpellCheck.sln') --verify-no-changes
}
else {
  Write-Host '[lint] dotnet-format not installed, skipping'
}

Write-Host '[lint] eslint'
Push-Location (Join-Path $Root 'src/KoSpellCheck.VSCode')
try {
  if (Test-Path 'node_modules') {
    npm run lint
  }
  else {
    Write-Host '[lint] node_modules missing, skipping eslint'
  }
}
finally {
  Pop-Location
}
