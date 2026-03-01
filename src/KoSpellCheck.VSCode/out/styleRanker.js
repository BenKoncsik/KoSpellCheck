"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rankSuggestionsByStyle = rankSuggestionsByStyle;
const normalization_1 = require("./normalization");
function rankSuggestionsByStyle(originalToken, suggestions, config, profile) {
    if (suggestions.length <= 1) {
        return suggestions;
    }
    const originalNormalized = normalizeStyleKey(originalToken);
    return suggestions
        .map((suggestion, index) => ({
        suggestion,
        index,
        score: computeScore(originalNormalized, suggestion, config, profile)
    }))
        .sort((a, b) => {
        if (a.score !== b.score) {
            return b.score - a.score;
        }
        return a.index - b.index;
    })
        .map((entry) => entry.suggestion);
}
function computeScore(originalNormalized, suggestion, config, profile) {
    let score = suggestion.confidence;
    if (isPreferredTermOverride(originalNormalized, suggestion.replacement, config)) {
        score += 1000;
    }
    if (!profile) {
        return score;
    }
    const replacementNormalized = normalizeStyleKey(suggestion.replacement);
    const stats = profile.tokenStats[replacementNormalized];
    if (!stats || stats.totalCount <= 0) {
        return score;
    }
    if (stats.preferredVariant === suggestion.replacement) {
        score += 100;
    }
    const dominantPattern = resolveDominantPattern(stats);
    if (dominantPattern !== 'unknown' && classifyPattern(suggestion.replacement) === dominantPattern) {
        score += 50;
    }
    score += Math.min(25, stats.totalCount);
    return score;
}
function isPreferredTermOverride(originalNormalized, replacement, config) {
    const replacementNormalized = (0, normalization_1.normalize)(replacement);
    for (const [key, value] of Object.entries(config.preferTerms)) {
        if ((0, normalization_1.normalize)(key) !== originalNormalized) {
            continue;
        }
        return (0, normalization_1.normalize)(value) === replacementNormalized;
    }
    return false;
}
function resolveDominantPattern(stats) {
    const counts = new Map();
    for (const [variant, count] of Object.entries(stats.variants)) {
        const pattern = classifyPattern(variant);
        counts.set(pattern, (counts.get(pattern) ?? 0) + count);
    }
    let winner = 'unknown';
    let maxCount = -1;
    for (const [pattern, count] of counts.entries()) {
        if (count > maxCount) {
            winner = pattern;
            maxCount = count;
        }
    }
    return winner;
}
function classifyPattern(token) {
    if (!token) {
        return 'unknown';
    }
    if (token.includes('_')) {
        if ([...token].every((c) => !isLetter(c) || c === c.toLowerCase())) {
            return 'snake-lower';
        }
        if ([...token].every((c) => !isLetter(c) || c === c.toUpperCase())) {
            return 'snake-upper';
        }
        return 'unknown';
    }
    if (token.includes('-')) {
        if ([...token].every((c) => !isLetter(c) || c === c.toLowerCase())) {
            return 'kebab-lower';
        }
        if ([...token].every((c) => !isLetter(c) || c === c.toUpperCase())) {
            return 'kebab-upper';
        }
        return 'unknown';
    }
    if ([...token].every((c) => !isLetter(c) || c === c.toUpperCase())) {
        return 'upper';
    }
    if ([...token].every((c) => !isLetter(c) || c === c.toLowerCase())) {
        return 'lower';
    }
    if (token[0] === token[0].toUpperCase() && /[\p{Ll}]/u.test(token.slice(1))) {
        return 'pascal';
    }
    if (token[0] === token[0].toLowerCase() && /[\p{Lu}]/u.test(token)) {
        return 'camel';
    }
    return 'unknown';
}
function isLetter(char) {
    return /^\p{L}$/u.test(char);
}
function normalizeStyleKey(value) {
    const normalized = (0, normalization_1.normalize)(value);
    if (!normalized) {
        return '';
    }
    const folded = normalized
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\x00-\x7F]/gu, '')
        .toLowerCase();
    return folded || normalized;
}
//# sourceMappingURL=styleRanker.js.map