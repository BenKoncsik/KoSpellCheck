import { createHash } from 'node:crypto';
import path from 'node:path';

const defaultStorageFolderName = '.kospellcheck';

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
