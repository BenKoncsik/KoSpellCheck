"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapDashboardViewModel = mapDashboardViewModel;
const sharedUiText_1 = require("../sharedUiText");
function mapDashboardViewModel(snapshot, logs, examplesByFolder) {
    const overview = mapOverview(snapshot);
    const settings = mapSettings(snapshot.settings);
    const conventionMap = mapConventionMap(snapshot.profile, examplesByFolder);
    const diagnostics = mapDiagnostics(snapshot.diagnostics);
    return {
        refreshedAtUtc: snapshot.generatedAtUtc,
        profilePath: snapshot.profilePath,
        summaryPath: snapshot.summaryPath,
        errorMessage: undefined,
        overview,
        settings,
        conventionMap,
        diagnostics,
        logs
    };
}
function mapOverview(snapshot) {
    const profile = asRecord(snapshot.profile);
    const summary = asRecord(snapshot.summary);
    const filesScanned = toNumber(profile.FilesScanned) ?? toNumber(summary.FilesScanned) ?? 0;
    const typesScanned = toNumber(profile.TypesScanned) ?? toNumber(summary.TypesScanned) ?? 0;
    const dominantCaseStyle = toStringValue(profile.DominantCaseStyle) ??
        toStringValue(summary.DominantCaseStyle) ??
        (0, sharedUiText_1.text)('dashboard.value.unknown', 'Unknown', {
            configuredLanguage: snapshot.settings?.uiLanguage
        });
    const profileLastUpdatedUtc = toStringValue(profile.GeneratedAtUtc) ?? toStringValue(summary.GeneratedAtUtc);
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
        coralDetail: coral?.Detail ?? (0, sharedUiText_1.text)('dashboard.value.inactive', 'Inactive', {
            configuredLanguage: snapshot.settings?.uiLanguage
        }).toLowerCase(),
        inFlightRebuildCount: snapshot.inFlightRebuildCount,
        queuedRebuildCount: snapshot.queuedRebuildCount
    };
}
function mapSettings(settings) {
    if (!settings) {
        return [];
    }
    return [
        {
            id: 'projectConventions.coreCliPath',
            label: (0, sharedUiText_1.text)('dashboard.setting.coreCliPath', 'Core CLI path', {
                configuredLanguage: settings.uiLanguage
            }),
            value: settings.coreCliPath ?? (0, sharedUiText_1.text)('dashboard.value.auto', '(auto)', {
                configuredLanguage: settings.uiLanguage
            }),
            type: 'string',
            editable: false
        },
        boolSetting(settings.uiLanguage, 'projectConventions.enabled', (0, sharedUiText_1.text)('dashboard.setting.projectConventionMapping', 'Project convention mapping', {
            configuredLanguage: settings.uiLanguage
        }), settings.projectConventionMappingEnabled),
        boolSetting(settings.uiLanguage, 'projectConventions.namingDiagnosticsEnabled', (0, sharedUiText_1.text)('dashboard.setting.namingDiagnostics', 'Naming diagnostics', {
            configuredLanguage: settings.uiLanguage
        }), settings.namingConventionDiagnosticsEnabled),
        boolSetting(settings.uiLanguage, 'projectConventions.statisticalAnomalyDetectionEnabled', (0, sharedUiText_1.text)('dashboard.setting.statisticalAnomalyDetection', 'Statistical anomaly detection', {
            configuredLanguage: settings.uiLanguage
        }), settings.statisticalAnomalyDetectionEnabled),
        boolSetting(settings.uiLanguage, 'projectConventions.aiNamingAnomalyDetectionEnabled', (0, sharedUiText_1.text)('dashboard.setting.aiNamingAnomalyDetection', 'AI naming anomaly detection', {
            configuredLanguage: settings.uiLanguage
        }), settings.aiNamingAnomalyDetectionEnabled),
        boolSetting(settings.uiLanguage, 'projectConventions.useCoralTpuIfAvailable', (0, sharedUiText_1.text)('dashboard.setting.useCoralTpuIfAvailable', 'Use Coral TPU if available', {
            configuredLanguage: settings.uiLanguage
        }), settings.useCoralTpuIfAvailable),
        boolSetting(settings.uiLanguage, 'projectConventions.autoRebuild', (0, sharedUiText_1.text)('dashboard.setting.autoRebuildConventionProfile', 'Auto rebuild convention profile', {
            configuredLanguage: settings.uiLanguage
        }), settings.autoRebuildConventionProfile),
        boolSetting(settings.uiLanguage, 'projectConventions.analyzeOnSave', (0, sharedUiText_1.text)('dashboard.setting.analyzeOnSave', 'Analyze on save', {
            configuredLanguage: settings.uiLanguage
        }), settings.analyzeOnSave),
        boolSetting(settings.uiLanguage, 'projectConventions.analyzeOnRename', (0, sharedUiText_1.text)('dashboard.setting.analyzeOnRename', 'Analyze on rename', {
            configuredLanguage: settings.uiLanguage
        }), settings.analyzeOnRename),
        boolSetting(settings.uiLanguage, 'projectConventions.analyzeOnNewFile', (0, sharedUiText_1.text)('dashboard.setting.analyzeOnNewFile', 'Analyze on new file', {
            configuredLanguage: settings.uiLanguage
        }), settings.analyzeOnNewFile),
        boolSetting(settings.uiLanguage, 'projectConventions.ignoreGeneratedCode', (0, sharedUiText_1.text)('dashboard.setting.ignoreGeneratedCode', 'Ignore generated code', {
            configuredLanguage: settings.uiLanguage
        }), settings.ignoreGeneratedCode),
        boolSetting(settings.uiLanguage, 'projectConventions.ignoreTestProjects', (0, sharedUiText_1.text)('dashboard.setting.ignoreTestProjects', 'Ignore test projects', {
            configuredLanguage: settings.uiLanguage
        }), settings.ignoreTestProjects),
        {
            id: 'projectConventions.statisticalAnomalyThreshold',
            label: (0, sharedUiText_1.text)('dashboard.setting.statisticalAnomalyThreshold', 'Statistical anomaly threshold', {
                configuredLanguage: settings.uiLanguage
            }),
            value: settings.statisticalAnomalyThreshold,
            type: 'number',
            editable: false
        },
        {
            id: 'projectConventions.aiAnomalyThreshold',
            label: (0, sharedUiText_1.text)('dashboard.setting.aiAnomalyThreshold', 'AI anomaly threshold', {
                configuredLanguage: settings.uiLanguage
            }),
            value: settings.aiAnomalyThreshold,
            type: 'number',
            editable: false
        },
        {
            id: 'projectConventions.scope',
            label: (0, sharedUiText_1.text)('dashboard.setting.scope', 'Scope', {
                configuredLanguage: settings.uiLanguage
            }),
            value: settings.conventionScope,
            type: 'string',
            editable: false
        }
    ];
}
function boolSetting(_uiLanguage, id, label, value) {
    return {
        id,
        label,
        value,
        type: 'boolean',
        editable: true
    };
}
function mapConventionMap(profileValue, examplesByFolder) {
    const profile = asRecord(profileValue);
    const folders = asRecord(profile.Folders);
    const output = [];
    for (const [folderPath, rawFolder] of Object.entries(folders)) {
        const folder = asRecord(rawFolder);
        const suffix = topFrequencyValue(folder.DominantSuffixes);
        const prefix = topFrequencyValue(folder.DominantPrefixes);
        const kind = topFrequencyValue(folder.DominantTypeKinds);
        const namespaceSample = topFrequencyValue(folder.NamespaceSamples);
        const confidence = Math.max(topFrequencyRatio(folder.DominantSuffixes), topFrequencyRatio(folder.DominantPrefixes), topFrequencyRatio(folder.DominantTypeKinds));
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
function mapDiagnostics(diagnostics) {
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
function normalizeSeverity(value) {
    switch ((value ?? '').toLowerCase()) {
        case 'error':
            return 'error';
        case 'warning':
            return 'warning';
        default:
            return 'info';
    }
}
function severityRank(severity) {
    switch (severity) {
        case 'error':
            return 3;
        case 'warning':
            return 2;
        default:
            return 1;
    }
}
function topFrequencyValue(value) {
    const entries = asArray(value);
    if (entries.length === 0) {
        return '';
    }
    const record = asRecord(entries[0]);
    return toStringValue(record.Value) ?? '';
}
function topFrequencyRatio(value) {
    const entries = asArray(value);
    if (entries.length === 0) {
        return 0;
    }
    const record = asRecord(entries[0]);
    return toNumber(record.Ratio) ?? 0;
}
function asRecord(value) {
    return value && typeof value === 'object'
        ? value
        : {};
}
function asArray(value) {
    return Array.isArray(value) ? value : [];
}
function toNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function toStringValue(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
//# sourceMappingURL=dashboardMapper.js.map