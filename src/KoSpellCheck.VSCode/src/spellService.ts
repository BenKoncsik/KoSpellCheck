import fs from 'node:fs';
import path from 'node:path';
import nspell from 'nspell';
import { KoSpellCheckConfig, Suggestion } from './types';
import { asciiFold, isAsciiOnly, normalize } from './normalization';

interface SpellDictionary {
  correct(token: string): boolean;
  suggest(token: string): string[];
}

class NSpellDictionary implements SpellDictionary {
  constructor(private readonly dictionary: ReturnType<typeof nspell>) {}

  public correct(token: string): boolean {
    return this.dictionary.correct(token);
  }

  public suggest(token: string): string[] {
    return this.dictionary.suggest(token);
  }
}

class WordSetDictionary implements SpellDictionary {
  private readonly words: Set<string>;
  private readonly buckets: Map<string, string[]> = new Map();

  constructor(words: string[]) {
    this.words = new Set(words);

    for (const word of this.words) {
      const key = WordSetDictionary.getBucketKey(word);
      const list = this.buckets.get(key) ?? [];
      list.push(word);
      this.buckets.set(key, list);

      const shortKey = word.slice(0, 1);
      const shortList = this.buckets.get(shortKey) ?? [];
      shortList.push(word);
      this.buckets.set(shortKey, shortList);
    }
  }

  public correct(token: string): boolean {
    return this.words.has(token);
  }

  public suggest(token: string): string[] {
    const normalized = normalize(token);
    const primary = this.buckets.get(WordSetDictionary.getBucketKey(normalized)) ?? [];
    const secondary = this.buckets.get(normalized.slice(0, 1)) ?? [];
    const candidates = (primary.length > 0 ? primary : secondary).slice(0, 6000);

    const scored: Array<{ word: string; distance: number; lengthDelta: number }> = [];
    for (const candidate of candidates) {
      const lengthDelta = Math.abs(candidate.length - normalized.length);
      if (lengthDelta > 2) {
        continue;
      }

      const distance = boundedDamerauLevenshtein(normalized, candidate, 2);
      if (distance > 2) {
        continue;
      }

      scored.push({ word: candidate, distance, lengthDelta });
    }

    scored.sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      if (a.lengthDelta !== b.lengthDelta) {
        return a.lengthDelta - b.lengthDelta;
      }
      return a.word.localeCompare(b.word);
    });

    return scored.slice(0, 8).map((x) => x.word);
  }

  private static getBucketKey(word: string): string {
    if (word.length <= 1) {
      return word;
    }
    return word.slice(0, 2);
  }
}

