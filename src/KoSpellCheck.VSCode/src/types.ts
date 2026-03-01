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
  styleLearningEnabled: boolean;
  styleLearningMaxFiles: number;
  styleLearningMaxTokens: number;
  styleLearningTimeBudgetMs: number;
  styleLearningFileExtensions: string[];
  styleLearningCachePath: string;
  styleLearningMinTokenLength: number;
  styleLearningIgnoreFolders: string[];
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

export interface TokenStyleStats {
  totalCount: number;
  variants: Record<string, number>;
  preferredVariant: string;
  confidence: number;
}

export interface ProjectStyleProfile {
  workspaceRoot: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  tokenStats: Record<string, TokenStyleStats>;
}
