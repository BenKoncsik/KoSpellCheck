import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('VS Code manifest configuration defaults to window scope', () => {
  const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    contributes?: {
      configuration?: {
        scope?: string;
        properties?: Record<string, unknown>;
      };
    };
  };

  const configuration = packageJson.contributes?.configuration;
  assert.ok(configuration, 'contributes.configuration must exist');
  assert.equal(
    configuration?.scope,
    'window',
    'contributes.configuration.scope must remain window so settings stay visible in Workspace scope'
  );
  assert.ok(
    Object.keys(configuration?.properties ?? {}).length > 1,
    'manifest should expose multiple extension settings'
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(
      configuration?.properties ?? {},
      'kospellcheck.workspaceStoragePath'
    ),
    'manifest must expose kospellcheck.workspaceStoragePath so users can configure a shared storage root once'
  );
});
