import assert from 'node:assert';
import test from 'node:test';
import { mapDashboardViewModel } from '../dashboard/dashboardMapper';
import { DashboardLogEntry } from '../dashboard/dashboardLogService';
import { ProjectConventionDashboardSnapshot } from '../projectConventions/feature';

test('dashboard mapper converts convention profile snapshot into view model', () => {
  const snapshot: ProjectConventionDashboardSnapshot = {
    generatedAtUtc: '2026-03-08T12:00:00.000Z',
    scope: {
      scope: 'workspace',
      scopeKey: 'workspace:/tmp/demo',
      storageRoot: '/tmp/demo'
    },
    settings: {
      projectConventionMappingEnabled: true,
      namingConventionDiagnosticsEnabled: true,
      statisticalAnomalyDetectionEnabled: true,
      aiNamingAnomalyDetectionEnabled: false,
      useCoralTpuIfAvailable: false,
      autoRebuildConventionProfile: true,
      analyzeOnSave: true,
      analyzeOnRename: true,
      analyzeOnNewFile: true,
      conventionScope: 'workspace',
      ignoreGeneratedCode: true,
      ignoreTestProjects: false,
      includePatterns: [],
      excludePatterns: [],
      supportedExtensions: ['cs'],
      maxFiles: 100,
      minEvidenceCount: 2,
      statisticalAnomalyThreshold: 0.6,
      aiAnomalyThreshold: 0.7,
      profilePath: '.kospellcheck/project-conventions.json',
      profileCachePath: '.kospellcheck/project-profile-cache.json',
      anomalyModelPath: '.kospellcheck/project-anomaly-model.json',
      scanSummaryPath: '.kospellcheck/project-scan-summary.json',
      ignoreListPath: '.kospellcheck/convention-ignores.json'
    },
    profilePath: '/tmp/demo/.kospellcheck/project-conventions.json',
    summaryPath: '/tmp/demo/.kospellcheck/project-scan-summary.json',
    profile: {
      FilesScanned: 10,
      TypesScanned: 12,
      DominantCaseStyle: 'PascalCase',
      GeneratedAtUtc: '2026-03-08T11:59:00.000Z',
      Folders: {
        Services: {
          DominantSuffixes: [{ Value: 'Service', Ratio: 0.9 }],
          DominantPrefixes: [],
          DominantTypeKinds: [{ Value: 'Class', Ratio: 0.9 }],
          NamespaceSamples: [{ Value: 'App.Services', Ratio: 0.9 }]
        }
      }
    },
    diagnostics: [
      {
        key: 'd1',
        workspaceRoot: '/tmp/demo',
        file: {
          WorkspaceRoot: '/tmp/demo',
          AbsolutePath: '/tmp/demo/Services/CustomerHandler.cs',
          RelativePath: 'Services/CustomerHandler.cs',
          FolderPath: 'Services',
          FileName: 'CustomerHandler.cs',
          FileStem: 'CustomerHandler'
        },
        diagnostic: {
          RuleId: 'KS_CONV_001',
          Title: 'Folder suffix mismatch',
          Severity: 'Warning',
          Confidence: 0.92,
          Message: 'Type does not follow folder suffix convention.',
          Explanation: 'Expected Service suffix.',
          Evidence: [{ Metric: 'suffix', Expected: 'Service', Observed: 'Handler' }],
          Suggestions: ['Rename to CustomerService'],
          QuickFixes: [],
          FilePath: 'Services/CustomerHandler.cs',
          Line: 3,
          Column: 8
        }
      }
    ],
    inFlightRebuildCount: 0,
    queuedRebuildCount: 0,
    coralRuntime: {
      Available: false,
      Detail: 'disabled'
    }
  };

  const logs: DashboardLogEntry[] = [
    {
      id: 1,
      timestampUtc: '2026-03-08T12:01:00.000Z',
      level: 'info',
      message: 'dashboard refresh completed'
    }
  ];

  const model = mapDashboardViewModel(snapshot, logs, {
    Services: ['CustomerService', 'OrderService']
  });

  assert.equal(model.overview.filesScanned, 10);
  assert.equal(model.conventionMap.length, 1);
  assert.equal(model.conventionMap[0].expectedSuffix, 'Service');
  assert.equal(model.conventionMap[0].exampleTypes[0], 'CustomerService');
  assert.equal(model.diagnostics.length, 1);
  assert.equal(model.diagnostics[0].severity, 'warning');
  assert.equal(model.logs.length, 1);
});
