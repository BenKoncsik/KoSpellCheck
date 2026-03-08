import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { loadConfig } from '../config';
import {
  CoreCliAnalyzeRequest,
  CoreCliIgnoreRequest,
  CoreCliProfileBuildRequest,
  CoreConventionCliClient
} from './adapters/coreCliClient';

type LogFn = (message: string, uri?: vscode.Uri, force?: boolean) => void;

interface TypoAccelerationProbe {
  inspectAvailability(forceRefresh?: boolean): {
    status: string;
    detail?: string;
  };
  inspectClassifierBackend(config?: unknown): {
    tpuInferenceActive: boolean;
    detail: string;
    adapterPath?: string;
    runtimeRoot?: string;
  };
}

export interface ConventionFeatureConfig {
  projectConventionMappingEnabled: boolean;
  namingConventionDiagnosticsEnabled: boolean;
  statisticalAnomalyDetectionEnabled: boolean;
  aiNamingAnomalyDetectionEnabled: boolean;
  useCoralTpuIfAvailable: boolean;
  autoRebuildConventionProfile: boolean;
  analyzeOnSave: boolean;
  analyzeOnRename: boolean;
  analyzeOnNewFile: boolean;
  conventionScope: 'workspace' | 'solution';
  ignoreGeneratedCode: boolean;
  ignoreTestProjects: boolean;
  includePatterns: string[];
  excludePatterns: string[];
  supportedExtensions: string[];
  maxFiles: number;
  minEvidenceCount: number;
  statisticalAnomalyThreshold: number;
  aiAnomalyThreshold: number;
  profilePath: string;
  profileCachePath: string;
  anomalyModelPath: string;
  scanSummaryPath: string;
  ignoreListPath: string;
}

interface ConventionScopeInfo {
  scope: 'workspace' | 'solution';
  scopeKey: string;
  storageRoot: string;
}

export interface CoreConventionEvidence {
  Metric: string;
  Expected: string;
  Observed: string;
  Ratio?: number;
  SampleSize?: number;
}

export interface CoreConventionQuickFix {
  Kind:
    | 'RenameFileToPrimaryType'
    | 'RenamePrimaryTypeToFileName'
    | 'RenameSuffix'
    | 'RenameAbbreviation'
    | 'MoveFileToFolder'
    | 'UpdateNamespaceToFolderConvention'
    | 'IgnoreRuleForFile'
    | 'IgnoreRuleForFolder'
    | 'IgnoreRuleForProject';
  Title: string;
  TargetPath?: string;
  Replacement?: string;
  RuleId?: string;
  ScopeTarget?: string;
}

export interface CoreConventionDiagnostic {
  RuleId: string;
  Title: string;
  Severity: 'Info' | 'Warning' | 'Error';
  Confidence: number;
  Message: string;
  Explanation: string;
  Evidence: CoreConventionEvidence[];
  Suggestions: string[];
  QuickFixes: CoreConventionQuickFix[];
  FilePath: string;
  Line: number;
  Column: number;
  AnomalyScore?: number;
  AiScore?: number;
}

export interface CoreConventionFileFacts {
  WorkspaceRoot: string;
  AbsolutePath: string;
  RelativePath: string;
  FolderPath: string;
  FileName: string;
  FileStem: string;
}

interface ConventionDiagnosticMetadata {
  workspaceRoot: string;
  file: CoreConventionFileFacts;
  diagnostic: CoreConventionDiagnostic;
  profile?: unknown;
  ignoreList?: unknown;
}

interface CoreAnalyzeResponse {
  Analysis?: {
    File?: CoreConventionFileFacts;
    Diagnostics?: CoreConventionDiagnostic[];
  };
  Profile?: unknown;
  IgnoreList?: unknown;
}

export interface ProjectConventionDashboardDiagnosticSnapshot {
  key: string;
  workspaceRoot: string;
  file: CoreConventionFileFacts;
  diagnostic: CoreConventionDiagnostic;
}

export interface ProjectConventionDashboardSnapshot {
  generatedAtUtc: string;
  scope?:
    | {
        scope: 'workspace' | 'solution';
        scopeKey: string;
        storageRoot: string;
      }
    | undefined;
  settings?: ConventionFeatureConfig;
  profilePath?: string;
  summaryPath?: string;
  cachePath?: string;
  anomalyModelPath?: string;
  ignoreListPath?: string;
  profile?: unknown;
  summary?: unknown;
  diagnostics: ProjectConventionDashboardDiagnosticSnapshot[];
  inFlightRebuildCount: number;
  queuedRebuildCount: number;
  coralRuntime?: CoreCliAnalyzeRequest['CoralRuntime'];
}

const SOURCE = 'KoSpellCheck.Conventions';

