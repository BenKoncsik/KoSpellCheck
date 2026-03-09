using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.ProjectConventions.Config;
using KoSpellCheck.Core.ProjectConventions.Models;
using KoSpellCheck.Core.ProjectConventions.Persistence;
using KoSpellCheck.Core.ProjectConventions.Scanning;
using KoSpellCheck.Core.ProjectConventions.Services;
using KoSpellCheck.Core.ProjectConventions.Utils;
using Microsoft.VisualStudio.Text;

namespace KoSpellCheck.VS2022.Services.ProjectConventions;

internal sealed class ProjectConventionDashboardService
{
    private sealed class WorkspaceState
    {
        public ProjectConventionProfile? Profile { get; set; }

        public ConventionIgnoreList IgnoreList { get; set; } = new();

        public LightweightAnomalyModel? AnomalyModel { get; set; }

        public ConventionScanSummary? Summary { get; set; }

        public readonly Dictionary<string, List<ConventionDashboardDiagnosticItem>> DiagnosticsByFile =
            new(StringComparer.OrdinalIgnoreCase);

        public readonly Dictionary<string, string[]> FolderExamples =
            new(StringComparer.OrdinalIgnoreCase);

        public bool IsRefreshing { get; set; }

        public bool IsRebuilding { get; set; }

        public string? LastError { get; set; }
    }

    private readonly object _gate = new();
    private readonly Dictionary<string, WorkspaceState> _workspaces =
        new(StringComparer.OrdinalIgnoreCase);
    private readonly ProjectConventionService _service;
    private readonly FileSystemWorkspaceFileProvider _workspaceFileProvider;
    private readonly FileSystemTextFileReader _textFileReader;
    private readonly ConventionDashboardLogService _logs;
    private readonly TelemetryLogger _telemetry;

    public ProjectConventionDashboardService(TelemetryLogger telemetry)
    {
        _telemetry = telemetry;
        _service = new ProjectConventionService();
        _workspaceFileProvider = new FileSystemWorkspaceFileProvider();
        _textFileReader = new FileSystemTextFileReader();
        _logs = new ConventionDashboardLogService();
    }

    public event EventHandler? StateChanged;

    public IReadOnlyList<ConventionDashboardLogEntry> GetLogs()
    {
        return _logs.Snapshot();
    }

    public void ClearLogs()
    {
        _logs.Clear();
        RaiseStateChanged();
    }

    public async Task UpdateFromDocumentAsync(SpellSettings settings, ITextSnapshot snapshot, CancellationToken cancellationToken)
    {
        if (settings == null)
        {
            return;
        }

        if (!settings.Config.ProjectConventions.EnableProjectConventionMapping ||
            !settings.Config.ProjectConventions.EnableNamingConventionDiagnostics)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(settings.FilePath))
        {
            return;
        }

