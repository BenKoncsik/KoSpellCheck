"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveWorkspaceStoragePathFromSettings = resolveWorkspaceStoragePathFromSettings;
function resolveWorkspaceStoragePathFromSettings(workspaceConfig, globalConfig, fallback) {
    const inspected = workspaceConfig.inspect('workspaceStoragePath');
    const directValue = inspected?.workspaceFolderValue ??
        inspected?.workspaceValue ??
        inspected?.globalValue;
    if (typeof directValue === 'string') {
        return directValue.trim();
    }
    const legacyValue = globalConfig.get('koSpellCheck.workspaceStoragePath');
    if (typeof legacyValue === 'string') {
        return legacyValue.trim();
    }
    return fallback;
}
//# sourceMappingURL=settings.js.map