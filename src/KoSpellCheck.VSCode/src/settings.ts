import * as vscode from 'vscode';

export function resolveWorkspaceStoragePathFromSettings(
  workspaceConfig: vscode.WorkspaceConfiguration,
  globalConfig: vscode.WorkspaceConfiguration,
  fallback: string
): string {
  const inspected = workspaceConfig.inspect<string>('workspaceStoragePath');
  const directValue =
    inspected?.workspaceFolderValue ??
    inspected?.workspaceValue ??
    inspected?.globalValue;
  if (typeof directValue === 'string') {
    return directValue.trim();
  }

  const legacyValue = globalConfig.get<string>('koSpellCheck.workspaceStoragePath');
  if (typeof legacyValue === 'string') {
    return legacyValue.trim();
  }

  return fallback;
}
