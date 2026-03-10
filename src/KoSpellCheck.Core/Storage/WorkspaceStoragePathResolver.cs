using System.Security.Cryptography;
using System.Text;

namespace KoSpellCheck.Core.Storage;

public static class WorkspaceStoragePathResolver
{
    private const string DefaultStorageFolderName = ".kospellcheck";

    public static string ComputeProjectStorageId(string workspaceRoot)
    {
        var normalized = NormalizeWorkspaceRoot(workspaceRoot);
        using var hash = SHA256.Create();
        var bytes = hash.ComputeHash(Encoding.UTF8.GetBytes(normalized));
        var hex = BitConverter.ToString(bytes).Replace("-", string.Empty).ToLowerInvariant();
        return $"project-{hex.Substring(0, 16)}";
    }

    public static string ResolveWorkspaceStorageRoot(string workspaceRoot, string? configuredWorkspaceStoragePath)
    {
        if (string.IsNullOrWhiteSpace(configuredWorkspaceStoragePath))
        {
            return Path.Combine(workspaceRoot, DefaultStorageFolderName);
        }

        var target = configuredWorkspaceStoragePath!.Trim();
        var baseRoot = Path.IsPathRooted(target)
            ? target
            : Path.Combine(workspaceRoot, target);
        return Path.Combine(baseRoot, ComputeProjectStorageId(workspaceRoot));
    }

    public static string ResolveArtifactPath(
        string workspaceRoot,
        string? configuredWorkspaceStoragePath,
        string? configuredArtifactPath,
        string defaultArtifactPath)
    {
        var target = string.IsNullOrWhiteSpace(configuredArtifactPath)
            ? defaultArtifactPath
            : configuredArtifactPath!.Trim();

        if (Path.IsPathRooted(target))
        {
            return target;
        }

        if (string.IsNullOrWhiteSpace(configuredWorkspaceStoragePath))
        {
            return Path.Combine(workspaceRoot, target);
        }

        var storageRoot = ResolveWorkspaceStorageRoot(workspaceRoot, configuredWorkspaceStoragePath);
        var relativePath = TrimLegacyStoragePrefix(target);
        return string.IsNullOrWhiteSpace(relativePath)
            ? storageRoot
            : Path.Combine(storageRoot, relativePath);
    }

    private static string NormalizeWorkspaceRoot(string workspaceRoot)
    {
        if (string.IsNullOrWhiteSpace(workspaceRoot))
        {
            return string.Empty;
        }

        try
        {
            return Path.GetFullPath(workspaceRoot)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                .ToLowerInvariant();
        }
        catch
        {
            return workspaceRoot
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                .ToLowerInvariant();
        }
    }

    private static string TrimLegacyStoragePrefix(string relativePath)
    {
        var normalized = relativePath.Replace('\\', '/').TrimStart('/');
        if (normalized.Equals(DefaultStorageFolderName, StringComparison.OrdinalIgnoreCase))
        {
            return string.Empty;
        }

        var folderPrefix = DefaultStorageFolderName + "/";
        if (normalized.StartsWith(folderPrefix, StringComparison.OrdinalIgnoreCase))
        {
            normalized = normalized.Substring(folderPrefix.Length);
        }

        return normalized.Replace('/', Path.DirectorySeparatorChar);
    }
}
