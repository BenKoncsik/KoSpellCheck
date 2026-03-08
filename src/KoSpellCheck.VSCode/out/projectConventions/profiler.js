"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildConventionProfile = buildConventionProfile;
const nameUtils_1 = require("./nameUtils");
function buildConventionProfile(workspaceRoot, files, scope, minEvidenceCount) {
    const now = new Date().toISOString();
    const folderStats = new Map();
    const globalSuffixes = {};
    const globalPrefixes = {};
    const caseStyles = {};
    const tokenFrequencies = {};
    const abbreviationFrequencies = {};
    const abbreviationPreferredForms = {};
    const folderToNamespaceSamples = new Map();
    const namespaceRoots = {};
    const interfaceCounters = { prefixed: 0, total: 0 };
    const enumSuffixes = {};
    const enumCaseStyles = {};
    const suffixToFolderCount = new Map();
    let typeCount = 0;
    let fileToPrimaryTypeMatches = 0;
    for (const file of files) {
        const folderKey = (0, nameUtils_1.normalizeFolderKey)(file.folderPath);
        const folder = folderStats.get(folderKey) ?? createFolderStats();
        folder.files += 1;
        if (file.primaryType && file.fileStem === file.primaryType.name) {
            fileToPrimaryTypeMatches += 1;
        }
        if (file.namespace) {
            incrementCounter(folder.namespaces, file.namespace);
            const folderNamespaceMap = folderToNamespaceSamples.get(folderKey) ?? {};
            incrementCounter(folderNamespaceMap, file.namespace);
            folderToNamespaceSamples.set(folderKey, folderNamespaceMap);
            const namespaceSegments = (0, nameUtils_1.normalizeNamespace)(file.namespace);
            if (namespaceSegments.length > 0) {
                incrementCounter(namespaceRoots, namespaceSegments[0]);
            }
        }
        for (const symbol of file.types) {
            typeCount += 1;
            folder.types += 1;
            incrementCounter(folder.kinds, symbol.kind);
            const style = (0, nameUtils_1.detectCaseStyle)(symbol.name);
            incrementCounter(caseStyles, style);
            incrementCounter(folder.caseStyles, style);
            const suffix = (0, nameUtils_1.detectKnownSuffix)(symbol.name, (0, nameUtils_1.builtInSuffixes)());
            if (suffix) {
                incrementCounter(globalSuffixes, suffix);
                incrementCounter(folder.suffixes, suffix);
                const folderCounter = suffixToFolderCount.get(suffix) ?? {};
                incrementCounter(folderCounter, folderKey);
                suffixToFolderCount.set(suffix, folderCounter);
            }
            const prefix = (0, nameUtils_1.detectKnownPrefix)(symbol.name);
            if (prefix) {
                incrementCounter(globalPrefixes, prefix);
                incrementCounter(folder.prefixes, prefix);
            }
            const tokens = (0, nameUtils_1.splitIdentifierTokens)(symbol.name);
            for (const token of tokens) {
                const normalizedToken = (0, nameUtils_1.normalizeToken)(token);
                if (!normalizedToken) {
                    continue;
                }
                incrementCounter(tokenFrequencies, normalizedToken);
                if (normalizedToken.length <= 4) {
                    incrementCounter(abbreviationFrequencies, normalizedToken);
                    const preferred = (0, nameUtils_1.abbreviationToPreferred)(normalizedToken);
                    if (preferred) {
                        abbreviationPreferredForms[normalizedToken] = preferred;
                    }
                }
            }
            if (symbol.kind === 'interface') {
                interfaceCounters.total += 1;
                if (symbol.name.startsWith('I') && symbol.name.length > 1 && /[A-Z]/u.test(symbol.name[1])) {
                    interfaceCounters.prefixed += 1;
                }
            }
            if (symbol.kind === 'enum') {
                incrementCounter(enumCaseStyles, style);
                const enumSuffix = (0, nameUtils_1.detectKnownSuffix)(symbol.name, ['Enum', 'Flags']);
                if (enumSuffix) {
                    incrementCounter(enumSuffixes, enumSuffix);
                }
            }
            if ((0, nameUtils_1.isPluralWord)(symbol.name)) {
                folder.pluralNames += 1;
            }
            else {
                folder.singularNames += 1;
            }
        }
        folderStats.set(folderKey, folder);
    }
    const folderProfiles = {};
    for (const [folderKey, stats] of folderStats.entries()) {
        folderProfiles[folderKey] = {
            folderPath: folderKey,
            files: stats.files,
            typeCount: stats.types,
            dominantSuffixes: toFrequencyEntries(stats.suffixes),
            dominantPrefixes: toFrequencyEntries(stats.prefixes),
            dominantTypeKinds: toFrequencyEntries(stats.kinds),
            dominantCaseStyles: toFrequencyEntries(stats.caseStyles),
            namespaceSamples: toFrequencyEntries(stats.namespaces),
            singularNames: stats.singularNames,
            pluralNames: stats.pluralNames
        };
    }
    const dominantCaseDistribution = toFrequencyEntries(caseStyles);
    const dominantCaseStyle = dominantCaseDistribution[0]?.value ?? 'unknown';
    const interfaceConfidence = interfaceCounters.total === 0 ? 0 : interfaceCounters.prefixed / interfaceCounters.total;
    const folderToNamespace = {};
    for (const [folderPath, namespaceCounter] of folderToNamespaceSamples.entries()) {
        const top = toFrequencyEntries(namespaceCounter)[0];
        if (!top) {
            continue;
        }
        folderToNamespace[folderPath] = top.value.split('.').filter(Boolean);
    }
    const namespaceRootEntries = toFrequencyEntries(namespaceRoots);
    const namespaceRoot = namespaceRootEntries[0]?.value ? [namespaceRootEntries[0].value] : [];
    const namespaceConfidence = namespaceRootEntries[0]?.ratio ?? 0;
    const profile = {
        schemaVersion: 1,
        generatedAtUtc: now,
        workspaceRoot,
        scope,
        filesScanned: files.length,
        typesScanned: typeCount,
        dominantCaseStyle,
        dominantCaseDistribution,
        fileToPrimaryTypeMatchRate: files.length === 0 ? 0 : fileToPrimaryTypeMatches / Math.max(1, files.length),
        folders: folderProfiles,
        globalSuffixes: toFrequencyEntries(globalSuffixes),
        globalPrefixes: toFrequencyEntries(globalPrefixes),
        tokenFrequencies,
        abbreviationFrequencies,
        abbreviationPreferredForms,
        interfaceConvention: {
            expectedPrefix: 'I',
            prefixedCount: interfaceCounters.prefixed,
            totalCount: interfaceCounters.total,
            confidence: interfaceConfidence
        },
        enumConvention: {
            dominantCaseStyle: toFrequencyEntries(enumCaseStyles)[0]?.value ??
                'unknown',
            dominantSuffix: toFrequencyEntries(enumSuffixes)[0]?.value,
            confidence: toFrequencyEntries(enumCaseStyles)[0]?.ratio ?? 0
        },
        namespaceConvention: {
            rootSegments: namespaceRoot,
            folderToNamespace,
            confidence: namespaceConfidence
        },
        knownSuffixes: [...new Set([...(0, nameUtils_1.builtInSuffixes)(), ...Object.keys(globalSuffixes)])]
    };
    const summary = {
        schemaVersion: 1,
        generatedAtUtc: now,
        workspaceRoot,
        scope,
        filesScanned: files.length,
        filesSkippedGenerated: 0,
        filesSkippedTests: 0,
        filesSkippedByPattern: 0,
        typesScanned: typeCount,
        dominantCaseStyle,
        dominantFolderConventions: Object.values(folderProfiles)
            .map((folder) => {
            const dominantSuffix = folder.dominantSuffixes[0];
            const dominantKind = folder.dominantTypeKinds[0];
            return {
                folderPath: folder.folderPath,
                dominantSuffix: dominantSuffix?.value,
                dominantKind: dominantKind?.value,
                confidence: Math.max(dominantSuffix?.ratio ?? 0, dominantKind?.ratio ?? 0)
            };
        })
            .filter((entry) => entry.confidence >= 0.4)
            .sort((left, right) => right.confidence - left.confidence)
            .slice(0, 20)
    };
    const anomalyModel = createDefaultAnomalyModel(minEvidenceCount);
    injectSuffixToFolderHints(profile, suffixToFolderCount);
    return {
        profile,
        summary,
        anomalyModel
    };
}
function createFolderStats() {
    return {
        files: 0,
        types: 0,
        suffixes: {},
        prefixes: {},
        kinds: {},
        caseStyles: {},
        namespaces: {},
        singularNames: 0,
        pluralNames: 0
    };
}
function incrementCounter(counter, key) {
    const normalizedKey = String(key).trim();
    if (!normalizedKey) {
        return;
    }
    counter[normalizedKey] = (counter[normalizedKey] ?? 0) + 1;
}
function toFrequencyEntries(counter) {
    const values = Object.entries(counter)
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => {
        if (left.count !== right.count) {
            return right.count - left.count;
        }
        return left.value.localeCompare(right.value);
    });
    const total = values.reduce((sum, item) => sum + item.count, 0);
    if (total <= 0) {
        return [];
    }
    return values.map((item) => ({
        value: item.value,
        count: item.count,
        ratio: item.count / total
    }));
}
function injectSuffixToFolderHints(profile, suffixToFolderCount) {
    for (const [suffix, folders] of suffixToFolderCount.entries()) {
        const topFolder = toFrequencyEntries(folders)[0];
        if (!topFolder) {
            continue;
        }
        const folder = profile.folders[topFolder.value];
        if (!folder) {
            continue;
        }
        const already = folder.dominantSuffixes.some((entry) => entry.value === suffix);
        if (!already) {
            folder.dominantSuffixes.push({
                value: suffix,
                count: topFolder.count,
                ratio: topFolder.ratio
            });
        }
    }
}
function createDefaultAnomalyModel(minEvidenceCount) {
    const calibration = Math.max(1, Math.min(10, minEvidenceCount));
    return {
        schemaVersion: 1,
        modelType: 'logistic-regression',
        createdAtUtc: new Date().toISOString(),
        weights: {
            bias: -0.35,
            deterministicViolationCount: 0.85 + calibration * 0.02,
            suffixMismatchScore: 1.3,
            folderKindMismatchScore: 1.05,
            namespaceMismatchScore: 0.95,
            fileTypeMismatchScore: 1.1,
            abbreviationMismatchScore: 0.8,
            tokenRarityScore: 0.7
        }
    };
}
//# sourceMappingURL=profiler.js.map