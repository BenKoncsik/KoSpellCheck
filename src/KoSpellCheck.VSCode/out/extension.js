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
const SOURCE = 'KoSpellCheck';
function activate(context) {
    const diagnostics = vscode.languages.createDiagnosticCollection(SOURCE);
    const output = vscode.window.createOutputChannel(SOURCE);
    const service = new spellService_1.SpellService(context.extensionPath);
    const metadata = new Map();
    const timers = new Map();
    const pendingFocusOffsets = new Map();
    let errorNotificationShown = false;
    const codeActionProvider = vscode.languages.registerCodeActionsProvider([{ scheme: 'file' }], {
        provideCodeActions(document, _range, codeActionContext) {
            const actions = [];
            for (const diagnostic of codeActionContext.diagnostics) {
                if (diagnostic.source !== SOURCE) {
                    continue;
                }
                const key = diagnosticKey(document.uri, diagnostic.range, diagnostic.message);
                const info = metadata.get(key);
                if (!info) {
                    continue;
                }
                for (const suggestion of info.suggestions.slice(0, 5)) {
                    const replace = new vscode.CodeAction(`Replace with '${suggestion}'`, vscode.CodeActionKind.QuickFix);
                    replace.diagnostics = [diagnostic];
                    replace.edit = new vscode.WorkspaceEdit();
                    replace.edit.replace(document.uri, diagnostic.range, suggestion);
                    actions.push(replace);
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
        }
        if (editor) {
            scheduleDocumentCheck(editor.document);
        }
    });
    const checkNow = (document) => {
        if (document.uri.scheme !== 'file') {
            return;
        }
        const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
        if (!activeUri || activeUri !== document.uri.toString()) {
            return;
        }
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const config = (0, config_1.loadConfig)(workspaceFolder?.uri.fsPath);
        const settingEnabled = vscode.workspace.getConfiguration('kospellcheck', document.uri).get('enabled', true);
        config.enabled = config.enabled && settingEnabled;
        if (!config.enabled) {
            diagnostics.delete(document.uri);
            return;
        }
        try {
            service.ensureInitialized();
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
            const issues = (0, engine_1.checkDocument)(document.getText(), config, service, {
                focusOffsets
            });
            const diagList = issuesToDiagnostics(document, issues, metadata);
            diagnostics.set(document.uri, diagList);
            pendingFocusOffsets.delete(uri);
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
    const scheduleDocumentCheck = (document) => {
        const uri = document.uri.toString();
        const configuredDebounce = vscode.workspace.getConfiguration('kospellcheck', document.uri).get('debounceMs', 500);
        const debounceMs = Math.min(600, Math.max(400, configuredDebounce));
        const existing = timers.get(uri);
        if (existing) {
            clearTimeout(existing);
        }
        timers.set(uri, setTimeout(() => {
            timers.delete(uri);
            checkNow(document);
        }, debounceMs));
    };
    context.subscriptions.push(diagnostics, output, codeActionProvider, addWordCommand, vscode.workspace.onDidChangeTextDocument((event) => {
        const uri = event.document.uri.toString();
        const list = pendingFocusOffsets.get(uri) ?? [];
        for (const change of event.contentChanges) {
            list.push(change.rangeOffset);
        }
        pendingFocusOffsets.set(uri, list.slice(-16));
        scheduleDocumentCheck(event.document);
    }), vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            scheduleDocumentCheck(editor.document);
        }
    }), vscode.workspace.onDidCloseTextDocument((document) => {
        diagnostics.delete(document.uri);
        const timer = timers.get(document.uri.toString());
        if (timer) {
            clearTimeout(timer);
            timers.delete(document.uri.toString());
        }
        pendingFocusOffsets.delete(document.uri.toString());
    }));
    if (vscode.window.activeTextEditor) {
        scheduleDocumentCheck(vscode.window.activeTextEditor.document);
    }
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
//# sourceMappingURL=extension.js.map