export class ProjectConventionFeature implements vscode.Disposable {
  private readonly diagnostics: vscode.DiagnosticCollection;
  private readonly metadata = new Map<string, ConventionDiagnosticMetadata>();
  private readonly scopeStates = new Map<string, { profile?: unknown; ignoreList?: unknown }>();
  private readonly rebuildTimers = new Map<string, NodeJS.Timeout>();
  private readonly inFlightRebuilds = new Map<string, Promise<void>>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly stateChangeEmitter = new vscode.EventEmitter<void>();
  private readonly cliClient: CoreConventionCliClient;
  private readonly log: LogFn;
  private readonly typoAcceleration?: TypoAccelerationProbe;
  private shownInitialSummary = false;
  public readonly onDidStateChange = this.stateChangeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    log: LogFn,
    typoAcceleration?: TypoAccelerationProbe
  ) {
    this.log = log;
    this.typoAcceleration = typoAcceleration;
    this.cliClient = new CoreConventionCliClient(this.context.extensionPath, (message) => this.log(message));
    this.diagnostics = vscode.languages.createDiagnosticCollection(SOURCE);

    this.disposables.push(
      this.diagnostics,
      this.registerCodeActions(),
      this.registerCommands(),
      this.registerEventHandlers()
    );

    this.scheduleRebuildForAll('activation', 250);
    if (vscode.window.activeTextEditor) {
      void this.analyzeDocument(vscode.window.activeTextEditor.document, 'activation');
    }
  }

  public dispose(): void {
    for (const timer of this.rebuildTimers.values()) {
      clearTimeout(timer);
    }

    this.rebuildTimers.clear();
    this.inFlightRebuilds.clear();
    this.metadata.clear();
    this.scopeStates.clear();
    this.stateChangeEmitter.dispose();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  public async rebuildActiveScope(reason = 'dashboard-rebuild', force = true): Promise<boolean> {
    const scope = this.resolveScope(vscode.window.activeTextEditor?.document.uri);
    if (!scope) {
      return false;
    }

    await this.rebuildScope(scope, reason, force);
    return true;
  }

  public getDashboardSnapshot(uri?: vscode.Uri): ProjectConventionDashboardSnapshot {
    const scope = this.resolveScope(uri ?? vscode.window.activeTextEditor?.document.uri);
    if (!scope) {
      return {
        generatedAtUtc: new Date().toISOString(),
        diagnostics: [],
        inFlightRebuildCount: this.inFlightRebuilds.size,
        queuedRebuildCount: this.rebuildTimers.size
      };
    }

    const config = this.resolveConfig(scope.storageRoot, uri ?? vscode.window.activeTextEditor?.document.uri);
    const profilePath = resolveArtifactPath(scope.storageRoot, config.profilePath);
    const summaryPath = resolveArtifactPath(scope.storageRoot, config.scanSummaryPath);
    const cachePath = resolveArtifactPath(scope.storageRoot, config.profileCachePath);
    const anomalyModelPath = resolveArtifactPath(scope.storageRoot, config.anomalyModelPath);
    const ignoreListPath = resolveArtifactPath(scope.storageRoot, config.ignoreListPath);
    const state = this.scopeStates.get(scope.scopeKey);
    const profile = state?.profile ?? this.readJsonArtifact(profilePath);
    const summary = this.readJsonArtifact(summaryPath);

    const diagnostics = [...this.metadata.entries()].map(([key, info]) => ({
      key,
      workspaceRoot: info.workspaceRoot,
      file: info.file,
      diagnostic: info.diagnostic
    }));

    return {
      generatedAtUtc: new Date().toISOString(),
      scope,
      settings: config,
      profilePath,
      summaryPath,
      cachePath,
      anomalyModelPath,
      ignoreListPath,
      profile,
      summary,
      diagnostics,
      inFlightRebuildCount: this.inFlightRebuilds.size,
      queuedRebuildCount: this.rebuildTimers.size,
      coralRuntime: this.toCoreCoralRuntime(config)
    };
  }

  private registerCommands(): vscode.Disposable {
    const rebuildCommand = vscode.commands.registerCommand(
      'kospellcheck.rebuildConventionProfile',
      async () => {
        const scope = this.resolveScope(vscode.window.activeTextEditor?.document.uri);
        if (!scope) {
          return;
        }

        await this.rebuildScope(scope, 'manual-command', true);
        vscode.window.showInformationMessage('KoSpellCheck: convention profile rebuilt.');
      }
    );

    const showCommand = vscode.commands.registerCommand(
      'kospellcheck.showLearnedConventions',
      async () => {
        const scope = this.resolveScope(vscode.window.activeTextEditor?.document.uri);
        if (!scope) {
          return;
        }

        const config = this.resolveConfig(scope.storageRoot, vscode.window.activeTextEditor?.document.uri);
        const profilePath = resolveArtifactPath(scope.storageRoot, config.profilePath);
        if (!fs.existsSync(profilePath)) {
          vscode.window.showInformationMessage(
            'KoSpellCheck: no learned convention profile found yet. Run "Rebuild Convention Profile" first.'
          );
          return;
        }

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(profilePath));
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    );

    const explainCommand = vscode.commands.registerCommand(
      'kospellcheck.explainConventionDiagnostic',
      async (uri?: vscode.Uri, range?: vscode.Range, metadataKey?: string) => {
        const resolvedUri = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!resolvedUri) {
          return;
        }

        const key = metadataKey ?? this.findMetadataKeyAtCursor(resolvedUri, range);
        if (!key) {
          vscode.window.showInformationMessage('KoSpellCheck: no convention diagnostic found at cursor.');
          return;
        }

        const info = this.metadata.get(key);
        if (!info) {
          return;
        }

        const evidence = (info.diagnostic.Evidence ?? [])
          .slice(0, 6)
          .map((item) => {
            const ratio = typeof item.Ratio === 'number' ? ` (${item.Ratio.toFixed(2)})` : '';
            return `- ${item.Metric}: expected ${item.Expected}, observed ${item.Observed}${ratio}`;
          })
          .join('\n');

        const suggestions = (info.diagnostic.Suggestions ?? [])
          .slice(0, 4)
          .map((entry) => `- ${entry}`)
          .join('\n');

        const message =
          `${info.diagnostic.Title}\n` +
          `Rule: ${info.diagnostic.RuleId}\n` +
          `Confidence: ${(info.diagnostic.Confidence * 100).toFixed(0)}%\n\n` +
          `${info.diagnostic.Explanation}` +
          (evidence ? `\n\nEvidence:\n${evidence}` : '') +
          (suggestions ? `\n\nSuggestions:\n${suggestions}` : '');

        await vscode.window.showInformationMessage(message, { modal: true });
      }
    );

    const ignoreCommand = vscode.commands.registerCommand(
      'kospellcheck.ignoreConventionPattern',
      async (
        uri?: vscode.Uri,
        _range?: vscode.Range,
        metadataKey?: string,
        scopeArg?: 'file' | 'folder' | 'project'
      ) => {
        const resolvedUri = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!resolvedUri) {
          return;
        }

        const key = metadataKey ?? this.findMetadataKeyAtCursor(resolvedUri);
        if (!key) {
          return;
        }

        const info = this.metadata.get(key);
        if (!info) {
          return;
        }

        await this.ignoreRule(info, scopeArg ?? 'file');
        await this.analyzeDocumentByPath(info.file.AbsolutePath, 'ignore-pattern');
      }
    );

    const applyQuickFixCommand = vscode.commands.registerCommand(
      'kospellcheck.applyConventionQuickFix',
      async (uri: vscode.Uri, metadataKey: string, quickFixIndex: number) => {
        if (!uri || !metadataKey) {
          return;
        }

        const info = this.metadata.get(metadataKey);
        if (!info) {
          return;
        }

        const quickFix = info.diagnostic.QuickFixes?.[quickFixIndex];
        if (!quickFix) {
          return;
        }

        await this.applyQuickFix(uri, info, quickFix);
      }
    );

    return vscode.Disposable.from(
      rebuildCommand,
      showCommand,
      explainCommand,
      ignoreCommand,
      applyQuickFixCommand
    );
  }

  private registerCodeActions(): vscode.Disposable {
    return vscode.languages.registerCodeActionsProvider(
      [{ scheme: 'file' }],
      {
        provideCodeActions: (document, range, codeActionContext) => {
          const actions: vscode.CodeAction[] = [];

          for (const diagnostic of codeActionContext.diagnostics) {
            if (diagnostic.source !== SOURCE || !diagnostic.range.intersection(range)) {
              continue;
            }

            const key = this.diagnosticKey(document.uri, diagnostic.range, diagnostic.message);
            const info = this.metadata.get(key);
            if (!info) {
              continue;
            }

            (info.diagnostic.QuickFixes ?? []).forEach((quickFix, index) => {
              const action = new vscode.CodeAction(quickFix.Title, vscode.CodeActionKind.QuickFix);
              action.diagnostics = [diagnostic];
              action.command = {
                command: 'kospellcheck.applyConventionQuickFix',
                title: 'KoSpellCheck: Apply convention quick fix',
                arguments: [document.uri, key, index]
              };
              actions.push(action);
            });

            const explainAction = new vscode.CodeAction(
              'Explain this diagnostic',
              vscode.CodeActionKind.QuickFix
            );
            explainAction.command = {
              command: 'kospellcheck.explainConventionDiagnostic',
              title: 'KoSpellCheck: Explain convention diagnostic',
              arguments: [document.uri, diagnostic.range, key]
            };
            explainAction.diagnostics = [diagnostic];
            actions.push(explainAction);

            const ignoreFileAction = new vscode.CodeAction('Ignore this rule for file', vscode.CodeActionKind.QuickFix);
            ignoreFileAction.command = {
              command: 'kospellcheck.ignoreConventionPattern',
              title: 'KoSpellCheck: Ignore convention pattern',
              arguments: [document.uri, diagnostic.range, key, 'file']
            };
            ignoreFileAction.diagnostics = [diagnostic];
            actions.push(ignoreFileAction);

            const ignoreProjectAction = new vscode.CodeAction(
              'Ignore this rule for project',
              vscode.CodeActionKind.QuickFix
            );
            ignoreProjectAction.command = {
              command: 'kospellcheck.ignoreConventionPattern',
              title: 'KoSpellCheck: Ignore convention pattern',
              arguments: [document.uri, diagnostic.range, key, 'project']
            };
            ignoreProjectAction.diagnostics = [diagnostic];
            actions.push(ignoreProjectAction);
          }

          return actions;
        }
      },
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
      }
    );
  }

  private registerEventHandlers(): vscode.Disposable {
    const onSave = vscode.workspace.onDidSaveTextDocument((document) => {
      void this.handleDocumentSave(document);
    });

    const onCreate = vscode.workspace.onDidCreateFiles((event) => {
      void this.handleFilesCreated(event.files);
    });

    const onRename = vscode.workspace.onDidRenameFiles((event) => {
      void this.handleFilesRenamed(event);
    });

    const onDelete = vscode.workspace.onDidDeleteFiles((event) => {
      void this.handleFilesDeleted(event.files);
    });

    const onConfig = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('kospellcheck.projectConventions')) {
        this.scheduleRebuildForAll('settings-changed', 300);
      }
    });

    const onFolders = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.scheduleRebuildForAll('workspace-folders-changed', 300);
    });

    const onClose = vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme !== 'file') {
        return;
      }

      this.diagnostics.delete(document.uri);
      this.clearMetadataForUri(document.uri);
      this.notifyDashboardStateChanged();
    });

    return vscode.Disposable.from(onSave, onCreate, onRename, onDelete, onConfig, onFolders, onClose);
  }

  private async handleDocumentSave(document: vscode.TextDocument): Promise<void> {
    if (document.uri.scheme !== 'file') {
      return;
    }

    const scope = this.resolveScope(document.uri);
    if (!scope) {
      return;
    }

    const config = this.resolveConfig(scope.storageRoot, document.uri);
    if (!config.projectConventionMappingEnabled) {
      return;
    }

    if (config.autoRebuildConventionProfile) {
      this.scheduleScopeRebuild(scope, 'document-saved', 900);
    }

    if (config.namingConventionDiagnosticsEnabled && config.analyzeOnSave) {
      await this.analyzeDocument(document, 'save');
    }
  }

  private async handleFilesCreated(files: readonly vscode.Uri[]): Promise<void> {
    for (const uri of files) {
      if (uri.scheme !== 'file') {
        continue;
      }

      const scope = this.resolveScope(uri);
      if (!scope) {
        continue;
      }

      const config = this.resolveConfig(scope.storageRoot, uri);
      if (!config.projectConventionMappingEnabled) {
        continue;
      }

      if (config.autoRebuildConventionProfile) {
        this.scheduleScopeRebuild(scope, 'files-created', 600);
      }

      if (config.namingConventionDiagnosticsEnabled && config.analyzeOnNewFile) {
        await this.analyzeDocumentByPath(uri.fsPath, 'file-created');
      }
    }
  }

  private async handleFilesRenamed(event: vscode.FileRenameEvent): Promise<void> {
    for (const item of event.files) {
      if (item.oldUri.scheme === 'file') {
        this.diagnostics.delete(item.oldUri);
        this.clearMetadataForUri(item.oldUri);
      }

      if (item.newUri.scheme !== 'file') {
        continue;
      }

      const scope = this.resolveScope(item.newUri);
      if (!scope) {
        continue;
      }

      const config = this.resolveConfig(scope.storageRoot, item.newUri);
      if (!config.projectConventionMappingEnabled) {
        continue;
      }

      if (config.autoRebuildConventionProfile) {
        this.scheduleScopeRebuild(scope, 'files-renamed', 600);
      }

      if (config.namingConventionDiagnosticsEnabled && config.analyzeOnRename) {
        await this.analyzeDocumentByPath(item.newUri.fsPath, 'file-renamed');
      }
    }
  }

  private async handleFilesDeleted(files: readonly vscode.Uri[]): Promise<void> {
    for (const uri of files) {
      if (uri.scheme !== 'file') {
        continue;
      }

      this.diagnostics.delete(uri);
      this.clearMetadataForUri(uri);
      this.notifyDashboardStateChanged();
      const scope = this.resolveScope(uri);
      if (!scope) {
        continue;
      }

      const config = this.resolveConfig(scope.storageRoot, uri);
      if (config.projectConventionMappingEnabled && config.autoRebuildConventionProfile) {
        this.scheduleScopeRebuild(scope, 'files-deleted', 700);
      }
    }
  }

  private scheduleRebuildForAll(reason: string, delayMs: number): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const scope = this.resolveScope(folder.uri);
      if (!scope) {
        continue;
      }

      this.scheduleScopeRebuild(scope, reason, delayMs);
      if (scope.scope === 'solution') {
        break;
      }
    }
  }

  private scheduleScopeRebuild(scope: ConventionScopeInfo, reason: string, delayMs: number): void {
    const existing = this.rebuildTimers.get(scope.scopeKey);
    if (existing) {
      clearTimeout(existing);
    }

    this.rebuildTimers.set(
      scope.scopeKey,
      setTimeout(() => {
        this.rebuildTimers.delete(scope.scopeKey);
        this.notifyDashboardStateChanged();
        void this.rebuildScope(scope, reason, false);
      }, delayMs)
    );
    this.notifyDashboardStateChanged();
  }

  private async rebuildScope(scope: ConventionScopeInfo, reason: string, force: boolean): Promise<void> {
    const inFlight = this.inFlightRebuilds.get(scope.scopeKey);
    if (inFlight) {
      return inFlight;
    }

    const task = this.doRebuildScope(scope, reason, force);
    this.inFlightRebuilds.set(scope.scopeKey, task);
    this.notifyDashboardStateChanged();

    try {
      await task;
    } finally {
      this.inFlightRebuilds.delete(scope.scopeKey);
      this.notifyDashboardStateChanged();
    }
  }

  private async doRebuildScope(scope: ConventionScopeInfo, reason: string, force: boolean): Promise<void> {
    const config = this.resolveConfig(scope.storageRoot, vscode.Uri.file(scope.storageRoot));
    if (!config.projectConventionMappingEnabled) {
      this.scopeStates.delete(scope.scopeKey);
      this.notifyDashboardStateChanged();
      return;
    }

    const request: CoreCliProfileBuildRequest = {
      WorkspaceRoot: scope.storageRoot,
      Scope: scope.scope,
      Options: this.toCoreOptions(config),
      PersistArtifacts: true
    };

    const result = await this.cliClient.buildProfile(request);
    if (!result) {
      this.notifyDashboardStateChanged();
      return;
    }

    const profile = result.Profile;
    const summary = result.Summary as { FilesScanned?: number; DominantFolderConventions?: Array<{ FolderPath?: string; DominantSuffix?: string; DominantKind?: string }> } | undefined;

    this.scopeStates.set(scope.scopeKey, {
      profile,
      ignoreList: undefined
    });
    this.notifyDashboardStateChanged();

    this.log(`project-conventions core rebuild scope=${scope.scopeKey} reason=${reason} force=${force}`);

    if (!this.shownInitialSummary && summary) {
      this.shownInitialSummary = true;
      const dominant = summary.DominantFolderConventions?.[0];
      const detail = dominant
        ? `${dominant.FolderPath ?? 'folder'}: ${dominant.DominantSuffix ?? dominant.DominantKind ?? 'pattern'}`
        : 'no dominant folder conventions yet';
      void vscode.window.showInformationMessage(
        `KoSpellCheck: learned project conventions from ${summary.FilesScanned ?? 0} files (${detail}).`
      );
    }
  }

  private async analyzeDocument(document: vscode.TextDocument, trigger: string): Promise<void> {
    if (document.uri.scheme !== 'file') {
      return;
    }

    await this.analyzeDocumentByPath(document.uri.fsPath, trigger, document);
  }

  private async analyzeDocumentByPath(
    absolutePath: string,
    trigger: string,
    existingDocument?: vscode.TextDocument
  ): Promise<void> {
    const uri = vscode.Uri.file(absolutePath);
    const scope = this.resolveScope(uri);
    if (!scope) {
      return;
    }

    const config = this.resolveConfig(scope.storageRoot, uri);
    if (!config.projectConventionMappingEnabled || !config.namingConventionDiagnosticsEnabled) {
      this.diagnostics.delete(uri);
      this.clearMetadataForUri(uri);
      this.notifyDashboardStateChanged();
      return;
    }

    let document = existingDocument;
    let content = existingDocument?.getText();

    if (!document) {
      try {
        document = await vscode.workspace.openTextDocument(uri);
        content = document.getText();
      } catch {
        return;
      }
    }

    const state = this.scopeStates.get(scope.scopeKey);
    const request: CoreCliAnalyzeRequest = {
      WorkspaceRoot: scope.storageRoot,
      FilePath: absolutePath,
      FileContent: content,
      Options: this.toCoreOptions(config),
      Profile: state?.profile,
      IgnoreList: state?.ignoreList,
      CoralRuntime: this.toCoreCoralRuntime(config)
    };

    const raw = await this.cliClient.analyze(request);
    if (!raw) {
      this.notifyDashboardStateChanged();
      return;
    }

    const response = raw as unknown as CoreAnalyzeResponse;
    if (response.Profile || response.IgnoreList) {
      this.scopeStates.set(scope.scopeKey, {
        profile: response.Profile,
        ignoreList: response.IgnoreList
      });
    }

    const file = response.Analysis?.File;
    const diagnostics = response.Analysis?.Diagnostics ?? [];
    if (!file) {
      this.diagnostics.delete(uri);
      this.clearMetadataForUri(uri);
      this.notifyDashboardStateChanged();
      return;
    }

    const vscodeDiagnostics = this.toVscodeDiagnostics(document, scope.storageRoot, file, diagnostics, response.Profile, response.IgnoreList);
    this.diagnostics.set(uri, vscodeDiagnostics);
    this.log(`project-conventions core analyze trigger=${trigger} file=${file.RelativePath} diagnostics=${vscodeDiagnostics.length}`, uri);
    this.notifyDashboardStateChanged();
  }

  private toVscodeDiagnostics(
    document: vscode.TextDocument,
    workspaceRoot: string,
    file: CoreConventionFileFacts,
    diagnostics: CoreConventionDiagnostic[],
    profile?: unknown,
    ignoreList?: unknown
  ): vscode.Diagnostic[] {
    const output: vscode.Diagnostic[] = [];
    this.clearMetadataForUri(document.uri);

    for (const item of diagnostics) {
      const range = toRange(document, item.Line ?? 0, item.Column ?? 0);
      const message = `${item.Message} (rule ${item.RuleId}, confidence ${(item.Confidence * 100).toFixed(0)}%)`;
      const diagnostic = new vscode.Diagnostic(range, message, toSeverity(item.Severity));
      diagnostic.source = SOURCE;
      diagnostic.code = item.RuleId;

      const key = this.diagnosticKey(document.uri, range, message);
      this.metadata.set(key, {
        workspaceRoot,
        file,
        diagnostic: item,
        profile,
        ignoreList
      });

      output.push(diagnostic);
    }

    return output;
  }

  private notifyDashboardStateChanged(): void {
    this.stateChangeEmitter.fire();
  }

  private readJsonArtifact(pathValue: string): unknown {
    try {
      if (!fs.existsSync(pathValue)) {
        return undefined;
      }

      return JSON.parse(fs.readFileSync(pathValue, 'utf8')) as unknown;
    } catch {
      return undefined;
    }
  }

  private async applyQuickFix(
    uri: vscode.Uri,
    info: ConventionDiagnosticMetadata,
    quickFix: CoreConventionQuickFix
  ): Promise<void> {
    switch (quickFix.Kind) {
      case 'RenameFileToPrimaryType': {
        const targetName = quickFix.Replacement?.trim();
        if (!targetName) {
          return;
        }

        const targetPath = path.join(path.dirname(info.file.AbsolutePath), targetName);
        try {
          await vscode.workspace.fs.rename(uri, vscode.Uri.file(targetPath), { overwrite: false });
          await this.analyzeDocumentByPath(targetPath, 'quick-fix-rename-file');
        } catch (error) {
          vscode.window.showWarningMessage(`KoSpellCheck: rename file failed (${String(error)}).`);
        }
        return;
      }
      case 'MoveFileToFolder': {
        const targetFolder = quickFix.TargetPath?.trim();
        if (!targetFolder) {
          return;
        }

        const destinationFolder = path.join(info.workspaceRoot, targetFolder);
        const destinationPath = path.join(destinationFolder, info.file.FileName);
        try {
          await fs.promises.mkdir(destinationFolder, { recursive: true });
          await vscode.workspace.fs.rename(uri, vscode.Uri.file(destinationPath), { overwrite: false });
          await this.analyzeDocumentByPath(destinationPath, 'quick-fix-move-file');
        } catch (error) {
          vscode.window.showWarningMessage(`KoSpellCheck: move file failed (${String(error)}).`);
        }
        return;
      }
      case 'UpdateNamespaceToFolderConvention': {
        const replacement = quickFix.Replacement?.trim();
        if (!replacement) {
          return;
        }

        const document = await vscode.workspace.openTextDocument(uri);
        const text = document.getText();
        const regex = /\bnamespace\s+([A-Za-z_][A-Za-z0-9_.]*)\s*[;{]/;
        const match = regex.exec(text);
        if (!match || typeof match.index !== 'number') {
          return;
        }

        const namespaceStart = match.index + match[0].indexOf(match[1]);
        const namespaceEnd = namespaceStart + match[1].length;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          uri,
          new vscode.Range(document.positionAt(namespaceStart), document.positionAt(namespaceEnd)),
          replacement
        );
        await vscode.workspace.applyEdit(edit);
        await document.save();
        await this.analyzeDocument(document, 'quick-fix-namespace');
        return;
      }
      case 'RenamePrimaryTypeToFileName':
      case 'RenameSuffix':
      case 'RenameAbbreviation': {
        const replacement = quickFix.Replacement?.trim();
        if (!replacement) {
          return;
        }

        await this.renameSymbol(uri, info.diagnostic.Line ?? 0, info.diagnostic.Column ?? 0, replacement);
        return;
      }
      case 'IgnoreRuleForFile': {
        await this.ignoreRule(info, 'file');
        await this.analyzeDocumentByPath(info.file.AbsolutePath, 'quick-fix-ignore-file');
        return;
      }
      case 'IgnoreRuleForFolder': {
        await this.ignoreRule(info, 'folder');
        await this.analyzeDocumentByPath(info.file.AbsolutePath, 'quick-fix-ignore-folder');
        return;
      }
      case 'IgnoreRuleForProject': {
        await this.ignoreRule(info, 'project');
        await this.analyzeDocumentByPath(info.file.AbsolutePath, 'quick-fix-ignore-project');
        return;
      }
    }
  }

  private async ignoreRule(
    info: ConventionDiagnosticMetadata,
    scope: 'file' | 'folder' | 'project'
  ): Promise<void> {
    const config = this.resolveConfig(info.workspaceRoot, vscode.Uri.file(info.file.AbsolutePath));
    const target =
      scope === 'file'
        ? info.file.RelativePath
        : scope === 'folder'
          ? info.file.FolderPath
          : '*';

    const request: CoreCliIgnoreRequest = {
      WorkspaceRoot: info.workspaceRoot,
      RuleId: info.diagnostic.RuleId,
      Scope: scope,
      Target: target,
      Options: this.toCoreOptions(config)
    };

    await this.cliClient.ignore(request);

    const scopeInfo = this.resolveScope(vscode.Uri.file(info.file.AbsolutePath));
    if (scopeInfo) {
      this.scopeStates.delete(scopeInfo.scopeKey);
    }
    this.notifyDashboardStateChanged();
  }

  private async renameSymbol(uri: vscode.Uri, line: number, column: number, replacement: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const position = new vscode.Position(
      Math.max(0, Math.min(line, Math.max(0, document.lineCount - 1))),
      Math.max(0, column)
    );

    try {
      const renameEdit = await vscode.commands.executeCommand<vscode.WorkspaceEdit | undefined>(
        'vscode.executeDocumentRenameProvider',
        uri,
        position,
        replacement
      );
      if (renameEdit && renameEdit.entries().length > 0) {
        await vscode.workspace.applyEdit(renameEdit);
        await document.save();
        await this.analyzeDocument(document, 'quick-fix-rename-symbol');
        return;
      }
    } catch {
      // fallback below
    }

    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) {
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, wordRange, replacement);
    await vscode.workspace.applyEdit(edit);
    await document.save();
    await this.analyzeDocument(document, 'quick-fix-direct-rename');
  }

  private resolveScope(uri?: vscode.Uri): ConventionScopeInfo | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return undefined;
    }

    const activeFolder = uri
      ? vscode.workspace.getWorkspaceFolder(uri)
      : vscode.window.activeTextEditor
        ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
        : folders[0];

    const baseFolder = activeFolder ?? folders[0];
    const config = this.resolveConfig(baseFolder.uri.fsPath, uri ?? baseFolder.uri);

    if (config.conventionScope === 'solution' && folders.length > 1) {
      const roots = folders.map((folder) => folder.uri.fsPath);
      return {
        scope: 'solution',
        scopeKey: `solution:${roots.join('|')}`,
        storageRoot: roots[0]
      };
    }

    return {
      scope: 'workspace',
      scopeKey: `workspace:${baseFolder.uri.fsPath}`,
      storageRoot: baseFolder.uri.fsPath
    };
  }

  private resolveConfig(workspaceRoot: string, uri?: vscode.Uri): ConventionFeatureConfig {
    const loaded = loadConfig(workspaceRoot);
    const settings = vscode.workspace.getConfiguration('kospellcheck', uri);

    return {
      projectConventionMappingEnabled: settings.get<boolean>(
        'projectConventions.enabled',
        loaded.projectConventionMappingEnabled
      ),
      namingConventionDiagnosticsEnabled: settings.get<boolean>(
        'projectConventions.namingDiagnosticsEnabled',
        loaded.namingConventionDiagnosticsEnabled
      ),
      statisticalAnomalyDetectionEnabled: settings.get<boolean>(
        'projectConventions.statisticalAnomalyDetectionEnabled',
        loaded.statisticalAnomalyDetectionEnabled
      ),
      aiNamingAnomalyDetectionEnabled: settings.get<boolean>(
        'projectConventions.aiNamingAnomalyDetectionEnabled',
        loaded.aiNamingAnomalyDetectionEnabled
      ),
      useCoralTpuIfAvailable: settings.get<boolean>(
        'projectConventions.useCoralTpuIfAvailable',
        loaded.useCoralTpuIfAvailable
      ),
      autoRebuildConventionProfile: settings.get<boolean>(
        'projectConventions.autoRebuild',
        loaded.autoRebuildConventionProfile
      ),
      analyzeOnSave: settings.get<boolean>('projectConventions.analyzeOnSave', loaded.conventionAnalyzeOnSave),
      analyzeOnRename: settings.get<boolean>('projectConventions.analyzeOnRename', loaded.conventionAnalyzeOnRename),
      analyzeOnNewFile: settings.get<boolean>('projectConventions.analyzeOnNewFile', loaded.conventionAnalyzeOnNewFile),
      conventionScope: settings.get<'workspace' | 'solution'>('projectConventions.scope', loaded.conventionScope),
      ignoreGeneratedCode: settings.get<boolean>(
        'projectConventions.ignoreGeneratedCode',
        loaded.conventionIgnoreGeneratedCode
      ),
      ignoreTestProjects: settings.get<boolean>(
        'projectConventions.ignoreTestProjects',
        loaded.conventionIgnoreTestProjects
      ),
      includePatterns: settings.get<string[]>(
        'projectConventions.includePatterns',
        loaded.projectConventionIncludePatterns
      ) ?? loaded.projectConventionIncludePatterns,
      excludePatterns: settings.get<string[]>(
        'projectConventions.excludePatterns',
        loaded.projectConventionExcludePatterns
      ) ?? loaded.projectConventionExcludePatterns,
      supportedExtensions: settings.get<string[]>(
        'projectConventions.supportedExtensions',
        loaded.projectConventionSupportedExtensions
      ) ?? loaded.projectConventionSupportedExtensions,
      maxFiles: settings.get<number>('projectConventions.maxFiles', loaded.projectConventionMaxFiles),
      minEvidenceCount: settings.get<number>(
        'projectConventions.minEvidenceCount',
        loaded.projectConventionMinEvidenceCount
      ),
      statisticalAnomalyThreshold: settings.get<number>(
        'projectConventions.statisticalAnomalyThreshold',
        loaded.statisticalAnomalyThreshold
      ),
      aiAnomalyThreshold: settings.get<number>('projectConventions.aiAnomalyThreshold', loaded.aiAnomalyThreshold),
      profilePath: settings.get<string>('projectConventions.profilePath', loaded.projectConventionProfilePath),
      profileCachePath: settings.get<string>(
        'projectConventions.profileCachePath',
        loaded.projectConventionProfileCachePath
      ),
      anomalyModelPath: settings.get<string>(
        'projectConventions.anomalyModelPath',
        loaded.projectConventionAnomalyModelPath
      ),
      scanSummaryPath: settings.get<string>(
        'projectConventions.scanSummaryPath',
        loaded.projectConventionScanSummaryPath
      ),
      ignoreListPath: settings.get<string>(
        'projectConventions.ignoreListPath',
        loaded.projectConventionIgnoreListPath
      )
    };
  }

  private toCoreOptions(config: ConventionFeatureConfig): Record<string, unknown> {
    return {
      EnableProjectConventionMapping: config.projectConventionMappingEnabled,
      EnableNamingConventionDiagnostics: config.namingConventionDiagnosticsEnabled,
      EnableStatisticalAnomalyDetection: config.statisticalAnomalyDetectionEnabled,
      EnableAiNamingAnomalyDetection: config.aiNamingAnomalyDetectionEnabled,
      UseCoralTpuIfAvailable: config.useCoralTpuIfAvailable,
      AutoRebuildConventionProfile: config.autoRebuildConventionProfile,
      AnalyzeOnSave: config.analyzeOnSave,
      AnalyzeOnRename: config.analyzeOnRename,
      AnalyzeOnNewFile: config.analyzeOnNewFile,
      Scope: config.conventionScope,
      IgnoreGeneratedCode: config.ignoreGeneratedCode,
      IgnoreTestProjects: config.ignoreTestProjects,
      IncludePatterns: config.includePatterns,
      ExcludePatterns: config.excludePatterns,
      SupportedExtensions: config.supportedExtensions,
      MaxFiles: config.maxFiles,
      MinEvidenceCount: config.minEvidenceCount,
      StatisticalAnomalyThreshold: config.statisticalAnomalyThreshold,
      AiAnomalyThreshold: config.aiAnomalyThreshold,
      ConventionProfilePath: config.profilePath,
      ConventionProfileCachePath: config.profileCachePath,
      ConventionAnomalyModelPath: config.anomalyModelPath,
      ConventionScanSummaryPath: config.scanSummaryPath,
      ConventionIgnoreListPath: config.ignoreListPath
    };
  }

  private toCoreCoralRuntime(config: ConventionFeatureConfig): CoreCliAnalyzeRequest['CoralRuntime'] {
    if (!config.useCoralTpuIfAvailable || !this.typoAcceleration) {
      return {
        Available: false,
        Detail: 'disabled'
      };
    }

    try {
      const availability = this.typoAcceleration.inspectAvailability(false);
      if (availability.status !== 'Available') {
        return {
          Available: false,
          Detail: availability.detail ?? availability.status
        };
      }

      const backend = this.typoAcceleration.inspectClassifierBackend();
      return {
        Available: !!backend.tpuInferenceActive,
        AdapterPath: backend.adapterPath,
        RuntimeRoot: backend.runtimeRoot,
        Detail: backend.detail
      };
    } catch (error) {
      return {
        Available: false,
        Detail: String(error)
      };
    }
  }

  private findMetadataKeyAtCursor(uri: vscode.Uri, range?: vscode.Range): string | undefined {
    const editor = vscode.window.activeTextEditor;
    const targetRange =
      range ?? (editor ? new vscode.Range(editor.selection.active, editor.selection.active) : undefined);
    const diagnostics = this.diagnostics.get(uri) ?? [];

    for (const diagnostic of diagnostics) {
      if (targetRange && !diagnostic.range.intersection(targetRange)) {
        continue;
      }

      const key = this.diagnosticKey(uri, diagnostic.range, diagnostic.message);
      if (this.metadata.has(key)) {
        return key;
      }
    }

    return undefined;
  }

  private clearMetadataForUri(uri: vscode.Uri): void {
    const prefix = `${uri.toString()}|`;
    for (const key of [...this.metadata.keys()]) {
      if (key.startsWith(prefix)) {
        this.metadata.delete(key);
      }
    }
  }

  private diagnosticKey(uri: vscode.Uri, range: vscode.Range, message: string): string {
    return `${uri.toString()}|${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}|${message}`;
  }
}

