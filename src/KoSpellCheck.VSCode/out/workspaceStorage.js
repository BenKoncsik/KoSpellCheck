"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeProjectStorageId = computeProjectStorageId;
exports.resolveWorkspaceStorageRoot = resolveWorkspaceStorageRoot;
exports.resolveWorkspaceArtifactPath = resolveWorkspaceArtifactPath;
exports.migrateLegacyWorkspaceStorage = migrateLegacyWorkspaceStorage;
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const defaultStorageFolderName = '.kospellcheck';
const legacyStorageFolderNames = ['.kospellcheck', '.KoSpellChecker', '.KoSpellCheck'];
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
function migrateLegacyWorkspaceStorage(workspaceRoot, configuredWorkspaceStoragePath, log) {
    const resolvedStorageRoot = resolveWorkspaceStorageRoot(workspaceRoot, configuredWorkspaceStoragePath);
    if (!configuredWorkspaceStoragePath?.trim()) {
        return { migrated: false, resolvedStorageRoot, migratedFrom: [] };
    }
    const migratedFrom = [];
    for (const folderName of legacyStorageFolderNames) {
        const sourceRoot = node_path_1.default.join(workspaceRoot, folderName);
        if (!node_fs_1.default.existsSync(sourceRoot)) {
            continue;
        }
        const normalizedSource = normalizeWorkspaceRoot(sourceRoot);
        const normalizedTarget = normalizeWorkspaceRoot(resolvedStorageRoot);
        if (normalizedSource === normalizedTarget) {
            continue;
        }
        try {
            copyDirectoryRecursive(sourceRoot, resolvedStorageRoot);
            node_fs_1.default.rmSync(sourceRoot, { recursive: true, force: true });
            migratedFrom.push(sourceRoot);
            log?.(`workspace-storage migrated '${sourceRoot}' -> '${resolvedStorageRoot}'`);
        }
        catch (error) {
            log?.(`workspace-storage migration failed source='${sourceRoot}' target='${resolvedStorageRoot}' reason=${String(error)}`);
        }
    }
    return {
        migrated: migratedFrom.length > 0,
        resolvedStorageRoot,
        migratedFrom
    };
}
function copyDirectoryRecursive(sourceRoot, targetRoot) {
    node_fs_1.default.mkdirSync(targetRoot, { recursive: true });
    for (const entry of node_fs_1.default.readdirSync(sourceRoot, { withFileTypes: true })) {
        const sourcePath = node_path_1.default.join(sourceRoot, entry.name);
        const targetPath = node_path_1.default.join(targetRoot, entry.name);
        if (entry.isDirectory()) {
            copyDirectoryRecursive(sourcePath, targetPath);
            continue;
        }
        if (entry.isFile()) {
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(targetPath), { recursive: true });
            node_fs_1.default.copyFileSync(sourcePath, targetPath);
        }
    }
}
//# sourceMappingURL=workspaceStorage.js.map