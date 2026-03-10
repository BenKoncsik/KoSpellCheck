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
    uiLanguage: 'auto',
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
    maxTokensPerDocument: 2000,
    workspaceStoragePath: '',
    styleLearningEnabled: true,
    styleLearningMaxFiles: 2000,
    styleLearningMaxTokens: 200000,
    styleLearningTimeBudgetMs: 2000,
    styleLearningFileExtensions: ['cs', 'ts', 'js', 'tsx', 'jsx', 'json', 'md'],
    styleLearningCachePath: '.kospellcheck/style-profile.json',
    styleLearningMinTokenLength: 3,
    styleLearningIgnoreFolders: ['bin', 'obj', 'node_modules', '.git', '.vs', 'artifacts'],
    localTypoAccelerationMode: 'auto',
    localTypoAccelerationModel: 'auto',
    localTypoAccelerationShowDetectionPrompt: true,
    localTypoAccelerationVerboseLogging: false,
    localTypoAccelerationAutoDownloadRuntime: true,
    projectConventionMappingEnabled: true,
    namingConventionDiagnosticsEnabled: true,
    statisticalAnomalyDetectionEnabled: true,
    aiNamingAnomalyDetectionEnabled: false,
    useCoralTpuIfAvailable: false,
    autoRebuildConventionProfile: true,
    conventionAnalyzeOnSave: true,
    conventionAnalyzeOnRename: true,
    conventionAnalyzeOnNewFile: true,
    conventionScope: 'workspace',
    conventionIgnoreGeneratedCode: true,
    conventionIgnoreTestProjects: false,
    projectConventionIncludePatterns: [],
    projectConventionExcludePatterns: [
        '**/bin/**',
        '**/obj/**',
        '**/node_modules/**',
        '**/.git/**',
        '**/.vs/**',
        '**/artifacts/**'
    ],
    projectConventionSupportedExtensions: ['cs', 'ts', 'tsx', 'js', 'jsx'],
    projectConventionMaxFiles: 6000,
    projectConventionMinEvidenceCount: 6,
    statisticalAnomalyThreshold: 0.62,
    aiAnomalyThreshold: 0.7,
    projectConventionProfilePath: '.kospellcheck/project-conventions.json',
    projectConventionProfileCachePath: '.kospellcheck/project-profile-cache.json',
    projectConventionAnomalyModelPath: '.kospellcheck/project-anomaly-model.json',
    projectConventionScanSummaryPath: '.kospellcheck/project-scan-summary.json',
    projectConventionIgnoreListPath: '.kospellcheck/convention-ignores.json'
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
            case 'kospellcheck_ui_language':
                config.uiLanguage = parseUiLanguage(value, config.uiLanguage);
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
            case 'kospellcheck_workspace_storage_path':
                config.workspaceStoragePath = value;
                break;
            case 'kospellcheck_prefer_terms':
                config.preferTerms = parsePreferTerms(value);
                break;
            case 'kospellcheck_style_learning':
                config.styleLearningEnabled = parseBool(value, config.styleLearningEnabled);
                break;
            case 'kospellcheck_style_learning_max_files':
                config.styleLearningMaxFiles = parseIntOr(value, config.styleLearningMaxFiles);
                break;
            case 'kospellcheck_style_learning_max_tokens':
                config.styleLearningMaxTokens = parseIntOr(value, config.styleLearningMaxTokens);
                break;
            case 'kospellcheck_style_learning_time_budget_ms':
                config.styleLearningTimeBudgetMs = parseIntOr(value, config.styleLearningTimeBudgetMs);
                break;
            case 'kospellcheck_style_learning_file_extensions':
                config.styleLearningFileExtensions = parseList(value).map(normalizeExtension).filter(Boolean);
                break;
            case 'kospellcheck_style_learning_cache_path':
                config.styleLearningCachePath = value;
                break;
            case 'kospellcheck_style_learning_min_token_length':
                config.styleLearningMinTokenLength = parseIntOr(value, config.styleLearningMinTokenLength);
                break;
            case 'kospellcheck_style_learning_ignore_folders':
                config.styleLearningIgnoreFolders = parseList(value);
                break;
            case 'kospellcheck_local_typo_acceleration_mode':
                config.localTypoAccelerationMode = parseTypoAccelerationMode(value, config.localTypoAccelerationMode);
                break;
            case 'kospellcheck_local_typo_acceleration_model':
                config.localTypoAccelerationModel = value || config.localTypoAccelerationModel;
                break;
            case 'kospellcheck_local_typo_acceleration_show_detection_prompt':
                config.localTypoAccelerationShowDetectionPrompt = parseBool(value, config.localTypoAccelerationShowDetectionPrompt);
                break;
            case 'kospellcheck_local_typo_acceleration_verbose_logging':
                config.localTypoAccelerationVerboseLogging = parseBool(value, config.localTypoAccelerationVerboseLogging);
                break;
            case 'kospellcheck_local_typo_acceleration_auto_download_runtime':
                config.localTypoAccelerationAutoDownloadRuntime = parseBool(value, config.localTypoAccelerationAutoDownloadRuntime);
                break;
            case 'kospellcheck_project_convention_mapping_enabled':
                config.projectConventionMappingEnabled = parseBool(value, config.projectConventionMappingEnabled);
                break;
            case 'kospellcheck_naming_convention_diagnostics_enabled':
                config.namingConventionDiagnosticsEnabled = parseBool(value, config.namingConventionDiagnosticsEnabled);
                break;
            case 'kospellcheck_statistical_anomaly_detection_enabled':
                config.statisticalAnomalyDetectionEnabled = parseBool(value, config.statisticalAnomalyDetectionEnabled);
                break;
            case 'kospellcheck_ai_naming_anomaly_detection_enabled':
                config.aiNamingAnomalyDetectionEnabled = parseBool(value, config.aiNamingAnomalyDetectionEnabled);
                break;
            case 'kospellcheck_use_coral_tpu_if_available':
                config.useCoralTpuIfAvailable = parseBool(value, config.useCoralTpuIfAvailable);
                break;
            case 'kospellcheck_auto_rebuild_convention_profile':
                config.autoRebuildConventionProfile = parseBool(value, config.autoRebuildConventionProfile);
                break;
            case 'kospellcheck_convention_analyze_on_save':
                config.conventionAnalyzeOnSave = parseBool(value, config.conventionAnalyzeOnSave);
                break;
            case 'kospellcheck_convention_analyze_on_rename':
                config.conventionAnalyzeOnRename = parseBool(value, config.conventionAnalyzeOnRename);
                break;
            case 'kospellcheck_convention_analyze_on_new_file':
                config.conventionAnalyzeOnNewFile = parseBool(value, config.conventionAnalyzeOnNewFile);
                break;
            case 'kospellcheck_convention_scope': {
                const normalized = value.trim().toLowerCase();
                if (normalized === 'workspace' || normalized === 'solution') {
                    config.conventionScope = normalized;
                }
                break;
            }
            case 'kospellcheck_convention_ignore_generated_code':
                config.conventionIgnoreGeneratedCode = parseBool(value, config.conventionIgnoreGeneratedCode);
                break;
            case 'kospellcheck_convention_ignore_test_projects':
                config.conventionIgnoreTestProjects = parseBool(value, config.conventionIgnoreTestProjects);
                break;
            case 'kospellcheck_project_convention_include_patterns':
                config.projectConventionIncludePatterns = parseList(value);
                break;
            case 'kospellcheck_project_convention_exclude_patterns':
                config.projectConventionExcludePatterns = parseList(value);
                break;
            case 'kospellcheck_project_convention_supported_extensions':
                config.projectConventionSupportedExtensions = parseList(value)
                    .map(normalizeExtension)
                    .filter(Boolean);
                break;
            case 'kospellcheck_project_convention_max_files':
                config.projectConventionMaxFiles = parseIntOr(value, config.projectConventionMaxFiles);
                break;
            case 'kospellcheck_project_convention_min_evidence_count':
                config.projectConventionMinEvidenceCount = parseIntOr(value, config.projectConventionMinEvidenceCount);
                break;
            case 'kospellcheck_statistical_anomaly_threshold':
                config.statisticalAnomalyThreshold = parseFloatOr(value, config.statisticalAnomalyThreshold);
                break;
            case 'kospellcheck_ai_anomaly_threshold':
                config.aiAnomalyThreshold = parseFloatOr(value, config.aiAnomalyThreshold);
                break;
            case 'kospellcheck_project_convention_profile_path':
                config.projectConventionProfilePath = value || config.projectConventionProfilePath;
                break;
            case 'kospellcheck_project_convention_profile_cache_path':
                config.projectConventionProfileCachePath = value || config.projectConventionProfileCachePath;
                break;
            case 'kospellcheck_project_convention_anomaly_model_path':
                config.projectConventionAnomalyModelPath = value || config.projectConventionAnomalyModelPath;
                break;
            case 'kospellcheck_project_convention_scan_summary_path':
                config.projectConventionScanSummaryPath = value || config.projectConventionScanSummaryPath;
                break;
            case 'kospellcheck_project_convention_ignore_list_path':
                config.projectConventionIgnoreListPath = value || config.projectConventionIgnoreListPath;
                break;
        }
    }
}
function applyJsonConfig(config, input) {
    if (typeof input.enabled === 'boolean')
        config.enabled = input.enabled;
    if (typeof input.uiLanguage === 'string') {
        config.uiLanguage = parseUiLanguage(input.uiLanguage, config.uiLanguage);
    }
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
    if (typeof input.workspaceStoragePath === 'string') {
        config.workspaceStoragePath = input.workspaceStoragePath;
    }
    if (typeof input.styleLearningEnabled === 'boolean')
        config.styleLearningEnabled = input.styleLearningEnabled;
    if (typeof input.styleLearningMaxFiles === 'number')
        config.styleLearningMaxFiles = input.styleLearningMaxFiles;
    if (typeof input.styleLearningMaxTokens === 'number')
        config.styleLearningMaxTokens = input.styleLearningMaxTokens;
    if (typeof input.styleLearningTimeBudgetMs === 'number') {
        config.styleLearningTimeBudgetMs = input.styleLearningTimeBudgetMs;
    }
    if (Array.isArray(input.styleLearningFileExtensions) && input.styleLearningFileExtensions.length > 0) {
        config.styleLearningFileExtensions = input.styleLearningFileExtensions.map(normalizeExtension).filter(Boolean);
    }
    if (typeof input.styleLearningCachePath === 'string' && input.styleLearningCachePath.trim().length > 0) {
        config.styleLearningCachePath = input.styleLearningCachePath;
    }
    if (typeof input.styleLearningMinTokenLength === 'number') {
        config.styleLearningMinTokenLength = input.styleLearningMinTokenLength;
    }
    if (Array.isArray(input.styleLearningIgnoreFolders) && input.styleLearningIgnoreFolders.length > 0) {
        config.styleLearningIgnoreFolders = input.styleLearningIgnoreFolders;
    }
    const localTypoAccelerationInput = input.localTypoAcceleration;
    const mode = localTypoAccelerationInput?.mode ?? input.localTypoAccelerationMode;
    if (typeof mode === 'string') {
        config.localTypoAccelerationMode = parseTypoAccelerationMode(mode, config.localTypoAccelerationMode);
    }
    const model = localTypoAccelerationInput?.model ??
        input.localTypoAccelerationModel;
    if (typeof model === 'string' && model.trim().length > 0) {
        config.localTypoAccelerationModel = model.trim();
    }
    const showPrompt = localTypoAccelerationInput?.showDetectionPrompt ??
        input.localTypoAccelerationShowDetectionPrompt;
    if (typeof showPrompt === 'boolean') {
        config.localTypoAccelerationShowDetectionPrompt = showPrompt;
    }
    const verbose = localTypoAccelerationInput?.verboseLogging ??
        input.localTypoAccelerationVerboseLogging;
    if (typeof verbose === 'boolean') {
        config.localTypoAccelerationVerboseLogging = verbose;
    }
    const autoDownload = localTypoAccelerationInput?.autoDownloadRuntime ??
        input.localTypoAccelerationAutoDownloadRuntime;
    if (typeof autoDownload === 'boolean') {
        config.localTypoAccelerationAutoDownloadRuntime = autoDownload;
    }
    const projectConventionsInput = input.projectConventions;
    const conventionEnabled = projectConventionsInput?.enabled ??
        input.projectConventionMappingEnabled;
    if (typeof conventionEnabled === 'boolean') {
        config.projectConventionMappingEnabled = conventionEnabled;
    }
    const namingDiagnosticsEnabled = projectConventionsInput?.namingDiagnosticsEnabled ??
        input.namingConventionDiagnosticsEnabled;
    if (typeof namingDiagnosticsEnabled === 'boolean') {
        config.namingConventionDiagnosticsEnabled = namingDiagnosticsEnabled;
    }
    const statisticalEnabled = projectConventionsInput?.statisticalAnomalyDetectionEnabled ??
        input.statisticalAnomalyDetectionEnabled;
    if (typeof statisticalEnabled === 'boolean') {
        config.statisticalAnomalyDetectionEnabled = statisticalEnabled;
    }
    const aiEnabled = projectConventionsInput?.aiNamingAnomalyDetectionEnabled ??
        input.aiNamingAnomalyDetectionEnabled;
    if (typeof aiEnabled === 'boolean') {
        config.aiNamingAnomalyDetectionEnabled = aiEnabled;
    }
    const coralEnabled = projectConventionsInput?.useCoralTpuIfAvailable ??
        input.useCoralTpuIfAvailable;
    if (typeof coralEnabled === 'boolean') {
        config.useCoralTpuIfAvailable = coralEnabled;
    }
    const autoRebuild = projectConventionsInput?.autoRebuild ??
        input.autoRebuildConventionProfile;
    if (typeof autoRebuild === 'boolean') {
        config.autoRebuildConventionProfile = autoRebuild;
    }
    const analyzeOnSave = projectConventionsInput?.analyzeOnSave ??
        input.conventionAnalyzeOnSave;
    if (typeof analyzeOnSave === 'boolean') {
        config.conventionAnalyzeOnSave = analyzeOnSave;
    }
    const analyzeOnRename = projectConventionsInput?.analyzeOnRename ??
        input.conventionAnalyzeOnRename;
    if (typeof analyzeOnRename === 'boolean') {
        config.conventionAnalyzeOnRename = analyzeOnRename;
    }
    const analyzeOnNewFile = projectConventionsInput?.analyzeOnNewFile ??
        input.conventionAnalyzeOnNewFile;
    if (typeof analyzeOnNewFile === 'boolean') {
        config.conventionAnalyzeOnNewFile = analyzeOnNewFile;
    }
    const scope = projectConventionsInput?.scope ??
        input.conventionScope;
    if (typeof scope === 'string') {
        const normalizedScope = scope.trim().toLowerCase();
        if (normalizedScope === 'workspace' || normalizedScope === 'solution') {
            config.conventionScope = normalizedScope;
        }
    }
    const ignoreGenerated = projectConventionsInput?.ignoreGeneratedCode ??
        input.conventionIgnoreGeneratedCode;
    if (typeof ignoreGenerated === 'boolean') {
        config.conventionIgnoreGeneratedCode = ignoreGenerated;
    }
    const ignoreTests = projectConventionsInput?.ignoreTestProjects ??
        input.conventionIgnoreTestProjects;
    if (typeof ignoreTests === 'boolean') {
        config.conventionIgnoreTestProjects = ignoreTests;
    }
    const includePatterns = projectConventionsInput?.includePatterns ??
        input.projectConventionIncludePatterns;
    if (Array.isArray(includePatterns)) {
        config.projectConventionIncludePatterns = includePatterns.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
    }
    const excludePatterns = projectConventionsInput?.excludePatterns ??
        input.projectConventionExcludePatterns;
    if (Array.isArray(excludePatterns)) {
        config.projectConventionExcludePatterns = excludePatterns.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
    }
    const supportedExtensions = projectConventionsInput?.supportedExtensions ??
        input.projectConventionSupportedExtensions;
    if (Array.isArray(supportedExtensions) && supportedExtensions.length > 0) {
        config.projectConventionSupportedExtensions = supportedExtensions
            .filter((entry) => typeof entry === 'string')
            .map(normalizeExtension)
            .filter(Boolean);
    }
    const maxFiles = projectConventionsInput?.maxFiles ??
        input.projectConventionMaxFiles;
    if (typeof maxFiles === 'number' && Number.isFinite(maxFiles)) {
        config.projectConventionMaxFiles = Math.max(1, Math.floor(maxFiles));
    }
    const minEvidenceCount = projectConventionsInput?.minEvidenceCount ??
        input.projectConventionMinEvidenceCount;
    if (typeof minEvidenceCount === 'number' && Number.isFinite(minEvidenceCount)) {
        config.projectConventionMinEvidenceCount = Math.max(1, Math.floor(minEvidenceCount));
    }
    const statisticalThreshold = projectConventionsInput?.statisticalAnomalyThreshold ??
        input.statisticalAnomalyThreshold;
    if (typeof statisticalThreshold === 'number' && Number.isFinite(statisticalThreshold)) {
        config.statisticalAnomalyThreshold = clamp01(statisticalThreshold);
    }
    const aiThreshold = projectConventionsInput?.aiAnomalyThreshold ??
        input.aiAnomalyThreshold;
    if (typeof aiThreshold === 'number' && Number.isFinite(aiThreshold)) {
        config.aiAnomalyThreshold = clamp01(aiThreshold);
    }
    const profilePath = projectConventionsInput?.profilePath ??
        input.projectConventionProfilePath;
    if (typeof profilePath === 'string' && profilePath.trim().length > 0) {
        config.projectConventionProfilePath = profilePath.trim();
    }
    const profileCachePath = projectConventionsInput?.profileCachePath ??
        input.projectConventionProfileCachePath;
    if (typeof profileCachePath === 'string' && profileCachePath.trim().length > 0) {
        config.projectConventionProfileCachePath = profileCachePath.trim();
    }
    const anomalyModelPath = projectConventionsInput?.anomalyModelPath ??
        input.projectConventionAnomalyModelPath;
    if (typeof anomalyModelPath === 'string' && anomalyModelPath.trim().length > 0) {
        config.projectConventionAnomalyModelPath = anomalyModelPath.trim();
    }
    const scanSummaryPath = projectConventionsInput?.scanSummaryPath ??
        input.projectConventionScanSummaryPath;
    if (typeof scanSummaryPath === 'string' && scanSummaryPath.trim().length > 0) {
        config.projectConventionScanSummaryPath = scanSummaryPath.trim();
    }
    const ignoreListPath = projectConventionsInput?.ignoreListPath ??
        input.projectConventionIgnoreListPath;
    if (typeof ignoreListPath === 'string' && ignoreListPath.trim().length > 0) {
        config.projectConventionIgnoreListPath = ignoreListPath.trim();
    }
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
function parseFloatOr(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function parseTypoAccelerationMode(value, fallback) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'off' || normalized === 'auto' || normalized === 'on') {
        return normalized;
    }
    return fallback;
}
function parseUiLanguage(value, fallback) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'auto' || normalized === 'system') {
        return 'auto';
    }
    if (normalized === 'en' || normalized === 'eng' || normalized === 'english') {
        return 'en';
    }
    if (normalized === 'hu' ||
        normalized === 'hun' ||
        normalized === 'hungarian' ||
        normalized === 'magyar') {
        return 'hu';
    }
    return fallback;
}
function normalizeExtension(value) {
    return value.trim().replace(/^\./u, '').toLowerCase();
}
function clamp01(value) {
    if (value <= 0) {
        return 0;
    }
    if (value >= 1) {
        return 1;
    }
    return value;
}
//# sourceMappingURL=config.js.map