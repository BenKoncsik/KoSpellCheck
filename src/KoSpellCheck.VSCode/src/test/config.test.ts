import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultConfig, loadConfig } from '../config';

test('default config enables local typo acceleration auto mode', () => {
  const config = defaultConfig();
  assert.equal(config.uiLanguage, 'auto');
  assert.equal(config.localTypoAccelerationMode, 'auto');
  assert.equal(config.localTypoAccelerationModel, 'auto');
  assert.equal(config.localTypoAccelerationShowDetectionPrompt, true);
  assert.equal(config.localTypoAccelerationVerboseLogging, false);
  assert.equal(config.localTypoAccelerationAutoDownloadRuntime, true);
  assert.equal(config.projectConventionMappingEnabled, true);
  assert.equal(config.namingConventionDiagnosticsEnabled, true);
  assert.equal(config.statisticalAnomalyDetectionEnabled, true);
  assert.equal(config.aiNamingAnomalyDetectionEnabled, false);
  assert.equal(config.useCoralTpuIfAvailable, false);
  assert.equal(config.workspaceStoragePath, '');
});

test('loadConfig reads local typo acceleration settings from kospellcheck.json', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kospellcheck-config-'));

  try {
    fs.writeFileSync(
      path.join(workspaceRoot, 'kospellcheck.json'),
      JSON.stringify(
        {
          localTypoAcceleration: {
            mode: 'on',
            model: 'typo_classifier_precision_edgetpu_v1',
            showDetectionPrompt: false,
            verboseLogging: true,
            autoDownloadRuntime: false
          }
        },
        null,
        2
      )
    );

    const config = loadConfig(workspaceRoot);
    assert.equal(config.localTypoAccelerationMode, 'on');
    assert.equal(config.localTypoAccelerationModel, 'typo_classifier_precision_edgetpu_v1');
    assert.equal(config.localTypoAccelerationShowDetectionPrompt, false);
    assert.equal(config.localTypoAccelerationVerboseLogging, true);
    assert.equal(config.localTypoAccelerationAutoDownloadRuntime, false);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('loadConfig reads local typo acceleration settings from .editorconfig', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kospellcheck-editorconfig-'));

  try {
    fs.writeFileSync(
      path.join(workspaceRoot, '.editorconfig'),
      [
        'kospellcheck_local_typo_acceleration_mode = off',
        'kospellcheck_local_typo_acceleration_model = typo_classifier_edgetpu_v1',
        'kospellcheck_local_typo_acceleration_show_detection_prompt = false',
        'kospellcheck_local_typo_acceleration_verbose_logging = true',
        'kospellcheck_local_typo_acceleration_auto_download_runtime = false'
      ].join('\n')
    );

    const config = loadConfig(workspaceRoot);
    assert.equal(config.localTypoAccelerationMode, 'off');
    assert.equal(config.localTypoAccelerationModel, 'typo_classifier_edgetpu_v1');
    assert.equal(config.localTypoAccelerationShowDetectionPrompt, false);
    assert.equal(config.localTypoAccelerationVerboseLogging, true);
    assert.equal(config.localTypoAccelerationAutoDownloadRuntime, false);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('loadConfig reads workspace storage path from kospellcheck.json', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kospellcheck-storage-json-'));

  try {
    fs.writeFileSync(
      path.join(workspaceRoot, 'kospellcheck.json'),
      JSON.stringify(
        {
          workspaceStoragePath: '/tmp/ko-storage'
        },
        null,
        2
      )
    );

    const config = loadConfig(workspaceRoot);
    assert.equal(config.workspaceStoragePath, '/tmp/ko-storage');
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('loadConfig reads workspace storage path from .editorconfig', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kospellcheck-storage-editorconfig-'));

  try {
    fs.writeFileSync(
      path.join(workspaceRoot, '.editorconfig'),
      [
        'kospellcheck_workspace_storage_path = /tmp/ko-storage-editorconfig'
      ].join('\n')
    );

    const config = loadConfig(workspaceRoot);
    assert.equal(config.workspaceStoragePath, '/tmp/ko-storage-editorconfig');
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('loadConfig reads project convention settings from kospellcheck.json', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kospellcheck-conventions-json-'));

  try {
    fs.writeFileSync(
      path.join(workspaceRoot, 'kospellcheck.json'),
      JSON.stringify(
        {
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
        },
        null,
        2
      )
    );

    const config = loadConfig(workspaceRoot);
    assert.equal(config.projectConventionMappingEnabled, true);
    assert.equal(config.namingConventionDiagnosticsEnabled, true);
    assert.equal(config.statisticalAnomalyDetectionEnabled, true);
    assert.equal(config.aiNamingAnomalyDetectionEnabled, true);
    assert.equal(config.useCoralTpuIfAvailable, true);
    assert.equal(config.autoRebuildConventionProfile, false);
    assert.equal(config.conventionAnalyzeOnSave, true);
    assert.equal(config.conventionAnalyzeOnRename, false);
    assert.equal(config.conventionAnalyzeOnNewFile, false);
    assert.equal(config.conventionScope, 'solution');
    assert.equal(config.conventionIgnoreGeneratedCode, true);
    assert.equal(config.conventionIgnoreTestProjects, true);
    assert.deepEqual(config.projectConventionIncludePatterns, ['**/*.cs']);
    assert.deepEqual(config.projectConventionExcludePatterns, ['**/legacy/**']);
    assert.deepEqual(config.projectConventionSupportedExtensions, ['cs']);
    assert.equal(config.projectConventionMaxFiles, 1234);
    assert.equal(config.projectConventionMinEvidenceCount, 7);
    assert.equal(config.statisticalAnomalyThreshold, 0.64);
    assert.equal(config.aiAnomalyThreshold, 0.8);
    assert.equal(config.projectConventionProfilePath, '.kospellcheck/custom-profile.json');
    assert.equal(config.projectConventionProfileCachePath, '.kospellcheck/custom-cache.json');
    assert.equal(config.projectConventionAnomalyModelPath, '.kospellcheck/custom-model.json');
    assert.equal(config.projectConventionScanSummaryPath, '.kospellcheck/custom-summary.json');
    assert.equal(config.projectConventionIgnoreListPath, '.kospellcheck/custom-ignore.json');
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('loadConfig reads project convention settings from .editorconfig', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kospellcheck-conventions-editorconfig-'));

  try {
    fs.writeFileSync(
      path.join(workspaceRoot, '.editorconfig'),
      [
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
      ].join('\n')
    );

    const config = loadConfig(workspaceRoot);
    assert.equal(config.projectConventionMappingEnabled, false);
    assert.equal(config.namingConventionDiagnosticsEnabled, false);
    assert.equal(config.statisticalAnomalyDetectionEnabled, false);
    assert.equal(config.aiNamingAnomalyDetectionEnabled, true);
    assert.equal(config.useCoralTpuIfAvailable, true);
    assert.equal(config.autoRebuildConventionProfile, false);
    assert.equal(config.conventionAnalyzeOnSave, false);
    assert.equal(config.conventionAnalyzeOnRename, false);
    assert.equal(config.conventionAnalyzeOnNewFile, false);
    assert.equal(config.conventionScope, 'solution');
    assert.equal(config.conventionIgnoreGeneratedCode, false);
    assert.equal(config.conventionIgnoreTestProjects, true);
    assert.deepEqual(config.projectConventionIncludePatterns, ['**/*.cs', '**/*.ts']);
    assert.deepEqual(config.projectConventionExcludePatterns, ['**/gen/**', '**/legacy/**']);
    assert.deepEqual(config.projectConventionSupportedExtensions, ['cs', 'ts']);
    assert.equal(config.projectConventionMaxFiles, 777);
    assert.equal(config.projectConventionMinEvidenceCount, 5);
    assert.equal(config.statisticalAnomalyThreshold, 0.55);
    assert.equal(config.aiAnomalyThreshold, 0.73);
    assert.equal(config.projectConventionProfilePath, '.kospellcheck/profile.json');
    assert.equal(config.projectConventionProfileCachePath, '.kospellcheck/cache.json');
    assert.equal(config.projectConventionAnomalyModelPath, '.kospellcheck/model.json');
    assert.equal(config.projectConventionScanSummaryPath, '.kospellcheck/summary.json');
    assert.equal(config.projectConventionIgnoreListPath, '.kospellcheck/ignore.json');
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
