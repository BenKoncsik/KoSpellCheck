import { KoSpellCheckConfig, SpellIssue, Suggestion } from './types';
import { SpellService } from './spellService';
import { asciiFold, isAllCaps, normalize } from './normalization';
import { tokenize } from './tokenizer';
import { compileIgnorePatterns } from './config';

interface CheckOptions {
  focusOffsets?: number[];
}

export function checkDocument(
  text: string,
  config: KoSpellCheckConfig,
  service: SpellService,
  options?: CheckOptions
): SpellIssue[] {
  if (!config.enabled || !text) {
    return [];
  }

  const ignoreRegexes = compileIgnorePatterns(config.ignorePatterns);
  const tokens = selectTokensForCheck(
    tokenize(text, config, ignoreRegexes),
    config.maxTokensPerDocument,
    options?.focusOffsets
  );
  const ignoreWords = new Set(config.ignoreWords.map((x) => normalize(x)));
  const projectDictionary = new Set(config.projectDictionary.map((x) => normalize(x)));

  const issues: SpellIssue[] = [];

  for (const token of tokens) {
    const raw = token.value;
    const normalized = normalize(raw);

    if (
      raw.length < config.minTokenLength ||
      raw.length > config.maxTokenLength ||
      (isAllCaps(raw) && raw.length <= config.ignoreAllCapsLengthThreshold) ||
      ignoreWords.has(normalized) ||
      projectDictionary.has(normalized)
    ) {
      continue;
    }

    const check = service.check(raw, config);
    let suggestions = service.suggest(raw, config);

    const preferred = findPreferred(normalized, config.preferTerms);
    if (preferred && preferred !== normalized) {
      suggestions = prependPreference(preferred, suggestions, config.suggestionsMax);
    }

    if (!check.correct) {
      issues.push({
        type: 'misspell',
        token: raw,
        start: token.start,
        end: token.end,
        message: `Possible misspelling: '${raw}'.`,
        languageHint: check.languages[0],
        suggestions: suggestions.slice(0, config.suggestionsMax)
      });
      continue;
    }

    if (preferred && preferred !== normalized) {
      issues.push({
        type: 'preference',
        token: raw,
        start: token.start,
        end: token.end,
        message: `Preferred term is '${preferred}'.`,
        languageHint: check.languages[0],
        suggestions: suggestions.slice(0, config.suggestionsMax)
      });
    }

    if (
      config.treatAsHungarianWhenAsciiOnly &&
      check.correct &&
      check.languages.includes('hu') &&
      /^[\x00-\x7F]+$/.test(raw)
    ) {
      const folded = asciiFold(raw);
      if (folded !== normalized) {
        // no-op, placeholder for future language hint tuning
      }
    }
  }

  return issues;
}

function selectTokensForCheck(
  tokens: Array<{ value: string; start: number; end: number }>,
  maxTokens: number,
  focusOffsets?: number[]
): Array<{ value: string; start: number; end: number }> {
  if (maxTokens <= 0) {
    return [];
  }

  if (tokens.length <= maxTokens) {
    return tokens;
  }

  const selected = new Set<number>();
  const normalizedFocusOffsets = (focusOffsets ?? []).filter((x) => Number.isFinite(x));

  if (normalizedFocusOffsets.length > 0) {
    const halfWindow = Math.max(25, Math.floor(maxTokens / 6));

    for (const offset of normalizedFocusOffsets) {
      const hit = findTokenIndexAtOffset(tokens, offset);
      if (hit < 0) {
        continue;
      }

      const start = Math.max(0, hit - halfWindow);
      const end = Math.min(tokens.length - 1, hit + halfWindow);
      for (let i = start; i <= end; i++) {
        selected.add(i);
        if (selected.size >= maxTokens) {
          break;
        }
      }

      if (selected.size >= maxTokens) {
        break;
      }
    }
  }

  for (let i = 0; i < tokens.length && selected.size < maxTokens; i++) {
    selected.add(i);
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((idx) => tokens[idx]);
}

function findTokenIndexAtOffset(
  tokens: Array<{ start: number; end: number }>,
  offset: number
): number {
  let left = 0;
  let right = tokens.length - 1;

  while (left <= right) {
    const mid = (left + right) >> 1;
    const token = tokens[mid];
    if (offset < token.start) {
      right = mid - 1;
      continue;
    }

    if (offset >= token.end) {
      left = mid + 1;
      continue;
    }

    return mid;
  }

  if (left < tokens.length) {
    return left;
  }

  return tokens.length - 1;
}

function prependPreference(preferred: string, suggestions: Suggestion[], max: number): Suggestion[] {
  const seen = new Set<string>([preferred.toLowerCase()]);
  const merged: Suggestion[] = [{ replacement: preferred, confidence: 1, sourceDictionary: 'preference' }];

  for (const item of suggestions) {
    if (seen.has(item.replacement.toLowerCase())) {
      continue;
    }
    seen.add(item.replacement.toLowerCase());
    merged.push(item);
    if (merged.length >= max) {
      break;
    }
  }

  return merged;
}

function findPreferred(normalized: string, map: Record<string, string>): string | undefined {
  for (const [key, value] of Object.entries(map)) {
    if (normalize(key) === normalized) {
      return normalize(value);
    }
  }
  return undefined;
}
