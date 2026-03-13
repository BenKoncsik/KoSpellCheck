import {
  ConventionFeatureConfig,
  ProjectConventionDashboardDiagnosticSnapshot,
  ProjectConventionDashboardUnusedTypeSnapshot,
  ProjectConventionDashboardSnapshot
} from '../projectConventions/feature';
import { DashboardLogEntry } from './dashboardLogService';
import {
  DashboardConventionItem,
  DashboardDiagnosticItem,
  DashboardOverview,
  DashboardSettingItem,
  DashboardUnusedTypeItem,
  DashboardViewModel
} from './dashboardState';
import { text } from '../sharedUiText';

export function mapDashboardViewModel(
  snapshot: ProjectConventionDashboardSnapshot,
  logs: DashboardLogEntry[],
  examplesByFolder: Record<string, string[]>
): Omit<DashboardViewModel, 'loading'> {
  const overview = mapOverview(snapshot);
  const settings = mapSettings(snapshot.settings);
  const conventionMap = mapConventionMap(snapshot.profile, examplesByFolder);
  const diagnostics = mapDiagnostics(snapshot.diagnostics);
  const unusedTypes = mapUnusedTypes(snapshot.unusedTypes ?? []);

  return {
    refreshedAtUtc: snapshot.generatedAtUtc,
    profilePath: snapshot.profilePath,
    summaryPath: snapshot.summaryPath,
    errorMessage: undefined,
    overview,
    settings,
    conventionMap,
    diagnostics,
    unusedTypes,
    logs
  };
}

function mapOverview(snapshot: ProjectConventionDashboardSnapshot): DashboardOverview {
  const profile = asRecord(snapshot.profile);
  const summary = asRecord(snapshot.summary);
  const filesScanned = toNumber(profile.FilesScanned) ?? toNumber(summary.FilesScanned) ?? 0;
  const typesScanned = toNumber(profile.TypesScanned) ?? toNumber(summary.TypesScanned) ?? 0;
  const dominantCaseStyle =
    toStringValue(profile.DominantCaseStyle) ??
    toStringValue(summary.DominantCaseStyle) ??
    text('dashboard.value.unknown', 'Unknown', {
      configuredLanguage: snapshot.settings?.uiLanguage
    });
  const profileLastUpdatedUtc =
    toStringValue(profile.GeneratedAtUtc) ?? toStringValue(summary.GeneratedAtUtc);
  const settings = snapshot.settings;
  const coral = snapshot.coralRuntime;

  return {
    workspaceRoot: snapshot.scope?.storageRoot ?? '',
    scope: snapshot.scope?.scope ?? 'none',
    filesScanned,
    typesScanned,
    dominantCaseStyle,
    profileLastUpdatedUtc,
    diagnosticsCount: snapshot.diagnostics.length,
    featureEnabled: settings?.projectConventionMappingEnabled ?? false,
    aiEnabled: settings?.aiNamingAnomalyDetectionEnabled ?? false,
    coralActive: !!coral?.Available,
    coralDetail: coral?.Detail ?? text('dashboard.value.inactive', 'Inactive', {
      configuredLanguage: snapshot.settings?.uiLanguage
    }).toLowerCase(),
    inFlightRebuildCount: snapshot.inFlightRebuildCount,
    queuedRebuildCount: snapshot.queuedRebuildCount
  };
}

