import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../config';
import { detectProjectStyleProfile } from '../styleDetector';
import { rankSuggestionsByStyle } from '../styleRanker';

test('style learning ranks HttpClient variant first for HttpClinet', async () => {
  const workspaceRoot = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'samples',
    'style-learning',
    'httpclient-workspace'
  );
  const files = collectFiles(workspaceRoot);
  const config = defaultConfig();
  config.styleLearningEnabled = true;
  config.styleLearningFileExtensions = ['cs'];
  config.styleLearningIgnoreFolders = ['bin', 'obj', '.git', '.vs', 'node_modules', 'artifacts'];
  config.styleLearningMaxFiles = 200;
  config.styleLearningMaxTokens = 50000;
  config.styleLearningTimeBudgetMs = 3000;

  const profile = await detectProjectStyleProfile(workspaceRoot, files, config);
  const ranked = rankSuggestionsByStyle(
    'HttpClinet',
    [
      { replacement: 'HTTPClient', confidence: 0.8, sourceDictionary: 'fake' },
      { replacement: 'httpClient', confidence: 0.8, sourceDictionary: 'fake' },
      { replacement: 'HttpClient', confidence: 0.8, sourceDictionary: 'fake' }
    ],
    config,
    profile
  );

  assert.equal(ranked[0]?.replacement, 'HttpClient');
});

function collectFiles(root: string): string[] {
  const output: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }

      output.push(fullPath);
    }
  }

  return output;
}
