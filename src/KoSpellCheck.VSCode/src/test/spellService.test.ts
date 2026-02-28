import assert from 'node:assert';
import path from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../config';
import { SpellService } from '../spellService';

test('spell service stays functional when HU nspell loader fails', () => {
  const extensionPath = path.resolve(__dirname, '..', '..');
  const service = new SpellService(extensionPath);
  const config = defaultConfig();
  config.languages = ['hu'];

  service.ensureInitialized();

  const correct = service.check('Alma', config);
  const misspelled = service.check('Almma', config);
  const suggestions = service.suggest('Almma', config).map((x) => x.replacement.toLowerCase());

  assert.equal(correct.correct, true);
  assert.equal(misspelled.correct, false);
  assert.ok(suggestions.includes('alma'));
});
