import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { checkDocument } from './engine';
import { loadConfig } from './config';
import { SpellService } from './spellService';
import { SpellIssue } from './types';

const SOURCE = 'KoSpellCheck';

interface DiagnosticMetadata {
  token: string;
  suggestions: string[];
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection(SOURCE);
  const output = vscode.window.createOutputChannel(SOURCE);
  const service = new SpellService(context.extensionPath);
  const metadata = new Map<string, DiagnosticMetadata>();
  const timers = new Map<string, NodeJS.Timeout>();
  const pendingFocusOffsets = new Map<string, number[]>();
  let errorNotificationShown = false;

  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    [{ scheme: 'file' }],
    {
      provideCodeActions(document, _range, codeActionContext) {
        const actions: vscode.CodeAction[] = [];
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
            const replace = new vscode.CodeAction(
              `Replace with '${suggestion}'`,
              vscode.CodeActionKind.QuickFix
            );
            replace.diagnostics = [diagnostic];
            replace.edit = new vscode.WorkspaceEdit();
            replace.edit.replace(document.uri, diagnostic.range, suggestion);
            actions.push(replace);
          }

          const addToDictionary = new vscode.CodeAction(
            `Add '${info.token}' to project dictionary`,
            vscode.CodeActionKind.QuickFix
          );
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
    },
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    }
  );

  const addWordCommand = vscode.commands.registerCommand(
    'kospellcheck.addWordToProjectDictionary',
    async (word?: string) => {
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

      const configPath = path.join(workspaceFolder.uri.fsPath, 'kospellcheck.json');
      const config = fs.existsSync(configPath)
        ? (JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>)
        : { enabled: true };

      const projectDictionaryRaw = Array.isArray(config.projectDictionary)
        ? [...(config.projectDictionary as string[])]
        : [];
      const exists = projectDictionaryRaw.some((x) => x.toLowerCase() === token.toLowerCase());
      if (!exists) {
        projectDictionaryRaw.push(token);
        config.projectDictionary = projectDictionaryRaw;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        vscode.window.showInformationMessage(`KoSpellCheck: '${token}' added to project dictionary.`);
      }

      if (editor) {
        scheduleDocumentCheck(editor.document);
      }
    }
  );

  const checkNow = (document: vscode.TextDocument): void => {
    if (document.uri.scheme !== 'file') {
      return;
    }

    const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
    if (!activeUri || activeUri !== document.uri.toString()) {
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const config = loadConfig(workspaceFolder?.uri.fsPath);
    const settingEnabled = vscode.workspace.getConfiguration('kospellcheck', document.uri).get<boolean>('enabled', true);
    config.enabled = config.enabled && settingEnabled;

    if (!config.enabled) {
      diagnostics.delete(document.uri);
      return;
    }

    try {
      service.ensureInitialized();

      const uri = document.uri.toString();
      const focusOffsets: number[] = [];
      const pending = pendingFocusOffsets.get(uri);
      if (pending && pending.length > 0) {
        focusOffsets.push(...pending);
      }

      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.toString() === uri) {
        focusOffsets.push(document.offsetAt(editor.selection.active));
      }

      const issues = checkDocument(document.getText(), config, service, {
        focusOffsets
      });
      const diagList = issuesToDiagnostics(document, issues, metadata);
      diagnostics.set(document.uri, diagList);
      pendingFocusOffsets.delete(uri);
    } catch (error) {
      const message = formatError(error);
      output.appendLine(`[${new Date().toISOString()}] ${message}`);
      diagnostics.delete(document.uri);
      if (!errorNotificationShown) {
        errorNotificationShown = true;
        void vscode.window.showWarningMessage(
          'KoSpellCheck initialization error. Open Output -> KoSpellCheck for details.'
        );
      }
    }
  };

  const scheduleDocumentCheck = (document: vscode.TextDocument): void => {
    const uri = document.uri.toString();
    const configuredDebounce = vscode.workspace.getConfiguration('kospellcheck', document.uri).get<number>('debounceMs', 500);
    const debounceMs = Math.min(600, Math.max(400, configuredDebounce));

    const existing = timers.get(uri);
    if (existing) {
      clearTimeout(existing);
    }

    timers.set(
      uri,
      setTimeout(() => {
        timers.delete(uri);
        checkNow(document);
      }, debounceMs)
    );
  };

  context.subscriptions.push(
    diagnostics,
    output,
    codeActionProvider,
    addWordCommand,
    vscode.workspace.onDidChangeTextDocument((event) => {
      const uri = event.document.uri.toString();
      const list = pendingFocusOffsets.get(uri) ?? [];
      for (const change of event.contentChanges) {
        list.push(change.rangeOffset);
      }
      pendingFocusOffsets.set(uri, list.slice(-16));
      scheduleDocumentCheck(event.document);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        scheduleDocumentCheck(editor.document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.delete(document.uri);
      const timer = timers.get(document.uri.toString());
      if (timer) {
        clearTimeout(timer);
        timers.delete(document.uri.toString());
      }
      pendingFocusOffsets.delete(document.uri.toString());
    })
  );

  if (vscode.window.activeTextEditor) {
    scheduleDocumentCheck(vscode.window.activeTextEditor.document);
  }
}

export function deactivate(): void {
  // no-op
}

function issuesToDiagnostics(
  document: vscode.TextDocument,
  issues: SpellIssue[],
  metadata: Map<string, DiagnosticMetadata>
): vscode.Diagnostic[] {
  const output: vscode.Diagnostic[] = [];

  for (const issue of issues) {
    const range = new vscode.Range(
      document.positionAt(issue.start),
      document.positionAt(issue.end)
    );

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

function diagnosticKey(uri: vscode.Uri, range: vscode.Range, message: string): string {
  return `${uri.toString()}|${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}|${message}`;
}

function formatError(error: unknown): string {
  let raw: string;
  if (error instanceof Error) {
    raw = error.stack ?? error.message;
  } else {
    raw = String(error);
  }

  const firstLine = raw.split(/\r?\n/u, 1)[0].trim();
  if (firstLine.length <= 500) {
    return firstLine;
  }

  return `${firstLine.slice(0, 500)}...`;
}
