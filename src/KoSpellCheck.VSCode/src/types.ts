export interface KoSpellCheckConfig {
  enabled: boolean;
  languages: string[];
  allowMixedLanguages: boolean;
  preferTerms: Record<string, string>;
  treatAsHungarianWhenAsciiOnly: boolean;
  ignoreWords: string[];
  projectDictionary: string[];
  ignorePatterns: string[];
  minTokenLength: number;
  maxTokenLength: number;
  ignoreAllCapsLengthThreshold: number;
  suggestionsMax: number;
  maxTokensPerDocument: number;
}

export interface TokenSpan {
  value: string;
  start: number;
  end: number;
}

export interface Suggestion {
  replacement: string;
  confidence: number;
  sourceDictionary: string;
}

export interface SpellIssue {
  type: 'misspell' | 'preference';
  token: string;
  start: number;
  end: number;
  message: string;
  languageHint?: string;
  suggestions: Suggestion[];
}