function mapSettings(settings?: ConventionFeatureConfig): DashboardSettingItem[] {
  if (!settings) {
    return [];
  }

  return [
    {
      id: 'projectConventions.coreCliPath',
      label: text('dashboard.setting.coreCliPath', 'Core CLI path', {
        configuredLanguage: settings.uiLanguage
      }),
      value: settings.coreCliPath ?? text('dashboard.value.auto', '(auto)', {
        configuredLanguage: settings.uiLanguage
      }),
      type: 'string',
      editable: false
    },
    boolSetting(
      settings.uiLanguage,
      'projectConventions.enabled',
      text('dashboard.setting.projectConventionMapping', 'Project convention mapping', {
        configuredLanguage: settings.uiLanguage
      }),
      settings.projectConventionMappingEnabled
    ),
    boolSetting(
      settings.uiLanguage,
      'projectConventions.namingDiagnosticsEnabled',
      text('dashboard.setting.namingDiagnostics', 'Naming diagnostics', {
        configuredLanguage: settings.uiLanguage
      }),
      settings.namingConventionDiagnosticsEnabled
    ),
    boolSetting(
      settings.uiLanguage,
      'projectConventions.statisticalAnomalyDetectionEnabled',
      text('dashboard.setting.statisticalAnomalyDetection', 'Statistical anomaly detection', {
        configuredLanguage: settings.uiLanguage
      }),
      settings.statisticalAnomalyDetectionEnabled
    ),
    boolSetting(
      settings.uiLanguage,
      'projectConventions.aiNamingAnomalyDetectionEnabled',
      text('dashboard.setting.aiNamingAnomalyDetection', 'AI naming anomaly detection', {
        configuredLanguage: settings.uiLanguage
      }),
      settings.aiNamingAnomalyDetectionEnabled
    ),
    boolSetting(
      settings.uiLanguage,
      'projectConventions.useCoralTpuIfAvailable',
      text('dashboard.setting.useCoralTpuIfAvailable', 'Use Coral TPU if available', {
        configuredLanguage: settings.uiLanguage
      }),
      settings.useCoralTpuIfAvailable
    ),
    boolSetting(
      settings.uiLanguage,
      'projectConventions.autoRebuild',
      text('dashboard.setting.autoRebuildConventionProfile', 'Auto rebuild convention profile', {
        configuredLanguage: settings.uiLanguage
      }),
      settings.autoRebuildConventionProfile
    ),
    boolSetting(
      settings.uiLanguage,
      'projectConventions.analyzeOnSave',
      text('dashboard.setting.analyzeOnSave', 'Analyze on save', {
        configuredLanguage: settings.uiLanguage
      }),
      settings.analyzeOnSave
    ),
    boolSetting(
      settings.uiLanguage,
      'projectConventions.analyzeOnRename',
      text('dashboard.setting.analyzeOnRename', 'Analyze on rename', {
        configuredLanguage: settings.uiLanguage
      }),
      settings.analyzeOnRename
    ),
    boolSetting(
      settings.uiLanguage,
      'projectConventions.analyzeOnNewFile',
      text('dashboard.setting.analyzeOnNewFile', 'Analyze on new file', {
        configuredLanguage: settings.uiLanguage
      }),
      settings.analyzeOnNewFile
    ),
    boolSetting(
      settings.uiLanguage,
      'projectConventions.ignoreGeneratedCode',
      text('dashboard.setting.ignoreGeneratedCode', 'Ignore generated code', {
        configuredLanguage: settings.uiLanguage
      }),
      settings.ignoreGeneratedCode
    ),
    boolSetting(
      settings.uiLanguage,
      'projectConventions.ignoreTestProjects',
      text('dashboard.setting.ignoreTestProjects', 'Ignore test projects', {
        configuredLanguage: settings.uiLanguage
      }),
      settings.ignoreTestProjects
    ),
    {
      id: 'projectConventions.statisticalAnomalyThreshold',
      label: text('dashboard.setting.statisticalAnomalyThreshold', 'Statistical anomaly threshold', {
        configuredLanguage: settings.uiLanguage
      }),
      value: settings.statisticalAnomalyThreshold,
      type: 'number',
      editable: false
    },
    {
      id: 'projectConventions.aiAnomalyThreshold',
      label: text('dashboard.setting.aiAnomalyThreshold', 'AI anomaly threshold', {
        configuredLanguage: settings.uiLanguage
      }),
      value: settings.aiAnomalyThreshold,
      type: 'number',
      editable: false
    },
    {
      id: 'projectConventions.scope',
      label: text('dashboard.setting.scope', 'Scope', {
        configuredLanguage: settings.uiLanguage
      }),
      value: settings.conventionScope,
      type: 'string',
      editable: false
    }
  ];
}

function boolSetting(
  _uiLanguage: string,
  id: string,
  label: string,
  value: boolean
): DashboardSettingItem {
  return {
    id,
    label,
    value,
    type: 'boolean',
    editable: true
  };
}

