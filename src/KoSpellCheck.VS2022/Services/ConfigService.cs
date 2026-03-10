using System.Collections.Concurrent;
using System.IO;
using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Storage;
using Microsoft.VisualStudio.Text;
using Newtonsoft.Json.Linq;

namespace KoSpellCheck.VS2022.Services;

internal sealed class ConfigService : IDisposable
{
    private sealed class CacheEntry
    {
        public CacheEntry(KoSpellCheckConfig config, SpellCheckScope scope)
        {
            Config = config;
            Scope = scope;
        }

        public KoSpellCheckConfig Config { get; }

        public SpellCheckScope Scope { get; }
    }

    private readonly ITextDocumentFactoryService _textDocumentFactoryService;
    private readonly ConcurrentDictionary<string, CacheEntry> _cache =
        new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, FileSystemWatcher> _watchers =
        new(StringComparer.OrdinalIgnoreCase);

    public ConfigService(ITextDocumentFactoryService textDocumentFactoryService)
    {
        _textDocumentFactoryService = textDocumentFactoryService;
    }

    public event EventHandler? ConfigChanged;

    public SpellSettings GetSettings(ITextBuffer textBuffer)
    {
        var filePath = GetFilePath(textBuffer);
        var workspaceRoot = ResolveWorkspaceRoot(filePath);
        EnsureWatcher(workspaceRoot);

        var entry = _cache.GetOrAdd(workspaceRoot, LoadSettings);

        return new SpellSettings(entry.Config.Clone(), entry.Scope, workspaceRoot, filePath);
    }

    public string? GetDocumentFilePath(ITextBuffer textBuffer)
    {
        return GetFilePath(textBuffer);
    }

    public bool AddWordToProjectDictionary(ITextBuffer textBuffer, string token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return false;
        }

        var filePath = GetFilePath(textBuffer);
        var workspaceRoot = ResolveWorkspaceRoot(filePath);
        var config = ConfigLoader.Load(workspaceRoot);
        var dictionaryPath = WorkspaceStoragePathResolver.ResolveArtifactPath(
            workspaceRoot,
            config.WorkspaceStoragePath,
            ".kospellcheck/project.dict",
            ".kospellcheck/project.dict");

        Directory.CreateDirectory(Path.GetDirectoryName(dictionaryPath) ?? workspaceRoot);

        var existing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (File.Exists(dictionaryPath))
        {
            foreach (var line in File.ReadAllLines(dictionaryPath))
            {
                var value = line.Trim();
                if (value.Length == 0 || value.StartsWith("#", StringComparison.Ordinal))
                {
                    continue;
                }

                existing.Add(value);
            }
        }

        if (!existing.Add(token.Trim()))
        {
            return false;
        }

