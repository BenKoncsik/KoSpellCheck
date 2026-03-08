namespace KoSpellCheck.Core.ProjectConventions.Models;

public enum ConventionSeverity
{
    Info,
    Warning,
    Error,
}

public enum ConventionTypeKind
{
    Class,
    Interface,
    Enum,
    Record,
    Struct,
    Type,
    Unknown,
}

public enum ConventionCaseStyle
{
    PascalCase,
    CamelCase,
    SnakeCase,
    KebabCase,
    UpperCase,
    Unknown,
}

public enum ConventionQuickFixKind
{
    RenameFileToPrimaryType,
    RenamePrimaryTypeToFileName,
    RenameSuffix,
    RenameAbbreviation,
    MoveFileToFolder,
    UpdateNamespaceToFolderConvention,
    IgnoreRuleForFile,
    IgnoreRuleForFolder,
    IgnoreRuleForProject,
}

public sealed class TypeSymbolFacts
{
    public string Name { get; set; } = string.Empty;

    public ConventionTypeKind Kind { get; set; } = ConventionTypeKind.Unknown;

    public int Line { get; set; }

    public int Column { get; set; }

    public string? Namespace { get; set; }
}

public sealed class ProjectFileFacts
{
    public string WorkspaceRoot { get; set; } = string.Empty;

    public string AbsolutePath { get; set; } = string.Empty;

    public string RelativePath { get; set; } = string.Empty;

    public string FolderPath { get; set; } = ".";

    public IList<string> FolderSegments { get; set; } = new List<string>();

    public string FileName { get; set; } = string.Empty;

    public string FileStem { get; set; } = string.Empty;

    public string Extension { get; set; } = string.Empty;

    public string? Namespace { get; set; }

    public IList<TypeSymbolFacts> Types { get; set; } = new List<TypeSymbolFacts>();

    public TypeSymbolFacts? PrimaryType { get; set; }

    public bool IsGenerated { get; set; }

    public bool IsTestProjectFile { get; set; }
}

public sealed class FrequencyEntry
{
    public string Value { get; set; } = string.Empty;

    public int Count { get; set; }

    public double Ratio { get; set; }
}

public sealed class FolderConventionProfile
{
    public string FolderPath { get; set; } = ".";

    public int Files { get; set; }

    public int TypeCount { get; set; }

    public IList<FrequencyEntry> DominantSuffixes { get; set; } = new List<FrequencyEntry>();

    public IList<FrequencyEntry> DominantPrefixes { get; set; } = new List<FrequencyEntry>();

    public IList<FrequencyEntry> DominantTypeKinds { get; set; } = new List<FrequencyEntry>();

    public IList<FrequencyEntry> DominantCaseStyles { get; set; } = new List<FrequencyEntry>();

    public IList<FrequencyEntry> NamespaceSamples { get; set; } = new List<FrequencyEntry>();

    public int SingularNames { get; set; }

    public int PluralNames { get; set; }
}

public sealed class InterfaceConventionProfile
{
    public string ExpectedPrefix { get; set; } = "I";

    public int PrefixedCount { get; set; }

    public int TotalCount { get; set; }

    public double Confidence { get; set; }
}

public sealed class EnumConventionProfile
{
    public ConventionCaseStyle DominantCaseStyle { get; set; } = ConventionCaseStyle.Unknown;

    public string? DominantSuffix { get; set; }

    public double Confidence { get; set; }
}

public sealed class NamespaceConventionProfile
{
    public IList<string> RootSegments { get; set; } = new List<string>();

    public IDictionary<string, IList<string>> FolderToNamespace { get; set; } =
        new Dictionary<string, IList<string>>(StringComparer.OrdinalIgnoreCase);

    public double Confidence { get; set; }
}

public sealed class ProjectConventionProfile
{
    public int SchemaVersion { get; set; } = 1;

    public DateTime GeneratedAtUtc { get; set; } = DateTime.UtcNow;

    public string WorkspaceRoot { get; set; } = string.Empty;

    public string Scope { get; set; } = "workspace";

