import { normalize } from './normalization';
import { KoSpellCheckConfig, ProjectStyleProfile, Suggestion, TokenStyleStats } from './types';

export function rankSuggestionsByStyle(
  originalToken: string,
  suggestions: Suggestion[],
  config: KoSpellCheckConfig,
  profile?: ProjectStyleProfile
): Suggestion[] {
  if (suggestions.length <= 1) {
    return suggestions;
  }

  const originalNormalized = normalizeStyleKey(originalToken);
  return suggestions
    .map((suggestion, index) => ({
      suggestion,
      index,
      score: computeScore(originalNormalized, suggestion, config, profile)
    }))
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.suggestion);
}

function computeScore(
  originalNormalized: string,
  suggestion: Suggestion,
  config: KoSpellCheckConfig,
  profile?: ProjectStyleProfile
): number {
  let score = suggestion.confidence;

  if (isPreferredTermOverride(originalNormalized, suggestion.replacement, config)) {
    score += 1000;
  }

  if (!profile) {
    return score;
  }
  const replacementNormalized = normalizeStyleKey(suggestion.replacement);

  const stats = profile.tokenStats[replacementNormalized];
  if (!stats || stats.totalCount <= 0) {
    return score;
  }

  if (stats.preferredVariant === suggestion.replacement) {
    score += 100;
  }

  const dominantPattern = resolveDominantPattern(stats);
  if (dominantPattern !== 'unknown' && classifyPattern(suggestion.replacement) === dominantPattern) {
    score += 50;
  }

  score += Math.min(25, stats.totalCount);
  return score;
}

function isPreferredTermOverride(
  originalNormalized: string,
  replacement: string,
  config: KoSpellCheckConfig
): boolean {
  const replacementNormalized = normalize(replacement);
  for (const [key, value] of Object.entries(config.preferTerms)) {
    if (normalize(key) !== originalNormalized) {
      continue;
    }

    return normalize(value) === replacementNormalized;
  }

  return false;
}

function resolveDominantPattern(stats: TokenStyleStats): CasePattern {
  const counts = new Map<CasePattern, number>();

  for (const [variant, count] of Object.entries(stats.variants)) {
    const pattern = classifyPattern(variant);
    counts.set(pattern, (counts.get(pattern) ?? 0) + count);
  }

  let winner: CasePattern = 'unknown';
  let maxCount = -1;
  for (const [pattern, count] of counts.entries()) {
    if (count > maxCount) {
      winner = pattern;
      maxCount = count;
    }
  }

  return winner;
}

type CasePattern =
  | 'unknown'
  | 'lower'
  | 'upper'
  | 'pascal'
  | 'camel'
  | 'snake-lower'
  | 'snake-upper'
  | 'kebab-lower'
  | 'kebab-upper';

function classifyPattern(token: string): CasePattern {
  if (!token) {
    return 'unknown';
  }

  if (token.includes('_')) {
    if ([...token].every((c) => !isLetter(c) || c === c.toLowerCase())) {
      return 'snake-lower';
    }
    if ([...token].every((c) => !isLetter(c) || c === c.toUpperCase())) {
      return 'snake-upper';
    }
    return 'unknown';
  }

  if (token.includes('-')) {
    if ([...token].every((c) => !isLetter(c) || c === c.toLowerCase())) {
      return 'kebab-lower';
    }
    if ([...token].every((c) => !isLetter(c) || c === c.toUpperCase())) {
      return 'kebab-upper';
    }
    return 'unknown';
  }

  if ([...token].every((c) => !isLetter(c) || c === c.toUpperCase())) {
    return 'upper';
  }

  if ([...token].every((c) => !isLetter(c) || c === c.toLowerCase())) {
    return 'lower';
  }

  if (token[0] === token[0].toUpperCase() && /[\p{Ll}]/u.test(token.slice(1))) {
    return 'pascal';
  }

  if (token[0] === token[0].toLowerCase() && /[\p{Lu}]/u.test(token)) {
    return 'camel';
  }

  return 'unknown';
}

function isLetter(char: string): boolean {
  return /^\p{L}$/u.test(char);
}

function normalizeStyleKey(value: string): string {
  const normalized = normalize(value);
  if (!normalized) {
    return '';
  }

  const folded = normalized
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x00-\x7F]/gu, '')
    .toLowerCase();

  return folded || normalized;
}
