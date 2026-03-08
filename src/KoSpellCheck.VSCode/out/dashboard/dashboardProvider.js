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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KoSpellCheckDashboardProvider = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const vscode = __importStar(require("vscode"));
const dashboardMapper_1 = require("./dashboardMapper");
const dashboardState_1 = require("./dashboardState");
const DASHBOARD_VIEW_TYPE = 'kospellcheck.dashboardView';
class KoSpellCheckDashboardProvider {
    constructor(context, projectConventionFeature, logService) {
        this.context = context;
        this.projectConventionFeature = projectConventionFeature;
        this.logService = logService;
        this.disposables = [];
        this.state = new dashboardState_1.DashboardStateStore();
        this.disposables.push(this.state, vscode.window.registerWebviewViewProvider(DASHBOARD_VIEW_TYPE, this, {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        }), this.registerCommands(), this.state.onDidChange((value) => {
            void this.postState(value);
        }), this.projectConventionFeature.onDidStateChange(() => {
            this.scheduleRefresh('project-conventions-state');
        }), this.logService.onDidChange(() => {
            this.state.setLogs(this.logService.snapshot());
        }));
    }
    dispose() {
        if (this.pendingRefreshTimer) {
            clearTimeout(this.pendingRefreshTimer);
            this.pendingRefreshTimer = undefined;
        }
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
    resolveWebviewView(webviewView) {
        this.webviewView = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'resources')]
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);
        this.disposables.push(webviewView.onDidDispose(() => {
            if (this.webviewView === webviewView) {
                this.webviewView = undefined;
            }
        }), webviewView.webview.onDidReceiveMessage((message) => {
            void this.handleMessage(message);
        }));
        this.scheduleRefresh('dashboard-opened', 0);
    }
    registerCommands() {
        const openDashboardCommand = vscode.commands.registerCommand('kospellcheck.openDashboard', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.kospellcheck');
            this.webviewView?.show?.(true);
            this.scheduleRefresh('open-dashboard', 0);
        });
        const refreshDashboardCommand = vscode.commands.registerCommand('kospellcheck.refreshDashboard', async () => {
            await this.refresh('command-refresh-dashboard');
        });
        const refreshConventionMapCommand = vscode.commands.registerCommand('kospellcheck.refreshConventionMap', async () => {
            await this.projectConventionFeature.rebuildActiveScope('dashboard-refresh-convention-map', false);
            await this.refresh('command-refresh-convention-map');
        });
        const clearLogsCommand = vscode.commands.registerCommand('kospellcheck.clearDashboardLogs', () => {
            this.logService.clear();
        });
        return vscode.Disposable.from(openDashboardCommand, refreshDashboardCommand, refreshConventionMapCommand, clearLogsCommand);
    }
    scheduleRefresh(reason, delayMs = 120) {
        if (this.pendingRefreshTimer) {
            clearTimeout(this.pendingRefreshTimer);
        }
        this.pendingRefreshTimer = setTimeout(() => {
            this.pendingRefreshTimer = undefined;
            void this.refresh(reason);
        }, delayMs);
    }
    async refresh(reason) {
        if (this.refreshTask) {
            return this.refreshTask;
        }
        this.refreshTask = this.doRefresh(reason);
        try {
            await this.refreshTask;
        }
        finally {
            this.refreshTask = undefined;
        }
    }
    async doRefresh(reason) {
        this.state.setLoading();
        this.logService.append(`dashboard refresh started reason=${reason}`);
        try {
            const snapshot = this.projectConventionFeature.getDashboardSnapshot(vscode.window.activeTextEditor?.document.uri);
            const examplesByFolder = await this.collectFolderExamples(snapshot);
            const model = (0, dashboardMapper_1.mapDashboardViewModel)(snapshot, this.logService.snapshot(), examplesByFolder);
            this.state.setData(model);
            this.logService.append(`dashboard refresh completed diagnostics=${model.diagnostics.length} folders=${model.conventionMap.length}`);
        }
        catch (error) {
            const message = `dashboard refresh failed reason=${String(error)}`;
            this.logService.append(message, 'error');
            this.state.setError(message);
        }
    }
    async handleMessage(message) {
        switch (message.command) {
            case 'refresh':
                await this.refresh('webview-refresh');
                return;
            case 'rebuild':
                await vscode.commands.executeCommand('kospellcheck.rebuildConventionProfile');
                await this.refresh('webview-rebuild');
                return;
            case 'refreshConventionMap':
                await this.projectConventionFeature.rebuildActiveScope('webview-refresh-convention-map', false);
                await this.refresh('webview-refresh-convention-map');
                return;
            case 'clearLogs':
                this.logService.clear();
                return;
            case 'openSettings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'kospellcheck.projectConventions');
                return;
            case 'openProfile':
                if (message.path) {
                    await this.openFile(message.path);
                }
                return;
            case 'revealDiagnostic':
                if (message.path) {
                    await this.revealDiagnostic(message.path, message.line, message.column);
                }
                return;
            case 'toggleSetting':
                if (typeof message.settingId === 'string') {
                    await this.toggleSetting(message.settingId, message.value);
                    await this.refresh('webview-toggle-setting');
                }
                return;
        }
    }
    async toggleSetting(settingId, currentValue) {
        const target = vscode.workspace.workspaceFolders?.length
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
        const config = vscode.workspace.getConfiguration('kospellcheck');
        const current = typeof currentValue === 'boolean'
            ? currentValue
            : config.get(settingId);
        if (typeof current !== 'boolean') {
            return;
        }
        await config.update(settingId, !current, target);
        this.logService.append(`dashboard setting toggled id=${settingId} value=${!current}`);
    }
    async openFile(targetPath) {
        try {
            const uri = vscode.Uri.file(targetPath);
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document, { preview: false });
        }
        catch (error) {
            this.logService.append(`dashboard open profile failed path=${targetPath} reason=${String(error)}`, 'warn');
        }
    }
    async revealDiagnostic(targetPath, line, column) {
        try {
            const uri = vscode.Uri.file(targetPath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document, { preview: false });
            const safeLine = Math.max(0, Math.min(Number(line ?? 0), Math.max(0, document.lineCount - 1)));
            const safeColumn = Math.max(0, Number(column ?? 0));
            const position = new vscode.Position(safeLine, safeColumn);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
        catch (error) {
            this.logService.append(`dashboard reveal failed path=${targetPath} reason=${String(error)}`, 'warn');
        }
    }
    async collectFolderExamples(snapshot) {
        const root = snapshot.scope?.storageRoot;
        const profile = asRecord(snapshot.profile);
        const folders = asRecord(profile.Folders);
        if (!root || !node_fs_1.default.existsSync(root) || Object.keys(folders).length === 0) {
            return {};
        }
        const output = {};
        for (const [folderPath, folderValue] of Object.entries(folders)) {
            const folder = asRecord(folderValue);
            const suffix = topFrequencyValue(folder.DominantSuffixes);
            const prefix = topFrequencyValue(folder.DominantPrefixes);
            output[folderPath] = await this.collectExamplesForFolder(root, folderPath, suffix, prefix);
        }
        return output;
    }
    async collectExamplesForFolder(workspaceRoot, folderPath, expectedSuffix, expectedPrefix) {
        const rootFolder = folderPath === '.' ? workspaceRoot : node_path_1.default.join(workspaceRoot, folderPath);
        if (!node_fs_1.default.existsSync(rootFolder)) {
            return [];
        }
        const queue = [rootFolder];
        const output = [];
        const seen = new Set();
        let scannedFiles = 0;
        while (queue.length > 0 && output.length < 3 && scannedFiles < 250) {
            const current = queue.shift();
            if (!current) {
                continue;
            }
            let entries = [];
            try {
                entries = await node_fs_1.default.promises.readdir(current, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (!isIgnoredDirectory(entry.name)) {
                        queue.push(node_path_1.default.join(current, entry.name));
                    }
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }
                scannedFiles += 1;
                if (scannedFiles > 250) {
                    break;
                }
                const stem = node_path_1.default.parse(entry.name).name;
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(stem)) {
                    continue;
                }
                if (expectedSuffix && !stem.endsWith(expectedSuffix)) {
                    continue;
                }
                if (expectedPrefix && !stem.startsWith(expectedPrefix)) {
                    continue;
                }
                if (!seen.has(stem)) {
                    seen.add(stem);
                    output.push(stem);
                }
                if (output.length >= 3) {
                    break;
                }
            }
        }
        return output;
    }
    async postState(state) {
        if (!this.webviewView) {
            return;
        }
        await this.webviewView.webview.postMessage({
            type: 'state',
            payload: state
        });
    }
    getHtml(webview) {
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'dashboard', 'styles.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'dashboard', 'main.js'));
        const nonce = randomNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${stylesUri}" />
  <title>KoSpellCheck Dashboard</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
exports.KoSpellCheckDashboardProvider = KoSpellCheckDashboardProvider;
function asRecord(value) {
    return value && typeof value === 'object'
        ? value
        : {};
}
function topFrequencyValue(value) {
    const list = Array.isArray(value) ? value : [];
    if (list.length === 0) {
        return '';
    }
    const first = asRecord(list[0]);
    return typeof first.Value === 'string' ? first.Value : '';
}
function isIgnoredDirectory(name) {
    return (name === 'bin' ||
        name === 'obj' ||
        name === 'node_modules' ||
        name === '.git' ||
        name === '.vs' ||
        name === '.kospellcheck');
}
function randomNonce() {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
//# sourceMappingURL=dashboardProvider.js.map