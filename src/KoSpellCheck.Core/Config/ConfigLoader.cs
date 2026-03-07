using Newtonsoft.Json.Linq;
using KoSpellCheck.Core.TypoAcceleration;

namespace KoSpellCheck.Core.Config;

public static class ConfigLoader
{
    public static KoSpellCheckConfig Load(string workspaceRoot)
    {
        var config = new KoSpellCheckConfig();

        var editorConfigPath = Path.Combine(workspaceRoot, ".editorconfig");
        if (File.Exists(editorConfigPath))
        {
            ApplyEditorConfig(config, editorConfigPath);
        }

        var jsonPath = Path.Combine(workspaceRoot, "kospellcheck.json");
        if (File.Exists(jsonPath))
        {
            ApplyJsonConfig(config, jsonPath);
        }

        return config;
    }

    public static void ApplyEditorConfig(KoSpellCheckConfig config, string editorConfigPath)
    {
        var lines = File.ReadAllLines(editorConfigPath);
        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (string.IsNullOrEmpty(line) || line.StartsWith("#", StringComparison.Ordinal))
            {
                continue;
            }

            var idx = line.IndexOf('=');
            if (idx <= 0)
            {
                continue;
            }

            var key = line.Substring(0, idx).Trim();
            var value = line.Substring(idx + 1).Trim();
            ApplyKeyValue(config, key, value);
        }
    }

    public static void ApplyJsonConfig(KoSpellCheckConfig config, string jsonPath)
    {
        var json = JObject.Parse(File.ReadAllText(jsonPath));

        config.Enabled = json.Value<bool?>("enabled") ?? config.Enabled;

        var langs = json["languages"]?.Values<string>()?.Where(v => !string.IsNullOrWhiteSpace(v)).ToList();
        if (langs is { Count: > 0 })
        {
            config.LanguagesEnabled = langs;
        }

        config.AllowMixedLanguages = json.Value<bool?>("allowMixedLanguages") ?? config.AllowMixedLanguages;
        config.TreatAsHungarianWhenAsciiOnly =
            json.Value<bool?>("treatAsHungarianWhenAsciiOnly") ?? config.TreatAsHungarianWhenAsciiOnly;
        config.MinTokenLength = json.Value<int?>("minTokenLength") ?? config.MinTokenLength;
        config.MaxTokenLength = json.Value<int?>("maxTokenLength") ?? config.MaxTokenLength;
        config.IgnoreAllCapsLengthThreshold =
            json.Value<int?>("ignoreAllCapsLengthThreshold") ?? config.IgnoreAllCapsLengthThreshold;
        config.SuggestionsMax = json.Value<int?>("suggestionsMax") ?? config.SuggestionsMax;
        config.MaxTokensPerDocument = json.Value<int?>("maxTokensPerDocument") ?? config.MaxTokensPerDocument;
        config.StyleLearningEnabled = json.Value<bool?>("styleLearningEnabled") ?? config.StyleLearningEnabled;
        config.StyleLearningMaxFiles = json.Value<int?>("styleLearningMaxFiles") ?? config.StyleLearningMaxFiles;
        config.StyleLearningMaxTokens = json.Value<int?>("styleLearningMaxTokens") ?? config.StyleLearningMaxTokens;
        config.StyleLearningTimeBudgetMs =
            json.Value<int?>("styleLearningTimeBudgetMs") ?? config.StyleLearningTimeBudgetMs;
        config.StyleLearningCachePath =
            json.Value<string>("styleLearningCachePath") ?? config.StyleLearningCachePath;
        config.StyleLearningMinTokenLength =
            json.Value<int?>("styleLearningMinTokenLength") ?? config.StyleLearningMinTokenLength;

        var localTypoAcceleration = json["localTypoAcceleration"] as JObject;
        var modeValue = localTypoAcceleration?.Value<string>("mode")
            ?? json.Value<string>("localTypoAccelerationMode");
        if (TryParseTypoAccelerationMode(modeValue, out var mode))
        {
            config.LocalTypoAccelerationMode = mode;
        }

        config.LocalTypoAccelerationShowDetectionPrompt =
            localTypoAcceleration?.Value<bool?>("showDetectionPrompt")
            ?? json.Value<bool?>("localTypoAccelerationShowDetectionPrompt")
            ?? config.LocalTypoAccelerationShowDetectionPrompt;
        config.LocalTypoAccelerationVerboseLogging =
            localTypoAcceleration?.Value<bool?>("verboseLogging")
            ?? json.Value<bool?>("localTypoAccelerationVerboseLogging")
            ?? config.LocalTypoAccelerationVerboseLogging;

        var ignoreWords = json["ignoreWords"]?.Values<string>()?.Where(v => !string.IsNullOrWhiteSpace(v));
        if (ignoreWords != null)
        {
            config.IgnoreWords = new HashSet<string>(ignoreWords, StringComparer.OrdinalIgnoreCase);
        }

        var projectDictionary = json["projectDictionary"]?.Values<string>()?.Where(v => !string.IsNullOrWhiteSpace(v));
        if (projectDictionary != null)
        {
            config.ProjectDictionary = new HashSet<string>(projectDictionary, StringComparer.OrdinalIgnoreCase);
        }

        var ignorePatterns = json["ignorePatterns"]?.Values<string>()?.Where(v => !string.IsNullOrWhiteSpace(v)).ToList();
        if (ignorePatterns is { Count: > 0 })
        {
            config.IgnorePatterns = ignorePatterns;
        }

        var styleExtensions = json["styleLearningFileExtensions"]?
            .Values<string>()?
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Select(v => v.Trim().TrimStart('.').ToLowerInvariant())
            .ToList();
        if (styleExtensions is { Count: > 0 })
        {
            config.StyleLearningFileExtensions = styleExtensions;
        }

        var styleIgnoreFolders = json["styleLearningIgnoreFolders"]?
            .Values<string>()?
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Select(v => v.Trim())
            .ToList();
        if (styleIgnoreFolders is { Count: > 0 })
        {
            config.StyleLearningIgnoreFolders = styleIgnoreFolders;
        }

        var preferTerms = json["preferTerms"] as JObject;
        if (preferTerms != null)
        {
            var mapped = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var prop in preferTerms.Properties())
            {
                var value = prop.Value.Value<string>();
                if (string.IsNullOrWhiteSpace(prop.Name) || string.IsNullOrWhiteSpace(value))
                {
                    continue;
                }

                mapped[prop.Name.Trim()] = value.Trim();
            }

            config.PreferTerms = mapped;
        }
    }

    private static void ApplyKeyValue(KoSpellCheckConfig config, string key, string value)
    {
        switch (key)
        {
            case "kospellcheck_enabled":
                config.Enabled = ParseBool(value, config.Enabled);
                break;
            case "kospellcheck_languages":
                config.LanguagesEnabled = ParseList(value);
                break;
            case "kospellcheck_allow_mixed_languages":
                config.AllowMixedLanguages = ParseBool(value, config.AllowMixedLanguages);
                break;
            case "kospellcheck_treat_as_hungarian_when_ascii_only":
                config.TreatAsHungarianWhenAsciiOnly = ParseBool(value, config.TreatAsHungarianWhenAsciiOnly);
                break;
            case "kospellcheck_ignore_words":
                config.IgnoreWords = new HashSet<string>(ParseList(value), StringComparer.OrdinalIgnoreCase);
                break;
            case "kospellcheck_project_dictionary":
                config.ProjectDictionary = new HashSet<string>(ParseList(value), StringComparer.OrdinalIgnoreCase);
                break;
            case "kospellcheck_ignore_patterns":
                config.IgnorePatterns = ParseList(value);
                break;
            case "kospellcheck_min_token_length":
                config.MinTokenLength = ParseInt(value, config.MinTokenLength);
                break;
            case "kospellcheck_max_token_length":
                config.MaxTokenLength = ParseInt(value, config.MaxTokenLength);
                break;
            case "kospellcheck_ignore_all_caps_length_threshold":
                config.IgnoreAllCapsLengthThreshold = ParseInt(value, config.IgnoreAllCapsLengthThreshold);
                break;
            case "kospellcheck_suggestions_max":
                config.SuggestionsMax = ParseInt(value, config.SuggestionsMax);
                break;
            case "kospellcheck_prefer_terms":
                config.PreferTerms = ParsePreferTerms(value);
                break;
            case "kospellcheck_style_learning":
                config.StyleLearningEnabled = ParseBool(value, config.StyleLearningEnabled);
                break;
            case "kospellcheck_style_learning_max_files":
                config.StyleLearningMaxFiles = ParseInt(value, config.StyleLearningMaxFiles);
                break;
            case "kospellcheck_style_learning_max_tokens":
                config.StyleLearningMaxTokens = ParseInt(value, config.StyleLearningMaxTokens);
                break;
            case "kospellcheck_style_learning_time_budget_ms":
                config.StyleLearningTimeBudgetMs = ParseInt(value, config.StyleLearningTimeBudgetMs);
                break;
            case "kospellcheck_style_learning_file_extensions":
                config.StyleLearningFileExtensions = ParseList(value)
                    .Select(v => v.Trim().TrimStart('.').ToLowerInvariant())
                    .Where(v => v.Length > 0)
                    .ToList();
                break;
            case "kospellcheck_style_learning_cache_path":
                config.StyleLearningCachePath = value;
                break;
            case "kospellcheck_style_learning_min_token_length":
                config.StyleLearningMinTokenLength = ParseInt(value, config.StyleLearningMinTokenLength);
                break;
            case "kospellcheck_style_learning_ignore_folders":
                config.StyleLearningIgnoreFolders = ParseList(value);
                break;
            case "kospellcheck_local_typo_acceleration_mode":
                config.LocalTypoAccelerationMode = ParseTypoAccelerationMode(value, config.LocalTypoAccelerationMode);
                break;
            case "kospellcheck_local_typo_acceleration_show_detection_prompt":
                config.LocalTypoAccelerationShowDetectionPrompt =
                    ParseBool(value, config.LocalTypoAccelerationShowDetectionPrompt);
                break;
            case "kospellcheck_local_typo_acceleration_verbose_logging":
                config.LocalTypoAccelerationVerboseLogging =
                    ParseBool(value, config.LocalTypoAccelerationVerboseLogging);
                break;
        }
    }

    private static bool ParseBool(string value, bool fallback)
    {
        return bool.TryParse(value, out var parsed) ? parsed : fallback;
    }

    private static int ParseInt(string value, int fallback)
    {
        return int.TryParse(value, out var parsed) ? parsed : fallback;
    }

    private static List<string> ParseList(string value)
    {
        return value
            .Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(v => v.Trim())
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .ToList();
    }

    private static IDictionary<string, string> ParsePreferTerms(string value)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pairRaw in value.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = pairRaw.Trim();
            var idx = pair.IndexOf(':');
            if (idx <= 0)
            {
                continue;
            }

            var key = pair.Substring(0, idx).Trim();
            var mappedValue = pair.Substring(idx + 1).Trim();
            if (key.Length == 0 || mappedValue.Length == 0)
            {
                continue;
            }

            map[key] = mappedValue;
        }

        return map;
    }

    private static TypoAccelerationMode ParseTypoAccelerationMode(string value, TypoAccelerationMode fallback)
    {
        return TryParseTypoAccelerationMode(value, out var parsed)
            ? parsed
            : fallback;
    }

    private static bool TryParseTypoAccelerationMode(string? value, out TypoAccelerationMode mode)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            mode = TypoAccelerationMode.Auto;
            return false;
        }

        switch (value.Trim().ToLowerInvariant())
        {
            case "off":
                mode = TypoAccelerationMode.Off;
                return true;
            case "auto":
                mode = TypoAccelerationMode.Auto;
                return true;
            case "on":
                mode = TypoAccelerationMode.On;
                return true;
            default:
                mode = TypoAccelerationMode.Auto;
                return false;
        }
    }
}
