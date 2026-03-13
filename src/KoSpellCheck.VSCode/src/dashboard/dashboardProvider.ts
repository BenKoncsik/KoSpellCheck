import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { mapDashboardViewModel } from './dashboardMapper';
import { DashboardLogService } from './dashboardLogService';
import { DashboardStateStore } from './dashboardState';
import { ProjectConventionDashboardSnapshot, ProjectConventionFeature } from '../projectConventions/feature';
import { resolveUiLanguage, text } from '../sharedUiText';

const DASHBOARD_VIEW_TYPE = 'kospellcheck.dashboardView';

type DashboardMessage =
  | { command: 'refresh' }
  | { command: 'rebuild' }
  | { command: 'refreshConventionMap' }
  | { command: 'clearLogs' }
  | { command: 'openSettings' }
  | { command: 'openProfile'; path?: string }
  | { command: 'revealDiagnostic'; path?: string; line?: number; column?: number }
  | { command: 'revealUnusedType'; path?: string; line?: number; column?: number }
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
      model.uiStrings = this.buildUiStrings(snapshot.settings?.uiLanguage);
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
    const configuredLanguage = vscode.workspace
      .getConfiguration('kospellcheck', vscode.window.activeTextEditor?.document.uri)
      .get<string>('uiLanguage', 'auto');
    const lang = resolveUiLanguage(configuredLanguage);
    const title = text('dashboard.title', 'KoSpellCheck Dashboard', {
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

  private buildUiStrings(configuredLanguage: string | undefined): Record<string, string> {
    return {
      toolbarRefresh: text('dashboard.toolbar.refresh', 'Refresh Dashboard', { configuredLanguage }),
      toolbarRebuild: text('dashboard.toolbar.rebuild', 'Rebuild Convention Profile', { configuredLanguage }),
      toolbarRefreshMap: text('dashboard.toolbar.refreshMap', 'Refresh Convention Map', { configuredLanguage }),
      toolbarClearLogs: text('dashboard.toolbar.clearLogs', 'Clear Logs', { configuredLanguage }),
      toolbarOpenSettings: text('dashboard.toolbar.openSettings', 'Open Settings', { configuredLanguage }),
      toolbarOpenProfileJson: text('dashboard.toolbar.openProfileJson', 'Open Profile JSON', { configuredLanguage }),
      sectionOverview: text('dashboard.section.overview', 'Overview', { configuredLanguage }),
      sectionSettings: text('dashboard.section.settings', 'Settings', { configuredLanguage }),
      sectionConventionMap: text('dashboard.section.conventionMap', 'Convention Map', { configuredLanguage }),
      sectionDiagnostics: text('dashboard.section.diagnostics', 'Diagnostics', { configuredLanguage }),
      sectionUnusedTypes: text('dashboard.section.unusedTypes', 'Unused Types', { configuredLanguage }),
      sectionLogs: text('dashboard.section.logs', 'Logs', { configuredLanguage }),
      overviewWorkspaceRoot: text('dashboard.overview.workspaceRoot', 'Workspace root', { configuredLanguage }),
      overviewScope: text('dashboard.overview.scope', 'Scope', { configuredLanguage }),
      overviewFilesScanned: text('dashboard.overview.filesScanned', 'Files scanned', { configuredLanguage }),
      overviewTypesScanned: text('dashboard.overview.typesScanned', 'Types scanned', { configuredLanguage }),
      overviewDominantCase: text('dashboard.overview.dominantCase', 'Dominant case', { configuredLanguage }),
      overviewProfileUpdated: text('dashboard.overview.profileUpdated', 'Profile updated', { configuredLanguage }),
      overviewDiagnostics: text('dashboard.overview.diagnostics', 'Diagnostics', { configuredLanguage }),
      overviewConventionFeature: text('dashboard.overview.conventionFeature', 'Convention feature', { configuredLanguage }),
      overviewAiAnomaly: text('dashboard.overview.aiAnomaly', 'AI anomaly', { configuredLanguage }),
      overviewCoral: text('dashboard.overview.coral', 'Coral', { configuredLanguage }),
      overviewRebuildQueue: text('dashboard.overview.rebuildQueue', 'Rebuild queue', { configuredLanguage }),
      tableSetting: text('dashboard.table.setting', 'Setting', { configuredLanguage }),
      tableValue: text('dashboard.table.value', 'Value', { configuredLanguage }),
      tableAction: text('dashboard.table.action', 'Action', { configuredLanguage }),
      toggle: text('dashboard.table.toggle', 'Toggle', { configuredLanguage }),
      emptySettings: text('dashboard.empty.settings', 'No settings snapshot available.', { configuredLanguage }),
      tableFolder: text('dashboard.table.folder', 'Folder', { configuredLanguage }),
      tableExpectedSuffix: text('dashboard.table.expectedSuffix', 'Expected suffix', { configuredLanguage }),
      tableExpectedPrefix: text('dashboard.table.expectedPrefix', 'Expected prefix', { configuredLanguage }),
      tableDominantKind: text('dashboard.table.dominantKind', 'Dominant kind', { configuredLanguage }),
      tableConfidence: text('dashboard.table.confidence', 'Confidence', { configuredLanguage }),
      tableNamespaceSample: text('dashboard.table.namespaceSample', 'Namespace sample', { configuredLanguage }),
      tableExamples: text('dashboard.table.examples', 'Examples', { configuredLanguage }),
      emptyExamples: text('dashboard.empty.examples', 'No examples found in current workspace snapshot.', { configuredLanguage }),
      emptyConventionMap: text(
        'dashboard.empty.conventionMap',
        'No convention profile loaded yet. Rebuild profile to populate this section.',
        { configuredLanguage }
      ),
      tableSeverity: text('dashboard.table.severity', 'Severity', { configuredLanguage }),
      tableType: text('dashboard.table.type', 'Type', { configuredLanguage }),
      tableClassification: text('dashboard.table.classification', 'Classification', { configuredLanguage }),
      tableFile: text('dashboard.table.file', 'File', { configuredLanguage }),
      tableMethod: text('dashboard.table.method', 'Method', { configuredLanguage }),
      tableProblem: text('dashboard.table.problem', 'Problem', { configuredLanguage }),
      tableRule: text('dashboard.table.rule', 'Rule', { configuredLanguage }),
      tableExpected: text('dashboard.table.expected', 'Expected', { configuredLanguage }),
      tableObserved: text('dashboard.table.observed', 'Observed', { configuredLanguage }),
      tableSuggestion: text('dashboard.table.suggestion', 'Suggestion', { configuredLanguage }),
      reveal: text('dashboard.button.reveal', 'Reveal', { configuredLanguage }),
      classificationUnused: text('dashboard.value.unused', 'Unused', { configuredLanguage }),
      classificationTestOnly: text('dashboard.value.testOnly', 'Test-only', { configuredLanguage }),
      emptyDiagnostics: text('dashboard.empty.diagnostics', 'No active convention diagnostics.', { configuredLanguage }),
      emptyUnusedTypes: text('dashboard.empty.unusedTypes', 'No unused or test-only types in current snapshot.', { configuredLanguage }),
      emptyLogs: text('dashboard.empty.logs', 'No log entries yet.', { configuredLanguage }),
      valueActive: text('dashboard.value.active', 'Active', { configuredLanguage }),
      valueInactive: text('dashboard.value.inactive', 'Inactive', { configuredLanguage }),
      valueInFlight: text('dashboard.value.inFlight', 'In-flight', { configuredLanguage }),
      valueQueued: text('dashboard.value.queued', 'Queued', { configuredLanguage }),
      valueAuto: text('dashboard.value.auto', '(auto)', { configuredLanguage }),
      valueNotAvailable: text('general.notAvailable', 'n/a', { configuredLanguage }),
      valueUnknown: text('dashboard.value.unknown', 'Unknown', { configuredLanguage }),
      metaLastRefresh: text('dashboard.meta.lastRefresh', 'Last refresh:', { configuredLanguage }),
      metaLoading: text('dashboard.meta.loading', 'Loading...', { configuredLanguage })
    };
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
