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
const sharedUiText_1 = require("../sharedUiText");
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
            model.uiStrings = this.buildUiStrings(snapshot.settings?.uiLanguage);
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
            case 'forceUnusedTypeSearch':
                await this.projectConventionFeature.forceUnusedTypeSearch(vscode.window.activeTextEditor?.document.uri);
                await this.refresh('webview-force-unused-type-search');
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
            case 'revealUnusedType':
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
        const configuredLanguage = vscode.workspace
            .getConfiguration('kospellcheck', vscode.window.activeTextEditor?.document.uri)
            .get('uiLanguage', 'auto');
        const lang = (0, sharedUiText_1.resolveUiLanguage)(configuredLanguage);
        const title = (0, sharedUiText_1.text)('dashboard.title', 'KoSpellCheck Dashboard', {
            configuredLanguage
        });
        return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${stylesUri}" />
  <title>${title}</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
    buildUiStrings(configuredLanguage) {
        return {
            toolbarRefresh: (0, sharedUiText_1.text)('dashboard.toolbar.refresh', 'Refresh Dashboard', { configuredLanguage }),
            toolbarRebuild: (0, sharedUiText_1.text)('dashboard.toolbar.rebuild', 'Rebuild Convention Profile', { configuredLanguage }),
            toolbarRefreshMap: (0, sharedUiText_1.text)('dashboard.toolbar.refreshMap', 'Refresh Convention Map', { configuredLanguage }),
            toolbarForceUnusedSearch: (0, sharedUiText_1.text)('dashboard.toolbar.forceUnusedSearch', 'Force Unused Type Search', { configuredLanguage }),
            toolbarClearLogs: (0, sharedUiText_1.text)('dashboard.toolbar.clearLogs', 'Clear Logs', { configuredLanguage }),
            toolbarOpenSettings: (0, sharedUiText_1.text)('dashboard.toolbar.openSettings', 'Open Settings', { configuredLanguage }),
            toolbarOpenProfileJson: (0, sharedUiText_1.text)('dashboard.toolbar.openProfileJson', 'Open Profile JSON', { configuredLanguage }),
            sectionOverview: (0, sharedUiText_1.text)('dashboard.section.overview', 'Overview', { configuredLanguage }),
            sectionSettings: (0, sharedUiText_1.text)('dashboard.section.settings', 'Settings', { configuredLanguage }),
            sectionConventionMap: (0, sharedUiText_1.text)('dashboard.section.conventionMap', 'Convention Map', { configuredLanguage }),
            sectionDiagnostics: (0, sharedUiText_1.text)('dashboard.section.diagnostics', 'Diagnostics', { configuredLanguage }),
            sectionUnusedTypes: (0, sharedUiText_1.text)('dashboard.section.unusedTypes', 'Unused Types', { configuredLanguage }),
            sectionLogs: (0, sharedUiText_1.text)('dashboard.section.logs', 'Logs', { configuredLanguage }),
            overviewWorkspaceRoot: (0, sharedUiText_1.text)('dashboard.overview.workspaceRoot', 'Workspace root', { configuredLanguage }),
            overviewScope: (0, sharedUiText_1.text)('dashboard.overview.scope', 'Scope', { configuredLanguage }),
            overviewFilesScanned: (0, sharedUiText_1.text)('dashboard.overview.filesScanned', 'Files scanned', { configuredLanguage }),
            overviewTypesScanned: (0, sharedUiText_1.text)('dashboard.overview.typesScanned', 'Types scanned', { configuredLanguage }),
            overviewDominantCase: (0, sharedUiText_1.text)('dashboard.overview.dominantCase', 'Dominant case', { configuredLanguage }),
            overviewProfileUpdated: (0, sharedUiText_1.text)('dashboard.overview.profileUpdated', 'Profile updated', { configuredLanguage }),
            overviewDiagnostics: (0, sharedUiText_1.text)('dashboard.overview.diagnostics', 'Diagnostics', { configuredLanguage }),
            overviewConventionFeature: (0, sharedUiText_1.text)('dashboard.overview.conventionFeature', 'Convention feature', { configuredLanguage }),
            overviewAiAnomaly: (0, sharedUiText_1.text)('dashboard.overview.aiAnomaly', 'AI anomaly', { configuredLanguage }),
            overviewCoral: (0, sharedUiText_1.text)('dashboard.overview.coral', 'Coral', { configuredLanguage }),
            overviewRebuildQueue: (0, sharedUiText_1.text)('dashboard.overview.rebuildQueue', 'Rebuild queue', { configuredLanguage }),
            tableSetting: (0, sharedUiText_1.text)('dashboard.table.setting', 'Setting', { configuredLanguage }),
            tableValue: (0, sharedUiText_1.text)('dashboard.table.value', 'Value', { configuredLanguage }),
            tableAction: (0, sharedUiText_1.text)('dashboard.table.action', 'Action', { configuredLanguage }),
            toggle: (0, sharedUiText_1.text)('dashboard.table.toggle', 'Toggle', { configuredLanguage }),
            emptySettings: (0, sharedUiText_1.text)('dashboard.empty.settings', 'No settings snapshot available.', { configuredLanguage }),
            tableFolder: (0, sharedUiText_1.text)('dashboard.table.folder', 'Folder', { configuredLanguage }),
            tableExpectedSuffix: (0, sharedUiText_1.text)('dashboard.table.expectedSuffix', 'Expected suffix', { configuredLanguage }),
            tableExpectedPrefix: (0, sharedUiText_1.text)('dashboard.table.expectedPrefix', 'Expected prefix', { configuredLanguage }),
            tableDominantKind: (0, sharedUiText_1.text)('dashboard.table.dominantKind', 'Dominant kind', { configuredLanguage }),
            tableConfidence: (0, sharedUiText_1.text)('dashboard.table.confidence', 'Confidence', { configuredLanguage }),
            tableNamespaceSample: (0, sharedUiText_1.text)('dashboard.table.namespaceSample', 'Namespace sample', { configuredLanguage }),
            tableExamples: (0, sharedUiText_1.text)('dashboard.table.examples', 'Examples', { configuredLanguage }),
            emptyExamples: (0, sharedUiText_1.text)('dashboard.empty.examples', 'No examples found in current workspace snapshot.', { configuredLanguage }),
            emptyConventionMap: (0, sharedUiText_1.text)('dashboard.empty.conventionMap', 'No convention profile loaded yet. Rebuild profile to populate this section.', { configuredLanguage }),
            tableSeverity: (0, sharedUiText_1.text)('dashboard.table.severity', 'Severity', { configuredLanguage }),
            tableType: (0, sharedUiText_1.text)('dashboard.table.type', 'Type', { configuredLanguage }),
            tableClassification: (0, sharedUiText_1.text)('dashboard.table.classification', 'Classification', { configuredLanguage }),
            tableFile: (0, sharedUiText_1.text)('dashboard.table.file', 'File', { configuredLanguage }),
            tableMethod: (0, sharedUiText_1.text)('dashboard.table.method', 'Method', { configuredLanguage }),
            tableProblem: (0, sharedUiText_1.text)('dashboard.table.problem', 'Problem', { configuredLanguage }),
            tableRule: (0, sharedUiText_1.text)('dashboard.table.rule', 'Rule', { configuredLanguage }),
            tableExpected: (0, sharedUiText_1.text)('dashboard.table.expected', 'Expected', { configuredLanguage }),
            tableObserved: (0, sharedUiText_1.text)('dashboard.table.observed', 'Observed', { configuredLanguage }),
            tableSuggestion: (0, sharedUiText_1.text)('dashboard.table.suggestion', 'Suggestion', { configuredLanguage }),
            reveal: (0, sharedUiText_1.text)('dashboard.button.reveal', 'Reveal', { configuredLanguage }),
            classificationUnused: (0, sharedUiText_1.text)('dashboard.value.unused', 'Unused', { configuredLanguage }),
            classificationTestOnly: (0, sharedUiText_1.text)('dashboard.value.testOnly', 'Test-only', { configuredLanguage }),
            emptyDiagnostics: (0, sharedUiText_1.text)('dashboard.empty.diagnostics', 'No active convention diagnostics.', { configuredLanguage }),
            emptyUnusedTypes: (0, sharedUiText_1.text)('dashboard.empty.unusedTypes', 'No unused or test-only types in current snapshot.', { configuredLanguage }),
            emptyLogs: (0, sharedUiText_1.text)('dashboard.empty.logs', 'No log entries yet.', { configuredLanguage }),
            valueActive: (0, sharedUiText_1.text)('dashboard.value.active', 'Active', { configuredLanguage }),
            valueInactive: (0, sharedUiText_1.text)('dashboard.value.inactive', 'Inactive', { configuredLanguage }),
            valueInFlight: (0, sharedUiText_1.text)('dashboard.value.inFlight', 'In-flight', { configuredLanguage }),
            valueQueued: (0, sharedUiText_1.text)('dashboard.value.queued', 'Queued', { configuredLanguage }),
            valueAuto: (0, sharedUiText_1.text)('dashboard.value.auto', '(auto)', { configuredLanguage }),
            valueNotAvailable: (0, sharedUiText_1.text)('general.notAvailable', 'n/a', { configuredLanguage }),
            valueUnknown: (0, sharedUiText_1.text)('dashboard.value.unknown', 'Unknown', { configuredLanguage }),
            metaLastRefresh: (0, sharedUiText_1.text)('dashboard.meta.lastRefresh', 'Last refresh:', { configuredLanguage }),
            metaLoading: (0, sharedUiText_1.text)('dashboard.meta.loading', 'Loading...', { configuredLanguage })
        };
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