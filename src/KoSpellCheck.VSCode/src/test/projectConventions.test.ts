import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CoreConventionCliClient } from '../projectConventions/adapters/coreCliClient';

const extensionPath = path.resolve(__dirname, '..', '..');

test('core convention CLI bridge builds profile and analyzes file', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kospellcheck-conv-cli-'));
  const client = new CoreConventionCliClient(extensionPath, () => {});

  try {
    writeFile(workspaceRoot, 'Services/CustomerService.cs', 'namespace App.Services; public class CustomerService {}');
    writeFile(workspaceRoot, 'Services/OrderService.cs', 'namespace App.Services; public class OrderService {}');
    writeFile(workspaceRoot, 'Dtos/CustomerDto.cs', 'namespace App.Dtos; public class CustomerDto {}');

    const profileResult = await client.buildProfile({
      WorkspaceRoot: workspaceRoot,
      Scope: 'workspace',
      PersistArtifacts: false,
      Options: {
        EnableProjectConventionMapping: true,
        EnableNamingConventionDiagnostics: true,
        EnableStatisticalAnomalyDetection: true,
        EnableAiNamingAnomalyDetection: false,
        UseCoralTpuIfAvailable: false,
        AutoRebuildConventionProfile: true,
        AnalyzeOnSave: true,
        AnalyzeOnRename: true,
        AnalyzeOnNewFile: true,
        Scope: 'workspace',
        IgnoreGeneratedCode: true,
        IgnoreTestProjects: false,
        IncludePatterns: ['**/*.cs'],
        ExcludePatterns: ['**/bin/**', '**/obj/**'],
        SupportedExtensions: ['cs'],
        MaxFiles: 100,
        MinEvidenceCount: 2,
        StatisticalAnomalyThreshold: 0.5,
        AiAnomalyThreshold: 0.7,
        ConventionProfilePath: '.kospellcheck/project-conventions.json',
        ConventionProfileCachePath: '.kospellcheck/project-profile-cache.json',
        ConventionAnomalyModelPath: '.kospellcheck/project-anomaly-model.json',
        ConventionScanSummaryPath: '.kospellcheck/project-scan-summary.json',
        ConventionIgnoreListPath: '.kospellcheck/convention-ignores.json'
      }
    });

    assert.ok(profileResult);
    assert.ok(profileResult.Profile);

    const analysisResult = await client.analyze({
      WorkspaceRoot: workspaceRoot,
      FilePath: path.join(workspaceRoot, 'Services', 'CustomerHandler.cs'),
      FileContent: 'namespace App.Services; public class CustomerHandler {}',
      Options: {
        EnableProjectConventionMapping: true,
        EnableNamingConventionDiagnostics: true,
        EnableStatisticalAnomalyDetection: true,
        EnableAiNamingAnomalyDetection: false,
        UseCoralTpuIfAvailable: false,
        AutoRebuildConventionProfile: true,
        AnalyzeOnSave: true,
        AnalyzeOnRename: true,
        AnalyzeOnNewFile: true,
        Scope: 'workspace',
        IgnoreGeneratedCode: true,
        IgnoreTestProjects: false,
        IncludePatterns: ['**/*.cs'],
        ExcludePatterns: ['**/bin/**', '**/obj/**'],
        SupportedExtensions: ['cs'],
        MaxFiles: 100,
        MinEvidenceCount: 2,
        StatisticalAnomalyThreshold: 0.5,
        AiAnomalyThreshold: 0.7,
        ConventionProfilePath: '.kospellcheck/project-conventions.json',
        ConventionProfileCachePath: '.kospellcheck/project-profile-cache.json',
        ConventionAnomalyModelPath: '.kospellcheck/project-anomaly-model.json',
        ConventionScanSummaryPath: '.kospellcheck/project-scan-summary.json',
        ConventionIgnoreListPath: '.kospellcheck/convention-ignores.json'
      },
      Profile: profileResult.Profile,
      IgnoreList: { schemaVersion: 1, entries: [] }
    });

    assert.ok(analysisResult);
    const diagnostics = ((analysisResult.Analysis as any)?.Diagnostics ?? []) as Array<{ RuleId: string }>;
    assert.ok(diagnostics.some((item) => item.RuleId === 'KS_CONV_001'));
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('core convention CLI bridge discovers CLI project from workspace root when extension path is installed-layout', () => {
  const fakeInstalledExtensionPath = path.join(
    os.tmpdir(),
    'kospellcheck-installed-extension',
    '.vscode',
    'extensions',
    'kospellcheckv2.kospellcheck-0.1.15'
  );
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const expectedCliProjectPath = path.join(
    repoRoot,
    'src',
    'KoSpellCheck.ProjectConventions.Cli',
    'KoSpellCheck.ProjectConventions.Cli.csproj'
  );

  const client = new CoreConventionCliClient(fakeInstalledExtensionPath, () => {});
  const candidates = (client as unknown as { resolveCliProjectCandidates: (workspaceRoot?: string) => string[] })
    .resolveCliProjectCandidates(repoRoot);

  assert.ok(candidates.includes(expectedCliProjectPath));
  assert.ok(fs.existsSync(expectedCliProjectPath));
});

test('core convention CLI bridge prioritizes RID-specific packaged host candidates', () => {
  const client = new CoreConventionCliClient(extensionPath, () => {});
  const candidates = (client as unknown as { packagedCliDllCandidates: string[] }).packagedCliDllCandidates;
  const hostSegment = `${path.sep}core-cli${path.sep}hosts${path.sep}`;
  const firstHostIndex = candidates.findIndex((entry) => entry.includes(hostSegment));
  const firstLegacyFrameworkIndex = candidates.findIndex((entry) =>
    entry.includes(`${path.sep}core-cli${path.sep}net9.0${path.sep}`)
  );

  assert.ok(firstHostIndex >= 0);
  assert.ok(firstLegacyFrameworkIndex >= 0);
  assert.ok(firstHostIndex < firstLegacyFrameworkIndex);
});

test('core convention CLI bridge prioritizes host RID matching current platform and arch', () => {
  const scenarios: Array<{ platform: NodeJS.Platform; arch: string; expectedRid: string }> = [
    { platform: 'darwin', arch: 'arm64', expectedRid: 'osx-arm64' },
    { platform: 'win32', arch: 'ia32', expectedRid: 'win-x86' },
    { platform: 'linux', arch: 'x64', expectedRid: 'linux-x64' }
  ];

  for (const scenario of scenarios) {
    withProcessPlatformAndArch(scenario.platform, scenario.arch, () => {
      const client = new CoreConventionCliClient(extensionPath, () => {});
      const candidates = (client as unknown as { packagedCliDllCandidates: string[] }).packagedCliDllCandidates;
      const hostCandidates = candidates.filter((entry) =>
        entry.includes(`${path.sep}core-cli${path.sep}hosts${path.sep}`)
      );

      assert.ok(hostCandidates.length > 0);
      assert.ok(hostCandidates[0].includes(`${path.sep}hosts${path.sep}${scenario.expectedRid}${path.sep}`));
    });
  }
});

test('core convention CLI bridge uses apphost when dotnet is missing from PATH', async () => {
  if (process.platform === 'win32') {
    return;
  }

  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kospellcheck-conv-cli-fallback-workspace-'));
  const fakeCliRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kospellcheck-conv-cli-fallback-host-'));
  const originalPath = process.env.PATH;

  try {
    const fakeDllPath = path.join(fakeCliRoot, 'KoSpellCheck.ProjectConventions.Cli.dll');
    const fakeAppHostPath = path.join(fakeCliRoot, 'KoSpellCheck.ProjectConventions.Cli');
    fs.writeFileSync(fakeDllPath, 'placeholder', 'utf8');
    fs.writeFileSync(
      fakeAppHostPath,
      '#!/bin/sh\nprintf "%s" "{\\"Profile\\":{\\"SchemaVersion\\":1}}"\n',
      'utf8'
    );
    fs.chmodSync(fakeAppHostPath, 0o755);

    process.env.PATH = '';
    const client = new CoreConventionCliClient(
      extensionPath,
      () => {},
      () => fakeCliRoot
    );

    const profileResult = await client.buildProfile({
      WorkspaceRoot: workspaceRoot,
      Scope: 'workspace',
      PersistArtifacts: false,
      Options: {}
    });

    assert.ok(profileResult);
    assert.ok(profileResult.Profile);
  } finally {
    process.env.PATH = originalPath;
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(fakeCliRoot, { recursive: true, force: true });
  }
});

function writeFile(root: string, relativePath: string, content: string): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function withProcessPlatformAndArch(
  platform: NodeJS.Platform,
  arch: string,
  callback: () => void
): void {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  const archDescriptor = Object.getOwnPropertyDescriptor(process, 'arch');
  if (!platformDescriptor?.configurable || !archDescriptor?.configurable) {
    throw new Error('process platform/arch descriptors are not configurable in this runtime');
  }

  try {
    Object.defineProperty(process, 'platform', { value: platform });
    Object.defineProperty(process, 'arch', { value: arch });
    callback();
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor);
    Object.defineProperty(process, 'arch', archDescriptor);
  }
}
