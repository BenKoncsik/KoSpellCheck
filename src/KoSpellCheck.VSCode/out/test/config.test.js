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
    node_assert_1.default.equal(config.localTypoAccelerationMode, 'auto');
    node_assert_1.default.equal(config.localTypoAccelerationModel, 'auto');
    node_assert_1.default.equal(config.localTypoAccelerationShowDetectionPrompt, true);
    node_assert_1.default.equal(config.localTypoAccelerationVerboseLogging, false);
    node_assert_1.default.equal(config.localTypoAccelerationAutoDownloadRuntime, true);
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
//# sourceMappingURL=config.test.js.map