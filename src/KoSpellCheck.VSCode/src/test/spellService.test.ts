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

test('suggestions preserve capitalization and include transposition fixes', () => {
  const extensionPath = path.resolve(__dirname, '..', '..');
  const service = new SpellService(extensionPath);
  const config = defaultConfig();
  config.languages = ['hu'];
  config.suggestionsMax = 8;

  service.ensureInitialized();

  const titleCaseSuggestions = service.suggest('Almma', config).map((x) => x.replacement);
  const tezstSuggestions = service.suggest('tezst', config).map((x) => x.replacement.toLowerCase());

  assert.ok(titleCaseSuggestions.includes('Alma'));
  assert.ok(tezstSuggestions.includes('teszt'));
});

test('compound suggestions split misspelled hungarian words', () => {
  const extensionPath = path.resolve(__dirname, '..', '..');
  const service = new SpellService(extensionPath);
  const config = defaultConfig();
  config.languages = ['hu'];
  config.suggestionsMax = 10;

  service.ensureInitialized();

  const suggestions = service.suggest('Almmakorte', config).map((x) => x.replacement);

  assert.ok(
    suggestions.some(
      (replacement) => replacement === 'AlmaKorte' || replacement === 'AlmaKörte'
    )
  );
});

test('english transposition correction is prioritized in mixed language mode', () => {
  const extensionPath = path.resolve(__dirname, '..', '..');
  const service = new SpellService(extensionPath);
  const config = defaultConfig();
  config.languages = ['hu', 'en'];
  config.suggestionsMax = 6;

  service.ensureInitialized();

  const suggestions = service.suggest('Viwe', config).map((x) => x.replacement);

  assert.equal(suggestions[0], 'View');
});

test('mixed hu+en mode keeps hungarian-first ranking for hungarian-looking stems', () => {
  const extensionPath = path.resolve(__dirname, '..', '..');
  const service = new SpellService(extensionPath);
  const config = defaultConfig();
  config.languages = ['hu', 'en'];
  config.suggestionsMax = 6;

  service.ensureInitialized();

  const ranked = service.suggest('kerese', config).map((x) => x.replacement);

  assert.equal(/\s/u.test(ranked[0]), false);
  assert.ok(
    ranked.some((item) => item.toLowerCase() === 'keresd' || item.toLowerCase() === 'kereső')
  );
});
