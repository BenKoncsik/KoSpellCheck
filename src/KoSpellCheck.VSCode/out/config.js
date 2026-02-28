"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultConfig = defaultConfig;
exports.loadConfig = loadConfig;
exports.compileIgnorePatterns = compileIgnorePatterns;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const DEFAULT_CONFIG = {
    enabled: true,
    languages: ['hu', 'en'],
    allowMixedLanguages: true,
    preferTerms: {},
    treatAsHungarianWhenAsciiOnly: true,
    ignoreWords: [],
    projectDictionary: [],
    ignorePatterns: [
        '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$',
        '^https?://',
        '^(0x)?[0-9a-fA-F]{8,}$'
    ],
    minTokenLength: 2,
    maxTokenLength: 64,
    ignoreAllCapsLengthThreshold: 4,
    suggestionsMax: 5,
    maxTokensPerDocument: 2000
};
function defaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}
function loadConfig(workspaceRoot) {
    const merged = defaultConfig();
    if (!workspaceRoot) {
        return merged;
    }
    const editorConfigPath = node_path_1.default.join(workspaceRoot, '.editorconfig');
    if (node_fs_1.default.existsSync(editorConfigPath)) {
        applyEditorConfig(merged, node_fs_1.default.readFileSync(editorConfigPath, 'utf8'));
    }
    const jsonPath = node_path_1.default.join(workspaceRoot, 'kospellcheck.json');
    if (node_fs_1.default.existsSync(jsonPath)) {
        applyJsonConfig(merged, JSON.parse(node_fs_1.default.readFileSync(jsonPath, 'utf8')));
    }
    return merged;
}
function compileIgnorePatterns(patterns) {
    const output = [];
    for (const pattern of patterns) {
        try {
            output.push(new RegExp(pattern));
        }
        catch {
            // ignore invalid regex
        }
    }
    return output;
}
function applyEditorConfig(config, content) {
    const lines = content.split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) {
            continue;
        }
        const idx = line.indexOf('=');
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        switch (key) {
            case 'kospellcheck_enabled':
                config.enabled = parseBool(value, config.enabled);
                break;
            case 'kospellcheck_languages':
                config.languages = parseList(value);
                break;
            case 'kospellcheck_allow_mixed_languages':
                config.allowMixedLanguages = parseBool(value, config.allowMixedLanguages);
                break;
            case 'kospellcheck_treat_as_hungarian_when_ascii_only':
                config.treatAsHungarianWhenAsciiOnly = parseBool(value, config.treatAsHungarianWhenAsciiOnly);
                break;
            case 'kospellcheck_ignore_words':
                config.ignoreWords = parseList(value);
                break;
            case 'kospellcheck_project_dictionary':
                config.projectDictionary = parseList(value);
                break;
            case 'kospellcheck_ignore_patterns':
                config.ignorePatterns = parseList(value);
                break;
            case 'kospellcheck_min_token_length':
                config.minTokenLength = parseIntOr(value, config.minTokenLength);
                break;
            case 'kospellcheck_max_token_length':
                config.maxTokenLength = parseIntOr(value, config.maxTokenLength);
                break;
            case 'kospellcheck_ignore_all_caps_length_threshold':
                config.ignoreAllCapsLengthThreshold = parseIntOr(value, config.ignoreAllCapsLengthThreshold);
                break;
            case 'kospellcheck_suggestions_max':
                config.suggestionsMax = parseIntOr(value, config.suggestionsMax);
                break;
            case 'kospellcheck_prefer_terms':
                config.preferTerms = parsePreferTerms(value);
                break;
        }
    }
}
function applyJsonConfig(config, input) {
    if (typeof input.enabled === 'boolean')
        config.enabled = input.enabled;
    if (Array.isArray(input.languages) && input.languages.length > 0)
        config.languages = input.languages;
    if (typeof input.allowMixedLanguages === 'boolean')
        config.allowMixedLanguages = input.allowMixedLanguages;
    if (input.preferTerms)
        config.preferTerms = input.preferTerms;
    if (typeof input.treatAsHungarianWhenAsciiOnly === 'boolean') {
        config.treatAsHungarianWhenAsciiOnly = input.treatAsHungarianWhenAsciiOnly;
    }
    if (Array.isArray(input.ignoreWords))
        config.ignoreWords = input.ignoreWords;
    if (Array.isArray(input.projectDictionary))
        config.projectDictionary = input.projectDictionary;
    if (Array.isArray(input.ignorePatterns))
        config.ignorePatterns = input.ignorePatterns;
    if (typeof input.minTokenLength === 'number')
        config.minTokenLength = input.minTokenLength;
    if (typeof input.maxTokenLength === 'number')
        config.maxTokenLength = input.maxTokenLength;
    if (typeof input.ignoreAllCapsLengthThreshold === 'number') {
        config.ignoreAllCapsLengthThreshold = input.ignoreAllCapsLengthThreshold;
    }
    if (typeof input.suggestionsMax === 'number')
        config.suggestionsMax = input.suggestionsMax;
    if (typeof input.maxTokensPerDocument === 'number')
        config.maxTokensPerDocument = input.maxTokensPerDocument;
}
function parseBool(value, fallback) {
    if (value.toLowerCase() === 'true')
        return true;
    if (value.toLowerCase() === 'false')
        return false;
    return fallback;
}
function parseList(value) {
    return value
        .split(/[;,]/g)
        .map((x) => x.trim())
        .filter(Boolean);
}
function parsePreferTerms(value) {
    const output = {};
    for (const pair of parseList(value)) {
        const idx = pair.indexOf(':');
        if (idx <= 0) {
            continue;
        }
        const key = pair.slice(0, idx).trim();
        const mapped = pair.slice(idx + 1).trim();
        if (key && mapped) {
            output[key.toLowerCase()] = mapped.toLowerCase();
        }
    }
    return output;
}
function parseIntOr(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}
//# sourceMappingURL=config.js.map