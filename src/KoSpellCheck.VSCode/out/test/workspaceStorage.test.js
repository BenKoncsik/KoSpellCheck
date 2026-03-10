"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const workspaceStorage_1 = require("../workspaceStorage");
(0, node_test_1.default)('workspace storage id is deterministic per workspace', () => {
    const workspaceRoot = node_path_1.default.join(node_path_1.default.sep, 'tmp', 'demo-project');
    const first = (0, workspaceStorage_1.computeProjectStorageId)(workspaceRoot);
    const second = (0, workspaceStorage_1.computeProjectStorageId)(workspaceRoot);
    node_assert_1.default.equal(first, second);
    node_assert_1.default.ok(first.startsWith('project-'));
});
(0, node_test_1.default)('workspace artifact path keeps default behavior when no custom storage path is configured', () => {
    const workspaceRoot = node_path_1.default.join(node_path_1.default.sep, 'tmp', 'demo-project');
    const artifactPath = (0, workspaceStorage_1.resolveWorkspaceArtifactPath)(workspaceRoot, '', '.kospellcheck/style-profile.json', '.kospellcheck/style-profile.json');
    node_assert_1.default.equal(artifactPath, node_path_1.default.join(workspaceRoot, '.kospellcheck', 'style-profile.json'));
});
(0, node_test_1.default)('workspace artifact path relocates .kospellcheck files under configured storage root', () => {
    const workspaceRoot = node_path_1.default.join(node_path_1.default.sep, 'tmp', 'demo-project');
    const configuredStorage = node_path_1.default.join(node_path_1.default.sep, 'var', 'kospellcheck');
    const storageRoot = (0, workspaceStorage_1.resolveWorkspaceStorageRoot)(workspaceRoot, configuredStorage);
    const artifactPath = (0, workspaceStorage_1.resolveWorkspaceArtifactPath)(workspaceRoot, configuredStorage, '.kospellcheck/project-conventions.json', '.kospellcheck/project-conventions.json');
    node_assert_1.default.equal(artifactPath, node_path_1.default.join(storageRoot, 'project-conventions.json'));
});
//# sourceMappingURL=workspaceStorage.test.js.map