        File.WriteAllLines(dictionaryPath, existing.OrderBy(v => v, StringComparer.OrdinalIgnoreCase));
        Invalidate(workspaceRoot);
        return true;
    }

    public void Dispose()
    {
        foreach (var watcher in _watchers.Values)
        {
            watcher.Dispose();
        }

        _watchers.Clear();
    }

    private CacheEntry LoadSettings(string workspaceRoot)
    {
        var config = ConfigLoader.Load(workspaceRoot);

        var editorScope = TryReadEditorConfigScope(Path.Combine(workspaceRoot, ".editorconfig"));
        var jsonScope = TryReadJsonScope(Path.Combine(workspaceRoot, "kospellcheck.json"));
        var scope = jsonScope ?? editorScope ?? SpellCheckScope.Identifiers;

        var projectDictionaryPath = WorkspaceStoragePathResolver.ResolveArtifactPath(
            workspaceRoot,
            config.WorkspaceStoragePath,
            ".kospellcheck/project.dict",
            ".kospellcheck/project.dict");
        if (File.Exists(projectDictionaryPath))
        {
            foreach (var line in File.ReadAllLines(projectDictionaryPath))
            {
                var value = line.Trim();
                if (value.Length == 0 || value.StartsWith("#", StringComparison.Ordinal))
                {
                    continue;
                }

                config.ProjectDictionary.Add(value);
            }
        }

        return new CacheEntry(config, scope);
    }

    private void EnsureWatcher(string workspaceRoot)
    {
        _watchers.GetOrAdd(workspaceRoot, root =>
        {
            var watcher = new FileSystemWatcher(root)
            {
                IncludeSubdirectories = true,
                NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.DirectoryName,
                Filter = "*",
                EnableRaisingEvents = true,
            };

            watcher.Changed += (_, args) => OnFileChanged(root, args.FullPath);
            watcher.Created += (_, args) => OnFileChanged(root, args.FullPath);
            watcher.Deleted += (_, args) => OnFileChanged(root, args.FullPath);
            watcher.Renamed += (_, args) => OnFileChanged(root, args.FullPath);

            return watcher;
        });
    }

    private void OnFileChanged(string workspaceRoot, string fullPath)
    {
        if (!IsConfigFilePath(fullPath, workspaceRoot))
        {
            return;
        }

        Invalidate(workspaceRoot);
    }

    private void Invalidate(string workspaceRoot)
    {
        _cache.TryRemove(workspaceRoot, out _);
        ConfigChanged?.Invoke(this, EventArgs.Empty);
    }

    private static bool IsConfigFilePath(string fullPath, string workspaceRoot)
    {
        var normalized = fullPath.Replace('\\', '/');
        var rootNormalized = workspaceRoot.Replace('\\', '/').TrimEnd('/');

        return string.Equals(normalized, $"{rootNormalized}/.editorconfig", StringComparison.OrdinalIgnoreCase)
            || string.Equals(normalized, $"{rootNormalized}/kospellcheck.json", StringComparison.OrdinalIgnoreCase)
            || string.Equals(normalized, $"{rootNormalized}/.kospellcheck/project.dict", StringComparison.OrdinalIgnoreCase);
    }

    private string? GetFilePath(ITextBuffer textBuffer)
    {
        if (_textDocumentFactoryService.TryGetTextDocument(textBuffer, out var textDocument))
        {
            return textDocument.FilePath;
        }

        return null;
    }

    private static string ResolveWorkspaceRoot(string? filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            return Directory.GetCurrentDirectory();
        }

        var probe = Path.GetDirectoryName(filePath) ?? Directory.GetCurrentDirectory();
        for (var i = 0; i < 12; i++)
        {
            if (File.Exists(Path.Combine(probe, "kospellcheck.json")) ||
                File.Exists(Path.Combine(probe, ".editorconfig")) ||
                Directory.Exists(Path.Combine(probe, ".git")) ||
                Directory.EnumerateFiles(probe, "*.sln").Any())
            {
                return probe;
            }

            var parent = Directory.GetParent(probe);
            if (parent == null)
            {
                break;
            }

            probe = parent.FullName;
        }

        return Path.GetDirectoryName(filePath) ?? Directory.GetCurrentDirectory();
    }

    private static SpellCheckScope? TryReadEditorConfigScope(string editorConfigPath)
    {
        if (!File.Exists(editorConfigPath))
        {
            return null;
        }

        foreach (var rawLine in File.ReadAllLines(editorConfigPath))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith("#", StringComparison.Ordinal) || !line.Contains('='))
            {
                continue;
            }

            var separatorIndex = line.IndexOf('=');
            var key = line.Substring(0, separatorIndex).Trim();
            if (!string.Equals(key, "kospellcheck_scope", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var value = line.Substring(separatorIndex + 1).Trim();
            return ParseScope(value);
        }

        return null;
    }

    private static SpellCheckScope? TryReadJsonScope(string jsonPath)
    {
        if (!File.Exists(jsonPath))
        {
            return null;
        }

        try
        {
            var root = JObject.Parse(File.ReadAllText(jsonPath));
            var scope = root.Value<string>("scope");
            return ParseScope(scope);
        }
        catch
        {
            return null;
        }
    }

    private static SpellCheckScope? ParseScope(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value!.Trim().ToLowerInvariant();
        return normalized switch
        {
            "identifiers" => SpellCheckScope.Identifiers,
            "identifiers_comments" => SpellCheckScope.IdentifiersAndComments,
            "identifiers_comments_strings" => SpellCheckScope.IdentifiersCommentsAndStrings,
            "document" => SpellCheckScope.Document,
            _ => null,
        };
    }
}

internal sealed class SpellSettings
{
    public SpellSettings(KoSpellCheckConfig config, SpellCheckScope scope, string workspaceRoot, string? filePath)
    {
        Config = config;
        Scope = scope;
        WorkspaceRoot = workspaceRoot;
        FilePath = filePath;
    }

    public KoSpellCheckConfig Config { get; }

    public SpellCheckScope Scope { get; }

    public string WorkspaceRoot { get; }

    public string? FilePath { get; }
}