        try
        {
            await EnsureProfileAsync(settings.WorkspaceRoot, settings.Config.ProjectConventions, cancellationToken).ConfigureAwait(false);

            var analysis = _service.Analyze(new ConventionAnalysisRequest
            {
                WorkspaceRoot = settings.WorkspaceRoot,
                FilePath = settings.FilePath!,
                FileContent = snapshot.GetText(),
                Options = settings.Config.ProjectConventions.Clone(),
            });

            UpdateAnalysisState(settings.WorkspaceRoot, analysis);
            _logs.Info($"convention analyze: {analysis.Analysis.File.RelativePath} diagnostics={analysis.Analysis.Diagnostics.Count}");
            RaiseStateChanged();
        }
        catch (OperationCanceledException)
        {
            // Ignore.
        }
        catch (Exception ex)
        {
            _telemetry.Error("Convention dashboard document analysis failed", ex);
            _logs.Error($"convention analyze failed: {ex.Message}");
            SetWorkspaceError(settings.WorkspaceRoot, ex.Message);
            RaiseStateChanged();
        }
    }

    public async Task RefreshWorkspaceAsync(string workspaceRoot, string? activeFilePath, bool deepScan, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(workspaceRoot))
        {
            return;
        }

        var config = ConfigLoader.Load(workspaceRoot);
        var options = config.ProjectConventions.Clone();
        var state = GetOrCreateState(workspaceRoot);

        lock (_gate)
        {
            state.IsRefreshing = true;
            state.LastError = null;
        }

        _logs.Info($"dashboard refresh started workspace={workspaceRoot} deepScan={deepScan}");
        RaiseStateChanged();

        try
        {
            await EnsureProfileAsync(workspaceRoot, options, cancellationToken).ConfigureAwait(false);

            if (!string.IsNullOrWhiteSpace(activeFilePath) && File.Exists(activeFilePath))
            {
                if (_textFileReader.TryRead(activeFilePath!, out var content))
                {
                    var analysis = _service.Analyze(new ConventionAnalysisRequest
                    {
                        WorkspaceRoot = workspaceRoot,
                        FilePath = activeFilePath!,
                        FileContent = content,
                        Options = options,
                    });

                    UpdateAnalysisState(workspaceRoot, analysis);
                }
            }

            if (deepScan)
            {
                await DeepScanWorkspaceAsync(workspaceRoot, options, cancellationToken).ConfigureAwait(false);
            }

            _logs.Info($"dashboard refresh completed workspace={workspaceRoot}");
        }
        catch (OperationCanceledException)
        {
            // Ignore cancellations.
        }
        catch (Exception ex)
        {
            _telemetry.Error("Convention dashboard refresh failed", ex);
            _logs.Error($"dashboard refresh failed: {ex.Message}");
            SetWorkspaceError(workspaceRoot, ex.Message);
        }
        finally
        {
            lock (_gate)
            {
                state.IsRefreshing = false;
            }

            RaiseStateChanged();
        }
    }

    public async Task RebuildWorkspaceAsync(string workspaceRoot, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(workspaceRoot))
        {
            return;
        }

        var config = ConfigLoader.Load(workspaceRoot);
        var options = config.ProjectConventions.Clone();
        var state = GetOrCreateState(workspaceRoot);
        lock (_gate)
        {
            state.IsRebuilding = true;
            state.LastError = null;
        }

        _logs.Info($"profile rebuild started workspace={workspaceRoot}");
        RaiseStateChanged();

        try
        {
            var build = await Task.Run(() => _service.BuildProfile(new ConventionProfileBuildRequest
            {
                WorkspaceRoot = workspaceRoot,
                Scope = options.Scope,
                Options = options,
                PersistArtifacts = true,
            }), cancellationToken).ConfigureAwait(false);

            lock (_gate)
            {
                state.Profile = build.Profile;
                state.Summary = build.Summary;
                state.AnomalyModel = build.AnomalyModel;
                state.IgnoreList = _service.Analyze(new ConventionAnalysisRequest
                {
                    WorkspaceRoot = workspaceRoot,
                    FilePath = build.ProfilePath,
                    Options = options,
                }).IgnoreList;
                state.DiagnosticsByFile.Clear();
                state.FolderExamples.Clear();
            }

            _logs.Info($"profile rebuild completed workspace={workspaceRoot} files={build.Summary.FilesScanned}");
        }
        catch (OperationCanceledException)
        {
            // Ignore cancellations.
        }
        catch (Exception ex)
        {
            _telemetry.Error("Convention profile rebuild failed", ex);
            _logs.Error($"profile rebuild failed: {ex.Message}");
            SetWorkspaceError(workspaceRoot, ex.Message);
        }
        finally
        {
            lock (_gate)
            {
                state.IsRebuilding = false;
            }

            RaiseStateChanged();
        }
    }

    public ConventionDashboardSnapshot GetSnapshot(string workspaceRoot)
    {
        if (string.IsNullOrWhiteSpace(workspaceRoot))
        {
            return new ConventionDashboardSnapshot
            {
                LastError = "No workspace is currently available.",
                Logs = _logs.Snapshot(),
            };
        }

        var config = ConfigLoader.Load(workspaceRoot);
        var options = config.ProjectConventions.Clone();
        var profilePath = JsonConventionProfileStore.ResolveArtifactPath(workspaceRoot, options.ConventionProfilePath);
        var summaryPath = JsonConventionProfileStore.ResolveArtifactPath(workspaceRoot, options.ConventionScanSummaryPath);

        WorkspaceState state;
        lock (_gate)
        {
            state = GetOrCreateState(workspaceRoot);
        }

        var profile = state.Profile;
        if (profile == null && File.Exists(profilePath))
        {
            try
            {
                var json = File.ReadAllText(profilePath);
                profile = Newtonsoft.Json.JsonConvert.DeserializeObject<ProjectConventionProfile>(json);
            }
            catch
            {
                // ignore invalid artifact
            }
        }

        var summary = state.Summary;
        if (summary == null && File.Exists(summaryPath))
        {
            try
            {
                var json = File.ReadAllText(summaryPath);
                summary = Newtonsoft.Json.JsonConvert.DeserializeObject<ConventionScanSummary>(json);
            }
            catch
            {
                // ignore invalid artifact
            }
        }

        var diagnostics = state.DiagnosticsByFile.Values.SelectMany(item => item).ToList();
        var mapItems = BuildMapItems(profile, state.FolderExamples);
        var settings = BuildSettingItems(options);
        var coralActive = options.EnableAiNamingAnomalyDetection && options.UseCoralTpuIfAvailable && false;
        var coralStatus = options.UseCoralTpuIfAvailable
            ? "requested (CPU fallback active in VS2022 host)"
            : "disabled";

        return new ConventionDashboardSnapshot
        {
            WorkspaceRoot = workspaceRoot,
            Scope = options.Scope,
            FeatureEnabled = options.EnableProjectConventionMapping,
            AiEnabled = options.EnableAiNamingAnomalyDetection,
            CoralEnabled = options.UseCoralTpuIfAvailable,
            CoralActive = coralActive,
            CoralStatus = coralStatus,
            FilesScanned = profile?.FilesScanned ?? summary?.FilesScanned ?? 0,
            TypesScanned = profile?.TypesScanned ?? summary?.TypesScanned ?? 0,
            DominantCaseStyle = profile?.DominantCaseStyle.ToString() ?? summary?.DominantCaseStyle.ToString() ?? "Unknown",
            ProfileUpdatedUtc = profile?.GeneratedAtUtc ?? summary?.GeneratedAtUtc,
            DiagnosticCount = diagnostics.Count,
            IsRefreshing = state.IsRefreshing,
            IsRebuilding = state.IsRebuilding,
            ProfilePath = profilePath,
            SummaryPath = summaryPath,
            LastError = state.LastError,
            Settings = settings,
            ConventionMap = mapItems,
            Diagnostics = diagnostics
                .OrderByDescending(item => SeverityRank(item.Severity))
                .ThenByDescending(item => item.Confidence)
                .Take(250)
                .ToList(),
            Logs = _logs.Snapshot(),
        };
    }

    private async Task EnsureProfileAsync(string workspaceRoot, ProjectConventionOptions options, CancellationToken cancellationToken)
    {
        var state = GetOrCreateState(workspaceRoot);
        lock (_gate)
        {
            if (state.Profile != null)
            {
                return;
            }
        }

        await RebuildWorkspaceAsync(workspaceRoot, cancellationToken).ConfigureAwait(false);
    }

    private Task DeepScanWorkspaceAsync(string workspaceRoot, ProjectConventionOptions options, CancellationToken cancellationToken)
    {
        var state = GetOrCreateState(workspaceRoot);
        var filePaths = _workspaceFileProvider
            .EnumerateFiles(workspaceRoot, options)
            .Take(Math.Min(Math.Max(50, options.MaxFiles), 220))
            .ToList();

        var diagnosticsByFile = new Dictionary<string, List<ConventionDashboardDiagnosticItem>>(StringComparer.OrdinalIgnoreCase);
        var folderExamples = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);

        foreach (var filePath in filePaths)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (!_textFileReader.TryRead(filePath, out var content))
            {
                continue;
            }

            var analysis = _service.Analyze(new ConventionAnalysisRequest
            {
                WorkspaceRoot = workspaceRoot,
                FilePath = filePath,
                FileContent = content,
                Options = options,
                Profile = state.Profile,
                IgnoreList = state.IgnoreList,
            });

            UpdateAnalysisState(workspaceRoot, analysis, raiseEvent: false);

            if (analysis.Analysis.Diagnostics.Count > 0)
            {
                diagnosticsByFile[analysis.Analysis.File.RelativePath] = analysis.Analysis.Diagnostics
                    .Select(diag => ToDiagnosticItem(analysis.Analysis.File, diag))
                    .ToList();
            }

            var folderKey = ConventionNamingUtils.NormalizeFolderKey(analysis.Analysis.File.FolderPath);
            if (!folderExamples.TryGetValue(folderKey, out var exampleSet))
            {
                exampleSet = new HashSet<string>(StringComparer.Ordinal);
                folderExamples[folderKey] = exampleSet;
            }

            if (analysis.Analysis.File.PrimaryType != null)
            {
                exampleSet.Add(analysis.Analysis.File.PrimaryType.Name);
            }
            else if (!string.IsNullOrWhiteSpace(analysis.Analysis.File.FileStem))
            {
                exampleSet.Add(analysis.Analysis.File.FileStem);
            }
        }

        lock (_gate)
        {
            state.DiagnosticsByFile.Clear();
            foreach (var pair in diagnosticsByFile)
            {
                state.DiagnosticsByFile[pair.Key] = pair.Value;
            }

            state.FolderExamples.Clear();
            foreach (var pair in folderExamples)
            {
                state.FolderExamples[pair.Key] = pair.Value.Take(3).ToArray();
            }
        }

        return Task.CompletedTask;
    }

    private void UpdateAnalysisState(string workspaceRoot, ConventionAnalysisResult analysis, bool raiseEvent = true)
    {
        var state = GetOrCreateState(workspaceRoot);
        var relativePath = analysis.Analysis.File.RelativePath;
        var mapped = analysis.Analysis.Diagnostics
            .Select(diag => ToDiagnosticItem(analysis.Analysis.File, diag))
            .ToList();

        lock (_gate)
        {
            state.Profile = analysis.Profile;
            state.IgnoreList = analysis.IgnoreList;
            state.DiagnosticsByFile[relativePath] = mapped;
        }

        if (raiseEvent)
        {
            RaiseStateChanged();
        }
    }

    private static ConventionDashboardDiagnosticItem ToDiagnosticItem(ProjectFileFacts file, ConventionDiagnostic diag)
    {
        var evidence = diag.Evidence.FirstOrDefault();
        return new ConventionDashboardDiagnosticItem
        {
            FilePath = file.RelativePath,
            AbsolutePath = file.AbsolutePath,
            RuleId = diag.RuleId,
            Severity = NormalizeSeverity(diag.Severity),
            Confidence = diag.Confidence,
            Message = diag.Message,
            Expected = evidence?.Expected ?? string.Empty,
            Observed = evidence?.Observed ?? string.Empty,
            Suggestion = diag.Suggestions.FirstOrDefault() ?? string.Empty,
            Line = diag.Line,
            Column = diag.Column,
        };
    }

    private static IReadOnlyList<ConventionDashboardMapItem> BuildMapItems(
        ProjectConventionProfile? profile,
        IReadOnlyDictionary<string, string[]> examples)
    {
        if (profile == null)
        {
            return Array.Empty<ConventionDashboardMapItem>();
        }

        var list = new List<ConventionDashboardMapItem>();
        foreach (var pair in profile.Folders)
        {
            var folder = pair.Value;
            var suffix = folder.DominantSuffixes.FirstOrDefault()?.Value ?? string.Empty;
            var prefix = folder.DominantPrefixes.FirstOrDefault()?.Value ?? string.Empty;
            var kind = folder.DominantTypeKinds.FirstOrDefault()?.Value ?? string.Empty;
            var namespaceSample = folder.NamespaceSamples.FirstOrDefault()?.Value ?? string.Empty;
            var confidence = new[]
            {
                folder.DominantSuffixes.FirstOrDefault()?.Ratio ?? 0,
                folder.DominantPrefixes.FirstOrDefault()?.Ratio ?? 0,
                folder.DominantTypeKinds.FirstOrDefault()?.Ratio ?? 0
            }.Max();

            list.Add(new ConventionDashboardMapItem
            {
                Folder = pair.Key,
                ExpectedSuffix = suffix,
                ExpectedPrefix = prefix,
                DominantKind = kind,
                NamespaceSample = namespaceSample,
                Confidence = confidence,
                Examples = examples.TryGetValue(pair.Key, out var values)
                    ? string.Join(", ", values.Take(3))
                    : string.Empty,
            });
        }

        return list
            .OrderByDescending(item => item.Confidence)
            .ThenBy(item => item.Folder, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static IReadOnlyList<ConventionDashboardSettingItem> BuildSettingItems(ProjectConventionOptions options)
    {
        return new List<ConventionDashboardSettingItem>
        {
            new() { Id = "EnableProjectConventionMapping", Label = "Project convention mapping", Value = options.EnableProjectConventionMapping.ToString() },
            new() { Id = "EnableNamingConventionDiagnostics", Label = "Naming diagnostics", Value = options.EnableNamingConventionDiagnostics.ToString() },
            new() { Id = "EnableStatisticalAnomalyDetection", Label = "Statistical anomaly detection", Value = options.EnableStatisticalAnomalyDetection.ToString() },
            new() { Id = "EnableAiNamingAnomalyDetection", Label = "AI naming anomaly detection", Value = options.EnableAiNamingAnomalyDetection.ToString() },
            new() { Id = "UseCoralTpuIfAvailable", Label = "Use Coral TPU if available", Value = options.UseCoralTpuIfAvailable.ToString() },
            new() { Id = "AutoRebuildConventionProfile", Label = "Auto rebuild profile", Value = options.AutoRebuildConventionProfile.ToString() },
            new() { Id = "AnalyzeOnSave", Label = "Analyze on save", Value = options.AnalyzeOnSave.ToString() },
            new() { Id = "AnalyzeOnRename", Label = "Analyze on rename", Value = options.AnalyzeOnRename.ToString() },
            new() { Id = "AnalyzeOnNewFile", Label = "Analyze on new file", Value = options.AnalyzeOnNewFile.ToString() },
            new() { Id = "IgnoreGeneratedCode", Label = "Ignore generated code", Value = options.IgnoreGeneratedCode.ToString() },
            new() { Id = "IgnoreTestProjects", Label = "Ignore test projects", Value = options.IgnoreTestProjects.ToString() },
            new() { Id = "StatisticalAnomalyThreshold", Label = "Statistical anomaly threshold", Value = options.StatisticalAnomalyThreshold.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) },
            new() { Id = "AiAnomalyThreshold", Label = "AI anomaly threshold", Value = options.AiAnomalyThreshold.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) },
            new() { Id = "Scope", Label = "Scope", Value = options.Scope },
        };
    }

    private WorkspaceState GetOrCreateState(string workspaceRoot)
    {
        lock (_gate)
        {
            if (!_workspaces.TryGetValue(workspaceRoot, out var state))
            {
                state = new WorkspaceState();
                _workspaces[workspaceRoot] = state;
            }

            return state;
        }
    }

    private void SetWorkspaceError(string workspaceRoot, string error)
    {
        lock (_gate)
        {
            var state = GetOrCreateState(workspaceRoot);
            state.LastError = error;
        }
    }

    private void RaiseStateChanged()
    {
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    private static string NormalizeSeverity(ConventionSeverity severity)
    {
        return severity switch
        {
            ConventionSeverity.Error => "error",
            ConventionSeverity.Warning => "warning",
            _ => "info",
        };
    }

    private static int SeverityRank(string severity)
    {
        return severity switch
        {
            "error" => 3,
            "warning" => 2,
            _ => 1,
        };
    }
}
