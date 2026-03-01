"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectProjectStyleProfile = detectProjectStyleProfile;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const normalization_1 = require("./normalization");
const tokenizer_1 = require("./tokenizer");
const numberRegex = /^\d+(\.\d+)?$/;
const guidRegex = /^[{(]?[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}[)}]?$/;
const hexRegex = /^(0x)?[0-9a-fA-F]{8,}$/;
const urlRegex = /^https?:\/\//i;
const detectorFingerprintVersion = 'style-detector-v2';
async function detectProjectStyleProfile(workspaceRoot, filePaths, config) {
    const started = Date.now();
    const timeBudgetMs = Math.max(250, config.styleLearningTimeBudgetMs);
    const maxTokens = Math.max(1, config.styleLearningMaxTokens);
    const maxFiles = Math.max(1, config.styleLearningMaxFiles);
    const extensionSet = new Set((config.styleLearningFileExtensions.length > 0
        ? config.styleLearningFileExtensions
        : ['cs', 'ts', 'js', 'tsx', 'jsx', 'json', 'md']).map(normalizeExtension));
    const ignoreFolders = new Set(config.styleLearningIgnoreFolders.map((value) => value.toLowerCase()));
    const selected = filePaths
        .filter((filePath) => isSupportedFile(filePath, extensionSet))
        .filter((filePath) => !isIgnoredPath(workspaceRoot, filePath, ignoreFolders))
        .slice(0, maxFiles)
        .sort((left, right) => left.localeCompare(right));
    const optionsFingerprint = [
        detectorFingerprintVersion,
        config.styleLearningEnabled,
        maxFiles,
        maxTokens,
        timeBudgetMs,
        config.styleLearningMinTokenLength,
        config.ignoreAllCapsLengthThreshold,
        [...extensionSet].sort().join(','),
        [...ignoreFolders].sort().join(',')
    ].join('|');
    const fingerprint = await buildFingerprint(workspaceRoot, selected, optionsFingerprint);
    const cachePath = resolveCachePath(workspaceRoot, config.styleLearningCachePath);
    const cached = await tryLoadCache(cachePath, workspaceRoot, fingerprint);
    if (cached) {
        return cached;
    }
    const profile = createEmptyProfile(workspaceRoot);
    const ignoreRegexes = (0, config_1.compileIgnorePatterns)(config.ignorePatterns);
    let processedTokens = 0;
    for (const filePath of selected) {
        if (processedTokens >= maxTokens || Date.now() - started >= timeBudgetMs) {
            break;
        }
        let content;
        try {
            content = await node_fs_1.default.promises.readFile(filePath, 'utf8');
        }
        catch {
            continue;
        }
        const tokens = enumerateStyleTokens(content, config, ignoreRegexes);
        for (const token of tokens) {
            if (processedTokens >= maxTokens || Date.now() - started >= timeBudgetMs) {
                break;
            }
            if (shouldIgnoreToken(token, config.styleLearningMinTokenLength, config.ignoreAllCapsLengthThreshold)) {
                continue;
            }
            const normalizedToken = normalizeStyleKey(token);
            if (!normalizedToken) {
                continue;
            }
            const stats = profile.tokenStats[normalizedToken] ?? createStats();
            stats.totalCount += 1;
            stats.variants[token] = (stats.variants[token] ?? 0) + 1;
            profile.tokenStats[normalizedToken] = stats;
            processedTokens += 1;
        }
    }
    for (const stats of Object.values(profile.tokenStats)) {
        stats.preferredVariant = resolvePreferredVariant(stats);
        stats.confidence = stats.totalCount <= 0 ? 0 : Math.min(1, stats.totalCount / 10);
    }
    profile.updatedAtUtc = new Date().toISOString();
    await trySaveCache(cachePath, fingerprint, profile);
    return profile;
}
function resolveCachePath(workspaceRoot, configuredPath) {
    if (!configuredPath?.trim()) {
        return node_path_1.default.join(workspaceRoot, '.kospellcheck', 'style-profile.json');
    }
    if (node_path_1.default.isAbsolute(configuredPath)) {
        return configuredPath;
    }
    return node_path_1.default.join(workspaceRoot, configuredPath);
}
function createEmptyProfile(workspaceRoot) {
    const now = new Date().toISOString();
    return {
        workspaceRoot,
        createdAtUtc: now,
        updatedAtUtc: now,
        tokenStats: {}
    };
}
function createStats() {
    return {
        totalCount: 0,
        variants: {},
        preferredVariant: '',
        confidence: 0
    };
}
function resolvePreferredVariant(stats) {
    const variants = Object.entries(stats.variants);
    if (variants.length === 0) {
        return '';
    }
    variants.sort((a, b) => {
        if (a[1] !== b[1]) {
            return b[1] - a[1];
        }
        return a[0].localeCompare(b[0]);
    });
    return variants[0][0];
}
function shouldIgnoreToken(token, minTokenLength, allCapsThreshold) {
    if (token.length < Math.max(1, minTokenLength)) {
        return true;
    }
    if ((0, normalization_1.isAllCaps)(token) && token.length <= Math.max(1, allCapsThreshold)) {
        return true;
    }
    return (numberRegex.test(token) ||
        guidRegex.test(token) ||
        hexRegex.test(token) ||
        urlRegex.test(token));
}
function enumerateStyleTokens(content, config, ignoreRegexes) {
    const output = [];
    for (const candidate of (0, tokenizer_1.scanCandidateSpans)(content, ignoreRegexes)) {
        if (isCompositeToken(candidate.value)) {
            output.push(candidate.value);
        }
    }
    for (const token of (0, tokenizer_1.tokenize)(content, config, ignoreRegexes)) {
        output.push(token.value);
    }
    return output;
}
function isCompositeToken(token) {
    if (/[_.\-\\/]/u.test(token)) {
        return true;
    }
    if (token.length < 2) {
        return false;
    }
    for (let i = 1; i < token.length; i++) {
        const prev = token[i - 1];
        const curr = token[i];
        const next = i + 1 < token.length ? token[i + 1] : '';
        if (isBoundary(prev, curr, next)) {
            return true;
        }
    }
    return false;
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
    return /^[\p{L}]$/u.test(char) && char === char.toLowerCase();
}
function isUpper(char) {
    return /^[\p{L}]$/u.test(char) && char === char.toUpperCase();
}
function isLetter(char) {
    return /^[\p{L}]$/u.test(char);
}
function isDigit(char) {
    return /^\d$/u.test(char);
}
function isSupportedFile(filePath, extensionSet) {
    const ext = normalizeExtension(node_path_1.default.extname(filePath));
    if (!ext) {
        return false;
    }
    if (extensionSet.size === 0) {
        return true;
    }
    return extensionSet.has(ext);
}
function isIgnoredPath(workspaceRoot, filePath, ignoreFolders) {
    const relative = node_path_1.default.relative(workspaceRoot, filePath);
    if (!relative || relative.startsWith('..')) {
        return true;
    }
    const segments = relative
        .split(/[\\/]/g)
        .filter(Boolean)
        .map((segment) => segment.toLowerCase());
    return segments.some((segment) => ignoreFolders.has(segment));
}
async function buildFingerprint(workspaceRoot, filePaths, optionsFingerprint) {
    const hash = (0, node_crypto_1.createHash)('sha256');
    hash.update(optionsFingerprint);
    hash.update('|');
    hash.update(workspaceRoot);
    hash.update('|');
    for (const filePath of filePaths) {
        try {
            const stat = await node_fs_1.default.promises.stat(filePath);
            hash.update(node_path_1.default.relative(workspaceRoot, filePath));
            hash.update(':');
            hash.update(String(stat.size));
            hash.update(':');
            hash.update(String(stat.mtimeMs));
            hash.update('|');
        }
        catch {
            // Ignore transient stat failures.
        }
    }
    return hash.digest('hex');
}
async function tryLoadCache(cachePath, workspaceRoot, fingerprint) {
    if (!node_fs_1.default.existsSync(cachePath)) {
        return undefined;
    }
    try {
        const payload = JSON.parse(await node_fs_1.default.promises.readFile(cachePath, 'utf8'));
        if (payload.workspaceRoot !== workspaceRoot || payload.fingerprint !== fingerprint) {
            return undefined;
        }
        if (!payload.profile?.tokenStats) {
            return undefined;
        }
        for (const stats of Object.values(payload.profile.tokenStats)) {
            stats.preferredVariant = resolvePreferredVariant(stats);
            stats.confidence = stats.totalCount <= 0 ? 0 : Math.min(1, stats.totalCount / 10);
        }
        return payload.profile;
    }
    catch {
        return undefined;
    }
}
async function trySaveCache(cachePath, fingerprint, profile) {
    try {
        await node_fs_1.default.promises.mkdir(node_path_1.default.dirname(cachePath), { recursive: true });
        const payload = {
            workspaceRoot: profile.workspaceRoot,
            fingerprint,
            profile
        };
        await node_fs_1.default.promises.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');
    }
    catch {
        // Ignore cache write failures.
    }
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
function normalizeExtension(value) {
    return value.replace(/^\./u, '').trim().toLowerCase();
}
//# sourceMappingURL=styleDetector.js.map