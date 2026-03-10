import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const defaultStorageFolderName = '.kospellcheck';
const legacyStorageFolderNames = ['.kospellcheck', '.KoSpellChecker', '.KoSpellCheck'] as const;

export function computeProjectStorageId(workspaceRoot: string): string {
  const normalized = normalizeWorkspaceRoot(workspaceRoot);
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `project-${hash.slice(0, 16)}`;
}

export function resolveWorkspaceStorageRoot(
  workspaceRoot: string,
  configuredWorkspaceStoragePath?: string
): string {
  if (!configuredWorkspaceStoragePath?.trim()) {
    return path.join(workspaceRoot, defaultStorageFolderName);
  }

  const target = configuredWorkspaceStoragePath.trim();
  const baseRoot = path.isAbsolute(target)
    ? target
    : path.join(workspaceRoot, target);
  return path.join(baseRoot, computeProjectStorageId(workspaceRoot));
}

export function resolveWorkspaceArtifactPath(
  workspaceRoot: string,
  configuredWorkspaceStoragePath: string | undefined,
  configuredArtifactPath: string | undefined,
  defaultArtifactPath: string
): string {
  const target = configuredArtifactPath?.trim() || defaultArtifactPath;
  if (path.isAbsolute(target)) {
    return target;
  }

  if (!configuredWorkspaceStoragePath?.trim()) {
    return path.join(workspaceRoot, target);
  }

  const storageRoot = resolveWorkspaceStorageRoot(workspaceRoot, configuredWorkspaceStoragePath);
  const relative = trimLegacyStoragePrefix(target);
  return relative ? path.join(storageRoot, relative) : storageRoot;
}

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  const fullPath = path.resolve(workspaceRoot);
  return fullPath
    .replace(/[\\/]+$/u, '')
    .toLowerCase();
}

function trimLegacyStoragePrefix(relativePath: string): string {
  let normalized = relativePath.replace(/\\/gu, '/').replace(/^\/+/u, '');
  if (normalized.toLowerCase() === defaultStorageFolderName) {
    return '';
  }

  const legacyPrefix = `${defaultStorageFolderName}/`;
  if (normalized.toLowerCase().startsWith(legacyPrefix)) {
    normalized = normalized.slice(legacyPrefix.length);
  }

  return normalized.replace(/\//gu, path.sep);
}

export function migrateLegacyWorkspaceStorage(
  workspaceRoot: string,
  configuredWorkspaceStoragePath?: string,
  log?: (message: string) => void
): { migrated: boolean; resolvedStorageRoot: string; migratedFrom: string[] } {
  const resolvedStorageRoot = resolveWorkspaceStorageRoot(workspaceRoot, configuredWorkspaceStoragePath);
  if (!configuredWorkspaceStoragePath?.trim()) {
    return { migrated: false, resolvedStorageRoot, migratedFrom: [] };
  }

  const migratedFrom: string[] = [];
  for (const folderName of legacyStorageFolderNames) {
    const sourceRoot = path.join(workspaceRoot, folderName);
    if (!fs.existsSync(sourceRoot)) {
      continue;
    }

    const normalizedSource = normalizeWorkspaceRoot(sourceRoot);
    const normalizedTarget = normalizeWorkspaceRoot(resolvedStorageRoot);
    if (normalizedSource === normalizedTarget) {
      continue;
    }

    try {
      copyDirectoryRecursive(sourceRoot, resolvedStorageRoot);
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      migratedFrom.push(sourceRoot);
      log?.(`workspace-storage migrated '${sourceRoot}' -> '${resolvedStorageRoot}'`);
    } catch (error) {
      log?.(
        `workspace-storage migration failed source='${sourceRoot}' target='${resolvedStorageRoot}' reason=${String(error)}`
      );
    }
  }

  return {
    migrated: migratedFrom.length > 0,
    resolvedStorageRoot,
    migratedFrom
  };
}

function copyDirectoryRecursive(sourceRoot: string, targetRoot: string): void {
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}
