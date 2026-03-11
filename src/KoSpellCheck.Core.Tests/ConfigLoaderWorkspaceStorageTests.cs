using KoSpellCheck.Core.Config;
using Xunit;

namespace KoSpellCheck.Core.Tests;

public sealed class ConfigLoaderWorkspaceStorageTests
{
    [Fact]
    public void Load_UsesRootWorkspaceStoragePath_ForProjectConventionStorage()
    {
        var workspaceRoot = CreateTempDirectory();
        try
        {
            File.WriteAllText(
                Path.Combine(workspaceRoot, "kospellcheck.json"),
                "{\n  \"workspaceStoragePath\": \"/tmp/ko-shared\"\n}\n");

            var config = ConfigLoader.Load(workspaceRoot);

            Assert.Equal("/tmp/ko-shared", config.WorkspaceStoragePath);
            Assert.Equal("/tmp/ko-shared", config.ProjectConventions.WorkspaceStoragePath);
        }
        finally
        {
            TryDeleteDirectory(workspaceRoot);
        }
    }

    [Fact]
    public void Load_ProjectConventionsWorkspaceStoragePath_OverridesRootAndAppliesGlobally()
    {
        var workspaceRoot = CreateTempDirectory();
        try
        {
            File.WriteAllText(
                Path.Combine(workspaceRoot, "kospellcheck.json"),
                "{\n  \"workspaceStoragePath\": \"/tmp/root-store\",\n  \"projectConventions\": {\n    \"workspaceStoragePath\": \"/tmp/conventions-store\"\n  }\n}\n");

            var config = ConfigLoader.Load(workspaceRoot);

            Assert.Equal("/tmp/conventions-store", config.WorkspaceStoragePath);
            Assert.Equal("/tmp/conventions-store", config.ProjectConventions.WorkspaceStoragePath);
        }
        finally
        {
            TryDeleteDirectory(workspaceRoot);
        }
    }

    private static string CreateTempDirectory()
    {
        return Directory.CreateTempSubdirectory("KoSpellCheck-ConfigLoader-Storage-").FullName;
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
            }
        }
        catch
        {
            // best effort cleanup
        }
    }
}
