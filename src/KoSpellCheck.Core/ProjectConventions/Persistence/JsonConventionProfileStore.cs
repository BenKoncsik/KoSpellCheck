using System.Security.Cryptography;
using System.Text;
using KoSpellCheck.Core.ProjectConventions.Abstractions;
using KoSpellCheck.Core.ProjectConventions.Models;
using KoSpellCheck.Core.Storage;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace KoSpellCheck.Core.ProjectConventions.Persistence;

public sealed class JsonConventionProfileStore : IConventionProfileStore
{
    private static readonly JsonSerializerSettings SerializerSettings = new()
    {
        Formatting = Formatting.Indented,
        NullValueHandling = NullValueHandling.Ignore,
        Converters = { new StringEnumConverter() },
    };

    public ProjectConventionProfile? LoadProfile(string workspaceRoot, string configuredPath, string? workspaceStoragePath = null)
    {
        var path = ResolveArtifactPath(workspaceRoot, configuredPath, workspaceStoragePath);
        return ReadJson<ProjectConventionProfile>(path);
    }

    public ConventionIgnoreList LoadIgnoreList(string workspaceRoot, string configuredPath, string? workspaceStoragePath = null)
    {
        var path = ResolveArtifactPath(workspaceRoot, configuredPath, workspaceStoragePath);
        var loaded = ReadJson<ConventionIgnoreList>(path);
        if (loaded != null && loaded.SchemaVersion == 1)
        {
            return loaded;
        }

        return new ConventionIgnoreList
        {
            SchemaVersion = 1,
            Entries = new List<ConventionIgnoreEntry>(),
        };
    }

    public void SaveArtifacts(
        string workspaceRoot,
        string? workspaceStoragePath,
        string profilePath,
        ProjectConventionProfile profile,
        string summaryPath,
        ConventionScanSummary summary,
        string cachePath,
        ConventionProfileCache cache,
        string anomalyModelPath,
        LightweightAnomalyModel anomalyModel)
    {
        WriteJson(ResolveArtifactPath(workspaceRoot, profilePath, workspaceStoragePath), profile, skipIfExists: false);
        WriteJson(ResolveArtifactPath(workspaceRoot, summaryPath, workspaceStoragePath), summary, skipIfExists: false);
        WriteJson(ResolveArtifactPath(workspaceRoot, cachePath, workspaceStoragePath), cache, skipIfExists: false);
        WriteJson(ResolveArtifactPath(workspaceRoot, anomalyModelPath, workspaceStoragePath), anomalyModel, skipIfExists: true);
    }

    public void AppendIgnoreEntry(
        string workspaceRoot,
        string configuredPath,
        ConventionIgnoreEntry entry,
        string? workspaceStoragePath = null)
    {
        var path = ResolveArtifactPath(workspaceRoot, configuredPath, workspaceStoragePath);
        var list = LoadIgnoreList(workspaceRoot, configuredPath, workspaceStoragePath);

        var exists = list.Entries.Any(item =>
            string.Equals(item.RuleId, entry.RuleId, StringComparison.Ordinal) &&
            string.Equals(item.Scope, entry.Scope, StringComparison.Ordinal) &&
            string.Equals(item.Target, entry.Target, StringComparison.Ordinal));

        if (exists)
        {
            return;
        }

        list.Entries.Add(entry);
        WriteJson(path, list, skipIfExists: false);
    }

    public static string ResolveArtifactPath(string workspaceRoot, string configuredPath, string? workspaceStoragePath = null)
    {
        return WorkspaceStoragePathResolver.ResolveArtifactPath(
            workspaceRoot,
            workspaceStoragePath,
            configuredPath,
            ".kospellcheck/project-conventions.json");
    }

    public static bool IsIgnored(ConventionIgnoreList ignoreList, string ruleId, string relativePath, string folderPath)
    {
        foreach (var entry in ignoreList.Entries)
        {
            if (!string.Equals(entry.RuleId, ruleId, StringComparison.Ordinal))
            {
                continue;
            }

            if (string.Equals(entry.Scope, "project", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            if (string.Equals(entry.Scope, "file", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(entry.Target, relativePath, StringComparison.Ordinal))
            {
                return true;
            }

            if (string.Equals(entry.Scope, "folder", StringComparison.OrdinalIgnoreCase) &&
                (string.Equals(folderPath, entry.Target, StringComparison.Ordinal) ||
                 folderPath.StartsWith(entry.Target + "/", StringComparison.Ordinal)))
            {
                return true;
            }
        }

        return false;
    }

    public static string BuildFingerprint(IEnumerable<string> filePaths)
    {
        using var hash = SHA256.Create();
        var builder = new StringBuilder();

        foreach (var filePath in filePaths.OrderBy(path => path, StringComparer.Ordinal))
        {
            try
            {
                var stat = new FileInfo(filePath);
                builder.Append(filePath);
                builder.Append(':');
                builder.Append(stat.Length);
                builder.Append(':');
                builder.Append(stat.LastWriteTimeUtc.Ticks);
                builder.Append('|');
            }
            catch
            {
                // Ignore transient stat failures.
            }
        }

        var bytes = Encoding.UTF8.GetBytes(builder.ToString());
        var fingerprint = hash.ComputeHash(bytes);
        return BitConverter.ToString(fingerprint).Replace("-", string.Empty).ToLowerInvariant();
    }

    private static T? ReadJson<T>(string path)
    {
        try
        {
            if (!File.Exists(path))
            {
                return default;
            }

            var content = File.ReadAllText(path);
            return JsonConvert.DeserializeObject<T>(content, SerializerSettings);
        }
        catch
        {
            return default;
        }
    }

    private static void WriteJson(string path, object payload, bool skipIfExists)
    {
        try
        {
            if (skipIfExists && File.Exists(path))
            {
                return;
            }

            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var tempPath = path + ".tmp-" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            File.WriteAllText(tempPath, JsonConvert.SerializeObject(payload, SerializerSettings));
            if (File.Exists(path))
            {
                File.Delete(path);
            }

            File.Move(tempPath, path);
        }
        catch
        {
            // Persistence errors should not crash host adapters.
        }
    }
}
