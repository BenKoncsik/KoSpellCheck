using KoSpellCheck.Core.ProjectConventions.Models;

namespace KoSpellCheck.Core.ProjectConventions.Abstractions;

public interface IConventionProfileStore
{
    ProjectConventionProfile? LoadProfile(string workspaceRoot, string configuredPath);

    ConventionIgnoreList LoadIgnoreList(string workspaceRoot, string configuredPath);

    void SaveArtifacts(
        string workspaceRoot,
        string profilePath,
        ProjectConventionProfile profile,
        string summaryPath,
        ConventionScanSummary summary,
        string cachePath,
        ConventionProfileCache cache,
        string anomalyModelPath,
        LightweightAnomalyModel anomalyModel);

    void AppendIgnoreEntry(string workspaceRoot, string configuredPath, ConventionIgnoreEntry entry);
}