export class SpellService {
  private readonly extensionPath: string;
  private readonly dictionaries: Map<string, SpellDictionary> = new Map();
  private readonly huAsciiFoldIndex: Map<string, string[]> = new Map();
  private readonly initializationNotes: string[] = [];
  private huWordSet?: WordSetDictionary;
  private initialized = false;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
  }

  public ensureInitialized(): void {
    if (this.initialized) {
      return;
    }

    this.initializationNotes.length = 0;
    this.loadDictionary('en', 'en_US');
    this.loadDictionary('hu', 'hu_HU');
    this.initialized = true;
  }

  public getInitializationNotes(): string[] {
    return [...this.initializationNotes];
  }

  public check(token: string, config: KoSpellCheckConfig): { correct: boolean; languages: string[] } {
    const normalized = normalize(token);
    const languages: string[] = [];

    for (const language of config.languages) {
      const spell = this.dictionaries.get(language.toLowerCase());
      if (!spell) {
        continue;
      }

      if (spell.correct(normalized)) {
        languages.push(language.toLowerCase());
        continue;
      }

      if (
        language.toLowerCase() === 'hu' &&
        config.treatAsHungarianWhenAsciiOnly &&
        isAsciiOnly(normalized) &&
        this.huAsciiFoldIndex.has(asciiFold(normalized))
      ) {
        languages.push('hu');
      }
    }

    return { correct: languages.length > 0, languages };
  }

  public suggest(token: string, config: KoSpellCheckConfig): Suggestion[] {
    const normalized = normalize(token);
    const byKey = new Map<string, Suggestion>();
    const addSuggestion = (replacement: string, confidence: number, sourceDictionary: string): void => {
      if (!replacement) {
        return;
      }

      const key = replacement.toLowerCase();
      const existing = byKey.get(key);
      if (existing && existing.confidence >= confidence) {
        return;
      }

      byKey.set(key, {
        replacement,
        confidence,
        sourceDictionary
      });
    };

    for (const language of config.languages) {
      const langCode = language.toLowerCase();
      const spell = this.dictionaries.get(langCode);
      if (!spell) {
        continue;
      }

      for (const swapped of this.findDictionarySwapCorrections(normalized, spell)) {
        addSuggestion(
          applyTokenCasePattern(token, swapped),
          langCode === 'en' ? 0.97 : 0.95,
          `${langCode}-swap`
        );
      }

      for (const suggestion of spell.suggest(normalized)) {
        addSuggestion(
          applyTokenCasePattern(token, suggestion),
          0.75,
          langCode
        );
      }

      if (
        langCode === 'hu' &&
        config.treatAsHungarianWhenAsciiOnly &&
        isAsciiOnly(normalized)
      ) {
        const folded = asciiFold(normalized);
        const matches = this.huAsciiFoldIndex.get(folded) ?? [];
        for (const suggestion of matches) {
          addSuggestion(
            applyTokenCasePattern(token, suggestion),
            0.9,
            'hu'
          );
        }
      }

      if (langCode === 'hu' && this.huWordSet) {
        for (const swapped of this.findHungarianSwapCorrections(normalized, config)) {
          addSuggestion(
            applyTokenCasePattern(token, swapped),
            0.96,
            'hu-swap'
          );
        }

        for (const suggestion of this.huWordSet.suggest(normalized)) {
          addSuggestion(
            applyTokenCasePattern(token, suggestion),
            0.86,
            'hu-heuristic'
          );
        }

        for (const splitSuggestion of this.buildHungarianCompoundSuggestions(token, normalized, config)) {
          addSuggestion(
            splitSuggestion.replacement,
            splitSuggestion.confidence,
            splitSuggestion.sourceDictionary
          );
        }
      }
    }

    const entries = [...byKey.values()].map((suggestion) => {
      const normalizedReplacement = normalize(suggestion.replacement).replace(/\s+/gu, '');
      const distance = boundedDamerauLevenshtein(normalized, normalizedReplacement, 4);
      const lengthDelta = Math.abs(normalizedReplacement.length - normalized.length);
      return {
        suggestion,
        normalizedReplacement,
        distance,
        lengthDelta,
        language: extractLanguageFromSource(suggestion.sourceDictionary)
      };
    });

    const languageBestDistance = new Map<'hu' | 'en', number>();
    for (const entry of entries) {
      if (!entry.language) {
        continue;
      }

      const existing = languageBestDistance.get(entry.language);
      if (existing === undefined || entry.distance < existing) {
        languageBestDistance.set(entry.language, entry.distance);
      }
    }

    const tokenHints = detectTokenLanguageHints(token);
    const tokenAsciiOnly = isAsciiOnly(normalized);
    return entries
      .map((entry) => ({
        ...entry,
        dynamicScore: scoreSuggestionDynamic(
          entry,
          tokenHints,
          languageBestDistance,
          normalized.length,
          normalized,
          tokenAsciiOnly
        )
      }))
      .sort((a, b) => {
        if (a.dynamicScore !== b.dynamicScore) {
          return b.dynamicScore - a.dynamicScore;
        }

        if (a.distance !== b.distance) {
          return a.distance - b.distance;
        }

        if (a.lengthDelta !== b.lengthDelta) {
          return a.lengthDelta - b.lengthDelta;
        }

        return a.suggestion.replacement.localeCompare(b.suggestion.replacement, 'hu');
      })
      .slice(0, config.suggestionsMax)
      .map((entry) => entry.suggestion);
  }

  private loadDictionary(languageCode: string, dictionaryFolderName: string): void {
    const rootDir = this.resolveDictionaryRoot();
    const baseDir = path.join(rootDir, dictionaryFolderName);
    const affPath = path.join(baseDir, `${dictionaryFolderName}.aff`);
    const dicPath = path.join(baseDir, `${dictionaryFolderName}.dic`);
    this.initializationNotes.push(`dictionary root: ${rootDir}`);

    if (languageCode.toLowerCase() === 'hu') {
      const words = this.readDictionaryWords(dicPath);
      this.buildHungarianFoldIndex(words);
      this.huWordSet = new WordSetDictionary(words);
      this.initializationNotes.push(`hu word index size: ${words.length}`);
      try {
        const aff = fs.readFileSync(affPath, 'utf8');
        const dic = fs.readFileSync(dicPath, 'utf8');
        this.dictionaries.set(languageCode, new NSpellDictionary(nspell(aff, dic)));
        this.initializationNotes.push('hu dictionary backend: nspell');
      } catch (error) {
        this.dictionaries.set(languageCode, new WordSetDictionary(words));
        this.initializationNotes.push(
          `hu dictionary backend: fallback-wordset (${formatError(error)})`
        );
      }
      return;
    }

    const aff = fs.readFileSync(affPath, 'utf8');
    const dic = fs.readFileSync(dicPath, 'utf8');
    this.dictionaries.set(languageCode, new NSpellDictionary(nspell(aff, dic)));
    this.initializationNotes.push(`${languageCode} dictionary backend: nspell`);
  }

  private resolveDictionaryRoot(): string {
    const candidates = [
      path.join(this.extensionPath, 'resources', 'dictionaries'),
      path.join(this.extensionPath, 'Resources', 'Dictionaries'),
      path.join(this.extensionPath, 'dictionaries')
    ];

    for (const candidate of candidates) {
      if (this.hasDictionaryFiles(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      `KoSpellCheck dictionaries not found. Checked: ${candidates.join(', ')}`
    );
  }

  private hasDictionaryFiles(root: string): boolean {
    return (
      fs.existsSync(path.join(root, 'hu_HU', 'hu_HU.aff')) &&
      fs.existsSync(path.join(root, 'hu_HU', 'hu_HU.dic')) &&
      fs.existsSync(path.join(root, 'en_US', 'en_US.aff')) &&
      fs.existsSync(path.join(root, 'en_US', 'en_US.dic'))
    );
  }

  private readDictionaryWords(dicPath: string): string[] {
    const output: string[] = [];
    const lines = fs.readFileSync(dicPath, 'utf8').split(/\r?\n/);
    for (const raw of lines.slice(1)) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const firstField = trimmed.split(/\s+/u, 1)[0];
      const slashIdx = firstField.indexOf('/');
      const word = slashIdx > 0 ? firstField.slice(0, slashIdx) : firstField;
      const normalized = normalize(word);
      if (!normalized || normalized.includes(' ')) {
        continue;
      }

      output.push(normalized);
    }
    return output;
  }

  private buildHungarianFoldIndex(words: string[]): void {
    this.huAsciiFoldIndex.clear();
    for (const word of words) {
      const folded = asciiFold(word);
      const list = this.huAsciiFoldIndex.get(folded) ?? [];
      if (!list.includes(word)) {
        list.push(word);
      }
      this.huAsciiFoldIndex.set(folded, list);
    }
  }

  private buildHungarianCompoundSuggestions(
    rawToken: string,
    normalizedToken: string,
    config: KoSpellCheckConfig
  ): Suggestion[] {
    if (normalizedToken.length < 8 || !this.huWordSet) {
      return [];
    }

    const matches: Array<{ left: string; right: string; score: number }> = [];

    for (let splitAt = 3; splitAt <= normalizedToken.length - 3; splitAt++) {
      const leftRaw = normalizedToken.slice(0, splitAt);
      const rightRaw = normalizedToken.slice(splitAt);
      const leftCandidates = this.resolveHungarianPartCandidates(leftRaw, config);
      const rightCandidates = this.resolveHungarianPartCandidates(rightRaw, config);
      if (leftCandidates.length === 0 || rightCandidates.length === 0) {
        continue;
      }

      for (const left of leftCandidates.slice(0, 2)) {
        for (const right of rightCandidates.slice(0, 2)) {
          const leftDistance = boundedLevenshtein(leftRaw, normalize(left), 3);
          const rightDistance = boundedLevenshtein(rightRaw, normalize(right), 3);
          if (leftDistance > 3 || rightDistance > 3) {
            continue;
          }

          const score = leftDistance + rightDistance;
          matches.push({ left, right, score });
        }
      }
    }

    matches.sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }

      const aCombined = `${a.left}${a.right}`;
      const bCombined = `${b.left}${b.right}`;
      return aCombined.localeCompare(bCombined, 'hu');
    });

    const output: Suggestion[] = [];
    const seen = new Set<string>();
    const pushCandidate = (replacement: string, confidence: number): void => {
      if (!replacement) {
        return;
      }

      const key = replacement.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      output.push({
        replacement,
        confidence,
        sourceDictionary: 'hu-compound'
      });
    };

    for (const match of matches.slice(0, 4)) {
      const compound = applyCompoundCasePattern(rawToken, match.left, match.right);
      pushCandidate(compound, 0.95);
      pushCandidate(
        `${applyTokenCasePattern(rawToken, match.left)} ${applyTokenCasePattern(rawToken, match.right)}`,
        0.9
      );

      if (isAsciiOnly(rawToken)) {
        const asciiLeft = asciiFold(match.left);
        const asciiRight = asciiFold(match.right);
        pushCandidate(applyCompoundCasePattern(rawToken, asciiLeft, asciiRight), 0.97);
      }

      if (output.length >= config.suggestionsMax) {
        break;
      }
    }

    return output;
  }

  private resolveHungarianPartCandidates(part: string, config: KoSpellCheckConfig): string[] {
    const output: string[] = [];
    const seen = new Set<string>();
    const addCandidate = (candidate: string): void => {
      const normalized = normalize(candidate);
      if (!normalized || seen.has(normalized)) {
        return;
      }

      seen.add(normalized);
      output.push(candidate);
    };

    const huDict = this.dictionaries.get('hu');
    if (huDict?.correct(part)) {
      addCandidate(part);
    }

    if (config.treatAsHungarianWhenAsciiOnly && isAsciiOnly(part)) {
      const foldedMatches = this.huAsciiFoldIndex.get(asciiFold(part)) ?? [];
      for (const match of foldedMatches.slice(0, 4)) {
        addCandidate(match);
      }
    }

    if (this.huWordSet) {
      for (const suggestion of this.huWordSet.suggest(part).slice(0, 4)) {
        addCandidate(suggestion);
      }
    }

    if (huDict) {
      for (const suggestion of huDict.suggest(part).slice(0, 4)) {
        addCandidate(suggestion);
      }
    }

    return output;
  }

  private findHungarianSwapCorrections(
    token: string,
    config: KoSpellCheckConfig
  ): string[] {
    if (token.length < 3) {
      return [];
    }

    const output: string[] = [];
    const seen = new Set<string>();
    const addCandidate = (candidate: string): void => {
      const normalized = normalize(candidate);
      if (!normalized || seen.has(normalized) || normalized === token) {
        return;
      }

      seen.add(normalized);
      output.push(candidate);
    };

    const huDict = this.dictionaries.get('hu');
    for (let i = 0; i < token.length - 1; i++) {
      if (token[i] === token[i + 1]) {
        continue;
      }

      const swapped =
        token.slice(0, i) +
        token[i + 1] +
        token[i] +
        token.slice(i + 2);

      if (huDict?.correct(swapped)) {
        addCandidate(swapped);
      }

      if (this.huWordSet?.correct(swapped)) {
        addCandidate(swapped);
      }

      if (config.treatAsHungarianWhenAsciiOnly && isAsciiOnly(swapped)) {
        const folded = asciiFold(swapped);
        const foldedMatches = this.huAsciiFoldIndex.get(folded) ?? [];
        for (const match of foldedMatches.slice(0, 3)) {
          addCandidate(match);
        }
      }
    }

    return output;
  }

  private findDictionarySwapCorrections(
    token: string,
    dictionary: SpellDictionary
  ): string[] {
    if (token.length < 3) {
      return [];
    }

    const output: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < token.length - 1; i++) {
      if (token[i] === token[i + 1]) {
        continue;
      }

      const swapped =
        token.slice(0, i) +
        token[i + 1] +
        token[i] +
        token.slice(i + 2);

      if (!dictionary.correct(swapped)) {
        continue;
      }

      const normalized = normalize(swapped);
      if (seen.has(normalized) || normalized === token) {
        continue;
      }

      seen.add(normalized);
      output.push(swapped);
    }

    return output;
  }
}

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
  if (a === b) {
    return 0;
  }

  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const aCode = a.charCodeAt(i - 1);

    for (let j = 1; j <= b.length; j++) {
      const cost = aCode === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
      if (curr[j] < rowMin) {
        rowMin = curr[j];
      }
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

function boundedDamerauLevenshtein(a: string, b: string, maxDistance: number): number {
  if (a === b) {
    return 0;
  }

  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  let prevPrev = new Array<number>(b.length + 1).fill(0);
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const aCode = a.charCodeAt(i - 1);

    for (let j = 1; j <= b.length; j++) {
      const cost = aCode === b.charCodeAt(j - 1) ? 0 : 1;
      let cell = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );

      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        cell = Math.min(cell, prevPrev[j - 2] + 1);
      }

      curr[j] = cell;
      if (cell < rowMin) {
        rowMin = cell;
      }
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    [prevPrev, prev, curr] = [prev, curr, prevPrev];
  }

  return prev[b.length];
}

