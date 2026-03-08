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
exports.activate = activate;
exports.deactivate = deactivate;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const vscode = __importStar(require("vscode"));
const engine_1 = require("./engine");
const config_1 = require("./config");
const spellService_1 = require("./spellService");
const styleLearningCoordinator_1 = require("./styleLearningCoordinator");
const feature_1 = require("./projectConventions/feature");
const dashboardLogService_1 = require("./dashboard/dashboardLogService");
const dashboardProvider_1 = require("./dashboard/dashboardProvider");
const localTypoAcceleration_1 = require("./localTypoAcceleration");
const SOURCE = 'KoSpellCheck';
function activate(context) {
    const diagnostics = vscode.languages.createDiagnosticCollection(SOURCE);
    const output = vscode.window.createOutputChannel(SOURCE);
    const dashboardLogService = new dashboardLogService_1.DashboardLogService(400);
    const service = new spellService_1.SpellService(context.extensionPath);
    const metadata = new Map();
    const timers = new Map();
    const pendingFocusOffsets = new Map();
    let errorNotificationShown = false;
    let initializationNotesLogged = false;
    const isDebugEnabled = (uri) => vscode.workspace.getConfiguration('kospellcheck', uri).get('debugLogging', false);
    const isLocalTypoVerboseEnabled = (uri) => vscode.workspace
        .getConfiguration('kospellcheck', uri)
        .get('localTypoAcceleration.verboseLogging', false);
    const log = (message, uri, force = false) => {
        if (shouldCaptureForDashboard(message, force)) {
            const lowered = message.toLowerCase();
            const level = lowered.includes('failed') || lowered.includes('error')
                ? 'warn'
                : 'info';
            dashboardLogService.append(message, level);
        }
        const localTypoVerbose = message.includes('local-typo-acceleration') && isLocalTypoVerboseEnabled(uri);
        if (!force && !isDebugEnabled(uri) && !localTypoVerbose) {
            return;
        }
        output.appendLine(`[${new Date().toISOString()}] ${message}`);
    };
    let runtimeStatusUpdateInFlight = false;
    let lastRuntimeStatusText = '';
    let availableModelsUpdateInFlight = false;
    let lastAvailableModelsText = '';
    let lastAvailableModelIds;
    let manualDownloadToggleInProgress = false;
    const updateRuntimeDownloadStatusSetting = async (statusText) => {
        const normalized = statusText.trim();
        if (!normalized || normalized === lastRuntimeStatusText) {
            return;
        }
        lastRuntimeStatusText = normalized;
        log(`local-typo-acceleration runtime-download status='${normalized}'`, undefined, false);
        if (runtimeStatusUpdateInFlight) {
            return;
        }
        runtimeStatusUpdateInFlight = true;
        try {
            await vscode.workspace
                .getConfiguration('kospellcheck')
                .update('localTypoAcceleration.runtimeDownloadStatus', normalized, vscode.ConfigurationTarget.Global);
        }
        catch (error) {
            log(`local-typo-acceleration runtime-download status update failed reason=${formatError(error)}`, undefined, true);
        }
        finally {
            runtimeStatusUpdateInFlight = false;
        }
    };
    const updateAvailableModelsSetting = async (models) => {
        const sorted = models.slice().sort((left, right) => left.id.localeCompare(right.id));
        const modelIds = sorted.map((item) => item.id).join('|');
        if (lastAvailableModelIds !== undefined && modelIds === lastAvailableModelIds) {
            return;
        }
        lastAvailableModelIds = modelIds;
        const statusText = sorted.length === 0
            ? 'Nincs telepített modell.'
            : sorted
                .map((item) => `${item.id}${item.isDefault ? ' [default]' : ''}${item.format ? ` (${item.format})` : ''}`)
                .join(', ');
        if (statusText === lastAvailableModelsText) {
            return;
        }
        lastAvailableModelsText = statusText;
        log(`local-typo-acceleration models available='${statusText}'`, undefined, false);
        if (availableModelsUpdateInFlight) {
            return;
        }
        availableModelsUpdateInFlight = true;
        try {
            await vscode.workspace
                .getConfiguration('kospellcheck')
                .update('localTypoAcceleration.availableModels', statusText, vscode.ConfigurationTarget.Global);
        }
        catch (error) {
            log(`local-typo-acceleration availableModels update failed reason=${formatError(error)}`, undefined, true);
        }
        finally {
            availableModelsUpdateInFlight = false;
        }
    };
    const onRuntimeDownloadProgress = (progress) => {
        const parts = [
            `phase=${progress.phase}`,
            `status='${progress.statusText}'`
        ];
        if (progress.filePath) {
            parts.push(`file='${progress.filePath}'`);
        }
        if (typeof progress.fileIndex === 'number' && typeof progress.fileCount === 'number') {
            parts.push(`item=${progress.fileIndex}/${progress.fileCount}`);
        }
        if (typeof progress.percent === 'number') {
            parts.push(`percent=${progress.percent}`);
        }
        const force = progress.phase === 'failed';
        log(`local-typo-acceleration runtime-download ${parts.join(' ')}`, undefined, force);
        void updateRuntimeDownloadStatusSetting(progress.statusText);
        if (progress.phase === 'success' || progress.phase === 'failed') {
            void updateAvailableModelsSetting(typoAcceleration.listInstalledModels());
        }
    };
    const tryTriggerManualRuntimeDownloadFromSetting = async () => {
        if (manualDownloadToggleInProgress) {
            return;
        }
        const uri = vscode.window.activeTextEditor?.document.uri;
        const workspaceConfig = vscode.workspace.getConfiguration('kospellcheck', uri);
        const requested = workspaceConfig.get('localTypoAcceleration.manualDownloadNow', false);
        if (!requested) {
            return;
        }
        manualDownloadToggleInProgress = true;
        try {
            const updates = [];
            const inspected = workspaceConfig.inspect('localTypoAcceleration.manualDownloadNow');
            if (inspected?.workspaceFolderValue === true && uri) {
                updates.push(workspaceConfig.update('localTypoAcceleration.manualDownloadNow', false, vscode.ConfigurationTarget.WorkspaceFolder));
            }
            if (inspected?.workspaceValue === true) {
                updates.push(workspaceConfig.update('localTypoAcceleration.manualDownloadNow', false, vscode.ConfigurationTarget.Workspace));
            }
            if (inspected?.globalValue === true) {
                updates.push(workspaceConfig.update('localTypoAcceleration.manualDownloadNow', false, vscode.ConfigurationTarget.Global));
            }
            if (updates.length === 0) {
                const target = uri && vscode.workspace.getWorkspaceFolder(uri)
                    ? vscode.ConfigurationTarget.Workspace
                    : vscode.ConfigurationTarget.Global;
                updates.push(workspaceConfig.update('localTypoAcceleration.manualDownloadNow', false, target));
            }
            await Promise.all(updates);
        }
        catch (error) {
            log(`local-typo-acceleration manualDownloadNow reset failed reason=${formatError(error)}`, uri, true);
        }
        finally {
            manualDownloadToggleInProgress = false;
        }
        await vscode.commands.executeCommand('kospellcheck.downloadLocalTypoRuntime');
    };
    const styleLearning = new styleLearningCoordinator_1.StyleLearningCoordinator(log);
    const typoAcceleration = new localTypoAcceleration_1.LocalTypoAccelerationController(context, context.extensionPath, log, onRuntimeDownloadProgress);
    const projectConventionFeature = new feature_1.ProjectConventionFeature(context, log, typoAcceleration);
    const dashboardProvider = new dashboardProvider_1.KoSpellCheckDashboardProvider(context, projectConventionFeature, dashboardLogService);
    void updateRuntimeDownloadStatusSetting('Nincs aktív letöltés.');
    void updateAvailableModelsSetting(typoAcceleration.listInstalledModels());
    log(`activate version=${context.extension.packageJSON.version ?? 'unknown'}`, undefined, true);
    const codeActionProvider = vscode.languages.registerCodeActionsProvider([{ scheme: 'file' }], {
        provideCodeActions(document, range, codeActionContext) {
            const actions = [];
            const targetDiagnostics = pickTargetDiagnostics(document, codeActionContext.diagnostics, range);
            for (const diagnostic of targetDiagnostics) {
                const key = diagnosticKey(document.uri, diagnostic.range, diagnostic.message);
                const info = metadata.get(key);
                if (!info) {
                    continue;
                }
                const contextKind = classifyDiagnosticContext(document, diagnostic.range);
                const classification = info.classification;
                for (const suggestion of info.suggestions.slice(0, 5)) {
                    if (contextKind === 'identifier' &&
                        classification?.category !== 'TextTypo' &&
                        isLikelyIdentifier(info.token) &&
                        isLikelyIdentifier(suggestion)) {
                        const renameTarget = buildRenameTarget(document, diagnostic.range, suggestion);
                        const renameSymbol = new vscode.CodeAction(`Rename symbol to '${renameTarget}'`, vscode.CodeActionKind.QuickFix);
                        renameSymbol.isPreferred = classification
                            ? classification.category === 'IdentifierTypo'
                            : true;
                        renameSymbol.diagnostics = [diagnostic];
                        renameSymbol.command = {
                            command: 'kospellcheck.renameSymbolWithSuggestion',
                            title: 'KoSpellCheck: Rename symbol with suggestion',
                            arguments: [document.uri, diagnostic.range, info.token, suggestion, renameTarget]
                        };
                        actions.push(renameSymbol);
                        continue;
                    }
                    const replaceSingle = new vscode.CodeAction(`Replace this with '${suggestion}'`, vscode.CodeActionKind.QuickFix);
                    replaceSingle.diagnostics = [diagnostic];
                    replaceSingle.edit = new vscode.WorkspaceEdit();
                    replaceSingle.edit.replace(document.uri, diagnostic.range, suggestion);
                    actions.push(replaceSingle);
                }
                const addToDictionary = new vscode.CodeAction(`Add '${info.token}' to project dictionary`, vscode.CodeActionKind.QuickFix);
                addToDictionary.command = {
                    command: 'kospellcheck.addWordToProjectDictionary',
                    title: 'KoSpellCheck: Add word to project dictionary',
                    arguments: [info.token]
                };
                addToDictionary.diagnostics = [diagnostic];
                actions.push(addToDictionary);
            }
            return actions;
        }
    }, {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    });
    const addWordCommand = vscode.commands.registerCommand('kospellcheck.addWordToProjectDictionary', async (word) => {
        const editor = vscode.window.activeTextEditor;
        const token = word?.trim() ?? editor?.document.getText(editor.selection).trim() ?? '';
        if (!token) {
            return;
        }
        const workspaceFolder = editor
            ? vscode.workspace.getWorkspaceFolder(editor.document.uri)
            : vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }
        const configPath = node_path_1.default.join(workspaceFolder.uri.fsPath, 'kospellcheck.json');
        const config = node_fs_1.default.existsSync(configPath)
            ? JSON.parse(node_fs_1.default.readFileSync(configPath, 'utf8'))
            : { enabled: true };
        const projectDictionaryRaw = Array.isArray(config.projectDictionary)
            ? [...config.projectDictionary]
            : [];
        const exists = projectDictionaryRaw.some((x) => x.toLowerCase() === token.toLowerCase());
        if (!exists) {
            projectDictionaryRaw.push(token);
            config.projectDictionary = projectDictionaryRaw;
            node_fs_1.default.writeFileSync(configPath, JSON.stringify(config, null, 2));
            vscode.window.showInformationMessage(`KoSpellCheck: '${token}' added to project dictionary.`);
            styleLearning.scheduleWorkspaceRefresh(workspaceFolder.uri.fsPath, 'project-dictionary-updated');
        }
        if (editor) {
            scheduleDocumentCheck(editor.document, 'add-word-command');
        }
    });
    const renameSymbolCommand = vscode.commands.registerCommand('kospellcheck.renameSymbolWithSuggestion', async (uri, range, token, replacement, renameTarget) => {
        if (!uri || !range || !replacement) {
            return;
        }
        const document = await vscode.workspace.openTextDocument(uri);
        const contextKind = classifyDiagnosticContext(document, range);
        if (contextKind !== 'identifier') {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, range, replacement);
            await vscode.workspace.applyEdit(edit);
            return;
        }
        const targetName = isLikelyIdentifier(renameTarget ?? '')
            ? renameTarget
            : buildRenameTarget(document, range, replacement);
        const renamePosition = findContainingIdentifierRange(document, range.start)?.start ?? range.start;
        try {
            const renameEdit = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', uri, renamePosition, targetName);
            if (renameEdit && workspaceEditHasChanges(renameEdit)) {
                await vscode.workspace.applyEdit(renameEdit);
                return;
            }
        }
        catch {
            // fall back to document-local replacement when rename provider is unavailable
        }
        const ranges = findTokenRangesInDocument(document, token);
        if (ranges.length === 0) {
            return;
        }
        const edit = new vscode.WorkspaceEdit();
        for (const range of ranges) {
            edit.replace(uri, range, replacement);
        }
        await vscode.workspace.applyEdit(edit);
    });
    const checkLocalTypoAccelerationStatusCommand = vscode.commands.registerCommand('kospellcheck.checkLocalTypoAccelerationStatus', async () => {
        const uri = vscode.window.activeTextEditor?.document.uri;
        const workspaceConfig = vscode.workspace.getConfiguration('kospellcheck', uri);
        const globalConfig = vscode.workspace.getConfiguration(undefined, uri);
        const mode = resolveTypoAccelerationModeFromSettings(workspaceConfig, globalConfig);
        const selectedModel = resolveTypoAccelerationModelFromSettings(workspaceConfig, globalConfig);
        const availability = typoAcceleration.inspectAvailability(true);
        const effectiveConfig = (0, config_1.loadConfig)();
        effectiveConfig.localTypoAccelerationMode = mode;
        effectiveConfig.localTypoAccelerationModel = selectedModel;
        const backendStatus = typoAcceleration.inspectClassifierBackend(effectiveConfig);
        const availableModels = typoAcceleration.listInstalledModels();
        void updateAvailableModelsSetting(availableModels);
        const statusText = toHungarianAvailability(availability.status);
        const modeText = toHungarianMode(mode);
        const autoDownload = resolveTypoAccelerationAutoDownloadFromSettings(workspaceConfig, globalConfig);
        const runtimeDownloadStatus = resolveRuntimeDownloadStatusFromSettings(workspaceConfig, globalConfig);
        const modelLabel = backendStatus.selectedModelId
            ? `${backendStatus.selectedModelDisplayName ?? backendStatus.selectedModelId} (${backendStatus.selectedModelId})`
            : selectedModel;
        const availableModelsText = availableModels.length > 0
            ? availableModels
                .map((item) => `${item.id}${item.isDefault ? ' [default]' : ''}`)
                .join(', ')
            : 'nincs telepített modell';
        const detail = availability.detail ? `\nRészlet: ${availability.detail}` : '';
        const backendText = backendStatus.tpuInferenceActive
            ? `Aktív (${backendStatus.backend})`
            : `Nem aktív (${backendStatus.backend})`;
        const tfliteRuntimeText = toLoadedNotLoadedText(backendStatus.tfliteRuntimeLoaded);
        const modelLoadableText = toModelLoadableText(backendStatus.modelLoadable);
        const modelPlaceholderText = toModelPlaceholderText(backendStatus.modelPlaceholder);
        const backendDetail = `\nKiválasztott modell: ${modelLabel}` +
            `\nElérhető modellek: ${availableModelsText}` +
            `\nModel betölthető: ${modelLoadableText}` +
            `\nModel placeholder: ${modelPlaceholderText}` +
            `\nTFLite C runtime: ${tfliteRuntimeText}` +
            `\nTPU inferencia: ${backendText}` +
            `\nBackend részlet: ${backendStatus.detail}`;
        const time = `\nEllenőrzés ideje: ${new Date(availability.detectedAtUtc).toLocaleString('hu-HU')}`;
        const message = `Helyi elírás-gyorsító állapot\n` +
            `Mód: ${modeText}\n` +
            `Model beállítás: ${selectedModel}\n` +
            `Runtime auto-letöltés: ${autoDownload ? 'bekapcsolva' : 'kikapcsolva'}\n` +
            `Runtime letöltési állapot: ${runtimeDownloadStatus}\n` +
            `Detektálás: ${statusText}` +
            detail +
            backendDetail +
            time +
            '\n\nVáltás: off = kikapcsolva, auto = automatikus, on = mindig próbálja (ha nem elérhető, fallback).';
        const selectDownloadNow = 'Runtime letöltés most';
        const selectModel = 'Modell kiválasztás';
        const selectAuto = 'Mód: auto';
        const selectOn = 'Mód: on';
        const selectOff = 'Mód: off';
        const selection = await vscode.window.showInformationMessage(message, { modal: false }, selectDownloadNow, selectModel, selectAuto, selectOn, selectOff);
        if (!selection) {
            return;
        }
        if (selection === selectDownloadNow) {
            await vscode.commands.executeCommand('kospellcheck.downloadLocalTypoRuntime');
            return;
        }
        if (selection === selectModel) {
            await vscode.commands.executeCommand('kospellcheck.pickLocalTypoModel');
            return;
        }
        const target = uri && vscode.workspace.getWorkspaceFolder(uri)
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
        const updatedMode = selection === selectOn ? 'on' : selection === selectOff ? 'off' : 'auto';
        await workspaceConfig.update('localTypoAcceleration.mode', updatedMode, target);
        vscode.window.showInformationMessage(`KoSpellCheck: localTypoAcceleration mód -> ${updatedMode}`);
    });
    const downloadLocalTypoRuntimeCommand = vscode.commands.registerCommand('kospellcheck.downloadLocalTypoRuntime', async () => {
        const uri = vscode.window.activeTextEditor?.document.uri;
        const workspaceConfig = vscode.workspace.getConfiguration('kospellcheck', uri);
        const globalConfig = vscode.workspace.getConfiguration(undefined, uri);
        const mode = resolveTypoAccelerationModeFromSettings(workspaceConfig, globalConfig);
        const model = resolveTypoAccelerationModelFromSettings(workspaceConfig, globalConfig);
        const autoDownload = resolveTypoAccelerationAutoDownloadFromSettings(workspaceConfig, globalConfig);
        const effectiveConfig = (0, config_1.loadConfig)();
        effectiveConfig.localTypoAccelerationMode = mode;
        effectiveConfig.localTypoAccelerationModel = model;
        effectiveConfig.localTypoAccelerationAutoDownloadRuntime = autoDownload;
        effectiveConfig.localTypoAccelerationVerboseLogging = true;
        void updateRuntimeDownloadStatusSetting('Runtime letöltés kézzel indítva...');
        typoAcceleration.requestRuntimeDownload(effectiveConfig, uri, true);
        vscode.window.showInformationMessage('KoSpellCheck: runtime letöltés indítva (ha elérhető a platformhoz tartozó csomag a repo-ban).');
    });
    const pickLocalTypoModelCommand = vscode.commands.registerCommand('kospellcheck.pickLocalTypoModel', async () => {
        const uri = vscode.window.activeTextEditor?.document.uri;
        const workspaceConfig = vscode.workspace.getConfiguration('kospellcheck', uri);
        const globalConfig = vscode.workspace.getConfiguration(undefined, uri);
        const selected = resolveTypoAccelerationModelFromSettings(workspaceConfig, globalConfig);
        const models = typoAcceleration.listInstalledModels();
        void updateAvailableModelsSetting(models);
        if (models.length === 0) {
            vscode.window.showInformationMessage('KoSpellCheck: nincs telepített modell. Előbb töltsd le a runtime csomagot.');
            return;
        }
        const quickPickItems = [
            {
                label: 'auto',
                description: 'Alapértelmezett runtime modell',
                detail: 'A runtime manifest default modelljét használja.'
            },
            ...models.map((item) => ({
                label: item.id,
                description: `${item.displayName}${item.isDefault ? ' [default]' : ''}`,
                detail: `${item.relativePath}${item.format ? ` | ${item.format}` : ''}${item.description ? ` | ${item.description}` : ''}`
            }))
        ];
        const picked = await vscode.window.showQuickPick(quickPickItems, {
            title: 'KoSpellCheck: Local Typo model kiválasztása',
            placeHolder: `Jelenlegi: ${selected}`
        });
        if (!picked) {
            return;
        }
        const target = uri && vscode.workspace.getWorkspaceFolder(uri)
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
        await workspaceConfig.update('localTypoAcceleration.model', picked.label, target);
        vscode.window.showInformationMessage(`KoSpellCheck: localTypoAcceleration modell -> ${picked.label}`);
    });
    const checkNow = (document, trigger) => {
        if (document.uri.scheme !== 'file') {
            log(`skip check trigger=${trigger} reason=non-file scheme=${document.uri.scheme}`, document.uri);
            return;
        }
        const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
        if (!activeUri || activeUri !== document.uri.toString()) {
            log(`skip check trigger=${trigger} reason=inactive-editor`, document.uri);
            return;
        }
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const workspaceRoot = workspaceFolder?.uri.fsPath;
        const config = (0, config_1.loadConfig)(workspaceFolder?.uri.fsPath);
        const workspaceConfig = vscode.workspace.getConfiguration('kospellcheck', document.uri);
        const globalConfig = vscode.workspace.getConfiguration(undefined, document.uri);
        const settingEnabled = workspaceConfig.get('enabled', true);
        config.enabled = config.enabled && settingEnabled;
        config.localTypoAccelerationMode = resolveTypoAccelerationModeFromSettings(workspaceConfig, globalConfig);
        config.localTypoAccelerationModel = resolveTypoAccelerationModelFromSettings(workspaceConfig, globalConfig);
        config.localTypoAccelerationShowDetectionPrompt = workspaceConfig.get('localTypoAcceleration.showDetectionPrompt', config.localTypoAccelerationShowDetectionPrompt);
        const fallbackShowPrompt = globalConfig.get('koSpellCheck.localTypoAcceleration.showDetectionPrompt');
        if (typeof fallbackShowPrompt === 'boolean') {
            config.localTypoAccelerationShowDetectionPrompt = fallbackShowPrompt;
        }
        config.localTypoAccelerationVerboseLogging = workspaceConfig.get('localTypoAcceleration.verboseLogging', config.localTypoAccelerationVerboseLogging);
        const fallbackVerbose = globalConfig.get('koSpellCheck.localTypoAcceleration.verboseLogging');
        if (typeof fallbackVerbose === 'boolean') {
            config.localTypoAccelerationVerboseLogging = fallbackVerbose;
        }
        config.localTypoAccelerationAutoDownloadRuntime = workspaceConfig.get('localTypoAcceleration.autoDownloadRuntime', config.localTypoAccelerationAutoDownloadRuntime);
        const fallbackAutoDownload = globalConfig.get('koSpellCheck.localTypoAcceleration.autoDownloadRuntime');
        if (typeof fallbackAutoDownload === 'boolean') {
            config.localTypoAccelerationAutoDownloadRuntime = fallbackAutoDownload;
        }
        void updateAvailableModelsSetting(typoAcceleration.listInstalledModels());
        if (!config.enabled) {
            log(`skip check trigger=${trigger} reason=disabled`, document.uri);
            diagnostics.delete(document.uri);
            return;
        }
        try {
            log(`check start trigger=${trigger}`, document.uri);
            service.ensureInitialized();
            if (!initializationNotesLogged) {
                for (const note of service.getInitializationNotes()) {
                    const force = note.includes('fallback-wordset');
                    log(`init ${note}`, document.uri, force);
                }
                initializationNotesLogged = true;
            }
            const uri = document.uri.toString();
            const focusOffsets = [];
            const pending = pendingFocusOffsets.get(uri);
            if (pending && pending.length > 0) {
                focusOffsets.push(...pending);
            }
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.toString() === uri) {
                focusOffsets.push(document.offsetAt(editor.selection.active));
            }
            if (workspaceRoot && config.styleLearningEnabled && !styleLearning.getProfile(workspaceRoot)) {
                styleLearning.scheduleWorkspaceRefresh(workspaceRoot, `on-demand-${trigger}`, 200);
            }
            const issues = (0, engine_1.checkDocument)(document.getText(), config, service, {
                focusOffsets,
                styleProfile: styleLearning.getProfile(workspaceRoot)
            });
            const acceleratedIssues = typoAcceleration.applyToIssues(document, issues, config, (range) => classifyDiagnosticContext(document, range));
            const diagList = issuesToDiagnostics(document, acceleratedIssues, metadata);
            diagnostics.set(document.uri, diagList);
            pendingFocusOffsets.delete(uri);
            log(`check done trigger=${trigger} issues=${acceleratedIssues.length} diagnostics=${diagList.length} focusOffsets=${focusOffsets.length}`, document.uri);
            for (const issue of acceleratedIssues.slice(0, 3)) {
                log(`issue token='${issue.token}' range=${issue.start}-${issue.end} message=${issue.message}`, document.uri);
            }
        }
        catch (error) {
            const message = formatError(error);
            log(message, document.uri, true);
            diagnostics.delete(document.uri);
            if (!errorNotificationShown) {
                errorNotificationShown = true;
                void vscode.window.showWarningMessage('KoSpellCheck initialization error. Open Output -> KoSpellCheck for details.');
            }
        }
    };
    const scheduleDocumentCheck = (document, reason) => {
        const uri = document.uri.toString();
        const configuredDebounce = vscode.workspace.getConfiguration('kospellcheck', document.uri).get('debounceMs', 500);
        const debounceMs = Math.min(600, Math.max(400, configuredDebounce));
        const existing = timers.get(uri);
        if (existing) {
            clearTimeout(existing);
        }
        timers.set(uri, setTimeout(() => {
            timers.delete(uri);
            checkNow(document, reason);
        }, debounceMs));
        log(`schedule check reason=${reason} debounceMs=${debounceMs}`, document.uri);
    };
    context.subscriptions.push(diagnostics, output, dashboardLogService, styleLearning, projectConventionFeature, dashboardProvider, codeActionProvider, addWordCommand, renameSymbolCommand, checkLocalTypoAccelerationStatusCommand, downloadLocalTypoRuntimeCommand, pickLocalTypoModelCommand, vscode.workspace.onDidChangeTextDocument((event) => {
        const uri = event.document.uri.toString();
        const list = pendingFocusOffsets.get(uri) ?? [];
        for (const change of event.contentChanges) {
            list.push(change.rangeOffset);
        }
        pendingFocusOffsets.set(uri, list.slice(-16));
        log(`text change edits=${event.contentChanges.length} pendingOffsets=${list.length}`, event.document.uri);
        scheduleDocumentCheck(event.document, 'text-change');
    }), vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            scheduleDocumentCheck(editor.document, 'active-editor-changed');
        }
    }), vscode.workspace.onDidSaveTextDocument((document) => {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (workspaceFolder) {
            styleLearning.scheduleWorkspaceRefresh(workspaceFolder.uri.fsPath, 'document-saved');
        }
    }), vscode.workspace.onDidChangeWorkspaceFolders(() => {
        styleLearning.scheduleAllWorkspaceRefreshes('workspace-folders-changed');
    }), vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('kospellcheck.localTypoAcceleration.manualDownloadNow')) {
            void tryTriggerManualRuntimeDownloadFromSetting();
        }
        if (event.affectsConfiguration('kospellcheck.localTypoAcceleration.model') ||
            event.affectsConfiguration('kospellcheck.localTypoAcceleration.mode')) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                scheduleDocumentCheck(editor.document, 'local-typo-config-changed');
            }
        }
        if (event.affectsConfiguration('kospellcheck') &&
            !event.affectsConfiguration('kospellcheck.localTypoAcceleration.runtimeDownloadStatus') &&
            !event.affectsConfiguration('kospellcheck.localTypoAcceleration.availableModels') &&
            !event.affectsConfiguration('kospellcheck.localTypoAcceleration.manualDownloadNow')) {
            styleLearning.scheduleAllWorkspaceRefreshes('settings-changed', 250);
        }
    }), vscode.workspace.onDidCloseTextDocument((document) => {
        diagnostics.delete(document.uri);
        const timer = timers.get(document.uri.toString());
        if (timer) {
            clearTimeout(timer);
            timers.delete(document.uri.toString());
        }
        pendingFocusOffsets.delete(document.uri.toString());
        log(`document closed`, document.uri);
    }));
    if (vscode.window.activeTextEditor) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
        if (workspaceFolder) {
            styleLearning.scheduleWorkspaceRefresh(workspaceFolder.uri.fsPath, 'activation', 100);
        }
        scheduleDocumentCheck(vscode.window.activeTextEditor.document, 'activation');
    }
    void tryTriggerManualRuntimeDownloadFromSetting();
    styleLearning.scheduleAllWorkspaceRefreshes('startup');
}
function deactivate() {
    // no-op
}
function issuesToDiagnostics(document, issues, metadata) {
    const output = [];
    for (const issue of issues) {
        const range = new vscode.Range(document.positionAt(issue.start), document.positionAt(issue.end));
        const severity = issue.typoClassification?.category === 'Uncertain'
            ? vscode.DiagnosticSeverity.Information
            : issue.type === 'preference'
                ? vscode.DiagnosticSeverity.Information
                : vscode.DiagnosticSeverity.Warning;
        const diagnostic = new vscode.Diagnostic(range, issue.message, severity);
        diagnostic.source = SOURCE;
        const key = diagnosticKey(document.uri, range, issue.message);
        metadata.set(key, {
            token: issue.token,
            suggestions: issue.suggestions.map((s) => s.replacement),
            classification: issue.typoClassification
        });
        output.push(diagnostic);
    }
    return output;
}
function isTypoAccelerationMode(value) {
    return value === 'off' || value === 'auto' || value === 'on';
}
function resolveTypoAccelerationModeFromSettings(workspaceConfig, globalConfig) {
    const workspaceMode = workspaceConfig.get('localTypoAcceleration.mode');
    if (isTypoAccelerationMode(workspaceMode)) {
        return workspaceMode;
    }
    const compatibilityMode = globalConfig.get('koSpellCheck.localTypoAcceleration.mode');
    if (isTypoAccelerationMode(compatibilityMode)) {
        return compatibilityMode;
    }
    return 'auto';
}
function resolveTypoAccelerationModelFromSettings(workspaceConfig, globalConfig) {
    const workspaceModel = workspaceConfig.get('localTypoAcceleration.model');
    if (typeof workspaceModel === 'string' && workspaceModel.trim().length > 0) {
        return workspaceModel.trim();
    }
    const compatibilityModel = globalConfig.get('koSpellCheck.localTypoAcceleration.model');
    if (typeof compatibilityModel === 'string' && compatibilityModel.trim().length > 0) {
        return compatibilityModel.trim();
    }
    return 'auto';
}
function resolveTypoAccelerationAutoDownloadFromSettings(workspaceConfig, globalConfig) {
    const workspaceValue = workspaceConfig.get('localTypoAcceleration.autoDownloadRuntime');
    if (typeof workspaceValue === 'boolean') {
        return workspaceValue;
    }
    const compatibilityValue = globalConfig.get('koSpellCheck.localTypoAcceleration.autoDownloadRuntime');
    if (typeof compatibilityValue === 'boolean') {
        return compatibilityValue;
    }
    return true;
}
function resolveRuntimeDownloadStatusFromSettings(workspaceConfig, globalConfig) {
    const workspaceValue = workspaceConfig.get('localTypoAcceleration.runtimeDownloadStatus');
    if (typeof workspaceValue === 'string' && workspaceValue.trim().length > 0) {
        return workspaceValue.trim();
    }
    const compatibilityValue = globalConfig.get('koSpellCheck.localTypoAcceleration.runtimeDownloadStatus');
    if (typeof compatibilityValue === 'string' && compatibilityValue.trim().length > 0) {
        return compatibilityValue.trim();
    }
    return 'Nincs aktív letöltés';
}
function toHungarianMode(mode) {
    switch (mode) {
        case 'off':
            return 'Kikapcsolva (off)';
        case 'on':
            return 'Bekapcsolva (on)';
        case 'auto':
        default:
            return 'Automatikus (auto)';
    }
}
function toHungarianAvailability(status) {
    switch (status) {
        case 'Available':
            return 'Elérhető';
        case 'Unavailable':
            return 'Nem elérhető';
        case 'UnavailableMissingRuntime':
            return 'Nem elérhető (hiányzó helyi runtime)';
        case 'UnavailableUnsupportedPlatform':
            return 'Nem elérhető (nem támogatott platform)';
        case 'Error':
            return 'Hiba történt detektálás közben';
        default:
            return status;
    }
}
function toLoadedNotLoadedText(value) {
    if (value === true) {
        return 'loaded';
    }
    if (value === false) {
        return 'not loaded';
    }
    return 'unknown';
}
function toModelLoadableText(value) {
    if (value === true) {
        return 'igen';
    }
    if (value === false) {
        return 'nem';
    }
    return 'ismeretlen';
}
function toModelPlaceholderText(value) {
    if (value === true) {
        return 'igen (helykitöltő modell, nem futtatható TPU inferenciára)';
    }
    if (value === false) {
        return 'nem';
    }
    return 'ismeretlen';
}
function shouldCaptureForDashboard(message, force) {
    if (force) {
        return true;
    }
    if (message.startsWith('schedule check') ||
        message.startsWith('text change') ||
        message.startsWith('document closed') ||
        message.startsWith('issue token=')) {
        return false;
    }
    return (message.startsWith('activate') ||
        message.startsWith('check start') ||
        message.startsWith('check done') ||
        message.startsWith('init ') ||
        message.includes('project-conventions') ||
        message.includes('local-typo-acceleration') ||
        message.includes('runtime-download') ||
        message.includes('settings-changed'));
}
function diagnosticKey(uri, range, message) {
    return `${uri.toString()}|${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}|${message}`;
}
function formatError(error) {
    let raw;
    if (error instanceof Error) {
        raw = error.stack ?? error.message;
    }
    else {
        raw = String(error);
    }
    const firstLine = raw.split(/\r?\n/u, 1)[0].trim();
    if (firstLine.length <= 500) {
        return firstLine;
    }
    return `${firstLine.slice(0, 500)}...`;
}
function findTokenRangesInDocument(document, token) {
    if (!token) {
        return [];
    }
    const text = document.getText();
    const ranges = [];
    let offset = 0;
    while (offset < text.length) {
        const hit = text.indexOf(token, offset);
        if (hit < 0) {
            break;
        }
        const prev = hit > 0 ? text[hit - 1] : '';
        const nextIndex = hit + token.length;
        const next = nextIndex < text.length ? text[nextIndex] : '';
        const isLeftBoundary = !isIdentifierChar(prev);
        const isRightBoundary = !isIdentifierChar(next);
        if (isLeftBoundary && isRightBoundary) {
            ranges.push(new vscode.Range(document.positionAt(hit), document.positionAt(nextIndex)));
        }
        offset = hit + token.length;
    }
    return ranges;
}
function isIdentifierChar(char) {
    if (!char) {
        return false;
    }
    return /[\p{L}\p{M}\p{N}_]/u.test(char);
}
function workspaceEditHasChanges(edit) {
    return edit.entries().some(([, changes]) => changes.length > 0);
}
function isLikelyIdentifier(token) {
    if (!token) {
        return false;
    }
    return /^[@\p{L}_][\p{L}\p{M}\p{N}_]*$/u.test(token);
}
function rangesIntersect(left, right) {
    return !!left.intersection(right);
}
function pickTargetDiagnostics(document, diagnostics, range) {
    const sameSource = diagnostics.filter((diagnostic) => diagnostic.source === SOURCE);
    const intersecting = sameSource.filter((diagnostic) => rangesIntersect(diagnostic.range, range));
    if (intersecting.length === 0) {
        return [];
    }
    const containingCursor = intersecting.filter((diagnostic) => diagnostic.range.contains(range.start));
    if (containingCursor.length > 0) {
        return dedupeDiagnostics(containingCursor);
    }
    const cursorOffset = document.offsetAt(range.start);
    const sortedByDistance = intersecting
        .slice()
        .sort((left, right) => distanceToRange(document, left.range, cursorOffset) - distanceToRange(document, right.range, cursorOffset));
    return dedupeDiagnostics(sortedByDistance.slice(0, 1));
}
function distanceToRange(document, range, offset) {
    const start = document.offsetAt(range.start);
    const end = document.offsetAt(range.end);
    if (offset < start) {
        return start - offset;
    }
    if (offset > end) {
        return offset - end;
    }
    return 0;
}
function dedupeDiagnostics(diagnostics) {
    const seen = new Set();
    const output = [];
    for (const diagnostic of diagnostics) {
        const id = `${diagnostic.range.start.line}:${diagnostic.range.start.character}-${diagnostic.range.end.line}:${diagnostic.range.end.character}|${diagnostic.message}`;
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        output.push(diagnostic);
    }
    return output;
}
function classifyDiagnosticContext(document, range) {
    const startOffset = document.offsetAt(range.start);
    const text = document.getText();
    if (startOffset < 0 || startOffset >= text.length) {
        return 'identifier';
    }
    if (isInsideQuotedString(text, startOffset) || isInsideLineComment(text, startOffset)) {
        return 'literal';
    }
    return 'identifier';
}
function isInsideQuotedString(text, offset) {
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    for (let i = 0; i < text.length && i < offset; i++) {
        const ch = text[i];
        if (ch === '\n' || ch === '\r') {
            if (!inSingle && !inDouble) {
                escaped = false;
            }
            continue;
        }
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = inSingle || inDouble;
            continue;
        }
        if (!inDouble && ch === '\'') {
            inSingle = !inSingle;
            continue;
        }
        if (!inSingle && ch === '"') {
            inDouble = !inDouble;
            continue;
        }
    }
    return inSingle || inDouble;
}
function isInsideLineComment(text, offset) {
    const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
    const lineEndIdx = text.indexOf('\n', offset);
    const lineEnd = lineEndIdx >= 0 ? lineEndIdx : text.length;
    const line = text.slice(lineStart, lineEnd);
    const localOffset = offset - lineStart;
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    for (let i = 0; i < line.length; i++) {
        if (i >= localOffset) {
            break;
        }
        const ch = line[i];
        const next = i + 1 < line.length ? line[i + 1] : '';
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = inSingle || inDouble;
            continue;
        }
        if (!inDouble && ch === '\'') {
            inSingle = !inSingle;
            continue;
        }
        if (!inSingle && ch === '"') {
            inDouble = !inDouble;
            continue;
        }
        if (!inSingle && !inDouble && ch === '/' && next === '/') {
            return true;
        }
    }
    return false;
}
function findContainingIdentifierRange(document, position) {
    const offset = document.offsetAt(position);
    const text = document.getText();
    if (offset < 0 || offset > text.length) {
        return undefined;
    }
    let start = offset;
    while (start > 0 && isIdentifierChar(text[start - 1])) {
        start -= 1;
    }
    let end = offset;
    while (end < text.length && isIdentifierChar(text[end])) {
        end += 1;
    }
    if (end <= start) {
        return undefined;
    }
    return new vscode.Range(document.positionAt(start), document.positionAt(end));
}
function buildRenameTarget(document, range, replacement) {
    if (!isLikelyIdentifier(replacement)) {
        return replacement;
    }
    const identifierRange = findContainingIdentifierRange(document, range.start);
    if (!identifierRange) {
        return replacement;
    }
    const identifierText = document.getText(identifierRange);
    const identifierStart = document.offsetAt(identifierRange.start);
    const partStart = document.offsetAt(range.start);
    const partEnd = document.offsetAt(range.end);
    const relStart = partStart - identifierStart;
    const relEnd = partEnd - identifierStart;
    if (relStart < 0 || relEnd < relStart || relEnd > identifierText.length) {
        return replacement;
    }
    const candidate = identifierText.slice(0, relStart) +
        replacement +
        identifierText.slice(relEnd);
    return isLikelyIdentifier(candidate) ? candidate : replacement;
}
//# sourceMappingURL=extension.js.map