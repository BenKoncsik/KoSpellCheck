import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultConfig, loadConfig } from '../config';

test('default config enables local typo acceleration auto mode', () => {
  const config = defaultConfig();
  assert.equal(config.localTypoAccelerationMode, 'auto');
  assert.equal(config.localTypoAccelerationShowDetectionPrompt, true);
  assert.equal(config.localTypoAccelerationVerboseLogging, false);
  assert.equal(config.localTypoAccelerationAutoDownloadRuntime, true);
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
        'kospellcheck_local_typo_acceleration_show_detection_prompt = false',
        'kospellcheck_local_typo_acceleration_verbose_logging = true',
        'kospellcheck_local_typo_acceleration_auto_download_runtime = false'
      ].join('\n')
    );

    const config = loadConfig(workspaceRoot);
    assert.equal(config.localTypoAccelerationMode, 'off');
    assert.equal(config.localTypoAccelerationShowDetectionPrompt, false);
    assert.equal(config.localTypoAccelerationVerboseLogging, true);
    assert.equal(config.localTypoAccelerationAutoDownloadRuntime, false);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
