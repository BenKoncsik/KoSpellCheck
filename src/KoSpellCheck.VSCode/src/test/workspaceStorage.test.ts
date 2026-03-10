import assert from 'node:assert';
import path from 'node:path';
import test from 'node:test';
import {
  computeProjectStorageId,
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
