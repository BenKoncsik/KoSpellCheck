"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapDashboardViewModel = mapDashboardViewModel;
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
        'Unknown';
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
        coralDetail: coral?.Detail ?? 'inactive',
        inFlightRebuildCount: snapshot.inFlightRebuildCount,
        queuedRebuildCount: snapshot.queuedRebuildCount
    };
}
function mapSettings(settings) {
    if (!settings) {
        return [];
    }
    return [
        boolSetting('projectConventions.enabled', 'Project convention mapping', settings.projectConventionMappingEnabled),
        boolSetting('projectConventions.namingDiagnosticsEnabled', 'Naming diagnostics', settings.namingConventionDiagnosticsEnabled),
        boolSetting('projectConventions.statisticalAnomalyDetectionEnabled', 'Statistical anomaly detection', settings.statisticalAnomalyDetectionEnabled),
        boolSetting('projectConventions.aiNamingAnomalyDetectionEnabled', 'AI naming anomaly detection', settings.aiNamingAnomalyDetectionEnabled),
        boolSetting('projectConventions.useCoralTpuIfAvailable', 'Use Coral TPU if available', settings.useCoralTpuIfAvailable),
        boolSetting('projectConventions.autoRebuild', 'Auto rebuild convention profile', settings.autoRebuildConventionProfile),
        boolSetting('projectConventions.analyzeOnSave', 'Analyze on save', settings.analyzeOnSave),
        boolSetting('projectConventions.analyzeOnRename', 'Analyze on rename', settings.analyzeOnRename),
        boolSetting('projectConventions.analyzeOnNewFile', 'Analyze on new file', settings.analyzeOnNewFile),
        boolSetting('projectConventions.ignoreGeneratedCode', 'Ignore generated code', settings.ignoreGeneratedCode),
        boolSetting('projectConventions.ignoreTestProjects', 'Ignore test projects', settings.ignoreTestProjects),
        {
            id: 'projectConventions.statisticalAnomalyThreshold',
            label: 'Statistical anomaly threshold',
            value: settings.statisticalAnomalyThreshold,
            type: 'number',
            editable: false
        },
        {
            id: 'projectConventions.aiAnomalyThreshold',
            label: 'AI anomaly threshold',
            value: settings.aiAnomalyThreshold,
            type: 'number',
            editable: false
        },
        {
            id: 'projectConventions.scope',
            label: 'Scope',
            value: settings.conventionScope,
            type: 'string',
            editable: false
        }
    ];
}
function boolSetting(id, label, value) {
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