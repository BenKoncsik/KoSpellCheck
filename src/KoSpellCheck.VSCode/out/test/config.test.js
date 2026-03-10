"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const config_1 = require("../config");
(0, node_test_1.default)('default config enables local typo acceleration auto mode', () => {
    const config = (0, config_1.defaultConfig)();
    node_assert_1.default.equal(config.uiLanguage, 'auto');
    node_assert_1.default.equal(config.localTypoAccelerationMode, 'auto');
    node_assert_1.default.equal(config.localTypoAccelerationModel, 'auto');
    node_assert_1.default.equal(config.localTypoAccelerationShowDetectionPrompt, true);
    node_assert_1.default.equal(config.localTypoAccelerationVerboseLogging, false);
    node_assert_1.default.equal(config.localTypoAccelerationAutoDownloadRuntime, true);
    node_assert_1.default.equal(config.projectConventionMappingEnabled, true);
    node_assert_1.default.equal(config.namingConventionDiagnosticsEnabled, true);
    node_assert_1.default.equal(config.statisticalAnomalyDetectionEnabled, true);
    node_assert_1.default.equal(config.aiNamingAnomalyDetectionEnabled, false);
    node_assert_1.default.equal(config.useCoralTpuIfAvailable, false);
    node_assert_1.default.equal(config.workspaceStoragePath, '');
});
(0, node_test_1.default)('loadConfig reads local typo acceleration settings from kospellcheck.json', () => {
    const workspaceRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'kospellcheck-config-'));
    try {
        node_fs_1.default.writeFileSync(node_path_1.default.join(workspaceRoot, 'kospellcheck.json'), JSON.stringify({
            localTypoAcceleration: {
                mode: 'on',
                model: 'typo_classifier_precision_edgetpu_v1',
                showDetectionPrompt: false,
                verboseLogging: true,
                autoDownloadRuntime: false
            }
        }, null, 2));
        const config = (0, config_1.loadConfig)(workspaceRoot);
        node_assert_1.default.equal(config.localTypoAccelerationMode, 'on');
        node_assert_1.default.equal(config.localTypoAccelerationModel, 'typo_classifier_precision_edgetpu_v1');
        node_assert_1.default.equal(config.localTypoAccelerationShowDetectionPrompt, false);
        node_assert_1.default.equal(config.localTypoAccelerationVerboseLogging, true);
        node_assert_1.default.equal(config.localTypoAccelerationAutoDownloadRuntime, false);
    }
    finally {
        node_fs_1.default.rmSync(workspaceRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)('loadConfig reads local typo acceleration settings from .editorconfig', () => {
    const workspaceRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'kospellcheck-editorconfig-'));
    try {
        node_fs_1.default.writeFileSync(node_path_1.default.join(workspaceRoot, '.editorconfig'), [
            'kospellcheck_local_typo_acceleration_mode = off',
            'kospellcheck_local_typo_acceleration_model = typo_classifier_edgetpu_v1',
            'kospellcheck_local_typo_acceleration_show_detection_prompt = false',
            'kospellcheck_local_typo_acceleration_verbose_logging = true',
            'kospellcheck_local_typo_acceleration_auto_download_runtime = false'
        ].join('\n'));
        const config = (0, config_1.loadConfig)(workspaceRoot);
        node_assert_1.default.equal(config.localTypoAccelerationMode, 'off');
        node_assert_1.default.equal(config.localTypoAccelerationModel, 'typo_classifier_edgetpu_v1');
        node_assert_1.default.equal(config.localTypoAccelerationShowDetectionPrompt, false);
        node_assert_1.default.equal(config.localTypoAccelerationVerboseLogging, true);
        node_assert_1.default.equal(config.localTypoAccelerationAutoDownloadRuntime, false);
    }
    finally {
        node_fs_1.default.rmSync(workspaceRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)('loadConfig reads workspace storage path from kospellcheck.json', () => {
    const workspaceRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'kospellcheck-storage-json-'));
    try {
        node_fs_1.default.writeFileSync(node_path_1.default.join(workspaceRoot, 'kospellcheck.json'), JSON.stringify({
            workspaceStoragePath: '/tmp/ko-storage'
        }, null, 2));
        const config = (0, config_1.loadConfig)(workspaceRoot);
        node_assert_1.default.equal(config.workspaceStoragePath, '/tmp/ko-storage');
    }
    finally {
        node_fs_1.default.rmSync(workspaceRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)('loadConfig reads workspace storage path from .editorconfig', () => {
    const workspaceRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'kospellcheck-storage-editorconfig-'));
    try {
        node_fs_1.default.writeFileSync(node_path_1.default.join(workspaceRoot, '.editorconfig'), [
            'kospellcheck_workspace_storage_path = /tmp/ko-storage-editorconfig'
        ].join('\n'));
        const config = (0, config_1.loadConfig)(workspaceRoot);
        node_assert_1.default.equal(config.workspaceStoragePath, '/tmp/ko-storage-editorconfig');
    }
    finally {
        node_fs_1.default.rmSync(workspaceRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)('loadConfig reads project convention settings from kospellcheck.json', () => {
    const workspaceRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'kospellcheck-conventions-json-'));
    try {
        node_fs_1.default.writeFileSync(node_path_1.default.join(workspaceRoot, 'kospellcheck.json'), JSON.stringify({
            projectConventions: {
                enabled: true,
                namingDiagnosticsEnabled: true,
                statisticalAnomalyDetectionEnabled: true,
                aiNamingAnomalyDetectionEnabled: true,
                useCoralTpuIfAvailable: true,
                autoRebuild: false,
                analyzeOnSave: true,
                analyzeOnRename: false,
                analyzeOnNewFile: false,
                scope: 'solution',
                ignoreGeneratedCode: true,
                ignoreTestProjects: true,
                includePatterns: ['**/*.cs'],
                excludePatterns: ['**/legacy/**'],
                supportedExtensions: ['cs'],
                maxFiles: 1234,
                minEvidenceCount: 7,
                statisticalAnomalyThreshold: 0.64,
                aiAnomalyThreshold: 0.8,
                profilePath: '.kospellcheck/custom-profile.json',
                profileCachePath: '.kospellcheck/custom-cache.json',
                anomalyModelPath: '.kospellcheck/custom-model.json',
                scanSummaryPath: '.kospellcheck/custom-summary.json',
                ignoreListPath: '.kospellcheck/custom-ignore.json'
            }
        }, null, 2));
        const config = (0, config_1.loadConfig)(workspaceRoot);
        node_assert_1.default.equal(config.projectConventionMappingEnabled, true);
        node_assert_1.default.equal(config.namingConventionDiagnosticsEnabled, true);
        node_assert_1.default.equal(config.statisticalAnomalyDetectionEnabled, true);
        node_assert_1.default.equal(config.aiNamingAnomalyDetectionEnabled, true);
        node_assert_1.default.equal(config.useCoralTpuIfAvailable, true);
        node_assert_1.default.equal(config.autoRebuildConventionProfile, false);
        node_assert_1.default.equal(config.conventionAnalyzeOnSave, true);
        node_assert_1.default.equal(config.conventionAnalyzeOnRename, false);
        node_assert_1.default.equal(config.conventionAnalyzeOnNewFile, false);
        node_assert_1.default.equal(config.conventionScope, 'solution');
        node_assert_1.default.equal(config.conventionIgnoreGeneratedCode, true);
        node_assert_1.default.equal(config.conventionIgnoreTestProjects, true);
        node_assert_1.default.deepEqual(config.projectConventionIncludePatterns, ['**/*.cs']);
        node_assert_1.default.deepEqual(config.projectConventionExcludePatterns, ['**/legacy/**']);
        node_assert_1.default.deepEqual(config.projectConventionSupportedExtensions, ['cs']);
        node_assert_1.default.equal(config.projectConventionMaxFiles, 1234);
        node_assert_1.default.equal(config.projectConventionMinEvidenceCount, 7);
        node_assert_1.default.equal(config.statisticalAnomalyThreshold, 0.64);
        node_assert_1.default.equal(config.aiAnomalyThreshold, 0.8);
        node_assert_1.default.equal(config.projectConventionProfilePath, '.kospellcheck/custom-profile.json');
        node_assert_1.default.equal(config.projectConventionProfileCachePath, '.kospellcheck/custom-cache.json');
        node_assert_1.default.equal(config.projectConventionAnomalyModelPath, '.kospellcheck/custom-model.json');
        node_assert_1.default.equal(config.projectConventionScanSummaryPath, '.kospellcheck/custom-summary.json');
        node_assert_1.default.equal(config.projectConventionIgnoreListPath, '.kospellcheck/custom-ignore.json');
    }
    finally {
        node_fs_1.default.rmSync(workspaceRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)('loadConfig reads project convention settings from .editorconfig', () => {
    const workspaceRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'kospellcheck-conventions-editorconfig-'));
    try {
        node_fs_1.default.writeFileSync(node_path_1.default.join(workspaceRoot, '.editorconfig'), [
            'kospellcheck_project_convention_mapping_enabled = false',
            'kospellcheck_naming_convention_diagnostics_enabled = false',
            'kospellcheck_statistical_anomaly_detection_enabled = false',
            'kospellcheck_ai_naming_anomaly_detection_enabled = true',
            'kospellcheck_use_coral_tpu_if_available = true',
            'kospellcheck_auto_rebuild_convention_profile = false',
            'kospellcheck_convention_analyze_on_save = false',
            'kospellcheck_convention_analyze_on_rename = false',
            'kospellcheck_convention_analyze_on_new_file = false',
            'kospellcheck_convention_scope = solution',
            'kospellcheck_convention_ignore_generated_code = false',
            'kospellcheck_convention_ignore_test_projects = true',
            'kospellcheck_project_convention_include_patterns = **/*.cs;**/*.ts',
            'kospellcheck_project_convention_exclude_patterns = **/gen/**;**/legacy/**',
            'kospellcheck_project_convention_supported_extensions = cs;ts',
            'kospellcheck_project_convention_max_files = 777',
            'kospellcheck_project_convention_min_evidence_count = 5',
            'kospellcheck_statistical_anomaly_threshold = 0.55',
            'kospellcheck_ai_anomaly_threshold = 0.73',
            'kospellcheck_project_convention_profile_path = .kospellcheck/profile.json',
            'kospellcheck_project_convention_profile_cache_path = .kospellcheck/cache.json',
            'kospellcheck_project_convention_anomaly_model_path = .kospellcheck/model.json',
            'kospellcheck_project_convention_scan_summary_path = .kospellcheck/summary.json',
            'kospellcheck_project_convention_ignore_list_path = .kospellcheck/ignore.json'
        ].join('\n'));
        const config = (0, config_1.loadConfig)(workspaceRoot);
        node_assert_1.default.equal(config.projectConventionMappingEnabled, false);
        node_assert_1.default.equal(config.namingConventionDiagnosticsEnabled, false);
        node_assert_1.default.equal(config.statisticalAnomalyDetectionEnabled, false);
        node_assert_1.default.equal(config.aiNamingAnomalyDetectionEnabled, true);
        node_assert_1.default.equal(config.useCoralTpuIfAvailable, true);
        node_assert_1.default.equal(config.autoRebuildConventionProfile, false);
        node_assert_1.default.equal(config.conventionAnalyzeOnSave, false);
        node_assert_1.default.equal(config.conventionAnalyzeOnRename, false);
        node_assert_1.default.equal(config.conventionAnalyzeOnNewFile, false);
        node_assert_1.default.equal(config.conventionScope, 'solution');
        node_assert_1.default.equal(config.conventionIgnoreGeneratedCode, false);
        node_assert_1.default.equal(config.conventionIgnoreTestProjects, true);
        node_assert_1.default.deepEqual(config.projectConventionIncludePatterns, ['**/*.cs', '**/*.ts']);
        node_assert_1.default.deepEqual(config.projectConventionExcludePatterns, ['**/gen/**', '**/legacy/**']);
        node_assert_1.default.deepEqual(config.projectConventionSupportedExtensions, ['cs', 'ts']);
        node_assert_1.default.equal(config.projectConventionMaxFiles, 777);
        node_assert_1.default.equal(config.projectConventionMinEvidenceCount, 5);
        node_assert_1.default.equal(config.statisticalAnomalyThreshold, 0.55);
        node_assert_1.default.equal(config.aiAnomalyThreshold, 0.73);
        node_assert_1.default.equal(config.projectConventionProfilePath, '.kospellcheck/profile.json');
        node_assert_1.default.equal(config.projectConventionProfileCachePath, '.kospellcheck/cache.json');
        node_assert_1.default.equal(config.projectConventionAnomalyModelPath, '.kospellcheck/model.json');
        node_assert_1.default.equal(config.projectConventionScanSummaryPath, '.kospellcheck/summary.json');
        node_assert_1.default.equal(config.projectConventionIgnoreListPath, '.kospellcheck/ignore.json');
    }
    finally {
        node_fs_1.default.rmSync(workspaceRoot, { recursive: true, force: true });
    }
});
//# sourceMappingURL=config.test.js.map