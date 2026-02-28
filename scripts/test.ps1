#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path "$PSScriptRoot/..").Path

Write-Host '[test] dotnet tests'
$targetFramework = 'net8.0'
$runtimes = dotnet --list-runtimes
if ($runtimes -match 'Microsoft\\.NETCore\\.App 9\\.') {
  $targetFramework = 'net9.0'
}
elseif ($runtimes -match 'Microsoft\\.NETCore\\.App 8\\.') {
  $targetFramework = 'net8.0'
}
dotnet test (Join-Path $Root 'src/KoSpellCheck.Core.Tests/KoSpellCheck.Core.Tests.csproj') -c Release -f $targetFramework

Write-Host '[test] vscode tests'
Push-Location (Join-Path $Root 'src/KoSpellCheck.VSCode')
try {
  if (-not (Test-Path 'node_modules')) {
    npm ci
  }
  npm run test
}
finally {
  Pop-Location
}

Write-Host '[test] completed'
