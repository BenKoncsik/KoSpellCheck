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

      const distance = boundedLevenshtein(normalized, candidate, 2);
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
  private initialized = false;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
  }

  public ensureInitialized(): void {
    if (this.initialized) {
      return;
    }

    this.loadDictionary('en', 'en_US');
    this.loadDictionary('hu', 'hu_HU');
    this.initialized = true;
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
    const output: Suggestion[] = [];
    const seen = new Set<string>();

    for (const language of config.languages) {
      const langCode = language.toLowerCase();
      const spell = this.dictionaries.get(langCode);
      if (!spell) {
        continue;
      }

      for (const suggestion of spell.suggest(normalized)) {
        if (seen.has(suggestion.toLowerCase())) {
          continue;
        }

        seen.add(suggestion.toLowerCase());
        output.push({ replacement: suggestion, confidence: 0.75, sourceDictionary: langCode });
        if (output.length >= config.suggestionsMax) {
          return output;
        }
      }

      if (
        langCode === 'hu' &&
        config.treatAsHungarianWhenAsciiOnly &&
        isAsciiOnly(normalized)
      ) {
        const folded = asciiFold(normalized);
        const matches = this.huAsciiFoldIndex.get(folded) ?? [];
        for (const suggestion of matches) {
          if (seen.has(suggestion.toLowerCase())) {
            continue;
          }

          seen.add(suggestion.toLowerCase());
          output.push({ replacement: suggestion, confidence: 0.9, sourceDictionary: 'hu' });
          if (output.length >= config.suggestionsMax) {
            return output;
          }
        }
      }
    }

    return output;
  }

  private loadDictionary(languageCode: string, dictionaryFolderName: string): void {
    const rootDir = this.resolveDictionaryRoot();
    const baseDir = path.join(rootDir, dictionaryFolderName);
    const affPath = path.join(baseDir, `${dictionaryFolderName}.aff`);
    const dicPath = path.join(baseDir, `${dictionaryFolderName}.dic`);

    if (languageCode.toLowerCase() === 'hu') {
      const words = this.readDictionaryWords(dicPath);
      this.buildHungarianFoldIndex(words);
      try {
        const aff = fs.readFileSync(affPath, 'utf8');
        const dic = fs.readFileSync(dicPath, 'utf8');
        this.dictionaries.set(languageCode, new NSpellDictionary(nspell(aff, dic)));
      } catch (error) {
        this.dictionaries.set(languageCode, new WordSetDictionary(words));
        console.warn(
          `[KoSpellCheck] Hungarian nspell load failed; using fallback dictionary: ${formatError(error)}`
        );
      }
      return;
    }

    const aff = fs.readFileSync(affPath, 'utf8');
    const dic = fs.readFileSync(dicPath, 'utf8');
    this.dictionaries.set(languageCode, new NSpellDictionary(nspell(aff, dic)));
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
