import * as vscode from 'vscode';
import { loadConfig } from './config';
import { detectProjectStyleProfile } from './styleDetector';
import { resolveWorkspaceStoragePathFromSettings } from './settings';
import { ProjectStyleProfile } from './types';

type Logger = (message: string, uri?: vscode.Uri, force?: boolean) => void;

export class StyleLearningCoordinator implements vscode.Disposable {
  private readonly profilesByWorkspace = new Map<string, ProjectStyleProfile>();
  private readonly timersByWorkspace = new Map<string, NodeJS.Timeout>();
  private readonly inFlightByWorkspace = new Map<string, Promise<void>>();
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  public getProfile(workspaceRoot?: string): ProjectStyleProfile | undefined {
    if (!workspaceRoot) {
      return undefined;
    }

    return this.profilesByWorkspace.get(workspaceRoot);
  }

  public scheduleWorkspaceRefresh(workspaceRoot: string, reason: string, delayMs = 700): void {
    if (!workspaceRoot) {
      return;
    }

    const existing = this.timersByWorkspace.get(workspaceRoot);
    if (existing) {
      clearTimeout(existing);
    }

    this.timersByWorkspace.set(
      workspaceRoot,
      setTimeout(() => {
        this.timersByWorkspace.delete(workspaceRoot);
        void this.refreshWorkspace(workspaceRoot, reason);
      }, delayMs)
    );
  }

  public scheduleAllWorkspaceRefreshes(reason: string, delayMs = 700): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      this.scheduleWorkspaceRefresh(folder.uri.fsPath, reason, delayMs);
    }
  }

  public dispose(): void {
    for (const timer of this.timersByWorkspace.values()) {
      clearTimeout(timer);
    }

    this.timersByWorkspace.clear();
    this.profilesByWorkspace.clear();
    this.inFlightByWorkspace.clear();
  }

  private async refreshWorkspace(workspaceRoot: string, reason: string): Promise<void> {
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
    } finally {
      this.inFlightByWorkspace.delete(workspaceRoot);
    }
  }

  private async doRefreshWorkspace(workspaceRoot: string, reason: string): Promise<void> {
    const config = loadConfig(workspaceRoot);
    const uri = vscode.Uri.file(workspaceRoot);
    const workspaceConfig = vscode.workspace.getConfiguration('kospellcheck', uri);
    const globalConfig = vscode.workspace.getConfiguration(undefined, uri);
    config.workspaceStoragePath = resolveWorkspaceStoragePathFromSettings(
      workspaceConfig,
      globalConfig,
      config.workspaceStoragePath
    );
    const settingEnabled = workspaceConfig.get<boolean>('enabled', true);
    if (!settingEnabled || !config.enabled || !config.styleLearningEnabled) {
      this.profilesByWorkspace.delete(workspaceRoot);
      this.log(`style-learning disabled workspace=${workspaceRoot} reason=${reason}`);
      return;
    }

    const includePattern = buildIncludePattern(config.styleLearningFileExtensions);
    const excludePattern = buildExcludePattern(config.styleLearningIgnoreFolders);
    const maxFiles = Math.max(1, config.styleLearningMaxFiles);

    let files: vscode.Uri[];
    try {
      files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceRoot, includePattern),
        excludePattern
          ? new vscode.RelativePattern(workspaceRoot, excludePattern)
          : undefined,
        maxFiles
      );
    } catch {
      return;
    }

    const profile = await detectProjectStyleProfile(
      workspaceRoot,
      files.map((uri) => uri.fsPath),
      config
    );

    this.profilesByWorkspace.set(workspaceRoot, profile);
    this.log(
      `style-learning refreshed workspace=${workspaceRoot} reason=${reason} files=${files.length} tokens=${Object.keys(profile.tokenStats).length}`
    );
  }
}

function buildIncludePattern(extensions: string[]): string {
  const unique = [...new Set((extensions ?? []).map(normalizeExtension).filter(Boolean))];
  if (unique.length === 0) {
    return '**/*';
  }

  if (unique.length === 1) {
    return `**/*.${unique[0]}`;
  }

  return `**/*.{${unique.join(',')}}`;
}

function buildExcludePattern(folders: string[]): string | undefined {
  const unique = [...new Set((folders ?? []).map((item) => item.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return undefined;
  }

  return `**/{${unique.join(',')}}/**`;
}

function normalizeExtension(value: string): string {
  return value.replace(/^\./u, '').trim().toLowerCase();
}
