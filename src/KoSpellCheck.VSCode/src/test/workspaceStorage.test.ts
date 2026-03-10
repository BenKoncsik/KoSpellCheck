import fs from 'node:fs';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  computeProjectStorageId,
  migrateLegacyWorkspaceStorage,
  resolveWorkspaceArtifactPath,
  resolveWorkspaceStorageRoot
} from '../workspaceStorage';

test('workspace storage id is deterministic per workspace', () => {
  const workspaceRoot = path.join(path.sep, 'tmp', 'demo-project');
  const first = computeProjectStorageId(workspaceRoot);
  const second = computeProjectStorageId(workspaceRoot);

  assert.equal(first, second);
  assert.ok(first.startsWith('project-'));
});

test('workspace artifact path keeps default behavior when no custom storage path is configured', () => {
  const workspaceRoot = path.join(path.sep, 'tmp', 'demo-project');
  const artifactPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    '',
    '.kospellcheck/style-profile.json',
    '.kospellcheck/style-profile.json'
  );

  assert.equal(artifactPath, path.join(workspaceRoot, '.kospellcheck', 'style-profile.json'));
});

test('workspace artifact path relocates .kospellcheck files under configured storage root', () => {
  const workspaceRoot = path.join(path.sep, 'tmp', 'demo-project');
  const configuredStorage = path.join(path.sep, 'var', 'kospellcheck');
  const storageRoot = resolveWorkspaceStorageRoot(workspaceRoot, configuredStorage);
  const artifactPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    configuredStorage,
    '.kospellcheck/project-conventions.json',
    '.kospellcheck/project-conventions.json'
  );

  assert.equal(artifactPath, path.join(storageRoot, 'project-conventions.json'));
});

test('workspace storage migration copies legacy folder and removes original folder', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kospellcheck-storage-migrate-'));
  const configuredStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'kospellcheck-storage-target-'));

  try {
    const legacyRoot = path.join(workspaceRoot, '.kospellcheck');
    fs.mkdirSync(legacyRoot, { recursive: true });
    const legacyFile = path.join(legacyRoot, 'style-profile.json');
    fs.writeFileSync(legacyFile, '{"ok":true}', 'utf8');

    const migration = migrateLegacyWorkspaceStorage(workspaceRoot, configuredStorage);
    const movedFile = path.join(migration.resolvedStorageRoot, 'style-profile.json');

    assert.equal(migration.migrated, true);
    assert.ok(fs.existsSync(movedFile));
    assert.equal(fs.existsSync(legacyRoot), false);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(configuredStorage, { recursive: true, force: true });
  }
});
