namespace KoSpellCheck.VS2022.Services.ProjectConventions;

internal sealed class ConventionDashboardSnapshot
{
    public string WorkspaceRoot { get; set; } = string.Empty;

    public string Scope { get; set; } = "workspace";

    public bool FeatureEnabled { get; set; }

    public bool AiEnabled { get; set; }

    public bool CoralEnabled { get; set; }

    public bool CoralActive { get; set; }

    public string CoralStatus { get; set; } = "inactive";

    public int FilesScanned { get; set; }

    public int TypesScanned { get; set; }

    public string DominantCaseStyle { get; set; } = "Unknown";

    public DateTime? ProfileUpdatedUtc { get; set; }

    public int DiagnosticCount { get; set; }

    public bool IsRefreshing { get; set; }

    public bool IsRebuilding { get; set; }

    public string? ProfilePath { get; set; }

    public string? SummaryPath { get; set; }

    public string? LastError { get; set; }

    public IReadOnlyList<ConventionDashboardSettingItem> Settings { get; set; } = Array.Empty<ConventionDashboardSettingItem>();

    public IReadOnlyList<ConventionDashboardMapItem> ConventionMap { get; set; } = Array.Empty<ConventionDashboardMapItem>();

    public IReadOnlyList<ConventionDashboardDiagnosticItem> Diagnostics { get; set; } = Array.Empty<ConventionDashboardDiagnosticItem>();

    public IReadOnlyList<ConventionDashboardUnusedTypeItem> UnusedTypes { get; set; } = Array.Empty<ConventionDashboardUnusedTypeItem>();

    public IReadOnlyList<ConventionDashboardLogEntry> Logs { get; set; } = Array.Empty<ConventionDashboardLogEntry>();
}

internal sealed class ConventionDashboardSettingItem
{
    public string Id { get; set; } = string.Empty;

    public string Label { get; set; } = string.Empty;

    public string Value { get; set; } = string.Empty;
}

internal sealed class ConventionDashboardMapItem
{
    public string Folder { get; set; } = ".";

    public string ExpectedSuffix { get; set; } = string.Empty;

    public string ExpectedPrefix { get; set; } = string.Empty;

    public string DominantKind { get; set; } = string.Empty;

    public double Confidence { get; set; }

    public string NamespaceSample { get; set; } = string.Empty;

    public string Examples { get; set; } = string.Empty;
}

internal sealed class ConventionDashboardDiagnosticItem
{
    public string FilePath { get; set; } = string.Empty;

    public string AbsolutePath { get; set; } = string.Empty;

    public string RuleId { get; set; } = string.Empty;

    public string Severity { get; set; } = "info";

    public double Confidence { get; set; }

    public string Message { get; set; } = string.Empty;

    public string Expected { get; set; } = string.Empty;

    public string Observed { get; set; } = string.Empty;

    public string Suggestion { get; set; } = string.Empty;

    public int Line { get; set; }

    public int Column { get; set; }
}

internal sealed class ConventionDashboardUnusedTypeItem
{
    public string TypeName { get; set; } = string.Empty;

    public string Classification { get; set; } = string.Empty;

    public string RuleId { get; set; } = string.Empty;

    public string DeclarationFilePath { get; set; } = string.Empty;

    public string DeclarationAbsolutePath { get; set; } = string.Empty;

    public int DeclarationLine { get; set; }

    public int DeclarationColumn { get; set; }

    public string NavigationFilePath { get; set; } = string.Empty;

    public string NavigationAbsolutePath { get; set; } = string.Empty;

    public int NavigationLine { get; set; }

    public int NavigationColumn { get; set; }

    public string NavigationMemberName { get; set; } = string.Empty;
}

internal sealed class ConventionDashboardLogEntry
{
    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;

    public string Level { get; set; } = "info";

    public string Message { get; set; } = string.Empty;
}
