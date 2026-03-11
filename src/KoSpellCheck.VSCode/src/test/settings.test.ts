import assert from 'node:assert';
import test from 'node:test';
import { resolveWorkspaceStoragePathFromSettings } from '../settings';

interface MockInspectResult {
  workspaceFolderValue?: string;
  workspaceValue?: string;
  globalValue?: string;
}

class MockWorkspaceConfiguration {
  constructor(
    private readonly inspectResult: MockInspectResult | undefined,
    private readonly values: Record<string, unknown>
  ) {}

  public inspect<T>(_section: string): {
    workspaceFolderValue?: T;
    workspaceValue?: T;
    globalValue?: T;
  } | undefined {
    return this.inspectResult as {
      workspaceFolderValue?: T;
      workspaceValue?: T;
      globalValue?: T;
    } | undefined;
  }

  public get<T>(section: string): T | undefined {
    return this.values[section] as T | undefined;
  }
}

test('workspaceStoragePath prefers direct workspace setting values', () => {
  const workspaceConfig = new MockWorkspaceConfiguration(
    { workspaceValue: ' /tmp/shared-store ' },
    {}
  );
  const globalConfig = new MockWorkspaceConfiguration(undefined, {});

  const resolved = resolveWorkspaceStoragePathFromSettings(
    workspaceConfig as never,
    globalConfig as never,
    '/fallback'
  );

  assert.equal(resolved, '/tmp/shared-store');
});

test('workspaceStoragePath falls back to legacy koSpellCheck setting', () => {
  const workspaceConfig = new MockWorkspaceConfiguration(undefined, {});
  const globalConfig = new MockWorkspaceConfiguration(undefined, {
    'koSpellCheck.workspaceStoragePath': ' /tmp/legacy-store '
  });

  const resolved = resolveWorkspaceStoragePathFromSettings(
    workspaceConfig as never,
    globalConfig as never,
    '/fallback'
  );

  assert.equal(resolved, '/tmp/legacy-store');
});

test('workspaceStoragePath keeps file config fallback when no VS Code setting is present', () => {
  const workspaceConfig = new MockWorkspaceConfiguration(undefined, {});
  const globalConfig = new MockWorkspaceConfiguration(undefined, {});

  const resolved = resolveWorkspaceStoragePathFromSettings(
    workspaceConfig as never,
    globalConfig as never,
    '/fallback'
  );

  assert.equal(resolved, '/fallback');
});