function formatError(error: unknown): string {
  let raw: string;
  if (error instanceof Error) {
    raw = error.message;
  } else {
    raw = String(error);
  }

  const firstLine = raw.split(/\r?\n/u, 1)[0].trim();
  if (firstLine.length <= 320) {
    return firstLine;
  }

  return `${firstLine.slice(0, 320)}...`;
}

function applyTokenCasePattern(inputToken: string, suggestion: string): string {
  if (!suggestion) {
    return suggestion;
  }

  if (isUppercaseToken(inputToken)) {
    return suggestion.toLocaleUpperCase('hu-HU');
  }

  if (isCapitalizedToken(inputToken)) {
    return suggestion.replace(/\p{L}+/gu, (segment) => {
      const lower = segment.toLocaleLowerCase('hu-HU');
      return lower.charAt(0).toLocaleUpperCase('hu-HU') + lower.slice(1);
    });
  }

  if (isLowercaseToken(inputToken)) {
    return suggestion.toLocaleLowerCase('hu-HU');
  }

  return suggestion;
}

function applyCompoundCasePattern(inputToken: string, left: string, right: string): string {
  if (isUppercaseToken(inputToken)) {
    return `${left.toLocaleUpperCase('hu-HU')}${right.toLocaleUpperCase('hu-HU')}`;
  }

  if (isCapitalizedToken(inputToken)) {
    return `${toTitleCaseWord(left)}${toTitleCaseWord(right)}`;
  }

  if (isCamelLikeToken(inputToken)) {
    return `${left.toLocaleLowerCase('hu-HU')}${toTitleCaseWord(right)}`;
  }

  return `${left} ${right}`;
}

