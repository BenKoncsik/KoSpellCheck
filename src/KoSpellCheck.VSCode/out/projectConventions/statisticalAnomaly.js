"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeStatisticalAnomaly = computeStatisticalAnomaly;
const nameUtils_1 = require("./nameUtils");
const DEFAULT_VECTOR = {
    deterministicViolationCount: 0,
    suffixMismatchScore: 0,
    folderKindMismatchScore: 0,
    namespaceMismatchScore: 0,
    fileTypeMismatchScore: 0,
    abbreviationMismatchScore: 0,
    tokenRarityScore: 0
};
function computeStatisticalAnomaly(file, profile, deterministicViolationCount) {
    if (!file.primaryType) {
        return {
            result: {
                score: 0,
                signals: []
            },
            vector: {
                ...DEFAULT_VECTOR,
                deterministicViolationCount
            }
        };
    }
    const evidence = [];
    const folderKey = (0, nameUtils_1.normalizeFolderKey)(file.folderPath);
    const folder = profile.folders[folderKey];
    const suffixMismatch = computeSuffixMismatch(file.primaryType, folder);
    if (suffixMismatch.evidence) {
        evidence.push(suffixMismatch.evidence);
    }
    const kindMismatch = computeKindMismatch(file.primaryType, folder);
    if (kindMismatch.evidence) {
        evidence.push(kindMismatch.evidence);
    }
    const namespaceMismatch = computeNamespaceMismatch(file, profile, folderKey);
    if (namespaceMismatch.evidence) {
        evidence.push(namespaceMismatch.evidence);
    }
    const fileTypeMismatch = computeFileTypeMismatch(file, profile);
    if (fileTypeMismatch.evidence) {
        evidence.push(fileTypeMismatch.evidence);
    }
    const abbreviationMismatch = computeAbbreviationMismatch(file.primaryType, profile);
    if (abbreviationMismatch.evidence) {
        evidence.push(abbreviationMismatch.evidence);
    }
    const tokenRarity = computeTokenRarity(file.primaryType, profile);
    if (tokenRarity.evidence) {
        evidence.push(tokenRarity.evidence);
    }
    const vector = {
        deterministicViolationCount,
        suffixMismatchScore: suffixMismatch.score,
        folderKindMismatchScore: kindMismatch.score,
        namespaceMismatchScore: namespaceMismatch.score,
        fileTypeMismatchScore: fileTypeMismatch.score,
        abbreviationMismatchScore: abbreviationMismatch.score,
        tokenRarityScore: tokenRarity.score
    };
    const weighted = vector.suffixMismatchScore * 0.24 +
        vector.folderKindMismatchScore * 0.17 +
        vector.namespaceMismatchScore * 0.2 +
        vector.fileTypeMismatchScore * 0.16 +
        vector.abbreviationMismatchScore * 0.11 +
        vector.tokenRarityScore * 0.12;
    return {
        result: {
            score: clamp01(weighted),
            signals: evidence
        },
        vector
    };
}
function computeSuffixMismatch(symbol, folder) {
    const topSuffix = folder?.dominantSuffixes?.[0];
    if (!topSuffix || topSuffix.ratio < 0.45) {
        return { score: 0 };
    }
    if (symbol.name.endsWith(topSuffix.value)) {
        return { score: 0 };
    }
    const observedSuffix = (0, nameUtils_1.detectKnownSuffix)(symbol.name) ?? 'none';
    return {
        score: clamp01(topSuffix.ratio),
        evidence: {
            metric: 'folder suffix likelihood',
            expected: topSuffix.value,
            observed: observedSuffix,
            ratio: 1 - topSuffix.ratio
        }
    };
}
function computeKindMismatch(symbol, folder) {
    const topKind = folder?.dominantTypeKinds?.[0];
    if (!topKind || topKind.ratio < 0.5) {
        return { score: 0 };
    }
    if (topKind.value === symbol.kind) {
        return { score: 0 };
    }
    return {
        score: clamp01(topKind.ratio),
        evidence: {
            metric: 'folder type-kind likelihood',
            expected: topKind.value,
            observed: symbol.kind,
            ratio: 1 - topKind.ratio
        }
    };
}
function computeNamespaceMismatch(file, profile, folderKey) {
    if (!file.namespace) {
        return { score: 0 };
    }
    const expected = profile.namespaceConvention.folderToNamespace[folderKey];
    if (!expected || expected.length === 0) {
        return { score: 0 };
    }
    const namespaceTokens = (0, nameUtils_1.normalizeNamespace)(file.namespace);
    const expectedTokens = expected.map((segment) => (0, nameUtils_1.normalizeToken)(segment)).filter(Boolean);
    const overlap = (0, nameUtils_1.similarityScore)(namespaceTokens, expectedTokens);
    if (overlap >= 0.7) {
        return { score: 0 };
    }
    return {
        score: clamp01(1 - overlap),
        evidence: {
            metric: 'namespace-path association',
            expected: expected.join('.'),
            observed: file.namespace,
            ratio: overlap
        }
    };
}
function computeFileTypeMismatch(file, profile) {
    if (!file.primaryType) {
        return { score: 0 };
    }
    if (file.fileStem === file.primaryType.name) {
        return { score: 0 };
    }
    if (profile.fileToPrimaryTypeMatchRate < 0.55) {
        return { score: 0 };
    }
    return {
        score: clamp01(profile.fileToPrimaryTypeMatchRate),
        evidence: {
            metric: 'file-primary-type similarity',
            expected: file.fileStem,
            observed: file.primaryType.name,
            ratio: 1 - profile.fileToPrimaryTypeMatchRate
        }
    };
}
function computeAbbreviationMismatch(symbol, profile) {
    const tokens = (0, nameUtils_1.splitIdentifierTokens)(symbol.name).map((token) => (0, nameUtils_1.normalizeToken)(token));
    let worst = 0;
    let mismatch;
    for (const token of tokens) {
        const preferred = profile.abbreviationPreferredForms[token];
        if (!preferred) {
            continue;
        }
        if (token === (0, nameUtils_1.normalizeToken)(preferred)) {
            continue;
        }
        const tokenCount = profile.abbreviationFrequencies[token] ?? 0;
        const preferredCount = profile.tokenFrequencies[(0, nameUtils_1.normalizeToken)(preferred)] ?? 0;
        const ratio = preferredCount / Math.max(1, tokenCount + preferredCount);
        if (ratio <= worst) {
            continue;
        }
        worst = ratio;
        mismatch = {
            expected: preferred,
            observed: token,
            ratio
        };
    }
    if (!mismatch) {
        return { score: 0 };
    }
    return {
        score: clamp01(mismatch.ratio),
        evidence: {
            metric: 'abbreviation preference likelihood',
            expected: mismatch.expected,
            observed: mismatch.observed,
            ratio: mismatch.ratio
        }
    };
}
function computeTokenRarity(symbol, profile) {
    const tokens = (0, nameUtils_1.splitIdentifierTokens)(symbol.name)
        .map((token) => (0, nameUtils_1.normalizeToken)(token))
        .filter(Boolean);
    if (tokens.length === 0) {
        return { score: 0 };
    }
    const totalFrequency = Object.values(profile.tokenFrequencies).reduce((sum, count) => sum + count, 0);
    if (totalFrequency <= 0) {
        return { score: 0 };
    }
    let raritySum = 0;
    for (const token of tokens) {
        const tokenCount = profile.tokenFrequencies[token] ?? 0;
        const probability = tokenCount / totalFrequency;
        const rarity = tokenCount <= 0 ? 1 : 1 - Math.min(1, probability * 25);
        raritySum += rarity;
    }
    const score = clamp01(raritySum / tokens.length);
    if (score < 0.6) {
        return { score: 0 };
    }
    return {
        score,
        evidence: {
            metric: 'token rarity',
            expected: 'common project tokens',
            observed: symbol.name,
            ratio: 1 - score
        }
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
//# sourceMappingURL=statisticalAnomaly.js.map