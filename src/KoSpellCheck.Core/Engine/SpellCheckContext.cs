using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Style;

namespace KoSpellCheck.Core.Engine;

public sealed class SpellCheckContext
{
    public SpellCheckContext(
        KoSpellCheckConfig config,
        string? filePath = null,
        string? workspaceRoot = null,
        ProjectStyleProfile? projectStyleProfile = null)
    {
        Config = config ?? throw new ArgumentNullException(nameof(config));
        FilePath = filePath;
        WorkspaceRoot = workspaceRoot;
        ProjectStyleProfile = projectStyleProfile;
    }

    public KoSpellCheckConfig Config { get; }

    public string? FilePath { get; }

    public string? WorkspaceRoot { get; }

    public ProjectStyleProfile? ProjectStyleProfile { get; }

    public string? ResolvedWorkspaceRoot =>
        !string.IsNullOrWhiteSpace(WorkspaceRoot)
            ? WorkspaceRoot
            : Path.GetDirectoryName(FilePath ?? string.Empty);
}