    public int FilesScanned { get; set; }

    public int TypesScanned { get; set; }

    public ConventionCaseStyle DominantCaseStyle { get; set; } = ConventionCaseStyle.Unknown;

    public IList<FrequencyEntry> DominantCaseDistribution { get; set; } = new List<FrequencyEntry>();

    public double FileToPrimaryTypeMatchRate { get; set; }

    public IDictionary<string, FolderConventionProfile> Folders { get; set; } =
        new Dictionary<string, FolderConventionProfile>(StringComparer.OrdinalIgnoreCase);

    public IList<FrequencyEntry> GlobalSuffixes { get; set; } = new List<FrequencyEntry>();

    public IList<FrequencyEntry> GlobalPrefixes { get; set; } = new List<FrequencyEntry>();

    public IDictionary<string, int> TokenFrequencies { get; set; } =
        new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

    public IDictionary<string, int> AbbreviationFrequencies { get; set; } =
        new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

    public IDictionary<string, string> AbbreviationPreferredForms { get; set; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    public InterfaceConventionProfile InterfaceConvention { get; set; } = new();

    public EnumConventionProfile EnumConvention { get; set; } = new();

    public NamespaceConventionProfile NamespaceConvention { get; set; } = new();

    public IList<string> KnownSuffixes { get; set; } = new List<string>();
}

public sealed class ConventionEvidence
{
    public string Metric { get; set; } = string.Empty;

    public string Expected { get; set; } = string.Empty;

    public string Observed { get; set; } = string.Empty;

    public double? Ratio { get; set; }

    public int? SampleSize { get; set; }
}

public sealed class ConventionQuickFix
{
    public ConventionQuickFixKind Kind { get; set; }

    public string Title { get; set; } = string.Empty;

    public string? TargetPath { get; set; }

    public string? Replacement { get; set; }

    public string? RuleId { get; set; }

    public string? ScopeTarget { get; set; }
}

public sealed class ConventionDiagnostic
{
    public string RuleId { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public ConventionSeverity Severity { get; set; } = ConventionSeverity.Info;

    public double Confidence { get; set; }

    public string Message { get; set; } = string.Empty;

    public string Explanation { get; set; } = string.Empty;

    public IList<ConventionEvidence> Evidence { get; set; } = new List<ConventionEvidence>();

    public IList<string> Suggestions { get; set; } = new List<string>();

    public IList<ConventionQuickFix> QuickFixes { get; set; } = new List<ConventionQuickFix>();

    public string FilePath { get; set; } = string.Empty;

    public int Line { get; set; }

    public int Column { get; set; }

    public double? AnomalyScore { get; set; }

    public double? AiScore { get; set; }
}

public sealed class StatisticalAnomalyResult
{
    public double Score { get; set; }

    public IList<ConventionEvidence> Signals { get; set; } = new List<ConventionEvidence>();
}

public sealed class AnomalyFeatureVector
{
    public int DeterministicViolationCount { get; set; }

    public double SuffixMismatchScore { get; set; }

    public double FolderKindMismatchScore { get; set; }

    public double NamespaceMismatchScore { get; set; }

    public double FileTypeMismatchScore { get; set; }

    public double AbbreviationMismatchScore { get; set; }

    public double TokenRarityScore { get; set; }
}

public sealed class AiAnomalyScore
{
    public double Score { get; set; }

    public string Backend { get; set; } = "cpu-logistic";

    public string Detail { get; set; } = string.Empty;
}

public sealed class ConventionFileAnalysisResult
{
    public ProjectFileFacts File { get; set; } = new();

    public IList<ConventionDiagnostic> Diagnostics { get; set; } = new List<ConventionDiagnostic>();

    public StatisticalAnomalyResult? Statistical { get; set; }

    public AiAnomalyScore? Ai { get; set; }
}

public sealed class ConventionIgnoreEntry
{
    public string RuleId { get; set; } = string.Empty;

    public string Scope { get; set; } = "file";