function toTitleCaseWord(input: string): string {
  const lower = input.toLocaleLowerCase('hu-HU');
  return lower.charAt(0).toLocaleUpperCase('hu-HU') + lower.slice(1);
}

function isUppercaseToken(input: string): boolean {
  const letters = input.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) {
    return false;
  }

  return input === input.toLocaleUpperCase('hu-HU');
}

function isLowercaseToken(input: string): boolean {
  const letters = input.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) {
    return false;
  }

  return input === input.toLocaleLowerCase('hu-HU');
}

function isCapitalizedToken(input: string): boolean {
  if (!/^\p{L}/u.test(input)) {
    return false;
  }

  const first = input[0];
  const rest = input.slice(1);
  return (
    first === first.toLocaleUpperCase('hu-HU') &&
    rest === rest.toLocaleLowerCase('hu-HU')
  );
}

function isCamelLikeToken(input: string): boolean {
  if (!/^\p{L}/u.test(input)) {
    return false;
  }

  const first = input[0];
  const rest = input.slice(1);
  return (
    first === first.toLocaleLowerCase('hu-HU') &&
    /[\p{Lu}]/u.test(rest)
  );
}

function extractLanguageFromSource(sourceDictionary: string): 'hu' | 'en' | undefined {
  const lower = sourceDictionary.toLowerCase();
  if (lower.startsWith('hu')) {
    return 'hu';
  }

  if (lower.startsWith('en')) {
    return 'en';
  }

  return undefined;
}

