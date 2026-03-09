# AGENTS.md

This file defines repository-level instructions for Codex agents working in this project.

## Scope and precedence
- Applies to the whole repository.
- More specific `AGENTS.md` or `AGENTS.override.md` files in subdirectories may override parts of this guidance.

## Project map
- `src/KoSpellCheck.Core`: shared spell-check engine, dictionaries, tokenization, normalization, style learning, project conventions.
- `src/KoSpellCheck.Core.Tests`: .NET unit tests for core behavior.
- `src/KoSpellCheck.LanguagePack.HuEn`: HU+EN language pack.
- `src/KoSpellCheck.VSCode`: VS Code extension (TypeScript).
- `src/KoSpellCheck.VS2022`: Visual Studio 2022 extension (VSIX, C#).
- `scripts`: cross-platform build/test/lint/pack wrappers.
- `tools/dictionaries`, `tools/licenses`: required dictionary and attribution assets.
- `docs`: architecture, configuration, troubleshooting.

## Recommended workflow
1. Read `README.md` and relevant files under `docs/` for feature context.
2. Keep changes minimal and limited to the affected component (`Core`, `VSCode`, or `VS2022`).
3. Prefer source edits over generated outputs.
4. Before implementing, evaluate whether any part of the requested feature can be moved into shared logic in `src/KoSpellCheck.Core`; if yes, implement that part in `Core` instead of duplicating extension-specific code.
5. Unless explicitly requested otherwise, implement every requested feature in both extensions (`src/KoSpellCheck.VSCode` and `src/KoSpellCheck.VS2022`), sharing behavior through `Core` when possible.
6. Validate with targeted tests first, then broader scripts when needed.

## Build, test, lint
### Full repo
- Build: `./scripts/build.sh` (Windows: `./scripts/build.ps1`)
- Test: `./scripts/test.sh` (Windows: `./scripts/test.ps1`)
- Lint: `./scripts/lint.sh` (Windows: `./scripts/lint.ps1`)
- Pack VSIX artifacts: `./scripts/pack.sh` (Windows: `./scripts/pack.ps1`)

### VS Code extension only (`src/KoSpellCheck.VSCode`)
- Install deps: `npm ci`
- Build: `npm run build`
- Test: `npm run test`
- Lint: `npm run lint`

### .NET only
- Restore/build solution: `dotnet restore KoSpellCheck.sln && dotnet build KoSpellCheck.sln -c Release`
- Core tests: `dotnet test src/KoSpellCheck.Core.Tests/KoSpellCheck.Core.Tests.csproj -c Release`

## Editing rules
- Do not manually edit generated/transpiled artifacts unless explicitly requested:
  - `src/KoSpellCheck.VSCode/out/**`
  - packaged outputs under `artifacts/**`
- If VS Code resources need dictionary/license sync, run `npm run prepare-assets` in `src/KoSpellCheck.VSCode` (or `npm run build`, which includes it).
- Preserve offline-first behavior. Do not introduce cloud-only runtime dependencies for spell-check features.
- Keep optional local typo acceleration non-blocking with safe fallback behavior.

## Validation expectations for code changes
- For `src/KoSpellCheck.VSCode/**` changes: run `npm run build` and `npm run test` in `src/KoSpellCheck.VSCode`.
- For `src/KoSpellCheck.Core/**` or `src/KoSpellCheck.VS2022/**` changes: run at least relevant `dotnet test`.
- For cross-cutting changes: run `./scripts/test.sh` and, if packaging is affected, `./scripts/pack.sh`.

## Packaging and assets
- Packaging expects dictionary and license assets under `tools/dictionaries` and `tools/licenses`.
- If missing, use:
  - `./tools/fetch-dictionaries.sh` (Linux/macOS)
  - `./tools/fetch-dictionaries.ps1` (Windows)
- VS Code VSIX output: `artifacts/vscode/KoSpellCheck.VSCode.vsix`
- Visual Studio VSIX output: `artifacts/vsix/KoSpellCheck.VS2022.vsix`

## Safety checks before finishing
- Keep naming and behavior consistent with existing architecture (`docs/architecture.md`).
- Avoid unrelated refactors.
- Summarize what was changed, what was validated, and what could not be validated.
