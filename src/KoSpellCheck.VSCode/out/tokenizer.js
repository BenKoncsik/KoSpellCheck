"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenize = tokenize;
const candidateRegex = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}_\-./\\']*/gu;
const numberRegex = /^\d+(\.\d+)?$/;
const guidRegex = /^[{(]?[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}[)}]?$/;
const hexRegex = /^(0x)?[0-9a-fA-F]{8,}$/;
const urlRegex = /^https?:\/\//i;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const base64LikeRegex = /^[A-Za-z0-9+/_=-]{24,}$/;
const separators = new Set(['_', '-', '.', '/', '\\']);
function tokenize(text, config, ignoreRegexes) {
    const out = [];
    for (const match of text.matchAll(candidateRegex)) {
        const raw = match[0];
        const index = match.index ?? 0;
        if (shouldIgnoreRaw(raw, ignoreRegexes)) {
            continue;
        }
        const split = splitBySeparatorsAndCasing(raw);
        for (const part of split) {
            if (!part.value) {
                continue;
            }
            out.push({
                value: part.value,
                start: index + part.start,
                end: index + part.end
            });
        }
    }
    return out;
}
function shouldIgnoreRaw(token, ignoreRegexes) {
    if (numberRegex.test(token) ||
        guidRegex.test(token) ||
        hexRegex.test(token) ||
        urlRegex.test(token) ||
        emailRegex.test(token) ||
        base64LikeRegex.test(token)) {
        return true;
    }
    if (looksLikeFilePath(token)) {
        return true;
    }
    for (const regex of ignoreRegexes) {
        if (regex.test(token)) {
            return true;
        }
    }
    return false;
}
function looksLikeFilePath(token) {
    return token.includes('/') || token.includes('\\');
}
function splitBySeparatorsAndCasing(raw) {
    const out = [];
    let chunkStart = 0;
    for (let i = 0; i <= raw.length; i++) {
        const isSeparator = i < raw.length && separators.has(raw[i]);
        if (!isSeparator && i < raw.length) {
            continue;
        }
        if (i > chunkStart) {
            out.push(...splitCamelCase(raw, chunkStart, i));
        }
        chunkStart = i + 1;
    }
    return out;
}
function splitCamelCase(raw, start, end) {
    const out = [];
    let partStart = start;
    for (let i = start + 1; i < end; i++) {
        const prev = raw[i - 1];
        const curr = raw[i];
        const next = i + 1 < end ? raw[i + 1] : '';
        if (!isBoundary(prev, curr, next)) {
            continue;
        }
        out.push({ value: raw.slice(partStart, i), start: partStart, end: i });
        partStart = i;
    }
    if (partStart < end) {
        out.push({ value: raw.slice(partStart, end), start: partStart, end });
    }
    return out;
}
function isBoundary(prev, curr, next) {
    if (isLower(prev) && isUpper(curr)) {
        return true;
    }
    if (isUpper(prev) && isUpper(curr) && !!next && isLower(next)) {
        return true;
    }
    if (isLetter(prev) && isDigit(curr)) {
        return true;
    }
    if (isDigit(prev) && isLetter(curr)) {
        return true;
    }
    return false;
}
function isLower(char) {
    return /^[a-záéíóöőúüű]$/i.test(char) && char === char.toLowerCase();
}
function isUpper(char) {
    return /^[a-záéíóöőúüű]$/i.test(char) && char === char.toUpperCase();
}
function isLetter(char) {
    return /^\p{L}$/u.test(char);
}
function isDigit(char) {
    return /^\d$/.test(char);
}
//# sourceMappingURL=tokenizer.js.map