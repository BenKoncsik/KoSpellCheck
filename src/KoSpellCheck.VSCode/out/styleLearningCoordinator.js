"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.StyleLearningCoordinator = void 0;
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
const styleDetector_1 = require("./styleDetector");
const settings_1 = require("./settings");
class StyleLearningCoordinator {
    constructor(log) {
        this.profilesByWorkspace = new Map();
        this.timersByWorkspace = new Map();
        this.inFlightByWorkspace = new Map();
        this.log = log;
    }
    getProfile(workspaceRoot) {
        if (!workspaceRoot) {
            return undefined;
        }
        return this.profilesByWorkspace.get(workspaceRoot);
    }
    scheduleWorkspaceRefresh(workspaceRoot, reason, delayMs = 700) {
        if (!workspaceRoot) {
            return;
        }
        const existing = this.timersByWorkspace.get(workspaceRoot);
        if (existing) {
            clearTimeout(existing);
        }
        this.timersByWorkspace.set(workspaceRoot, setTimeout(() => {
            this.timersByWorkspace.delete(workspaceRoot);
            void this.refreshWorkspace(workspaceRoot, reason);
        }, delayMs));
    }
    scheduleAllWorkspaceRefreshes(reason, delayMs = 700) {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            this.scheduleWorkspaceRefresh(folder.uri.fsPath, reason, delayMs);
        }
    }
    dispose() {
        for (const timer of this.timersByWorkspace.values()) {
            clearTimeout(timer);
        }
        this.timersByWorkspace.clear();
        this.profilesByWorkspace.clear();
        this.inFlightByWorkspace.clear();
    }
    async refreshWorkspace(workspaceRoot, reason) {
        if (!workspaceRoot) {
            return;
        }
        const inFlight = this.inFlightByWorkspace.get(workspaceRoot);
        if (inFlight) {
            return;
        }
        const task = this.doRefreshWorkspace(workspaceRoot, reason);
        this.inFlightByWorkspace.set(workspaceRoot, task);
        try {
            await task;
        }
        finally {
            this.inFlightByWorkspace.delete(workspaceRoot);
        }
    }
    async doRefreshWorkspace(workspaceRoot, reason) {
        const config = (0, config_1.loadConfig)(workspaceRoot);
        const uri = vscode.Uri.file(workspaceRoot);
        const workspaceConfig = vscode.workspace.getConfiguration('kospellcheck', uri);
        const globalConfig = vscode.workspace.getConfiguration(undefined, uri);
        config.workspaceStoragePath = (0, settings_1.resolveWorkspaceStoragePathFromSettings)(workspaceConfig, globalConfig, config.workspaceStoragePath);
        const settingEnabled = workspaceConfig.get('enabled', true);
        if (!settingEnabled || !config.enabled || !config.styleLearningEnabled) {
            this.profilesByWorkspace.delete(workspaceRoot);
            this.log(`style-learning disabled workspace=${workspaceRoot} reason=${reason}`);
            return;
        }
        const includePattern = buildIncludePattern(config.styleLearningFileExtensions);
        const excludePattern = buildExcludePattern(config.styleLearningIgnoreFolders);
        const maxFiles = Math.max(1, config.styleLearningMaxFiles);
        let files;
        try {
            files = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceRoot, includePattern), excludePattern
                ? new vscode.RelativePattern(workspaceRoot, excludePattern)
                : undefined, maxFiles);
        }
        catch {
            return;
        }
        const profile = await (0, styleDetector_1.detectProjectStyleProfile)(workspaceRoot, files.map((uri) => uri.fsPath), config);
        this.profilesByWorkspace.set(workspaceRoot, profile);
        this.log(`style-learning refreshed workspace=${workspaceRoot} reason=${reason} files=${files.length} tokens=${Object.keys(profile.tokenStats).length}`);
    }
}
exports.StyleLearningCoordinator = StyleLearningCoordinator;
function buildIncludePattern(extensions) {
    const unique = [...new Set((extensions ?? []).map(normalizeExtension).filter(Boolean))];
    if (unique.length === 0) {
        return '**/*';
    }
    if (unique.length === 1) {
        return `**/*.${unique[0]}`;
    }
    return `**/*.{${unique.join(',')}}`;
}
function buildExcludePattern(folders) {
    const unique = [...new Set((folders ?? []).map((item) => item.trim()).filter(Boolean))];
    if (unique.length === 0) {
        return undefined;
    }
    return `**/{${unique.join(',')}}/**`;
}
function normalizeExtension(value) {
    return value.replace(/^\./u, '').trim().toLowerCase();
}
//# sourceMappingURL=styleLearningCoordinator.js.map