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

function writeFile(root: string, relativePath: string, content: string): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}
