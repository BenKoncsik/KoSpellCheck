"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveArtifactPath = resolveArtifactPath;
exports.saveConventionArtifacts = saveConventionArtifacts;
exports.loadConventionProfile = loadConventionProfile;
exports.loadIgnoreList = loadIgnoreList;
exports.appendIgnoreEntry = appendIgnoreEntry;
exports.isIgnored = isIgnored;
exports.buildFingerprint = buildFingerprint;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function resolveArtifactPath(workspaceRoot, configuredPath) {
    const target = configuredPath?.trim() || '.kospellcheck/project-conventions.json';
    if (node_path_1.default.isAbsolute(target)) {
        return target;
    }
    return node_path_1.default.join(workspaceRoot, target);
}
async function saveConventionArtifacts(profilePath, profile, summaryPath, summary, cachePath, cache, anomalyModelPath, model) {
    await writeJson(profilePath, profile);
    await writeJson(summaryPath, summary);
    await writeJson(cachePath, cache);
    await writeJson(anomalyModelPath, model, true);
}
async function loadConventionProfile(profilePath) {
    return readJsonFile(profilePath);
}
async function loadIgnoreList(ignorePath) {
    const loaded = await readJsonFile(ignorePath);
    if (loaded?.schemaVersion === 1 && Array.isArray(loaded.entries)) {
        return loaded;
    }
    return {
        schemaVersion: 1,
        entries: []
    };
}
async function appendIgnoreEntry(ignorePath, entry) {
    const list = await loadIgnoreList(ignorePath);
    const alreadyExists = list.entries.some((item) => item.ruleId === entry.ruleId && item.scope === entry.scope && item.target === entry.target);
    if (alreadyExists) {
        return;
    }
    list.entries.push(entry);
    await writeJson(ignorePath, list);
}
function isIgnored(ignoreList, ruleId, relativePath, folderPath) {
    for (const entry of ignoreList.entries) {
        if (entry.ruleId !== ruleId) {
            continue;
        }
        if (entry.scope === 'project') {
            return true;
        }
        if (entry.scope === 'file' && entry.target === relativePath) {
            return true;
        }
        if (entry.scope === 'folder' && (folderPath === entry.target || folderPath.startsWith(`${entry.target}/`))) {
            return true;
        }
    }
    return false;
}
async function buildFingerprint(filePaths) {
    const hash = (0, node_crypto_1.createHash)('sha256');
    const sorted = [...filePaths].sort((left, right) => left.localeCompare(right));
    for (const filePath of sorted) {
        try {
            const stat = await node_fs_1.default.promises.stat(filePath);
            hash.update(filePath);
            hash.update(':');
            hash.update(String(stat.size));
            hash.update(':');
            hash.update(String(stat.mtimeMs));
            hash.update('|');
        }
        catch {
            // ignore transient stat errors
        }
    }
    return hash.digest('hex');
}
async function readJsonFile(filePath) {
    try {
        const content = await node_fs_1.default.promises.readFile(filePath, 'utf8');
        return JSON.parse(content);
    }
    catch {
        return undefined;
    }
}
async function writeJson(filePath, payload, skipIfExists = false) {
    try {
        if (skipIfExists && node_fs_1.default.existsSync(filePath)) {
            return;
        }
        await node_fs_1.default.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        const tempPath = `${filePath}.tmp-${Date.now()}`;
        await node_fs_1.default.promises.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
        await node_fs_1.default.promises.rename(tempPath, filePath);
    }
    catch {
        // Ignore persistence failures to keep diagnostics resilient.
    }
}
//# sourceMappingURL=persistence.js.map