using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Normalization;
using KoSpellCheck.Core.Tokenization;
using Newtonsoft.Json;

namespace KoSpellCheck.Core.Style;

public sealed class ProjectStyleDetector
{
    private static readonly Regex CandidateRegex =
        new(@"[\p{L}\p{Mn}\p{Nd}][\p{L}\p{Mn}\p{Nd}_\-\./\\']*", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex NumberRegex =
        new(@"^\d+(\.\d+)?$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex GuidRegex =
        new(@"^[{(]?[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}[)}]?$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex HexRegex =
        new(@"^(0x)?[0-9a-fA-F]{8,}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex UrlRegex =
        new(@"^https?://", RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    private readonly CodeAwareTokenizer _tokenizer;

    public ProjectStyleDetector(CodeAwareTokenizer? tokenizer = null)
    {
        _tokenizer = tokenizer ?? new CodeAwareTokenizer();
    }

    public Task<ProjectStyleProfile> DetectWorkspaceAsync(
        string workspaceRoot,
        KoSpellCheckConfig config,
        CancellationToken cancellationToken = default)
    {
        var options = StyleLearningOptions.FromConfig(config);
        return DetectWorkspaceAsync(workspaceRoot, config, options, cancellationToken);
    }

    public Task<ProjectStyleProfile> DetectWorkspaceAsync(
        string workspaceRoot,
        KoSpellCheckConfig config,
        StyleLearningOptions options,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(workspaceRoot))
        {
            throw new ArgumentException("Workspace root must be provided.", nameof(workspaceRoot));
        }

        return Task.Run(() =>
        {
            var profile = CreateEmptyProfile(workspaceRoot);
            if (!options.Enabled || !Directory.Exists(workspaceRoot))
            {
                return profile;
            }

            var filePaths = EnumerateWorkspaceFiles(workspaceRoot, options)
                .Take(options.MaxFiles)
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                .ToList();

            var fingerprint = BuildFingerprint(workspaceRoot, filePaths, options);
            var cachePath = options.ResolveCachePath(workspaceRoot);
            var cached = TryLoadCache(cachePath, workspaceRoot, fingerprint);
            if (cached != null)
            {
                return cached;
            }

            profile = DetectFromFiles(workspaceRoot, filePaths, config, options, cancellationToken);
            TrySaveCache(cachePath, fingerprint, profile);
            return profile;
        }, cancellationToken);
    }

    public Task<ProjectStyleProfile> DetectFromFilesAsync(
        string workspaceRoot,
        IEnumerable<string> filePaths,
        KoSpellCheckConfig config,
        CancellationToken cancellationToken = default)
    {
        var options = StyleLearningOptions.FromConfig(config);
        return Task.Run(
            () => DetectFromFiles(workspaceRoot, filePaths, config, options, cancellationToken),
            cancellationToken);
    }

    private ProjectStyleProfile DetectFromFiles(
        string workspaceRoot,
        IEnumerable<string> filePaths,
        KoSpellCheckConfig config,
        StyleLearningOptions options,
        CancellationToken cancellationToken)
    {
        var profile = CreateEmptyProfile(workspaceRoot);
        var stopwatch = Stopwatch.StartNew();
        var processedFiles = 0;
        var processedTokens = 0;

        foreach (var filePath in filePaths)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (processedFiles >= options.MaxFiles ||
                processedTokens >= options.MaxTokens ||
                stopwatch.ElapsedMilliseconds >= options.TimeBudgetMs)
            {
                break;
            }

            if (!IsSupportedFile(filePath, options) || IsIgnoredPath(workspaceRoot, filePath, options))
            {
                continue;
            }

            string content;
            try
            {
                content = File.ReadAllText(filePath);
            }
            catch
            {
                continue;
            }

            processedFiles++;

            foreach (var tokenValue in EnumerateStyleTokens(content, config))
            {
                if (processedTokens >= options.MaxTokens ||
                    stopwatch.ElapsedMilliseconds >= options.TimeBudgetMs)
                {
                    break;
                }

                if (ShouldIgnoreToken(tokenValue, options))
                {
                    continue;
                }

                var normalized = StyleTokenNormalizer.NormalizeKey(tokenValue);
                if (normalized.Length == 0)
                {
                    continue;
                }

                if (!profile.TokenStats.TryGetValue(normalized, out var stats))
                {
                    stats = new TokenStyleStats();
                    profile.TokenStats[normalized] = stats;
                }

                stats.AddVariant(tokenValue);
                processedTokens++;
            }
        }

        profile.UpdatedAtUtc = DateTime.UtcNow;
        return profile;
    }

    private IEnumerable<string> EnumerateStyleTokens(string content, KoSpellCheckConfig config)
    {
        foreach (Match match in CandidateRegex.Matches(content))
        {
            if (!match.Success)
            {
                continue;
            }

            var rawToken = match.Value;
            if (IsCompositeToken(rawToken))
            {
                yield return rawToken;
            }
        }

        foreach (var token in _tokenizer.Tokenize(content, config))
        {
            yield return token.Value;
        }
    }

    private static bool ShouldIgnoreToken(string token, StyleLearningOptions options)
    {
        if (token.Length < options.MinTokenLength)
        {
            return true;
        }

        if (TextNormalizer.IsAllCaps(token) && token.Length <= options.IgnoreAllCapsLengthThreshold)
        {
            return true;
        }

        if (NumberRegex.IsMatch(token) || GuidRegex.IsMatch(token) || HexRegex.IsMatch(token) || UrlRegex.IsMatch(token))
        {
            return true;
        }

        return false;
    }

    private static bool IsCompositeToken(string token)
    {
        if (token.IndexOfAny(new[] { '_', '-', '.', '/', '\\' }) >= 0)
        {
            return true;
        }

        if (token.Length < 2)
        {
            return false;
        }

        for (var i = 1; i < token.Length; i++)
        {
            var prev = token[i - 1];
            var curr = token[i];
            var next = i + 1 < token.Length ? token[i + 1] : '\0';

            if (IsBoundary(prev, curr, next))
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsBoundary(char prev, char curr, char next)
    {
        if (char.IsLower(prev) && char.IsUpper(curr))
        {
            return true;
        }

        if (char.IsUpper(prev) && char.IsUpper(curr) && next != '\0' && char.IsLower(next))
        {
            return true;
        }

        if (char.IsLetter(prev) && char.IsDigit(curr))
        {
            return true;
        }

        if (char.IsDigit(prev) && char.IsLetter(curr))
        {
            return true;
        }

        return false;
    }

    private static IEnumerable<string> EnumerateWorkspaceFiles(string workspaceRoot, StyleLearningOptions options)
    {
        var pending = new Stack<string>();
        pending.Push(workspaceRoot);

        while (pending.Count > 0)
        {
            var current = pending.Pop();

            foreach (var directory in SafeEnumerateDirectories(current))
            {
                if (options.IgnoreFolders.Contains(Path.GetFileName(directory)))
                {
                    continue;
                }

                pending.Push(directory);
            }

            foreach (var file in SafeEnumerateFiles(current))
            {
                if (IsSupportedFile(file, options))
                {
                    yield return file;
                }
            }
        }
    }

    private static IEnumerable<string> SafeEnumerateDirectories(string root)
    {
        try
        {
            return Directory.EnumerateDirectories(root).ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static IEnumerable<string> SafeEnumerateFiles(string root)
    {
        try
        {
            return Directory.EnumerateFiles(root).ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static bool IsSupportedFile(string filePath, StyleLearningOptions options)
    {
        var extension = Path.GetExtension(filePath).TrimStart('.').ToLowerInvariant();
        if (extension.Length == 0)
        {
            return false;
        }

        if (options.FileExtensions.Count == 0)
        {
            return true;
        }

        return options.FileExtensions.Contains(extension);
    }

    private static bool IsIgnoredPath(string workspaceRoot, string filePath, StyleLearningOptions options)
    {
        string relativePath;
        try
        {
            relativePath = GetRelativePath(workspaceRoot, filePath);
        }
        catch
        {
            return true;
        }

        var segments = relativePath
            .Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);

        return segments.Any(options.IgnoreFolders.Contains);
    }

    private static string BuildFingerprint(string workspaceRoot, IReadOnlyList<string> files, StyleLearningOptions options)
    {
        var builder = new StringBuilder();
        builder.Append("style-detector-v2");
        builder.Append('|');
        builder.Append(options.BuildOptionsFingerprint());
        builder.Append('|');
        builder.Append(workspaceRoot);
        builder.Append('|');

        foreach (var file in files)
        {
            try
            {
                var info = new FileInfo(file);
                var relativePath = GetRelativePath(workspaceRoot, file).Replace('\\', '/');
                builder.Append(relativePath);
                builder.Append(':');
                builder.Append(info.Length);
                builder.Append(':');
                builder.Append(info.LastWriteTimeUtc.Ticks);
                builder.Append('|');
            }
            catch
            {
                // Ignore transient file failures; fingerprint should remain best effort.
            }
        }

        using var sha = SHA256.Create();
        var bytes = Encoding.UTF8.GetBytes(builder.ToString());
        var hash = sha.ComputeHash(bytes);
        return BitConverter.ToString(hash).Replace("-", string.Empty).ToLowerInvariant();
    }

    private static ProjectStyleProfile? TryLoadCache(string cachePath, string workspaceRoot, string fingerprint)
    {
        if (!File.Exists(cachePath))
        {
            return null;
        }

        try
        {
            var payload = JsonConvert.DeserializeObject<ProjectStyleCachePayload>(File.ReadAllText(cachePath));
            if (payload == null)
            {
                return null;
            }

            if (!string.Equals(payload.WorkspaceRoot, workspaceRoot, StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            if (!string.Equals(payload.Fingerprint, fingerprint, StringComparison.Ordinal))
            {
                return null;
            }

            return new ProjectStyleProfile
            {
                WorkspaceRoot = payload.WorkspaceRoot,
                CreatedAtUtc = payload.CreatedAtUtc,
                UpdatedAtUtc = payload.UpdatedAtUtc,
                TokenStats = payload.TokenStats ??
                    new Dictionary<string, TokenStyleStats>(StringComparer.Ordinal),
            };
        }
        catch
        {
            return null;
        }
    }

    private static void TrySaveCache(string cachePath, string fingerprint, ProjectStyleProfile profile)
    {
        try
        {
            var parent = Path.GetDirectoryName(cachePath);
            if (!string.IsNullOrWhiteSpace(parent))
            {
                Directory.CreateDirectory(parent);
            }

            var payload = new ProjectStyleCachePayload
            {
                WorkspaceRoot = profile.WorkspaceRoot,
                Fingerprint = fingerprint,
                CreatedAtUtc = profile.CreatedAtUtc,
                UpdatedAtUtc = profile.UpdatedAtUtc,
                TokenStats = new Dictionary<string, TokenStyleStats>(profile.TokenStats, StringComparer.Ordinal),
            };

            var json = JsonConvert.SerializeObject(payload, Formatting.Indented);
            File.WriteAllText(cachePath, json);
        }
        catch
        {
            // Ignore cache write failures.
        }
    }

    private static ProjectStyleProfile CreateEmptyProfile(string workspaceRoot)
    {
        var now = DateTime.UtcNow;
        return new ProjectStyleProfile
        {
            WorkspaceRoot = workspaceRoot,
            CreatedAtUtc = now,
            UpdatedAtUtc = now,
            TokenStats = new Dictionary<string, TokenStyleStats>(StringComparer.Ordinal),
        };
    }

    private static string GetRelativePath(string basePath, string fullPath)
    {
        try
        {
            var baseUri = new Uri(AppendDirectorySeparator(basePath));
            var fullUri = new Uri(fullPath);

            if (!string.Equals(baseUri.Scheme, fullUri.Scheme, StringComparison.OrdinalIgnoreCase))
            {
                return fullPath;
            }

            var relativeUri = baseUri.MakeRelativeUri(fullUri);
            var relative = Uri.UnescapeDataString(relativeUri.ToString());
            return relative.Replace('/', Path.DirectorySeparatorChar);
        }
        catch
        {
            return fullPath;
        }
    }

    private static string AppendDirectorySeparator(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return Path.DirectorySeparatorChar.ToString();
        }

        if (path.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal) ||
            path.EndsWith(Path.AltDirectorySeparatorChar.ToString(), StringComparison.Ordinal))
        {
            return path;
        }

        return path + Path.DirectorySeparatorChar;
    }

    private sealed class ProjectStyleCachePayload
    {
        public string WorkspaceRoot { get; set; } = string.Empty;

        public string Fingerprint { get; set; } = string.Empty;

        public DateTime CreatedAtUtc { get; set; }

        public DateTime UpdatedAtUtc { get; set; }

        public Dictionary<string, TokenStyleStats>? TokenStats { get; set; }
    }
}
