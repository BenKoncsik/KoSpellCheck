using KoSpellCheck.Core.ProjectConventions.Abstractions;
using KoSpellCheck.Core.ProjectConventions.AI;
using KoSpellCheck.Core.ProjectConventions.Anomaly;
using KoSpellCheck.Core.ProjectConventions.Config;
using KoSpellCheck.Core.ProjectConventions.Models;
using KoSpellCheck.Core.ProjectConventions.Persistence;
using KoSpellCheck.Core.ProjectConventions.Profiling;
using KoSpellCheck.Core.ProjectConventions.Rules;
using KoSpellCheck.Core.ProjectConventions.Scanning;
using KoSpellCheck.Core.ProjectConventions.Utils;
using Newtonsoft.Json;

namespace KoSpellCheck.Core.ProjectConventions.Services;

public sealed class ProjectConventionService : IProjectConventionProfiler, IProjectConventionAnalyzer
{
    private readonly IWorkspaceFileProvider _workspaceFileProvider;
    private readonly ITextFileReader _textFileReader;
    private readonly ProjectConventionSymbolExtractor _symbolExtractor;
    private readonly DotNetTypeUsageAnalyzer _dotNetTypeUsageAnalyzer;
    private readonly ConventionProfiler _profiler;
    private readonly ConventionRuleEngine _ruleEngine;
    private readonly IAnomalyScorer _anomalyScorer;
    private readonly IAiConventionScorer _aiConventionScorer;
    private readonly IConventionProfileStore _profileStore;

    public ProjectConventionService(
        IWorkspaceFileProvider? workspaceFileProvider = null,
        ITextFileReader? textFileReader = null,
        ProjectConventionSymbolExtractor? symbolExtractor = null,
        DotNetTypeUsageAnalyzer? dotNetTypeUsageAnalyzer = null,
        ConventionProfiler? profiler = null,
        ConventionRuleEngine? ruleEngine = null,
        IAnomalyScorer? anomalyScorer = null,
        IAiConventionScorer? aiConventionScorer = null,
        IConventionProfileStore? profileStore = null)
    {
        _workspaceFileProvider = workspaceFileProvider ?? new FileSystemWorkspaceFileProvider();
        _textFileReader = textFileReader ?? new FileSystemTextFileReader();
        _symbolExtractor = symbolExtractor ?? new ProjectConventionSymbolExtractor();
        _dotNetTypeUsageAnalyzer = dotNetTypeUsageAnalyzer ?? new DotNetTypeUsageAnalyzer(_workspaceFileProvider, _textFileReader, _symbolExtractor);
        _profiler = profiler ?? new ConventionProfiler();
        _ruleEngine = ruleEngine ?? new ConventionRuleEngine();
        _anomalyScorer = anomalyScorer ?? new StatisticalAnomalyScorer();
        _aiConventionScorer = aiConventionScorer ?? new LogisticAiConventionScorer();
        _profileStore = profileStore ?? new JsonConventionProfileStore();
    }

