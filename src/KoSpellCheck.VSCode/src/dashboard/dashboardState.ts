import * as vscode from 'vscode';
import { DashboardLogEntry } from './dashboardLogService';

export interface DashboardOverview {
  workspaceRoot: string;
  scope: 'workspace' | 'solution' | 'none';
  filesScanned: number;
  typesScanned: number;
  dominantCaseStyle: string;
  profileLastUpdatedUtc?: string;
  diagnosticsCount: number;
  featureEnabled: boolean;
  aiEnabled: boolean;
  coralActive: boolean;
  coralDetail: string;
  inFlightRebuildCount: number;
  queuedRebuildCount: number;
}

export interface DashboardSettingItem {
  id: string;
  label: string;
  value: boolean | number | string;
  type: 'boolean' | 'number' | 'string';
  editable: boolean;
}

export interface DashboardConventionItem {
  folderPath: string;
  expectedSuffix?: string;
  expectedPrefix?: string;
  dominantKind?: string;
  confidence: number;
  namespaceSample?: string;
  exampleTypes: string[];
}

export interface DashboardDiagnosticItem {
  key: string;
  filePath: string;
  absolutePath: string;
  ruleId: string;
  title: string;
  severity: 'info' | 'warning' | 'error';
  confidence: number;
  message: string;
  expected?: string;
  observed?: string;
  suggestion?: string;
  line: number;
  column: number;
}

export interface DashboardViewModel {
  loading: boolean;
  errorMessage?: string;
  refreshedAtUtc: string;
  uiStrings?: Record<string, string>;
  profilePath?: string;
  summaryPath?: string;
  overview: DashboardOverview;
  settings: DashboardSettingItem[];
  conventionMap: DashboardConventionItem[];
  diagnostics: DashboardDiagnosticItem[];
  logs: DashboardLogEntry[];
}

export class DashboardStateStore implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<DashboardViewModel>();
  private state: DashboardViewModel = createEmptyState();

  public readonly onDidChange = this.changeEmitter.event;

  public setLoading(): void {
    this.state = {
      ...this.state,
      loading: true,
      errorMessage: undefined,
      refreshedAtUtc: new Date().toISOString()
    };
    this.changeEmitter.fire(this.state);
  }

  public setData(next: Omit<DashboardViewModel, 'loading'>): void {
    this.state = {
      ...next,
      loading: false
    };
    this.changeEmitter.fire(this.state);
  }

  public setError(message: string): void {
    this.state = {
      ...this.state,
      loading: false,
      errorMessage: message,
      refreshedAtUtc: new Date().toISOString()
    };
    this.changeEmitter.fire(this.state);
  }

  public setLogs(logs: DashboardLogEntry[]): void {
    this.state = {
      ...this.state,
      logs: logs.slice(),
      refreshedAtUtc: new Date().toISOString()
    };
    this.changeEmitter.fire(this.state);
  }

  public snapshot(): DashboardViewModel {
    return this.state;
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }
}

function createEmptyState(): DashboardViewModel {
  return {
    loading: false,
    refreshedAtUtc: new Date().toISOString(),
    overview: {
      workspaceRoot: '',
      scope: 'none',
      filesScanned: 0,
      typesScanned: 0,
      dominantCaseStyle: 'Unknown',
      diagnosticsCount: 0,
      featureEnabled: false,
      aiEnabled: false,
      coralActive: false,
      coralDetail: 'inactive',
      inFlightRebuildCount: 0,
      queuedRebuildCount: 0
    },
    settings: [],
    conventionMap: [],
    diagnostics: [],
    logs: []
  };
}
