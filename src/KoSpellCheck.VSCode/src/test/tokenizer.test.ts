import assert from 'node:assert';
import test from 'node:test';
import { defaultConfig, compileIgnorePatterns } from '../config';
import { tokenize } from '../tokenizer';

test('tokenizer splits camel and snake case', () => {
  const config = defaultConfig();
  const ignoreRegexes = compileIgnorePatterns(config.ignorePatterns);
  const tokens = tokenize('KoSpellCheck gps_coordinate_lat HTTPServerConfig', config, ignoreRegexes).map((x) => x.value);

  assert.deepStrictEqual(tokens, [
    'Ko',
    'Spell',
    'Check',
    'gps',
    'coordinate',
    'lat',
    'HTTP',
    'Server',
    'Config'
  ]);
});
