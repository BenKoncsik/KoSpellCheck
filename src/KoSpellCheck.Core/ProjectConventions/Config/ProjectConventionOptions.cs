namespace KoSpellCheck.Core.ProjectConventions.Config;

public sealed class ProjectConventionOptions
{
    public bool EnableProjectConventionMapping { get; set; } = true;

    public bool EnableNamingConventionDiagnostics { get; set; } = true;

    public bool EnableStatisticalAnomalyDetection { get; set; } = true;

    public bool EnableAiNamingAnomalyDetection { get; set; } = false;

    public bool UseCoralTpuIfAvailable { get; set; } = false;

    public bool AutoRebuildConventionProfile { get; set; } = true;

    public bool AnalyzeOnSave { get; set; } = true;

    public bool AnalyzeOnRename { get; set; } = true;

    public bool AnalyzeOnNewFile { get; set; } = true;

    public string Scope { get; set; } = "workspace";

    public bool IgnoreGeneratedCode { get; set; } = true;

    public bool IgnoreTestProjects { get; set; } = false;

    public IList<string> IncludePatterns { get; set; } = new List<string>();

    public IList<string> ExcludePatterns { get; set; } = new List<string>
    {
        "**/bin/**",
        "**/obj/**",
        "**/node_modules/**",
        "**/.git/**",
        "**/.vs/**",
        "**/artifacts/**"
    };

    public IList<string> SupportedExtensions { get; set; } = new List<string> { "cs", "ts", "tsx", "js", "jsx" };

    public int MaxFiles { get; set; } = 6000;

    public int MinEvidenceCount { get; set; } = 6;

    public double StatisticalAnomalyThreshold { get; set; } = 0.62;

    public double AiAnomalyThreshold { get; set; } = 0.70;

    public string ConventionProfilePath { get; set; } = ".kospellcheck/project-conventions.json";

    public string ConventionProfileCachePath { get; set; } = ".kospellcheck/project-profile-cache.json";

    public string ConventionAnomalyModelPath { get; set; } = ".kospellcheck/project-anomaly-model.json";

    public string ConventionScanSummaryPath { get; set; } = ".kospellcheck/project-scan-summary.json";

    public string ConventionIgnoreListPath { get; set; } = ".kospellcheck/convention-ignores.json";

    public ProjectConventionOptions Clone()
    {
        return new ProjectConventionOptions
        {
            EnableProjectConventionMapping = EnableProjectConventionMapping,
            EnableNamingConventionDiagnostics = EnableNamingConventionDiagnostics,
            EnableStatisticalAnomalyDetection = EnableStatisticalAnomalyDetection,
            EnableAiNamingAnomalyDetection = EnableAiNamingAnomalyDetection,
            UseCoralTpuIfAvailable = UseCoralTpuIfAvailable,
            AutoRebuildConventionProfile = AutoRebuildConventionProfile,
            AnalyzeOnSave = AnalyzeOnSave,
            AnalyzeOnRename = AnalyzeOnRename,
            AnalyzeOnNewFile = AnalyzeOnNewFile,
            Scope = Scope,
            IgnoreGeneratedCode = IgnoreGeneratedCode,
            IgnoreTestProjects = IgnoreTestProjects,
            IncludePatterns = IncludePatterns.ToList(),
            ExcludePatterns = ExcludePatterns.ToList(),
            SupportedExtensions = SupportedExtensions.ToList(),
            MaxFiles = MaxFiles,
            MinEvidenceCount = MinEvidenceCount,
            StatisticalAnomalyThreshold = StatisticalAnomalyThreshold,
            AiAnomalyThreshold = AiAnomalyThreshold,
            ConventionProfilePath = ConventionProfilePath,
            ConventionProfileCachePath = ConventionProfileCachePath,
            ConventionAnomalyModelPath = ConventionAnomalyModelPath,
            ConventionScanSummaryPath = ConventionScanSummaryPath,
            ConventionIgnoreListPath = ConventionIgnoreListPath,
        };
    }
}
