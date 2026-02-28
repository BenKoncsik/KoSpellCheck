"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDocument = checkDocument;
const normalization_1 = require("./normalization");
const tokenizer_1 = require("./tokenizer");
const config_1 = require("./config");
function checkDocument(text, config, service, options) {
    if (!config.enabled || !text) {
        return [];
    }
    const ignoreRegexes = (0, config_1.compileIgnorePatterns)(config.ignorePatterns);
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
        if (!check.correct) {
            issues.push({
                type: 'misspell',
                token: raw,
                start: token.start,
                end: token.end,
                message: `Possible misspelling: '${raw}'.`,
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
    return issues;
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
function prependPreference(preferred, suggestions, max) {
    const seen = new Set([preferred.toLowerCase()]);
    const merged = [{ replacement: preferred, confidence: 1, sourceDictionary: 'preference' }];
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
function findPreferred(normalized, map) {
    for (const [key, value] of Object.entries(map)) {
        if ((0, normalization_1.normalize)(key) === normalized) {
            return (0, normalization_1.normalize)(value);
        }
    }
    return undefined;
}
//# sourceMappingURL=engine.js.map