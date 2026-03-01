using KoSpellCheck.Core.Config;

namespace KoSpellCheck.Core.Style;

public interface IProjectStyleProfileProvider
{
    ProjectStyleProfile? GetProfile(string workspaceRoot);

    void RequestRefresh(string workspaceRoot, KoSpellCheckConfig config, bool force = false);

    Task<ProjectStyleProfile?> RefreshAsync(
        string workspaceRoot,
        KoSpellCheckConfig config,
        CancellationToken cancellationToken = default);
}
