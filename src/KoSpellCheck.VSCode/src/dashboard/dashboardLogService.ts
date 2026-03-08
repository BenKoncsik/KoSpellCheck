import * as vscode from 'vscode';

export type DashboardLogLevel = 'info' | 'warn' | 'error';

export interface DashboardLogEntry {
  id: number;
  timestampUtc: string;
  level: DashboardLogLevel;
  message: string;
}

export class DashboardLogService implements vscode.Disposable {
  private readonly entries: DashboardLogEntry[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private nextId = 1;

  public readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly maxEntries = 300) {}

  public append(message: string, level: DashboardLogLevel = 'info'): void {
    const trimmed = (message ?? '').trim();
    if (!trimmed) {
      return;
    }

    this.entries.push({
      id: this.nextId++,
      timestampUtc: new Date().toISOString(),
      level,
      message: trimmed
    });

    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    this.changeEmitter.fire();
  }

  public clear(): void {
    if (this.entries.length === 0) {
      return;
    }

    this.entries.length = 0;
    this.changeEmitter.fire();
  }

  public snapshot(): DashboardLogEntry[] {
    return this.entries.slice().reverse();
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }
}
