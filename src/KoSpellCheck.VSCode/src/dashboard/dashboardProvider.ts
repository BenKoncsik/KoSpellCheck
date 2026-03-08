import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { mapDashboardViewModel } from './dashboardMapper';
import { DashboardLogService } from './dashboardLogService';
import { DashboardStateStore } from './dashboardState';
import { ProjectConventionDashboardSnapshot, ProjectConventionFeature } from '../projectConventions/feature';

const DASHBOARD_VIEW_TYPE = 'kospellcheck.dashboardView';

type DashboardMessage =
  | { command: 'refresh' }
  | { command: 'rebuild' }
  | { command: 'refreshConventionMap' }
  | { command: 'clearLogs' }
  | { command: 'openSettings' }
  | { command: 'openProfile'; path?: string }
  | { command: 'revealDiagnostic'; path?: string; line?: number; column?: number }
  | { command: 'toggleSetting'; settingId?: string; value?: unknown };

export class KoSpellCheckDashboardProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly state = new DashboardStateStore();
  private webviewView?: vscode.WebviewView;
  private pendingRefreshTimer?: NodeJS.Timeout;
  private refreshTask: Promise<void> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projectConventionFeature: ProjectConventionFeature,
    private readonly logService: DashboardLogService
  ) {
    this.disposables.push(
      this.state,
      vscode.window.registerWebviewViewProvider(DASHBOARD_VIEW_TYPE, this, {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }),
      this.registerCommands(),
      this.state.onDidChange((value) => {
        void this.postState(value);
      }),
      this.projectConventionFeature.onDidStateChange(() => {
        this.scheduleRefresh('project-conventions-state');
      }),
      this.logService.onDidChange(() => {
        this.state.setLogs(this.logService.snapshot());
      })
    );
  }

  public dispose(): void {
    if (this.pendingRefreshTimer) {
      clearTimeout(this.pendingRefreshTimer);
      this.pendingRefreshTimer = undefined;
    }

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'resources')]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    this.disposables.push(
      webviewView.onDidDispose(() => {
        if (this.webviewView === webviewView) {
          this.webviewView = undefined;
        }
      }),
      webviewView.webview.onDidReceiveMessage((message: DashboardMessage) => {
        void this.handleMessage(message);
      })
    );

    this.scheduleRefresh('dashboard-opened', 0);
  }

  private registerCommands(): vscode.Disposable {
    const openDashboardCommand = vscode.commands.registerCommand(
      'kospellcheck.openDashboard',
      async () => {
        await vscode.commands.executeCommand('workbench.view.extension.kospellcheck');
        this.webviewView?.show?.(true);
        this.scheduleRefresh('open-dashboard', 0);
      }
    );

    const refreshDashboardCommand = vscode.commands.registerCommand(
      'kospellcheck.refreshDashboard',
      async () => {
        await this.refresh('command-refresh-dashboard');
      }
    );

    const refreshConventionMapCommand = vscode.commands.registerCommand(
      'kospellcheck.refreshConventionMap',
      async () => {
        await this.projectConventionFeature.rebuildActiveScope('dashboard-refresh-convention-map', false);
        await this.refresh('command-refresh-convention-map');
      }
    );

    const clearLogsCommand = vscode.commands.registerCommand(
      'kospellcheck.clearDashboardLogs',
      () => {
        this.logService.clear();
      }
    );

    return vscode.Disposable.from(
      openDashboardCommand,
      refreshDashboardCommand,
      refreshConventionMapCommand,
      clearLogsCommand
    );
  }

  private scheduleRefresh(reason: string, delayMs = 120): void {
    if (this.pendingRefreshTimer) {
      clearTimeout(this.pendingRefreshTimer);
    }

    this.pendingRefreshTimer = setTimeout(() => {
      this.pendingRefreshTimer = undefined;
      void this.refresh(reason);
    }, delayMs);
  }

  private async refresh(reason: string): Promise<void> {
    if (this.refreshTask) {
      return this.refreshTask;
    }

    this.refreshTask = this.doRefresh(reason);
    try {
      await this.refreshTask;
    } finally {
      this.refreshTask = undefined;
    }
  }

  private async doRefresh(reason: string): Promise<void> {
    this.state.setLoading();
    this.logService.append(`dashboard refresh started reason=${reason}`);

    try {
      const snapshot = this.projectConventionFeature.getDashboardSnapshot(
        vscode.window.activeTextEditor?.document.uri
      );
      const examplesByFolder = await this.collectFolderExamples(snapshot);
      const model = mapDashboardViewModel(snapshot, this.logService.snapshot(), examplesByFolder);
      this.state.setData(model);
      this.logService.append(
        `dashboard refresh completed diagnostics=${model.diagnostics.length} folders=${model.conventionMap.length}`
      );
    } catch (error) {
      const message = `dashboard refresh failed reason=${String(error)}`;
      this.logService.append(message, 'error');
      this.state.setError(message);
    }
  }

  private async handleMessage(message: DashboardMessage): Promise<void> {
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

  private async toggleSetting(settingId: string, currentValue: unknown): Promise<void> {
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    const config = vscode.workspace.getConfiguration('kospellcheck');
    const current =
      typeof currentValue === 'boolean'
        ? currentValue
        : config.get<boolean>(settingId);
    if (typeof current !== 'boolean') {
      return;
    }

    await config.update(settingId, !current, target);
    this.logService.append(`dashboard setting toggled id=${settingId} value=${!current}`);
  }

  private async openFile(targetPath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(targetPath);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      this.logService.append(`dashboard open profile failed path=${targetPath} reason=${String(error)}`, 'warn');
    }
  }

  private async revealDiagnostic(targetPath: string, line?: number, column?: number): Promise<void> {
    try {
      const uri = vscode.Uri.file(targetPath);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, { preview: false });
      const safeLine = Math.max(0, Math.min(Number(line ?? 0), Math.max(0, document.lineCount - 1)));
      const safeColumn = Math.max(0, Number(column ?? 0));
      const position = new vscode.Position(safeLine, safeColumn);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    } catch (error) {
      this.logService.append(`dashboard reveal failed path=${targetPath} reason=${String(error)}`, 'warn');
    }
  }

  private async collectFolderExamples(
    snapshot: ProjectConventionDashboardSnapshot
  ): Promise<Record<string, string[]>> {
    const root = snapshot.scope?.storageRoot;
    const profile = asRecord(snapshot.profile);
    const folders = asRecord(profile.Folders);
    if (!root || !fs.existsSync(root) || Object.keys(folders).length === 0) {
      return {};
    }

    const output: Record<string, string[]> = {};
    for (const [folderPath, folderValue] of Object.entries(folders)) {
      const folder = asRecord(folderValue);
      const suffix = topFrequencyValue(folder.DominantSuffixes);
      const prefix = topFrequencyValue(folder.DominantPrefixes);
      output[folderPath] = await this.collectExamplesForFolder(root, folderPath, suffix, prefix);
    }

    return output;
  }

  private async collectExamplesForFolder(
    workspaceRoot: string,
    folderPath: string,
    expectedSuffix: string,
    expectedPrefix: string
  ): Promise<string[]> {
    const rootFolder = folderPath === '.' ? workspaceRoot : path.join(workspaceRoot, folderPath);
    if (!fs.existsSync(rootFolder)) {
      return [];
    }

    const queue: string[] = [rootFolder];
    const output: string[] = [];
    const seen = new Set<string>();
    let scannedFiles = 0;

    while (queue.length > 0 && output.length < 3 && scannedFiles < 250) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!isIgnoredDirectory(entry.name)) {
            queue.push(path.join(current, entry.name));
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

        const stem = path.parse(entry.name).name;
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

  private async postState(state: unknown): Promise<void> {
    if (!this.webviewView) {
      return;
    }

    await this.webviewView.webview.postMessage({
      type: 'state',
      payload: state
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'dashboard', 'styles.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'dashboard', 'main.js')
    );
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function topFrequencyValue(value: unknown): string {
  const list = Array.isArray(value) ? value : [];
  if (list.length === 0) {
    return '';
  }

  const first = asRecord(list[0]);
  return typeof first.Value === 'string' ? first.Value : '';
}

function isIgnoredDirectory(name: string): boolean {
  return (
    name === 'bin' ||
    name === 'obj' ||
    name === 'node_modules' ||
    name === '.git' ||
    name === '.vs' ||
    name === '.kospellcheck'
  );
}

function randomNonce(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
