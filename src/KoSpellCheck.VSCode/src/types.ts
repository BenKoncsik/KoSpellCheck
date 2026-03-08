export type TypoAccelerationMode = 'off' | 'auto' | 'on';

export type AcceleratorAvailabilityStatus =
  | 'Available'
  | 'Unavailable'
  | 'UnavailableMissingRuntime'
  | 'UnavailableUnsupportedPlatform'
  | 'Error';

export type TypoClassificationCategory =
  | 'IdentifierTypo'
  | 'TextTypo'
  | 'NotTypo'
  | 'Uncertain';

export interface TypoClassificationResult {
  isTypo: boolean;
  confidence: number;
  category: TypoClassificationCategory;
  backend: string;
  reason?: string;
}

export interface TypoClassificationRequest {
  token: string;
  suggestions: Suggestion[];
  context: 'identifier' | 'literal';
}

export interface AcceleratorAvailabilityResult {
  status: AcceleratorAvailabilityStatus;
  provider: string;
  detail?: string;
  detectedAtUtc: string;
}

export interface ILocalTypoClassifier {
  classify(request: TypoClassificationRequest): TypoClassificationResult;
}

export interface IAcceleratorAvailabilityService {
  getAvailability(forceRefresh?: boolean): AcceleratorAvailabilityResult;
}

export interface IAcceleratorNotificationService {
  notifyAutoModeDetection(
    mode: TypoAccelerationMode,
    showPrompt: boolean
  ): void;
  notifyOnModeUnavailable(status: AcceleratorAvailabilityStatus): void;
}

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
  localTypoAccelerationMode: TypoAccelerationMode;
  localTypoAccelerationModel: string;
  localTypoAccelerationShowDetectionPrompt: boolean;
  localTypoAccelerationVerboseLogging: boolean;
  localTypoAccelerationAutoDownloadRuntime: boolean;
  projectConventionMappingEnabled: boolean;
  namingConventionDiagnosticsEnabled: boolean;
  statisticalAnomalyDetectionEnabled: boolean;
  aiNamingAnomalyDetectionEnabled: boolean;
  useCoralTpuIfAvailable: boolean;
  autoRebuildConventionProfile: boolean;
  conventionAnalyzeOnSave: boolean;
  conventionAnalyzeOnRename: boolean;
  conventionAnalyzeOnNewFile: boolean;
  conventionScope: 'workspace' | 'solution';
  conventionIgnoreGeneratedCode: boolean;
  conventionIgnoreTestProjects: boolean;
  projectConventionIncludePatterns: string[];
  projectConventionExcludePatterns: string[];
  projectConventionSupportedExtensions: string[];
  projectConventionMaxFiles: number;
  projectConventionMinEvidenceCount: number;
  statisticalAnomalyThreshold: number;
  aiAnomalyThreshold: number;
  projectConventionProfilePath: string;
  projectConventionProfileCachePath: string;
  projectConventionAnomalyModelPath: string;
  projectConventionScanSummaryPath: string;
  projectConventionIgnoreListPath: string;
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
  typoClassification?: TypoClassificationResult;
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
