"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectCaseStyle = detectCaseStyle;
exports.splitIdentifierTokens = splitIdentifierTokens;
exports.detectKnownSuffix = detectKnownSuffix;
exports.detectKnownPrefix = detectKnownPrefix;
exports.isPluralWord = isPluralWord;
exports.normalizeToken = normalizeToken;
exports.normalizedPathSegments = normalizedPathSegments;
exports.normalizeNamespace = normalizeNamespace;
exports.toPascalCase = toPascalCase;
exports.replaceSuffix = replaceSuffix;
exports.abbreviationToPreferred = abbreviationToPreferred;
exports.suggestFolderFromSuffix = suggestFolderFromSuffix;
exports.similarityScore = similarityScore;
exports.normalizeFolderKey = normalizeFolderKey;
exports.builtInSuffixes = builtInSuffixes;
const knownSuffixes = [
    'Base',
    'Dto',
    'Service',
    'Controller',
    'Repository',
    'ViewModel',
    'Manager',
    'Provider',
    'Factory',
    'Options',
    'Config',
    'Request',
    'Response',
    'Entity',
    'Model',
    'Handler',
    'Command',
    'Query'
];
const knownPrefixes = ['I'];
const abbreviationExpansions = {
    repo: 'Repository',
    svc: 'Service',
    cfg: 'Config',
    ctrl: 'Controller',
    dto: 'Dto',
    vm: 'ViewModel',
    req: 'Request',
    resp: 'Response',
    mgr: 'Manager',
    prov: 'Provider'
};
function detectCaseStyle(value) {
    if (!value) {
        return 'unknown';
    }
    if (/^[A-Z][a-zA-Z0-9]*$/u.test(value)) {
        return 'PascalCase';
    }
    if (/^[a-z][a-zA-Z0-9]*$/u.test(value)) {
        return 'camelCase';
    }
    if (/^[a-z][a-z0-9_]*$/u.test(value) && value.includes('_')) {
        return 'snake_case';
    }
    if (/^[a-z][a-z0-9-]*$/u.test(value) && value.includes('-')) {
        return 'kebab-case';
    }
    if (/^[A-Z][A-Z0-9_]*$/u.test(value) && value.includes('_')) {
        return 'UPPER_CASE';
    }
    return 'unknown';
}
function splitIdentifierTokens(value) {
    if (!value) {
        return [];
    }
    const separated = value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
        .replace(/[_\-.\s]+/g, ' ')
        .trim();
    if (!separated) {
        return [];
    }
    return separated
        .split(/\s+/u)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
}
function detectKnownSuffix(name, additional = []) {
    const suffixes = [...new Set([...additional, ...knownSuffixes])].sort((left, right) => right.length - left.length);
    for (const suffix of suffixes) {
        if (name.length > suffix.length && name.endsWith(suffix)) {
            return suffix;
        }
    }
    return undefined;
}
function detectKnownPrefix(name, additional = []) {
    const prefixes = [...new Set([...additional, ...knownPrefixes])].sort((left, right) => right.length - left.length);
    for (const prefix of prefixes) {
        if (name.length > prefix.length && name.startsWith(prefix)) {
            return prefix;
        }
    }
    return undefined;
}
function isPluralWord(value) {
    if (!value || value.length <= 2) {
        return false;
    }
    const lowered = value.toLowerCase();
    if (lowered.endsWith('ss')) {
        return false;
    }
    return lowered.endsWith('s');
}
function normalizeToken(value) {
    return value
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
}
function normalizedPathSegments(pathValue) {
    return pathValue
        .split(/[\\/]/g)
        .map((segment) => normalizeToken(segment))
        .filter(Boolean);
}
function normalizeNamespace(namespaceValue) {
    return namespaceValue
        .split('.')
        .map((segment) => normalizeToken(segment))
        .filter(Boolean);
}
function toPascalCase(value) {
    const tokens = splitIdentifierTokens(value);
    if (tokens.length === 0) {
        return value;
    }
    return tokens
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join('');
}
function replaceSuffix(name, fromSuffix, toSuffix) {
    if (name.endsWith(fromSuffix) && name.length > fromSuffix.length) {
        return `${name.slice(0, name.length - fromSuffix.length)}${toSuffix}`;
    }
    return `${name}${toSuffix}`;
}
function abbreviationToPreferred(token) {
    return abbreviationExpansions[normalizeToken(token)];
}
function suggestFolderFromSuffix(suffix, folderDominanceBySuffix) {
    if (!suffix) {
        return undefined;
    }
    return folderDominanceBySuffix[suffix];
}
function similarityScore(left, right) {
    if (left.length === 0 || right.length === 0) {
        return 0;
    }
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    let intersect = 0;
    for (const token of leftSet) {
        if (rightSet.has(token)) {
            intersect += 1;
        }
    }
    const union = new Set([...leftSet, ...rightSet]).size;
    if (union === 0) {
        return 0;
    }
    return intersect / union;
}
function normalizeFolderKey(pathValue) {
    if (!pathValue || pathValue === '.') {
        return '.';
    }
    return pathValue.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || '.';
}
function builtInSuffixes() {
    return [...knownSuffixes];
}
//# sourceMappingURL=nameUtils.js.map