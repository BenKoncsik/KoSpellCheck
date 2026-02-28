import assert from 'node:assert';
import test from 'node:test';
import { defaultConfig } from '../config';
import { checkDocument } from '../engine';

test('engine prioritizes focus offsets when token budget is exceeded', () => {
  const config = defaultConfig();
  config.maxTokensPerDocument = 2000;

  const filler = Array.from({ length: 2200 }, () => 'helyes').join(' ');
  const text = `${filler} TesztiresAlmmaKorte`;
  const targetOffset = text.lastIndexOf('Almma');

  const service = {
    check(token: string) {
      const misspelled = token.toLowerCase() === 'almma';
      return {
        correct: !misspelled,
        languages: misspelled ? [] : ['hu']
      };
    },
    suggest(token: string) {
      if (token.toLowerCase() === 'almma') {
        return [{ replacement: 'alma', confidence: 1, sourceDictionary: 'hu' }];
      }
      return [];
    }
  };

  const noFocus = checkDocument(text, config, service as any);
  assert.equal(noFocus.some((issue) => issue.token === 'Almma'), false);

  const withFocus = checkDocument(text, config, service as any, {
    focusOffsets: [targetOffset]
  });
  assert.equal(withFocus.some((issue) => issue.token === 'Almma'), true);
});