function detectTokenLanguageHints(token: string): { likelyHungarian: boolean; likelyEnglish: boolean } {
  const lower = token.toLocaleLowerCase('hu-HU');
  const likelyHungarian =
    /[áéíóöőúüű]/u.test(lower) ||
    /(sz|zs|cs|gy|ny|ty|ly|dzs|dz)/u.test(lower);
  const likelyEnglish =
    /[wq]/u.test(lower) ||
    /(view|model|service|controller|manager|request|response)/u.test(lower);

  return { likelyHungarian, likelyEnglish };
}

function scoreSuggestionDynamic(
  entry: {
    suggestion: Suggestion;
    normalizedReplacement: string;
    distance: number;
    lengthDelta: number;
    language?: 'hu' | 'en';
  },
  tokenHints: { likelyHungarian: boolean; likelyEnglish: boolean },
  languageBestDistance: Map<'hu' | 'en', number>,
  tokenLength: number,
  normalizedToken: string,
  tokenAsciiOnly: boolean
): number {
  let score = entry.suggestion.confidence;
  const neutralAsciiToken = tokenAsciiOnly && !tokenHints.likelyHungarian;

  if (entry.language) {
    const bestForLang = languageBestDistance.get(entry.language);
    if (bestForLang !== undefined) {
      const overallBest = Math.min(...languageBestDistance.values());
      const delta = bestForLang - overallBest;
      score -= delta * 0.08;
      if (delta === 0 && languageBestDistance.size > 1) {
        score += 0.03;
      }
    }
  }

  if (entry.language === 'hu' && tokenHints.likelyHungarian) {
    score += 0.05;
  }

  if (entry.language === 'en' && tokenHints.likelyEnglish) {
    score += 0.05;
  }

  if (neutralAsciiToken && entry.language === 'en' && isAsciiOnly(entry.normalizedReplacement)) {
    score += 0.12;
  }

  if (neutralAsciiToken && entry.suggestion.sourceDictionary === 'hu-heuristic') {
    score -= 0.12;
  }

  if (/\s/u.test(entry.suggestion.replacement) && tokenLength < 8) {
    score -= 0.2;
  }

  if (
    entry.normalizedReplacement.length > normalizedToken.length &&
    entry.normalizedReplacement.length - normalizedToken.length <= 2 &&
    isSubsequence(normalizedToken, entry.normalizedReplacement)
  ) {
    score += 0.05;
  }

  score += Math.max(0, 4 - entry.distance) * 0.02;
  score -= Math.min(4, entry.lengthDelta) * 0.01;

  return score;
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle || needle.length >= haystack.length) {
    return false;
  }

  let needleIndex = 0;
  for (let i = 0; i < haystack.length && needleIndex < needle.length; i++) {
    if (haystack[i] === needle[needleIndex]) {
      needleIndex += 1;
    }
  }

  return needleIndex === needle.length;
}
