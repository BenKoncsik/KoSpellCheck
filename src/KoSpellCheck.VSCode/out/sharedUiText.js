"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSharedUiText = initializeSharedUiText;
exports.normalizeConfiguredUiLanguage = normalizeConfiguredUiLanguage;
exports.resolveUiLanguage = resolveUiLanguage;
exports.text = text;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const DEFAULT_LANGUAGE = 'en';
const SHARED_CATALOG_RELATIVE_PATH = node_path_1.default.join('resources', 'i18n', 'shared-ui-strings.json');
let hostLanguage = DEFAULT_LANGUAGE;
let configuredDefaultLanguage = DEFAULT_LANGUAGE;
let catalogByLanguage = {
    en: {},
    hu: {}
};
function initializeSharedUiText(extensionPath, hostLocale) {
    hostLanguage = toSupportedLanguage(hostLocale);
    const catalogPath = node_path_1.default.join(extensionPath, SHARED_CATALOG_RELATIVE_PATH);
    if (!node_fs_1.default.existsSync(catalogPath)) {
        return;
    }
    try {
        const raw = node_fs_1.default.readFileSync(catalogPath, 'utf8');
        const parsed = JSON.parse(raw);
        const languages = parsed.languages ?? {};
        const en = safeLanguageMap(languages.en);
        const hu = safeLanguageMap(languages.hu);
        catalogByLanguage = {
            en,
            hu
        };
        configuredDefaultLanguage = toSupportedLanguage(parsed.defaultLanguage);
    }
    catch {
        // fall back to built-in defaults (key fallback strings)
    }
}
function normalizeConfiguredUiLanguage(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return 'auto';
    }
    switch (value.trim().toLowerCase()) {
        case 'auto':
        case 'system':
            return 'auto';
        case 'en':
        case 'eng':
        case 'english':
            return 'en';
        case 'hu':
        case 'hun':
        case 'hungarian':
        case 'magyar':
            return 'hu';
        default:
            return 'auto';
    }
}
function resolveUiLanguage(configuredLanguage) {
    const normalized = normalizeConfiguredUiLanguage(configuredLanguage);
    return normalized === 'auto' ? hostLanguage : normalized;
}
function text(key, fallback, options) {
    const language = options?.language ?? resolveUiLanguage(options?.configuredLanguage);
    const template = catalogByLanguage[language]?.[key] ??
        catalogByLanguage[configuredDefaultLanguage]?.[key] ??
        fallback;
    return formatTemplate(template, options?.args);
}
function formatTemplate(template, args) {
    if (!args || Object.keys(args).length === 0) {
        return template;
    }
    return template.replace(/\{([A-Za-z0-9_.-]+)\}/gu, (_, token) => {
        const value = args[token];
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
    });
}
function safeLanguageMap(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }
    const output = {};
    for (const [key, raw] of Object.entries(value)) {
        if (typeof raw !== 'string' || key.trim().length === 0 || raw.trim().length === 0) {
            continue;
        }
        output[key.trim()] = raw;
    }
    return output;
}
function toSupportedLanguage(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return DEFAULT_LANGUAGE;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized.startsWith('hu')) {
        return 'hu';
    }
    return 'en';
}
//# sourceMappingURL=sharedUiText.js.map