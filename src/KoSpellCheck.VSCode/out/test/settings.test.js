"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const settings_1 = require("../settings");
class MockWorkspaceConfiguration {
    constructor(inspectResult, values) {
        this.inspectResult = inspectResult;
        this.values = values;
    }
    inspect(_section) {
        return this.inspectResult;
    }
    get(section) {
        return this.values[section];
    }
}
(0, node_test_1.default)('workspaceStoragePath prefers direct workspace setting values', () => {
    const workspaceConfig = new MockWorkspaceConfiguration({ workspaceValue: ' /tmp/shared-store ' }, {});
    const globalConfig = new MockWorkspaceConfiguration(undefined, {});
    const resolved = (0, settings_1.resolveWorkspaceStoragePathFromSettings)(workspaceConfig, globalConfig, '/fallback');
    node_assert_1.default.equal(resolved, '/tmp/shared-store');
});
(0, node_test_1.default)('workspaceStoragePath falls back to legacy koSpellCheck setting', () => {
    const workspaceConfig = new MockWorkspaceConfiguration(undefined, {});
    const globalConfig = new MockWorkspaceConfiguration(undefined, {
        'koSpellCheck.workspaceStoragePath': ' /tmp/legacy-store '
    });
    const resolved = (0, settings_1.resolveWorkspaceStoragePathFromSettings)(workspaceConfig, globalConfig, '/fallback');
    node_assert_1.default.equal(resolved, '/tmp/legacy-store');
});
(0, node_test_1.default)('workspaceStoragePath keeps file config fallback when no VS Code setting is present', () => {
    const workspaceConfig = new MockWorkspaceConfiguration(undefined, {});
    const globalConfig = new MockWorkspaceConfiguration(undefined, {});
    const resolved = (0, settings_1.resolveWorkspaceStoragePathFromSettings)(workspaceConfig, globalConfig, '/fallback');
    node_assert_1.default.equal(resolved, '/fallback');
});
//# sourceMappingURL=settings.test.js.map