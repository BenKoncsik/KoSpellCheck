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
  const almmaIssue = withFocus.find((issue) => issue.token === 'Almma');
  assert.ok(almmaIssue);
  assert.ok(almmaIssue.message.includes('alma'));
});

test('engine produces a single fix for multi-part identifier misspellings', () => {
  const config = defaultConfig();
  const text = 'public void TesztirsaAlmmakorte() {}';
  const service = {
    check(token: string) {
      const normalized = token.toLowerCase();
      const misspelled = normalized === 'tesztirsa' || normalized === 'almmakorte';
      return {
        correct: !misspelled,
        languages: misspelled ? [] : ['hu']
      };
    },
    suggest(token: string) {
      const normalized = token.toLowerCase();
      if (normalized === 'tesztirsa') {
        return [{ replacement: 'Tesztiras', confidence: 0.95, sourceDictionary: 'hu' }];
      }

      if (normalized === 'almmakorte') {
        return [{ replacement: 'AlmaKorte', confidence: 0.97, sourceDictionary: 'hu' }];
      }

      return [];
    }
  };

  const issues = checkDocument(text, config, service as any);
  assert.equal(issues.length, 1);

  const issue = issues[0];
  assert.equal(issue.token, 'TesztirsaAlmmakorte');
  assert.equal(issue.suggestions[0]?.replacement, 'TesztirasAlmaKorte');
});
