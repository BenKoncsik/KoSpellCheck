using KoSpellCheck.Core.Storage;
using Xunit;

namespace KoSpellCheck.Core.Tests;

public sealed class WorkspaceStoragePathResolverTests
{
    [Fact]
    public void ComputeProjectStorageId_IsDeterministic()
    {
        var workspaceRoot = Path.Combine(Path.GetTempPath(), "KoSpellCheck", "DemoWorkspace");
        var first = WorkspaceStoragePathResolver.ComputeProjectStorageId(workspaceRoot);
        var second = WorkspaceStoragePathResolver.ComputeProjectStorageId(workspaceRoot);

        Assert.Equal(first, second);
        Assert.StartsWith("project-", first, StringComparison.Ordinal);
    }

    [Fact]
    public void ResolveArtifactPath_KeepsDefaultWorkspaceLocalBehavior_WithoutCustomStoragePath()
    {
        var workspaceRoot = Path.Combine(Path.GetTempPath(), "KoSpellCheck", "WorkspaceDefault");
        var resolved = WorkspaceStoragePathResolver.ResolveArtifactPath(
            workspaceRoot,
            configuredWorkspaceStoragePath: null,
            configuredArtifactPath: ".kospellcheck/style-profile.json",
            defaultArtifactPath: ".kospellcheck/style-profile.json");

        var expected = Path.Combine(workspaceRoot, ".kospellcheck", "style-profile.json");
        Assert.Equal(expected, resolved);
    }

    [Fact]
    public void ResolveArtifactPath_RelocatesLegacyKospellcheckPrefix_WhenCustomStoragePathIsConfigured()
    {
        var workspaceRoot = Path.Combine(Path.GetTempPath(), "KoSpellCheck", "WorkspaceRelocated");
        var configuredStoragePath = Path.Combine(Path.GetTempPath(), "KoSpellCheckStorage");
        var storageRoot = WorkspaceStoragePathResolver.ResolveWorkspaceStorageRoot(workspaceRoot, configuredStoragePath);

        var resolved = WorkspaceStoragePathResolver.ResolveArtifactPath(
            workspaceRoot,
            configuredStoragePath,
            ".kospellcheck/project-conventions.json",
            ".kospellcheck/project-conventions.json");

        var expected = Path.Combine(storageRoot, "project-conventions.json");
        Assert.Equal(expected, resolved);
    }
}
