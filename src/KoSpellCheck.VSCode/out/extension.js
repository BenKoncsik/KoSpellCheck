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
const SOURCE = 'KoSpellCheck';
function activate(context) {
    const diagnostics = vscode.languages.createDiagnosticCollection(SOURCE);
    const output = vscode.window.createOutputChannel(SOURCE);
    const service = new spellService_1.SpellService(context.extensionPath);
    const metadata = new Map();
    const timers = new Map();
    const pendingFocusOffsets = new Map();
    let errorNotificationShown = false;
    let initializationNotesLogged = false;
    const isDebugEnabled = (uri) => vscode.workspace.getConfiguration('kospellcheck', uri).get('debugLogging', false);
    const log = (message, uri, force = false) => {
        if (!force && !isDebugEnabled(uri)) {
            return;
        }
        output.appendLine(`[${new Date().toISOString()}] ${message}`);
    };
    const styleLearning = new styleLearningCoordinator_1.StyleLearningCoordinator(log);
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
                for (const suggestion of info.suggestions.slice(0, 5)) {
                    if (contextKind === 'identifier' &&
                        isLikelyIdentifier(info.token) &&
                        isLikelyIdentifier(suggestion)) {
                        const renameTarget = buildRenameTarget(document, diagnostic.range, suggestion);
                        const renameSymbol = new vscode.CodeAction(`Rename symbol to '${renameTarget}'`, vscode.CodeActionKind.QuickFix);
                        renameSymbol.isPreferred = true;
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
        const settingEnabled = vscode.workspace.getConfiguration('kospellcheck', document.uri).get('enabled', true);
        config.enabled = config.enabled && settingEnabled;
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
            const diagList = issuesToDiagnostics(document, issues, metadata);
            diagnostics.set(document.uri, diagList);
            pendingFocusOffsets.delete(uri);
            log(`check done trigger=${trigger} issues=${issues.length} diagnostics=${diagList.length} focusOffsets=${focusOffsets.length}`, document.uri);
            for (const issue of issues.slice(0, 3)) {
                log(`issue token='${issue.token}' range=${issue.start}-${issue.end} message=${issue.message}`, document.uri);
            }
        }
        catch (error) {
            const message = formatError(error);
            output.appendLine(`[${new Date().toISOString()}] ${message}`);
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
    context.subscriptions.push(diagnostics, output, styleLearning, codeActionProvider, addWordCommand, renameSymbolCommand, vscode.workspace.onDidChangeTextDocument((event) => {
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
        if (event.affectsConfiguration('kospellcheck')) {
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
    styleLearning.scheduleAllWorkspaceRefreshes('startup');
}
function deactivate() {
    // no-op
}
function issuesToDiagnostics(document, issues, metadata) {
    const output = [];
    for (const issue of issues) {
        const range = new vscode.Range(document.positionAt(issue.start), document.positionAt(issue.end));
        const severity = issue.type === 'preference'
            ? vscode.DiagnosticSeverity.Information
            : vscode.DiagnosticSeverity.Warning;
        const diagnostic = new vscode.Diagnostic(range, issue.message, severity);
        diagnostic.source = SOURCE;
        const key = diagnosticKey(document.uri, range, issue.message);
        metadata.set(key, {
            token: issue.token,
            suggestions: issue.suggestions.map((s) => s.replacement)
        });
        output.push(diagnostic);
    }
    return output;
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