    public string Target { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class ConventionIgnoreList
{
    public int SchemaVersion { get; set; } = 1;

    public IList<ConventionIgnoreEntry> Entries { get; set; } = new List<ConventionIgnoreEntry>();
}

public sealed class ConventionProfileCache
{
    public int SchemaVersion { get; set; } = 1;

    public string Fingerprint { get; set; } = string.Empty;

    public DateTime GeneratedAtUtc { get; set; } = DateTime.UtcNow;

    public int FilesScanned { get; set; }
}

public sealed class ConventionScanSummaryEntry
{
    public string FolderPath { get; set; } = ".";

    public string? DominantSuffix { get; set; }

    public string? DominantKind { get; set; }

    public double Confidence { get; set; }
}

public sealed class ConventionScanSummary
{
    public int SchemaVersion { get; set; } = 1;

    public DateTime GeneratedAtUtc { get; set; } = DateTime.UtcNow;

    public string WorkspaceRoot { get; set; } = string.Empty;

    public string Scope { get; set; } = "workspace";

    public int FilesScanned { get; set; }

    public int FilesSkippedGenerated { get; set; }

    public int FilesSkippedTests { get; set; }

    public int FilesSkippedByPattern { get; set; }

    public int TypesScanned { get; set; }

    public ConventionCaseStyle DominantCaseStyle { get; set; } = ConventionCaseStyle.Unknown;

    public IList<ConventionScanSummaryEntry> DominantFolderConventions { get; set; } = new List<ConventionScanSummaryEntry>();
}

public sealed class LightweightAnomalyModelWeights
{
    public double Bias { get; set; } = -0.35;

    public double DeterministicViolationCount { get; set; } = 0.90;

    public double SuffixMismatchScore { get; set; } = 1.30;

    public double FolderKindMismatchScore { get; set; } = 1.05;

    public double NamespaceMismatchScore { get; set; } = 0.95;

    public double FileTypeMismatchScore { get; set; } = 1.10;

    public double AbbreviationMismatchScore { get; set; } = 0.80;

    public double TokenRarityScore { get; set; } = 0.70;
}

public sealed class LightweightAnomalyModel
{
    public int SchemaVersion { get; set; } = 1;

    public string ModelType { get; set; } = "logistic-regression";

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public LightweightAnomalyModelWeights Weights { get; set; } = new();
}

public sealed class ConventionProfileBuildRequest
{
    public string WorkspaceRoot { get; set; } = string.Empty;

    public string Scope { get; set; } = "workspace";

    public IList<string>? FilePaths { get; set; }

    public Config.ProjectConventionOptions Options { get; set; } = new();

    public bool PersistArtifacts { get; set; } = true;
}

public sealed class ConventionProfileBuildResult
{
    public ProjectConventionProfile Profile { get; set; } = new();

    public ConventionScanSummary Summary { get; set; } = new();

    public LightweightAnomalyModel AnomalyModel { get; set; } = new();

    public ConventionProfileCache Cache { get; set; } = new();

    public string ProfilePath { get; set; } = string.Empty;

    public string SummaryPath { get; set; } = string.Empty;

    public string CachePath { get; set; } = string.Empty;

    public string AnomalyModelPath { get; set; } = string.Empty;
}

public sealed class ConventionAnalysisRequest
{
    public string WorkspaceRoot { get; set; } = string.Empty;

    public string FilePath { get; set; } = string.Empty;

    public string? FileContent { get; set; }

    public Config.ProjectConventionOptions Options { get; set; } = new();

    public ProjectConventionProfile? Profile { get; set; }

    public ConventionIgnoreList? IgnoreList { get; set; }

    public CoralRuntimeContext? CoralRuntime { get; set; }
}

public sealed class ConventionAnalysisResult
{
    public ConventionFileAnalysisResult Analysis { get; set; } = new();

    public ProjectConventionProfile? Profile { get; set; }

    public ConventionIgnoreList IgnoreList { get; set; } = new();
}

public sealed class CoralRuntimeContext
{
    public bool Available { get; set; }

    public string? AdapterPath { get; set; }

    public string? RuntimeRoot { get; set; }

    public string Detail { get; set; } = string.Empty;
}
