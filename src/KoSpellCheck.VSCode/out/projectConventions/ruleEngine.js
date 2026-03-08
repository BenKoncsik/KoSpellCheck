"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateDeterministicRules = evaluateDeterministicRules;
const nameUtils_1 = require("./nameUtils");
function evaluateDeterministicRules(file, profile, minEvidenceCount) {
    const context = {
        profile,
        minEvidenceCount,
        suffixToFolderDominance: buildDominantFolderBySuffix(profile)
    };
    const diagnostics = [];
    diagnostics.push(...checkFileToPrimaryTypeMapping(file, context));
    diagnostics.push(...checkNamespaceConventions(file, context));
    for (const symbol of file.types) {
        diagnostics.push(...checkFolderSuffixConvention(file, symbol, context));
        diagnostics.push(...checkInterfacePrefixConvention(file, symbol, context));
        diagnostics.push(...checkEnumConvention(file, symbol, context));
        diagnostics.push(...checkAbbreviationConvention(file, symbol, context));
        diagnostics.push(...checkPluralityConvention(file, symbol, context));
        diagnostics.push(...checkFolderBySuffixConvention(file, symbol, context));
    }
    return dedupeDiagnostics(diagnostics);
}
function checkFileToPrimaryTypeMapping(file, context) {
    const primary = file.primaryType;
    if (!primary) {
        return [];
    }
    if (file.fileStem === primary.name) {
        return [];
    }
    const confidence = context.profile.fileToPrimaryTypeMatchRate;
    if (confidence < 0.65 || context.profile.filesScanned < context.minEvidenceCount) {
        return [];
    }
    return [
        createDiagnostic(file, primary, {
            ruleId: 'KS_CONV_003',
            title: 'File name does not match primary type',
            severity: confidence >= 0.85 ? 'error' : 'warning',
            confidence,
            message: `The file name ${file.fileName} does not match the primary type ${primary.name}.`,
            explanation: 'This project mostly maps one file to one primary type with matching names, but this file deviates from that dominant pattern.',
            evidence: [
                {
                    metric: 'file->primary-type match rate',
                    expected: `~${Math.round(confidence * 100)}% files follow file-name==primary-type`,
                    observed: `${file.fileStem} vs ${primary.name}`,
                    ratio: confidence,
                    sampleSize: context.profile.filesScanned
                }
            ],
            suggestions: [
                `Rename file to ${primary.name}.${file.extension}`,
                `Rename primary type to ${file.fileStem}`
            ],
            quickFixes: [
                {
                    kind: 'renameFileToPrimaryType',
                    title: `Rename file to ${primary.name}.${file.extension}`,
                    replacement: `${primary.name}.${file.extension}`
                },
                {
                    kind: 'renamePrimaryTypeToFileName',
                    title: `Rename primary type to ${file.fileStem}`,
                    replacement: file.fileStem
                }
            ]
        })
    ];
}
function checkFolderSuffixConvention(file, symbol, context) {
    const folderKey = (0, nameUtils_1.normalizeFolderKey)(file.folderPath);
    const folder = context.profile.folders[folderKey];
    if (!folder) {
        return [];
    }
    const dominantSuffix = folder.dominantSuffixes[0];
    if (!dominantSuffix || dominantSuffix.count < context.minEvidenceCount || dominantSuffix.ratio < 0.55) {
        return [];
    }
    if (symbol.name.endsWith(dominantSuffix.value)) {
        return [];
    }
    if (symbol.kind === 'interface' && symbol.name.startsWith('I')) {
        return [];
    }
    const suggestion = (0, nameUtils_1.replaceSuffix)(symbol.name, (0, nameUtils_1.detectKnownSuffix)(symbol.name, context.profile.knownSuffixes) ?? '', dominantSuffix.value);
    return [
        createDiagnostic(file, symbol, {
            ruleId: 'KS_CONV_001',
            title: 'Type name does not fit folder naming convention',
            severity: dominantSuffix.ratio >= 0.8 ? 'warning' : 'info',
            confidence: dominantSuffix.ratio,
            message: `The type ${symbol.name} deviates from the dominant *${dominantSuffix.value} pattern used in ${folderKey}.`,
            explanation: 'The learned folder convention indicates a strong suffix trend in this folder. The current type name does not match that local pattern.',
            evidence: [
                {
                    metric: 'folder dominant suffix',
                    expected: `*${dominantSuffix.value}`,
                    observed: symbol.name,
                    ratio: dominantSuffix.ratio,
                    sampleSize: dominantSuffix.count
                }
            ],
            suggestions: [`Suggested name: ${suggestion}`],
            quickFixes: [
                {
                    kind: 'renameSuffix',
                    title: `Rename type to ${suggestion}`,
                    replacement: suggestion
                }
            ]
        }),
        createDiagnostic(file, symbol, {
            ruleId: 'KS_CONV_008',
            title: 'Unexpected or missing suffix',
            severity: 'info',
            confidence: Math.min(1, dominantSuffix.ratio * 0.9),
            message: `Expected suffix *${dominantSuffix.value} is missing for ${symbol.name} in ${folderKey}.`,
            explanation: 'The dominant suffix in this folder was learned from existing project files and appears consistently.',
            evidence: [
                {
                    metric: 'dominant suffix consistency',
                    expected: `suffix ${dominantSuffix.value}`,
                    observed: symbol.name,
                    ratio: dominantSuffix.ratio,
                    sampleSize: dominantSuffix.count
                }
            ],
            suggestions: [`Use suffix ${dominantSuffix.value} for consistency`],
            quickFixes: [
                {
                    kind: 'renameSuffix',
                    title: `Apply ${dominantSuffix.value} suffix`,
                    replacement: suggestion
                }
            ]
        })
    ];
}
function checkInterfacePrefixConvention(file, symbol, context) {
    if (symbol.kind !== 'interface') {
        return [];
    }
    const interfaceConvention = context.profile.interfaceConvention;
    if (interfaceConvention.totalCount < context.minEvidenceCount || interfaceConvention.confidence < 0.7) {
        return [];
    }
    const expectedPrefix = interfaceConvention.expectedPrefix;
    if (symbol.name.startsWith(expectedPrefix)) {
        return [];
    }
    const suggestedName = `${expectedPrefix}${symbol.name}`;
    return [
        createDiagnostic(file, symbol, {
            ruleId: 'KS_CONV_004',
            title: 'Interface prefix convention mismatch',
            severity: interfaceConvention.confidence >= 0.9 ? 'warning' : 'info',
            confidence: interfaceConvention.confidence,
            message: `Interface ${symbol.name} does not start with ${expectedPrefix}, but this project expects that pattern.`,
            explanation: 'Interface naming was learned from existing interfaces where the I-prefix is dominant.',
            evidence: [
                {
                    metric: 'interface prefix ratio',
                    expected: `${expectedPrefix}*`,
                    observed: symbol.name,
                    ratio: interfaceConvention.confidence,
                    sampleSize: interfaceConvention.totalCount
                }
            ],
            suggestions: [`Suggested name: ${suggestedName}`],
            quickFixes: [
                {
                    kind: 'renamePrimaryTypeToFileName',
                    title: `Rename interface to ${suggestedName}`,
                    replacement: suggestedName
                }
            ]
        })
    ];
}
function checkEnumConvention(file, symbol, context) {
    if (symbol.kind !== 'enum') {
        return [];
    }
    const diagnostics = [];
    const enumConvention = context.profile.enumConvention;
    const observedStyle = (0, nameUtils_1.detectCaseStyle)(symbol.name);
    if (enumConvention.confidence >= 0.6 && enumConvention.dominantCaseStyle !== 'unknown' && observedStyle !== enumConvention.dominantCaseStyle) {
        diagnostics.push(createDiagnostic(file, symbol, {
            ruleId: 'KS_CONV_005',
            title: 'Enum naming style mismatch',
            severity: 'info',
            confidence: enumConvention.confidence,
            message: `Enum ${symbol.name} uses ${observedStyle}, but this project usually uses ${enumConvention.dominantCaseStyle} for enums.`,
            explanation: 'Enum case style was inferred from existing enums in this project.',
            evidence: [
                {
                    metric: 'enum case style',
                    expected: enumConvention.dominantCaseStyle,
                    observed: observedStyle,
                    ratio: enumConvention.confidence
                }
            ],
            suggestions: [`Rename enum to follow ${enumConvention.dominantCaseStyle}`],
            quickFixes: []
        }));
    }
    if (enumConvention.dominantSuffix && !symbol.name.endsWith(enumConvention.dominantSuffix)) {
        const rename = `${symbol.name}${enumConvention.dominantSuffix}`;
        diagnostics.push(createDiagnostic(file, symbol, {
            ruleId: 'KS_CONV_005',
            title: 'Enum suffix mismatch',
            severity: 'info',
            confidence: Math.max(0.5, enumConvention.confidence),
            message: `Enum ${symbol.name} does not follow the dominant *${enumConvention.dominantSuffix} suffix.`,
            explanation: 'The learned enum suffix indicates a recurring pattern in the existing code.',
            evidence: [
                {
                    metric: 'enum suffix',
                    expected: enumConvention.dominantSuffix,
                    observed: symbol.name,
                    ratio: enumConvention.confidence
                }
            ],
            suggestions: [`Suggested name: ${rename}`],
            quickFixes: [
                {
                    kind: 'renameSuffix',
                    title: `Rename enum to ${rename}`,
                    replacement: rename
                }
            ]
        }));
    }
    return diagnostics;
}
function checkAbbreviationConvention(file, symbol, context) {
    const diagnostics = [];
    const tokens = (0, nameUtils_1.splitIdentifierTokens)(symbol.name);
    for (const token of tokens) {
        const normalizedToken = token.toLowerCase();
        const preferred = context.profile.abbreviationPreferredForms[normalizedToken];
        if (!preferred) {
            continue;
        }
        if (token.toLowerCase() === preferred.toLowerCase()) {
            continue;
        }
        const abbreviationCount = context.profile.abbreviationFrequencies[normalizedToken] ?? 0;
        const preferredCount = context.profile.tokenFrequencies[preferred.toLowerCase()] ?? 0;
        if (preferredCount < context.minEvidenceCount || preferredCount <= abbreviationCount) {
            continue;
        }
        const replacement = symbol.name.replace(token, preferred);
        const ratio = preferredCount / Math.max(1, preferredCount + abbreviationCount);
        diagnostics.push(createDiagnostic(file, symbol, {
            ruleId: 'KS_CONV_006',
            title: 'Suspicious abbreviation',
            severity: ratio > 0.8 ? 'warning' : 'info',
            confidence: Math.min(1, ratio),
            message: `The abbreviation '${token}' is unusual in this project. The dominant pattern is '${preferred}'.`,
            explanation: 'Abbreviation usage was learned from project token frequencies, where the expanded term appears significantly more often.',
            evidence: [
                {
                    metric: 'abbreviation usage',
                    expected: preferred,
                    observed: token,
                    ratio,
                    sampleSize: preferredCount + abbreviationCount
                }
            ],
            suggestions: [`Suggested name: ${replacement}`],
            quickFixes: [
                {
                    kind: 'renameAbbreviation',
                    title: `Replace ${token} with ${preferred}`,
                    replacement
                }
            ]
        }));
        if (normalizedToken === 'repo') {
            diagnostics.push(createDiagnostic(file, symbol, {
                ruleId: 'KS_CONV_011',
                title: 'Near-duplicate naming pattern inconsistency',
                severity: 'info',
                confidence: Math.min(1, ratio),
                message: `${symbol.name} uses 'Repo', while this project predominantly uses 'Repository'.`,
                explanation: 'Near-duplicate naming forms were detected across the project and this token is the minority variant.',
                evidence: [
                    {
                        metric: 'pattern variant frequency',
                        expected: 'Repository',
                        observed: 'Repo',
                        ratio,
                        sampleSize: preferredCount + abbreviationCount
                    }
                ],
                suggestions: [`Suggested name: ${replacement}`],
                quickFixes: [
                    {
                        kind: 'renameAbbreviation',
                        title: 'Use Repository instead of Repo',
                        replacement
                    }
                ]
            }));
        }
    }
    return diagnostics;
}
function checkPluralityConvention(file, symbol, context) {
    const folder = context.profile.folders[(0, nameUtils_1.normalizeFolderKey)(file.folderPath)];
    if (!folder || folder.typeCount < context.minEvidenceCount) {
        return [];
    }
    const total = folder.singularNames + folder.pluralNames;
    if (total < context.minEvidenceCount) {
        return [];
    }
    const singularRatio = folder.singularNames / Math.max(1, total);
    const pluralRatio = folder.pluralNames / Math.max(1, total);
    const observedPlural = (0, nameUtils_1.isPluralWord)(symbol.name);
    if (singularRatio >= 0.8 && observedPlural) {
        return [
            createDiagnostic(file, symbol, {
                ruleId: 'KS_CONV_007',
                title: 'Plural/singular mismatch',
                severity: 'info',
                confidence: singularRatio,
                message: `${symbol.name} is plural, but ${folder.folderPath} mostly contains singular type names.`,
                explanation: 'Singular/plural tendencies were learned from names in this folder.',
                evidence: [
                    {
                        metric: 'folder singular ratio',
                        expected: 'singular names',
                        observed: 'plural name',
                        ratio: singularRatio,
                        sampleSize: total
                    }
                ],
                suggestions: ['Consider using singular type naming in this folder'],
                quickFixes: []
            })
        ];
    }
    if (pluralRatio >= 0.8 && !observedPlural) {
        return [
            createDiagnostic(file, symbol, {
                ruleId: 'KS_CONV_007',
                title: 'Plural/singular mismatch',
                severity: 'info',
                confidence: pluralRatio,
                message: `${symbol.name} is singular, but ${folder.folderPath} mostly contains plural type names.`,
                explanation: 'Singular/plural tendencies were learned from names in this folder.',
                evidence: [
                    {
                        metric: 'folder plural ratio',
                        expected: 'plural names',
                        observed: 'singular name',
                        ratio: pluralRatio,
                        sampleSize: total
                    }
                ],
                suggestions: ['Consider using plural type naming in this folder'],
                quickFixes: []
            })
        ];
    }
    return [];
}
function checkFolderBySuffixConvention(file, symbol, context) {
    const suffix = (0, nameUtils_1.detectKnownSuffix)(symbol.name, context.profile.knownSuffixes);
    if (!suffix) {
        return [];
    }
    const recommendedFolder = (0, nameUtils_1.suggestFolderFromSuffix)(suffix, context.suffixToFolderDominance);
    if (!recommendedFolder || recommendedFolder === (0, nameUtils_1.normalizeFolderKey)(file.folderPath)) {
        return [];
    }
    return [
        createDiagnostic(file, symbol, {
            ruleId: 'KS_CONV_009',
            title: 'Type appears in unexpected folder',
            severity: 'warning',
            confidence: 0.72,
            message: `${symbol.name} looks like a *${suffix} type, but it is located in ${file.folderPath}.`,
            explanation: 'The learned suffix-to-folder correlation suggests this type should be placed in another folder.',
            evidence: [
                {
                    metric: 'suffix->folder correlation',
                    expected: recommendedFolder,
                    observed: (0, nameUtils_1.normalizeFolderKey)(file.folderPath)
                }
            ],
            suggestions: [`Move file to ${recommendedFolder}`],
            quickFixes: [
                {
                    kind: 'moveFileToFolder',
                    title: `Move file to ${recommendedFolder}`,
                    targetPath: recommendedFolder
                }
            ]
        })
    ];
}
function checkNamespaceConventions(file, context) {
    if (!file.namespace) {
        return [];
    }
    const diagnostics = [];
    const namespaceSegments = (0, nameUtils_1.normalizeNamespace)(file.namespace);
    const folderKey = (0, nameUtils_1.normalizeFolderKey)(file.folderPath);
    const folderNamespace = context.profile.namespaceConvention.folderToNamespace[folderKey];
    if (folderNamespace && folderNamespace.length > 0) {
        const expected = folderNamespace.map((segment) => segment.toLowerCase());
        const observed = namespaceSegments.map((segment) => segment.toLowerCase());
        const score = (0, nameUtils_1.similarityScore)(expected, observed);
        if (score < 0.6) {
            diagnostics.push(createDiagnostic(file, file.primaryType ?? fallbackSymbol(file), {
                ruleId: 'KS_CONV_002',
                title: 'Namespace does not align with folder convention',
                severity: 'warning',
                confidence: Math.max(0.55, 1 - score),
                message: 'The namespace does not align with the folder-to-namespace convention observed in this project.',
                explanation: 'Namespace-to-folder mapping was learned from existing files in the same folder and this namespace is a low-similarity outlier.',
                evidence: [
                    {
                        metric: 'namespace-folder similarity',
                        expected: folderNamespace.join('.'),
                        observed: file.namespace,
                        ratio: score
                    }
                ],
                suggestions: [`Update namespace to ${folderNamespace.join('.')}`],
                quickFixes: [
                    {
                        kind: 'updateNamespaceToFolderConvention',
                        title: `Update namespace to ${folderNamespace.join('.')}`,
                        replacement: folderNamespace.join('.')
                    }
                ]
            }));
        }
    }
    const rootSegments = context.profile.namespaceConvention.rootSegments;
    if (rootSegments.length > 0 && namespaceSegments.length > 0) {
        const expectedRoot = rootSegments[0].toLowerCase();
        const observedRoot = namespaceSegments[0].toLowerCase();
        if (expectedRoot !== observedRoot) {
            diagnostics.push(createDiagnostic(file, file.primaryType ?? fallbackSymbol(file), {
                ruleId: 'KS_CONV_010',
                title: 'Unexpected namespace root segment',
                severity: 'info',
                confidence: Math.max(0.5, context.profile.namespaceConvention.confidence),
                message: `Namespace root '${namespaceSegments[0]}' is unusual. Project convention usually starts with '${rootSegments[0]}'.`,
                explanation: 'Namespace root usage was learned from existing files and this root differs from the dominant root segment.',
                evidence: [
                    {
                        metric: 'namespace root segment',
                        expected: rootSegments[0],
                        observed: namespaceSegments[0],
                        ratio: context.profile.namespaceConvention.confidence,
                        sampleSize: context.profile.filesScanned
                    }
                ],
                suggestions: [`Use namespace root ${rootSegments[0]}`],
                quickFixes: []
            }));
        }
    }
    const folderSegments = (0, nameUtils_1.normalizedPathSegments)(file.folderPath);
    if (folderSegments.length > 0 && namespaceSegments.length > 0) {
        const score = (0, nameUtils_1.similarityScore)(folderSegments, namespaceSegments);
        if (score < 0.35) {
            diagnostics.push(createDiagnostic(file, file.primaryType ?? fallbackSymbol(file), {
                ruleId: 'KS_CONV_010',
                title: 'Namespace segment mismatch for file location',
                severity: 'info',
                confidence: Math.min(1, 1 - score),
                message: 'The namespace segments are weakly correlated with the current folder path segments.',
                explanation: 'Folder-path to namespace-segment correlation was learned across the project and this file is an outlier.',
                evidence: [
                    {
                        metric: 'path-namespace segment overlap',
                        expected: folderSegments.join('.'),
                        observed: namespaceSegments.join('.'),
                        ratio: score
                    }
                ],
                suggestions: ['Align namespace with folder path segments'],
                quickFixes: []
            }));
        }
    }
    return diagnostics;
}
function buildDominantFolderBySuffix(profile) {
    const map = {};
    const perSuffix = {};
    for (const folder of Object.values(profile.folders)) {
        for (const suffix of folder.dominantSuffixes) {
            const list = perSuffix[suffix.value] ?? [];
            list.push({ folder: folder.folderPath, ratio: suffix.ratio, count: suffix.count });
            perSuffix[suffix.value] = list;
        }
    }
    for (const [suffix, entries] of Object.entries(perSuffix)) {
        entries.sort((left, right) => {
            if (left.count !== right.count) {
                return right.count - left.count;
            }
            return right.ratio - left.ratio;
        });
        const top = entries[0];
        if (top && top.ratio >= 0.5 && top.count >= 3) {
            map[suffix] = top.folder;
        }
    }
    return map;
}
function fallbackSymbol(file) {
    return {
        name: file.fileStem,
        kind: 'unknown',
        line: 0,
        column: 0
    };
}
function dedupeDiagnostics(input) {
    const seen = new Set();
    const output = [];
    for (const diagnostic of input) {
        const key = `${diagnostic.ruleId}|${diagnostic.filePath}|${diagnostic.line}|${diagnostic.message}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        output.push(diagnostic);
    }
    return output;
}
function createDiagnostic(file, symbol, data) {
    return {
        ruleId: data.ruleId,
        title: data.title,
        severity: data.severity,
        confidence: clamp01(data.confidence),
        message: data.message,
        explanation: data.explanation,
        evidence: data.evidence,
        suggestions: data.suggestions,
        quickFixes: data.quickFixes,
        filePath: file.relativePath,
        line: symbol.line,
        column: symbol.column
    };
}
function clamp01(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value <= 0) {
        return 0;
    }
    if (value >= 1) {
        return 1;
    }
    return value;
}
//# sourceMappingURL=ruleEngine.js.map