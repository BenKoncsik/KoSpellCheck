"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDocument = checkDocument;
const normalization_1 = require("./normalization");
const tokenizer_1 = require("./tokenizer");
const config_1 = require("./config");
const styleRanker_1 = require("./styleRanker");
function checkDocument(text, config, service, options) {
    if (!config.enabled || !text) {
        return [];
    }
    const ignoreRegexes = (0, config_1.compileIgnorePatterns)(config.ignorePatterns);
    const candidateSpans = (0, tokenizer_1.scanCandidateSpans)(text, ignoreRegexes);
    const tokens = selectTokensForCheck((0, tokenizer_1.tokenize)(text, config, ignoreRegexes), config.maxTokensPerDocument, options?.focusOffsets);
    const ignoreWords = new Set(config.ignoreWords.map((x) => (0, normalization_1.normalize)(x)));
    const projectDictionary = new Set(config.projectDictionary.map((x) => (0, normalization_1.normalize)(x)));
    const issues = [];
    for (const token of tokens) {
        const raw = token.value;
        const normalized = (0, normalization_1.normalize)(raw);
        if (raw.length < config.minTokenLength ||
            raw.length > config.maxTokenLength ||
            ((0, normalization_1.isAllCaps)(raw) && raw.length <= config.ignoreAllCapsLengthThreshold) ||
            ignoreWords.has(normalized) ||
            projectDictionary.has(normalized)) {
            continue;
        }
        const check = service.check(raw, config);
        let suggestions = service.suggest(raw, config);
        const preferred = findPreferred(normalized, config.preferTerms);
        if (preferred && preferred !== normalized) {
            suggestions = prependPreference(preferred, suggestions, config.suggestionsMax);
        }
        const asciiPreferred = findAsciiIdentifierPreference(raw);
        if (asciiPreferred && asciiPreferred !== raw) {
            suggestions = prependSuggestion(asciiPreferred, suggestions, config.suggestionsMax, 'identifier-ascii');
        }
        suggestions = (0, styleRanker_1.rankSuggestionsByStyle)(raw, suggestions, config, options?.styleProfile)
            .slice(0, config.suggestionsMax);
        if (!check.correct) {
            const message = buildMisspellingMessage(raw, suggestions);
            issues.push({
                type: 'misspell',
                token: raw,
                start: token.start,
                end: token.end,
                message,
                languageHint: check.languages[0],
                suggestions: suggestions.slice(0, config.suggestionsMax)
            });
            continue;
        }
        if (preferred && preferred !== normalized) {
            issues.push({
                type: 'preference',
                token: raw,
                start: token.start,
                end: token.end,
                message: `Preferred term is '${preferred}'.`,
                languageHint: check.languages[0],
                suggestions: suggestions.slice(0, config.suggestionsMax)
            });
            continue;
        }
        if (asciiPreferred && asciiPreferred !== raw) {
            issues.push({
                type: 'preference',
                token: raw,
                start: token.start,
                end: token.end,
                message: `Preferred identifier form is '${asciiPreferred}' (ASCII-only).`,
                languageHint: check.languages[0],
                suggestions: suggestions.slice(0, config.suggestionsMax)
            });
        }
        if (config.treatAsHungarianWhenAsciiOnly &&
            check.correct &&
            check.languages.includes('hu') &&
            /^[\x00-\x7F]+$/.test(raw)) {
            const folded = (0, normalization_1.asciiFold)(raw);
            if (folded !== normalized) {
                // no-op, placeholder for future language hint tuning
            }
        }
    }
    return mergeCompoundIdentifierIssues(text, issues, candidateSpans, config.suggestionsMax, config, options?.styleProfile);
}
function selectTokensForCheck(tokens, maxTokens, focusOffsets) {
    if (maxTokens <= 0) {
        return [];
    }
    if (tokens.length <= maxTokens) {
        return tokens;
    }
    const selected = new Set();
    const normalizedFocusOffsets = (focusOffsets ?? []).filter((x) => Number.isFinite(x));
    if (normalizedFocusOffsets.length > 0) {
        const halfWindow = Math.max(25, Math.floor(maxTokens / 6));
        for (const offset of normalizedFocusOffsets) {
            const hit = findTokenIndexAtOffset(tokens, offset);
            if (hit < 0) {
                continue;
            }
            const start = Math.max(0, hit - halfWindow);
            const end = Math.min(tokens.length - 1, hit + halfWindow);
            for (let i = start; i <= end; i++) {
                selected.add(i);
                if (selected.size >= maxTokens) {
                    break;
                }
            }
            if (selected.size >= maxTokens) {
                break;
            }
        }
    }
    for (let i = 0; i < tokens.length && selected.size < maxTokens; i++) {
        selected.add(i);
    }
    return [...selected]
        .sort((a, b) => a - b)
        .map((idx) => tokens[idx]);
}
function findTokenIndexAtOffset(tokens, offset) {
    let left = 0;
    let right = tokens.length - 1;
    while (left <= right) {
        const mid = (left + right) >> 1;
        const token = tokens[mid];
        if (offset < token.start) {
            right = mid - 1;
            continue;
        }
        if (offset >= token.end) {
            left = mid + 1;
            continue;
        }
        return mid;
    }
    if (left < tokens.length) {
        return left;
    }
    return tokens.length - 1;
}
function buildMisspellingMessage(raw, suggestions) {
    if (suggestions.length === 0) {
        return `Possible misspelling: '${raw}'.`;
    }
    const preview = suggestions
        .slice(0, 3)
        .map((x) => x.replacement)
        .join(', ');
    return `Possible misspelling: '${raw}'. Suggestions: ${preview}`;
}
function mergeCompoundIdentifierIssues(text, issues, candidateSpans, maxSuggestions, config, styleProfile) {
    const misspellEntries = issues
        .map((issue, index) => ({ issue, index }))
        .filter((entry) => entry.issue.type === 'misspell');
    if (misspellEntries.length < 2) {
        return issues;
    }
    const coveredIssueIndexes = new Set();
    const combinedIssues = [];
    for (const candidate of candidateSpans) {
        const related = misspellEntries
            .filter((entry) => !coveredIssueIndexes.has(entry.index) &&
            entry.issue.start >= candidate.start &&
            entry.issue.end <= candidate.end)
            .sort((a, b) => a.issue.start - b.issue.start);
        if (related.length < 2) {
            continue;
        }
        let cursor = candidate.start;
        let replacement = '';
        let confidenceSum = 0;
        let canMerge = true;
        for (const entry of related) {
            if (entry.issue.start < cursor) {
                canMerge = false;
                break;
            }
            const topSuggestion = entry.issue.suggestions[0];
            if (!topSuggestion?.replacement) {
                canMerge = false;
                break;
            }
            replacement += text.slice(cursor, entry.issue.start);
            replacement += topSuggestion.replacement;
            cursor = entry.issue.end;
            confidenceSum += topSuggestion.confidence;
        }
        if (!canMerge) {
            continue;
        }
        replacement += text.slice(cursor, candidate.end);
        if (!replacement || replacement === candidate.value) {
            continue;
        }
        const suggestion = {
            replacement,
            confidence: Math.max(0.55, confidenceSum / related.length),
            sourceDictionary: 'compound-identifier'
        };
        const rankedSuggestions = (0, styleRanker_1.rankSuggestionsByStyle)(candidate.value, [suggestion], config, styleProfile);
        combinedIssues.push({
            type: 'misspell',
            token: candidate.value,
            start: candidate.start,
            end: candidate.end,
            message: `Possible misspelling: '${candidate.value}'. Suggestions: ${replacement}`,
            languageHint: related[0].issue.languageHint,
            suggestions: rankedSuggestions.slice(0, maxSuggestions)
        });
        for (const entry of related) {
            coveredIssueIndexes.add(entry.index);
        }
    }
    if (combinedIssues.length === 0) {
        return issues;
    }
    return [...issues.filter((_, idx) => !coveredIssueIndexes.has(idx)), ...combinedIssues].sort((a, b) => a.start - b.start || a.end - b.end);
}
function prependPreference(preferred, suggestions, max) {
    return prependSuggestion(preferred, suggestions, max, 'preference');
}
function prependSuggestion(replacement, suggestions, max, sourceDictionary) {
    const normalizedReplacement = replacement.toLowerCase();
    const seen = new Set([normalizedReplacement]);
    const merged = [{ replacement, confidence: 1, sourceDictionary }];
    for (const item of suggestions) {
        if (seen.has(item.replacement.toLowerCase())) {
            continue;
        }
        seen.add(item.replacement.toLowerCase());
        merged.push(item);
        if (merged.length >= max) {
            break;
        }
    }
    return merged;
}
function findAsciiIdentifierPreference(token) {
    if (!isLikelyIdentifierToken(token)) {
        return undefined;
    }
    if (/^[\x00-\x7F]+$/u.test(token)) {
        return undefined;
    }
    const folded = token
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\x00-\x7F]/gu, '');
    if (!folded || folded === token) {
        return undefined;
    }
    return folded;
}
function isLikelyIdentifierToken(token) {
    return /^[@\p{L}_][\p{L}\p{M}\p{N}_]*$/u.test(token);
}
function findPreferred(normalized, map) {
    for (const [key, value] of Object.entries(map)) {
        if ((0, normalization_1.normalize)(key) === normalized) {
            return (0, normalization_1.normalize)(value);
        }
    }
    return undefined;
}
//# sourceMappingURL=engine.js.map