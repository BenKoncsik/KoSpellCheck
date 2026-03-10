"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeProjectStorageId = computeProjectStorageId;
exports.resolveWorkspaceStorageRoot = resolveWorkspaceStorageRoot;
exports.resolveWorkspaceArtifactPath = resolveWorkspaceArtifactPath;
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const defaultStorageFolderName = '.kospellcheck';
function computeProjectStorageId(workspaceRoot) {
    const normalized = normalizeWorkspaceRoot(workspaceRoot);
    const hash = (0, node_crypto_1.createHash)('sha256').update(normalized).digest('hex');
    return `project-${hash.slice(0, 16)}`;
}
function resolveWorkspaceStorageRoot(workspaceRoot, configuredWorkspaceStoragePath) {
    if (!configuredWorkspaceStoragePath?.trim()) {
        return node_path_1.default.join(workspaceRoot, defaultStorageFolderName);
    }
    const target = configuredWorkspaceStoragePath.trim();
    const baseRoot = node_path_1.default.isAbsolute(target)
        ? target
        : node_path_1.default.join(workspaceRoot, target);
    return node_path_1.default.join(baseRoot, computeProjectStorageId(workspaceRoot));
}
function resolveWorkspaceArtifactPath(workspaceRoot, configuredWorkspaceStoragePath, configuredArtifactPath, defaultArtifactPath) {
    const target = configuredArtifactPath?.trim() || defaultArtifactPath;
    if (node_path_1.default.isAbsolute(target)) {
        return target;
    }
    if (!configuredWorkspaceStoragePath?.trim()) {
        return node_path_1.default.join(workspaceRoot, target);
    }
    const storageRoot = resolveWorkspaceStorageRoot(workspaceRoot, configuredWorkspaceStoragePath);
    const relative = trimLegacyStoragePrefix(target);
    return relative ? node_path_1.default.join(storageRoot, relative) : storageRoot;
}
function normalizeWorkspaceRoot(workspaceRoot) {
    const fullPath = node_path_1.default.resolve(workspaceRoot);
    return fullPath
        .replace(/[\\/]+$/u, '')
        .toLowerCase();
}
function trimLegacyStoragePrefix(relativePath) {
    let normalized = relativePath.replace(/\\/gu, '/').replace(/^\/+/u, '');
    if (normalized.toLowerCase() === defaultStorageFolderName) {
        return '';
    }
    const legacyPrefix = `${defaultStorageFolderName}/`;
    if (normalized.toLowerCase().startsWith(legacyPrefix)) {
        normalized = normalized.slice(legacyPrefix.length);
    }
    return normalized.replace(/\//gu, node_path_1.default.sep);
}
//# sourceMappingURL=workspaceStorage.js.map