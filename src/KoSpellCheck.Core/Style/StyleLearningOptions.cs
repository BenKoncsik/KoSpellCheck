using KoSpellCheck.Core.Config;

namespace KoSpellCheck.Core.Style;

public sealed class StyleLearningOptions
{
    public bool Enabled { get; set; } = true;

    public int MaxFiles { get; set; } = 2000;

    public int MaxTokens { get; set; } = 200000;

    public int TimeBudgetMs { get; set; } = 2000;

    public ISet<string> FileExtensions { get; set; } =
        new HashSet<string>(new[] { "cs", "ts", "js", "tsx", "jsx", "json", "md" }, StringComparer.OrdinalIgnoreCase);

    public string CachePath { get; set; } = ".kospellcheck/style-profile.json";

    public int MinTokenLength { get; set; } = 3;

    public int IgnoreAllCapsLengthThreshold { get; set; } = 4;

    public ISet<string> IgnoreFolders { get; set; } =
        new HashSet<string>(
            new[] { "bin", "obj", "node_modules", ".git", ".vs", "artifacts" },
            StringComparer.OrdinalIgnoreCase);

    public string ResolveCachePath(string workspaceRoot)
    {
        if (string.IsNullOrWhiteSpace(CachePath))
        {
            return Path.Combine(workspaceRoot, ".kospellcheck", "style-profile.json");
        }

        return Path.IsPathRooted(CachePath)
            ? CachePath
            : Path.Combine(workspaceRoot, CachePath);
    }

    public string BuildOptionsFingerprint()
    {
        return string.Join(
            "|",
            Enabled,
            MaxFiles,
            MaxTokens,
            TimeBudgetMs,
            MinTokenLength,
            IgnoreAllCapsLengthThreshold,
            string.Join(",", FileExtensions.OrderBy(v => v, StringComparer.OrdinalIgnoreCase)),
            CachePath,
            string.Join(",", IgnoreFolders.OrderBy(v => v, StringComparer.OrdinalIgnoreCase)));
    }

    public static StyleLearningOptions FromConfig(KoSpellCheckConfig config)
    {
        return new StyleLearningOptions
        {
            Enabled = config.StyleLearningEnabled,
            MaxFiles = Math.Max(1, config.StyleLearningMaxFiles),
            MaxTokens = Math.Max(1, config.StyleLearningMaxTokens),
            TimeBudgetMs = Math.Max(250, config.StyleLearningTimeBudgetMs),
            FileExtensions = new HashSet<string>(
                config.StyleLearningFileExtensions
                    .Select(NormalizeExtension)
                    .Where(v => v.Length > 0),
                StringComparer.OrdinalIgnoreCase),
            CachePath = string.IsNullOrWhiteSpace(config.StyleLearningCachePath)
                ? ".kospellcheck/style-profile.json"
                : config.StyleLearningCachePath,
            MinTokenLength = Math.Max(1, config.StyleLearningMinTokenLength),
            IgnoreAllCapsLengthThreshold = Math.Max(1, config.IgnoreAllCapsLengthThreshold),
            IgnoreFolders = new HashSet<string>(
                config.StyleLearningIgnoreFolders.Where(v => !string.IsNullOrWhiteSpace(v)),
                StringComparer.OrdinalIgnoreCase),
        };
    }

    private static string NormalizeExtension(string extension)
    {
        if (string.IsNullOrWhiteSpace(extension))
        {
            return string.Empty;
        }

        return extension.Trim().TrimStart('.').ToLowerInvariant();
    }
}
