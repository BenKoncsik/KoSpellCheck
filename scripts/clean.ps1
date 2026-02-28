#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path "$PSScriptRoot/..").Path

Write-Host '[clean] removing build outputs'
Get-ChildItem -Path $Root -Recurse -Directory -Include bin,obj,out,node_modules |
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

$Artifacts = Join-Path $Root 'artifacts'
if (Test-Path $Artifacts) {
  Remove-Item -Recurse -Force $Artifacts
}

New-Item -ItemType Directory -Force -Path (Join-Path $Artifacts 'vsix') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Artifacts 'vscode') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Artifacts 'nuget') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Artifacts 'logs') | Out-Null

Write-Host '[clean] completed'