function resolveArtifactPath(workspaceRoot: string, configuredPath: string): string {
  const target = configuredPath?.trim() || '.kospellcheck/project-conventions.json';
  return path.isAbsolute(target) ? target : path.join(workspaceRoot, target);
}

function toRange(document: vscode.TextDocument, line: number, column: number): vscode.Range {
  const safeLine = Math.max(0, Math.min(line, Math.max(0, document.lineCount - 1)));
  const safeColumn = Math.max(0, column);
  const lineTextLength = document.lineAt(safeLine).text.length;
  const startCharacter = Math.min(safeColumn, lineTextLength);
  const endCharacter = Math.min(lineTextLength, startCharacter + Math.max(1, guessWordLength(document, safeLine, startCharacter)));
  return new vscode.Range(
    new vscode.Position(safeLine, startCharacter),
    new vscode.Position(safeLine, endCharacter)
  );
}

function guessWordLength(document: vscode.TextDocument, line: number, character: number): number {
  const text = document.lineAt(line).text;
  if (!text || character >= text.length) {
    return 1;
  }

  let end = character;
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) {
    end += 1;
  }

  return Math.max(1, end - character);
}

function toSeverity(severity: 'Info' | 'Warning' | 'Error'): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'Error':
      return vscode.DiagnosticSeverity.Error;
    case 'Warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'Info':
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}