function mapConventionMap(
  profileValue: unknown,
  examplesByFolder: Record<string, string[]>
): DashboardConventionItem[] {
  const profile = asRecord(profileValue);
  const folders = asRecord(profile.Folders);
  const output: DashboardConventionItem[] = [];

  for (const [folderPath, rawFolder] of Object.entries(folders)) {
    const folder = asRecord(rawFolder);
    const suffix = topFrequencyValue(folder.DominantSuffixes);
    const prefix = topFrequencyValue(folder.DominantPrefixes);
    const kind = topFrequencyValue(folder.DominantTypeKinds);
    const namespaceSample = topFrequencyValue(folder.NamespaceSamples);
    const confidence = Math.max(
      topFrequencyRatio(folder.DominantSuffixes),
      topFrequencyRatio(folder.DominantPrefixes),
      topFrequencyRatio(folder.DominantTypeKinds)
    );

    output.push({
      folderPath,
      expectedSuffix: suffix,
      expectedPrefix: prefix,
      dominantKind: kind,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      namespaceSample: namespaceSample || undefined,
      exampleTypes: examplesByFolder[folderPath] ?? []
    });
  }

  output.sort((left, right) => right.confidence - left.confidence || left.folderPath.localeCompare(right.folderPath));
  return output;
}

function mapDiagnostics(diagnostics: ProjectConventionDashboardDiagnosticSnapshot[]): DashboardDiagnosticItem[] {
  return diagnostics
    .map((item) => {
      const evidence = Array.isArray(item.diagnostic.Evidence) && item.diagnostic.Evidence.length > 0
        ? item.diagnostic.Evidence[0]
        : undefined;
      const firstSuggestion = Array.isArray(item.diagnostic.Suggestions) && item.diagnostic.Suggestions.length > 0
        ? item.diagnostic.Suggestions[0]
        : undefined;

      return {
        key: item.key,
        filePath: item.file.RelativePath,
        absolutePath: item.file.AbsolutePath,
        ruleId: item.diagnostic.RuleId,
        title: item.diagnostic.Title,
        severity: normalizeSeverity(item.diagnostic.Severity),
        confidence: Number(item.diagnostic.Confidence ?? 0),
        message: item.diagnostic.Message,
        expected: evidence?.Expected,
        observed: evidence?.Observed,
        suggestion: firstSuggestion,
        line: Number(item.diagnostic.Line ?? 0),
        column: Number(item.diagnostic.Column ?? 0)
      };
    })
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || right.confidence - left.confidence);
}

function mapUnusedTypes(unusedTypes: ProjectConventionDashboardUnusedTypeSnapshot[]): DashboardUnusedTypeItem[] {
  return unusedTypes
    .map((item) => ({
      key: item.key,
      typeName: item.typeName,
      classification: item.classification,
      ruleId: item.ruleId,
      declarationPath: item.declarationPath,
      declarationAbsolutePath: item.declarationAbsolutePath,
      declarationLine: Number(item.declarationLine ?? 0),
      declarationColumn: Number(item.declarationColumn ?? 0),
      navigationPath: item.navigationPath,
      navigationAbsolutePath: item.navigationAbsolutePath,
      navigationLine: Number(item.navigationLine ?? 0),
      navigationColumn: Number(item.navigationColumn ?? 0),
      navigationMemberName: item.navigationMemberName ?? ''
    }))
    .sort((left, right) => left.typeName.localeCompare(right.typeName) || left.declarationPath.localeCompare(right.declarationPath));
}

function normalizeSeverity(value: string): 'info' | 'warning' | 'error' {
  switch ((value ?? '').toLowerCase()) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}

function severityRank(severity: 'info' | 'warning' | 'error'): number {
  switch (severity) {
    case 'error':
      return 3;
    case 'warning':
      return 2;
    default:
      return 1;
  }
}

function topFrequencyValue(value: unknown): string {
  const entries = asArray(value);
  if (entries.length === 0) {
    return '';
  }

  const record = asRecord(entries[0]);
  return toStringValue(record.Value) ?? '';
}

function topFrequencyRatio(value: unknown): number {
  const entries = asArray(value);
  if (entries.length === 0) {
    return 0;
  }

  const record = asRecord(entries[0]);
  return toNumber(record.Ratio) ?? 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