    public ConventionProfileBuildResult BuildProfile(ConventionProfileBuildRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.WorkspaceRoot))
        {
            throw new ArgumentException("WorkspaceRoot is required.", nameof(request));
        }

        var options = request.Options?.Clone() ?? new ProjectConventionOptions();
        var filePaths = ((request.FilePaths is { Count: > 0 }
                ? request.FilePaths.AsEnumerable()
                : _workspaceFileProvider.EnumerateFiles(request.WorkspaceRoot, options).AsEnumerable()))
            .Take(Math.Max(1, options.MaxFiles))
            .ToList();

        var extracted = ExtractFacts(request.WorkspaceRoot, filePaths, options);
        var (profile, summary, anomalyModel) = _profiler.BuildProfile(
            request.WorkspaceRoot,
            extracted.Files.ToList(),
            string.IsNullOrWhiteSpace(request.Scope) ? "workspace" : request.Scope,
            Math.Max(1, options.MinEvidenceCount));

        summary.FilesSkippedGenerated = extracted.SkippedGenerated;
        summary.FilesSkippedTests = extracted.SkippedTests;
        summary.FilesSkippedByPattern = extracted.SkippedByPattern;

        var cache = new ConventionProfileCache
        {
            SchemaVersion = 1,
            GeneratedAtUtc = DateTime.UtcNow,
            FilesScanned = extracted.Files.Count,
            Fingerprint = JsonConventionProfileStore.BuildFingerprint(filePaths),
        };

        var profilePath = JsonConventionProfileStore.ResolveArtifactPath(
            request.WorkspaceRoot,
            options.ConventionProfilePath,
            options.WorkspaceStoragePath);
        var summaryPath = JsonConventionProfileStore.ResolveArtifactPath(
            request.WorkspaceRoot,
            options.ConventionScanSummaryPath,
            options.WorkspaceStoragePath);
        var cachePath = JsonConventionProfileStore.ResolveArtifactPath(
            request.WorkspaceRoot,
            options.ConventionProfileCachePath,
            options.WorkspaceStoragePath);
        var anomalyModelPath = JsonConventionProfileStore.ResolveArtifactPath(
            request.WorkspaceRoot,
            options.ConventionAnomalyModelPath,
            options.WorkspaceStoragePath);

        if (request.PersistArtifacts)
        {
            _profileStore.SaveArtifacts(
                request.WorkspaceRoot,
                options.WorkspaceStoragePath,
                options.ConventionProfilePath,
                profile,
                options.ConventionScanSummaryPath,
                summary,
                options.ConventionProfileCachePath,
                cache,
                options.ConventionAnomalyModelPath,
                anomalyModel);
        }

        return new ConventionProfileBuildResult
        {
            Profile = profile,
            Summary = summary,
            AnomalyModel = anomalyModel,
            Cache = cache,
            ProfilePath = profilePath,
            SummaryPath = summaryPath,
            CachePath = cachePath,
            AnomalyModelPath = anomalyModelPath,
        };
    }

    public ConventionAnalysisResult Analyze(ConventionAnalysisRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.WorkspaceRoot))
        {
            throw new ArgumentException("WorkspaceRoot is required.", nameof(request));
        }

        if (string.IsNullOrWhiteSpace(request.FilePath))
        {
            throw new ArgumentException("FilePath is required.", nameof(request));
        }

        var options = request.Options?.Clone() ?? new ProjectConventionOptions();
        var profile = request.Profile ?? _profileStore.LoadProfile(
            request.WorkspaceRoot,
            options.ConventionProfilePath,
            options.WorkspaceStoragePath);
        if (profile == null)
        {
            var build = BuildProfile(new ConventionProfileBuildRequest
            {
                WorkspaceRoot = request.WorkspaceRoot,
                Scope = options.Scope,
                Options = options,
                PersistArtifacts = true,
            });
            profile = build.Profile;
        }

        var ignoreList = request.IgnoreList ?? _profileStore.LoadIgnoreList(
            request.WorkspaceRoot,
            options.ConventionIgnoreListPath,
            options.WorkspaceStoragePath);

        var fullPath = Path.IsPathRooted(request.FilePath)
            ? request.FilePath
            : Path.Combine(request.WorkspaceRoot, request.FilePath);

        var content = request.FileContent;
        if (content == null && !_textFileReader.TryRead(fullPath, out content))
        {
            return new ConventionAnalysisResult
            {
                Profile = profile,
                IgnoreList = ignoreList,
                Analysis = new ConventionFileAnalysisResult
                {
                    File = new ProjectFileFacts
                    {
                        WorkspaceRoot = request.WorkspaceRoot,
                        AbsolutePath = fullPath,
                        RelativePath = ConventionPathUtils.NormalizeRelativePath(request.WorkspaceRoot, fullPath),
                        FileName = Path.GetFileName(fullPath),
                        FileStem = Path.GetFileNameWithoutExtension(fullPath),
                    },
                    Diagnostics = new List<ConventionDiagnostic>(),
                },
            };
        }

        var fileFacts = _symbolExtractor.Extract(request.WorkspaceRoot, fullPath, content!);
        if (!ShouldIncludeForAnalysis(fileFacts, options))
        {
            return new ConventionAnalysisResult
            {
                Profile = profile,
                IgnoreList = ignoreList,
                Analysis = new ConventionFileAnalysisResult
                {
                    File = fileFacts,
                    Diagnostics = new List<ConventionDiagnostic>(),
                },
            };
        }

        var typeUsage = BuildTypeUsageFacts(request.WorkspaceRoot, fullPath, content!, fileFacts, options);

        var diagnostics = _ruleEngine.Evaluate(fileFacts, profile, Math.Max(1, options.MinEvidenceCount), typeUsage)
            .Where(diag => !JsonConventionProfileStore.IsIgnored(ignoreList, diag.RuleId, fileFacts.RelativePath, fileFacts.FolderPath))
            .ToList();

        var deterministicCount = diagnostics.Count;
        var (statisticalResult, vector) = _anomalyScorer.Score(fileFacts, profile, deterministicCount);

        if (options.EnableStatisticalAnomalyDetection)
        {
            diagnostics = diagnostics
                .Select(diag =>
                {
                    diag.Confidence = Clamp01(diag.Confidence * 0.75 + statisticalResult.Score * 0.25);
                    diag.AnomalyScore = statisticalResult.Score;
                    foreach (var signal in statisticalResult.Signals.Take(2))
                    {
                        diag.Evidence.Add(signal);
                    }

                    return diag;
                })
                .ToList();

            if (diagnostics.Count > 0 && statisticalResult.Score >= options.StatisticalAnomalyThreshold)
            {
                diagnostics.Add(CreateStatisticalSupportDiagnostic(fileFacts, statisticalResult));
            }
        }

        AiAnomalyScore? aiScore = null;
        if (options.EnableAiNamingAnomalyDetection)
        {
            var model = LoadAnomalyModel(
                request.WorkspaceRoot,
                options.ConventionAnomalyModelPath,
                options.WorkspaceStoragePath);
            aiScore = _aiConventionScorer.Score(vector, model, request.CoralRuntime, options.UseCoralTpuIfAvailable);
            if (aiScore != null && aiScore.Score >= options.AiAnomalyThreshold)
            {
                diagnostics = diagnostics
                    .Select(diag =>
                    {
                        diag.Confidence = Clamp01(diag.Confidence * 0.80 + aiScore.Score * 0.20);
                        diag.AiScore = aiScore.Score;
                        diag.Evidence.Add(new ConventionEvidence
                        {
                            Metric = "local AI anomaly score",
                            Expected = "low anomaly score",
                            Observed = aiScore.Score.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture),
                            Ratio = aiScore.Score,
                        });
                        return diag;
                    })
                    .ToList();

                if (diagnostics.Count > 0)
                {
                    diagnostics.Add(CreateAiSupportDiagnostic(fileFacts, aiScore));
                }
            }
        }

        return new ConventionAnalysisResult
        {
            Profile = profile,
            IgnoreList = ignoreList,
            Analysis = new ConventionFileAnalysisResult
            {
                File = fileFacts,
                Diagnostics = diagnostics,
                TypeUsages = typeUsage.ToList(),
                Statistical = options.EnableStatisticalAnomalyDetection ? statisticalResult : null,
                Ai = aiScore,
            },
        };
    }

    public void IgnoreDiagnostic(
        string workspaceRoot,
        ProjectConventionOptions options,
        string ruleId,
        string scope,
        string target)
    {
        _profileStore.AppendIgnoreEntry(workspaceRoot, options.ConventionIgnoreListPath, new ConventionIgnoreEntry
        {
            RuleId = ruleId,
            Scope = scope,
            Target = target,
            CreatedAtUtc = DateTime.UtcNow,
        }, options.WorkspaceStoragePath);
    }

    private static LightweightAnomalyModel LoadAnomalyModel(
        string workspaceRoot,
        string configuredPath,
        string? workspaceStoragePath)
    {
        var path = JsonConventionProfileStore.ResolveArtifactPath(workspaceRoot, configuredPath, workspaceStoragePath);
        try
        {
            if (!File.Exists(path))
            {
                return new LightweightAnomalyModel();
            }

            var raw = File.ReadAllText(path);
            var parsed = JsonConvert.DeserializeObject<LightweightAnomalyModel>(raw);
            if (parsed == null || !string.Equals(parsed.ModelType, "logistic-regression", StringComparison.OrdinalIgnoreCase))
            {
                return new LightweightAnomalyModel();
            }

            return parsed;
        }
        catch
        {
            return new LightweightAnomalyModel();
        }
    }

    private static ConventionDiagnostic CreateStatisticalSupportDiagnostic(
        ProjectFileFacts file,
        StatisticalAnomalyResult statistical)
    {
        return new ConventionDiagnostic
        {
            RuleId = "KS_CONV_STAT_001",
            Title = "Statistical naming anomaly signal",
            Severity = statistical.Score >= 0.80 ? ConventionSeverity.Warning : ConventionSeverity.Info,
            Confidence = Clamp01(statistical.Score),
            Message = $"This file has a high statistical naming anomaly score ({statistical.Score:0.00}) compared to learned project patterns.",
            Explanation = "The statistical layer ranked this file as unusual using folder-suffix, namespace-path, and token frequency associations.",
            Evidence = statistical.Signals.ToList(),
            Suggestions = new List<string>
            {
                "Review naming and location for consistency with existing project conventions",
            },
            QuickFixes = new List<ConventionQuickFix>
            {
                new()
                {
                    Kind = ConventionQuickFixKind.IgnoreRuleForFile,
                    RuleId = "KS_CONV_STAT_001",
                    ScopeTarget = file.RelativePath,
                    Title = "Ignore statistical anomaly for this file",
                },
            },
            FilePath = file.RelativePath,
            Line = file.PrimaryType?.Line ?? 0,
            Column = file.PrimaryType?.Column ?? 0,
            AnomalyScore = statistical.Score,
        };
    }

    private IReadOnlyList<TypeUsageFacts> BuildTypeUsageFacts(
        string workspaceRoot,
        string fullPath,
        string fileContent,
        ProjectFileFacts fileFacts,
        ProjectConventionOptions options)
    {
        if (!string.Equals(fileFacts.Extension, "cs", StringComparison.OrdinalIgnoreCase))
        {
            return Array.Empty<TypeUsageFacts>();
        }

        if (fileFacts.Types.All(symbol => symbol.Kind is not ConventionTypeKind.Class and not ConventionTypeKind.Interface))
        {
            return Array.Empty<TypeUsageFacts>();
        }

        return _dotNetTypeUsageAnalyzer.Analyze(workspaceRoot, fullPath, fileContent, options);
    }

    private static ConventionDiagnostic CreateAiSupportDiagnostic(ProjectFileFacts file, AiAnomalyScore ai)
    {
        return new ConventionDiagnostic
        {
            RuleId = "KS_CONV_AI_001",
            Title = "Local AI naming anomaly signal",
            Severity = ai.Score >= 0.85 ? ConventionSeverity.Warning : ConventionSeverity.Info,
            Confidence = Clamp01(ai.Score),
            Message = $"Local AI anomaly score is {ai.Score:0.00} ({ai.Backend}).",
            Explanation = "A lightweight local model marked this naming pattern as an outlier. This signal is advisory and complements deterministic rules.",
            Evidence = new List<ConventionEvidence>
            {
                new()
                {
                    Metric = "local AI backend",
                    Expected = "cpu-logistic or coral-adapter",
                    Observed = ai.Backend,
                    Ratio = ai.Score,
                },
            },
            Suggestions = new List<string>
            {
                "Review deterministic diagnostics and apply conventions where appropriate",
            },
            QuickFixes = new List<ConventionQuickFix>
            {
                new()
                {
                    Kind = ConventionQuickFixKind.IgnoreRuleForFile,
                    RuleId = "KS_CONV_AI_001",
                    ScopeTarget = file.RelativePath,
                    Title = "Ignore AI anomaly for this file",
                },
            },
            FilePath = file.RelativePath,
            Line = file.PrimaryType?.Line ?? 0,
            Column = file.PrimaryType?.Column ?? 0,
            AiScore = ai.Score,
        };
    }

    private ExtractResult ExtractFacts(
        string workspaceRoot,
        IReadOnlyList<string> filePaths,
        ProjectConventionOptions options)
    {
        var output = new List<ProjectFileFacts>();
        var skippedGenerated = 0;
        var skippedTests = 0;
        var skippedByPattern = 0;

        foreach (var filePath in filePaths)
        {
            if (!_textFileReader.TryRead(filePath, out var content))
            {
                continue;
            }

            var facts = _symbolExtractor.Extract(workspaceRoot, filePath, content);
            if (!ShouldIncludeRelativePath(facts.RelativePath, options.IncludePatterns, options.ExcludePatterns))
            {
                skippedByPattern++;
                continue;
            }

            if (options.IgnoreGeneratedCode && facts.IsGenerated)
            {
                skippedGenerated++;
                continue;
            }

            if (options.IgnoreTestProjects && facts.IsTestProjectFile)
            {
                skippedTests++;
                continue;
            }

            output.Add(facts);
        }

        return new ExtractResult
        {
            Files = output,
            SkippedGenerated = skippedGenerated,
            SkippedTests = skippedTests,
            SkippedByPattern = skippedByPattern,
        };
    }

    private static bool ShouldIncludeForAnalysis(ProjectFileFacts file, ProjectConventionOptions options)
    {
        if (options.IgnoreGeneratedCode && file.IsGenerated)
        {
            return false;
        }

        if (options.IgnoreTestProjects && file.IsTestProjectFile)
        {
            return false;
        }

        if (!ShouldIncludeRelativePath(file.RelativePath, options.IncludePatterns, options.ExcludePatterns))
        {
            return false;
        }

        var normalizedSupported = new HashSet<string>(
            options.SupportedExtensions.Select(ext => ext.Trim().TrimStart('.').ToLowerInvariant()),
            StringComparer.OrdinalIgnoreCase);

        return normalizedSupported.Count == 0 || normalizedSupported.Contains(file.Extension.ToLowerInvariant());
    }

    private static bool ShouldIncludeRelativePath(string relativePath, IEnumerable<string> includePatterns, IEnumerable<string> excludePatterns)
    {
        var normalized = relativePath.Replace('\\', '/');
        if (excludePatterns.Any(pattern => GlobMatch(normalized, pattern)))
        {
            return false;
        }

        var includes = includePatterns.Where(pattern => !string.IsNullOrWhiteSpace(pattern)).ToList();
        if (includes.Count == 0)
        {
            return true;
        }

        return includes.Any(pattern => GlobMatch(normalized, pattern));
    }

    private static bool GlobMatch(string value, string pattern)
    {
        if (string.IsNullOrWhiteSpace(pattern) || string.Equals(pattern, "**/*", StringComparison.Ordinal))
        {
            return true;
        }

        var normalizedPattern = pattern.Replace('\\', '/');
        var escaped = System.Text.RegularExpressions.Regex.Escape(normalizedPattern)
            .Replace("\\*\\*", "::DOUBLE_STAR::")
            .Replace("\\*", "[^/]*")
            .Replace("::DOUBLE_STAR::", ".*")
            .Replace("\\?", ".");

        var regex = new System.Text.RegularExpressions.Regex($"^{escaped}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);
        return regex.IsMatch(value.Replace('\\', '/'));
    }

    private static double Clamp01(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return 0;
        }

        if (value <= 0)
        {
            return 0;
        }

        if (value >= 1)
        {
            return 1;
        }

        return value;
    }

    private sealed class ExtractResult
    {
        public IList<ProjectFileFacts> Files { get; set; } = new List<ProjectFileFacts>();

        public int SkippedGenerated { get; set; }

        public int SkippedTests { get; set; }

        public int SkippedByPattern { get; set; }
    }
}
