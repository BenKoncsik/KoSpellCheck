using System.Text.RegularExpressions;
using KoSpellCheck.Core.TypoAcceleration;

namespace KoSpellCheck.Core.Config;

public sealed class KoSpellCheckConfig
{
    public bool Enabled { get; set; } = true;

    public IList<string> LanguagesEnabled { get; set; } = new List<string> { "hu", "en" };

    public bool AllowMixedLanguages { get; set; } = true;

    public IDictionary<string, string> PreferTerms { get; set; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    public bool TreatAsHungarianWhenAsciiOnly { get; set; } = true;

    public ISet<string> IgnoreWords { get; set; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    public ISet<string> ProjectDictionary { get; set; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    public IList<string> IgnorePatterns { get; set; } = new List<string>
    {
        "^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$",
        "^https?://",
        "^[0-9a-fA-F]{16,}$",
    };

    public int MinTokenLength { get; set; } = 2;

    public int MaxTokenLength { get; set; } = 64;

    public int IgnoreAllCapsLengthThreshold { get; set; } = 4;

    public int SuggestionsMax { get; set; } = 5;

    public int MaxTokensPerDocument { get; set; } = 2000;

    public bool StyleLearningEnabled { get; set; } = true;

    public int StyleLearningMaxFiles { get; set; } = 2000;

    public int StyleLearningMaxTokens { get; set; } = 200000;

    public int StyleLearningTimeBudgetMs { get; set; } = 2000;

    public IList<string> StyleLearningFileExtensions { get; set; } =
        new List<string> { "cs", "ts", "js", "tsx", "jsx", "json", "md" };

    public string StyleLearningCachePath { get; set; } = ".kospellcheck/style-profile.json";

    public int StyleLearningMinTokenLength { get; set; } = 3;

    public IList<string> StyleLearningIgnoreFolders { get; set; } =
        new List<string> { "bin", "obj", "node_modules", ".git", ".vs", "artifacts" };

    public TypoAccelerationMode LocalTypoAccelerationMode { get; set; } = TypoAccelerationMode.Auto;

    public bool LocalTypoAccelerationShowDetectionPrompt { get; set; } = true;

    public bool LocalTypoAccelerationVerboseLogging { get; set; } = false;

    public bool IsLanguageEnabled(string languageCode)
    {
        return LanguagesEnabled.Any(l =>
            string.Equals(l, languageCode, StringComparison.OrdinalIgnoreCase));
    }

    public KoSpellCheckConfig Clone()
    {
        return new KoSpellCheckConfig
        {
            Enabled = Enabled,
            LanguagesEnabled = LanguagesEnabled.ToList(),
            AllowMixedLanguages = AllowMixedLanguages,
            PreferTerms = new Dictionary<string, string>(PreferTerms, StringComparer.OrdinalIgnoreCase),
            TreatAsHungarianWhenAsciiOnly = TreatAsHungarianWhenAsciiOnly,
            IgnoreWords = new HashSet<string>(IgnoreWords, StringComparer.OrdinalIgnoreCase),
            ProjectDictionary = new HashSet<string>(ProjectDictionary, StringComparer.OrdinalIgnoreCase),
            IgnorePatterns = IgnorePatterns.ToList(),
            MinTokenLength = MinTokenLength,
            MaxTokenLength = MaxTokenLength,
            IgnoreAllCapsLengthThreshold = IgnoreAllCapsLengthThreshold,
            SuggestionsMax = SuggestionsMax,
            MaxTokensPerDocument = MaxTokensPerDocument,
            StyleLearningEnabled = StyleLearningEnabled,
            StyleLearningMaxFiles = StyleLearningMaxFiles,
            StyleLearningMaxTokens = StyleLearningMaxTokens,
            StyleLearningTimeBudgetMs = StyleLearningTimeBudgetMs,
            StyleLearningFileExtensions = StyleLearningFileExtensions.ToList(),
            StyleLearningCachePath = StyleLearningCachePath,
            StyleLearningMinTokenLength = StyleLearningMinTokenLength,
            StyleLearningIgnoreFolders = StyleLearningIgnoreFolders.ToList(),
            LocalTypoAccelerationMode = LocalTypoAccelerationMode,
            LocalTypoAccelerationShowDetectionPrompt = LocalTypoAccelerationShowDetectionPrompt,
            LocalTypoAccelerationVerboseLogging = LocalTypoAccelerationVerboseLogging,
        };
    }

    public IEnumerable<Regex> BuildIgnoreRegexes()
    {
        foreach (var pattern in IgnorePatterns)
        {
            if (string.IsNullOrWhiteSpace(pattern))
            {
                continue;
            }

            Regex? regex = null;
            try
            {
                regex = new Regex(pattern, RegexOptions.Compiled | RegexOptions.CultureInvariant);
            }
            catch
            {
                // Ignore invalid regex patterns from user config.
            }

            if (regex != null)
            {
                yield return regex;
            }
        }
    }
}
