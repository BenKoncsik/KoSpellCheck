using System.Security.Cryptography;
using System.Text;

namespace KoSpellCheck.Core.Storage;

public static class WorkspaceStoragePathResolver
{
    private const string DefaultStorageFolderName = ".kospellcheck";
    private static readonly string[] LegacyStorageFolderNames =
    {
        ".kospellcheck",
        ".KoSpellChecker",
        ".KoSpellCheck",
    };

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

    public static IReadOnlyList<string> MigrateLegacyStorage(string workspaceRoot, string? configuredWorkspaceStoragePath)
    {
        if (string.IsNullOrWhiteSpace(configuredWorkspaceStoragePath))
        {
            return Array.Empty<string>();
        }

        var migratedFrom = new List<string>();
        var targetRoot = ResolveWorkspaceStorageRoot(workspaceRoot, configuredWorkspaceStoragePath);
        var normalizedTargetRoot = NormalizeWorkspaceRoot(targetRoot);

        foreach (var legacyFolderName in LegacyStorageFolderNames)
        {
            var sourceRoot = Path.Combine(workspaceRoot, legacyFolderName);
            if (!Directory.Exists(sourceRoot))
            {
                continue;
            }

            var normalizedSourceRoot = NormalizeWorkspaceRoot(sourceRoot);
            if (string.Equals(normalizedSourceRoot, normalizedTargetRoot, StringComparison.Ordinal))
            {
                continue;
            }

            try
            {
                CopyDirectoryRecursive(sourceRoot, targetRoot);
                Directory.Delete(sourceRoot, recursive: true);
                migratedFrom.Add(sourceRoot);
            }
            catch
            {
                // Best effort migration, failures are non-fatal.
            }
        }

        return migratedFrom;
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

    private static void CopyDirectoryRecursive(string sourceRoot, string targetRoot)
    {
        Directory.CreateDirectory(targetRoot);

        foreach (var directoryPath in Directory.GetDirectories(sourceRoot, "*", SearchOption.AllDirectories))
        {
            var relativePath = directoryPath.Substring(sourceRoot.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var targetDirectory = Path.Combine(targetRoot, relativePath);
            Directory.CreateDirectory(targetDirectory);
        }

        foreach (var sourceFilePath in Directory.GetFiles(sourceRoot, "*", SearchOption.AllDirectories))
        {
            var relativePath = sourceFilePath.Substring(sourceRoot.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var targetFilePath = Path.Combine(targetRoot, relativePath);
            var targetDirectory = Path.GetDirectoryName(targetFilePath);
            if (!string.IsNullOrWhiteSpace(targetDirectory))
            {
                Directory.CreateDirectory(targetDirectory);
            }

            File.Copy(sourceFilePath, targetFilePath, overwrite: true);
        }
    }
}
