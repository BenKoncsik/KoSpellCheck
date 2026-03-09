using Newtonsoft.Json.Linq;
using KoSpellCheck.Core.TypoAcceleration;
using KoSpellCheck.Core.ProjectConventions.Config;
using KoSpellCheck.Core.Localization;

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
        var uiLanguage = json.Value<string>("uiLanguage");
        if (SharedUiText.TryNormalizeConfiguredLanguage(uiLanguage, out var normalizedUiLanguage))
        {
            config.UiLanguage = normalizedUiLanguage;
        }

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

        var projectConventions = json["projectConventions"] as JObject;
        var conventions = config.ProjectConventions.Clone();

        conventions.EnableProjectConventionMapping =
            projectConventions?.Value<bool?>("enabled")
            ?? json.Value<bool?>("projectConventionMappingEnabled")
            ?? conventions.EnableProjectConventionMapping;
        conventions.EnableNamingConventionDiagnostics =
            projectConventions?.Value<bool?>("namingDiagnosticsEnabled")
            ?? json.Value<bool?>("namingConventionDiagnosticsEnabled")
            ?? conventions.EnableNamingConventionDiagnostics;
        conventions.EnableStatisticalAnomalyDetection =
            projectConventions?.Value<bool?>("statisticalAnomalyDetectionEnabled")
            ?? json.Value<bool?>("statisticalAnomalyDetectionEnabled")
            ?? conventions.EnableStatisticalAnomalyDetection;
        conventions.EnableAiNamingAnomalyDetection =
            projectConventions?.Value<bool?>("aiNamingAnomalyDetectionEnabled")
            ?? json.Value<bool?>("aiNamingAnomalyDetectionEnabled")
            ?? conventions.EnableAiNamingAnomalyDetection;
        conventions.UseCoralTpuIfAvailable =
            projectConventions?.Value<bool?>("useCoralTpuIfAvailable")
            ?? json.Value<bool?>("useCoralTpuIfAvailable")
            ?? conventions.UseCoralTpuIfAvailable;
        conventions.AutoRebuildConventionProfile =
            projectConventions?.Value<bool?>("autoRebuild")
            ?? json.Value<bool?>("autoRebuildConventionProfile")
            ?? conventions.AutoRebuildConventionProfile;
        conventions.AnalyzeOnSave =
            projectConventions?.Value<bool?>("analyzeOnSave")
            ?? json.Value<bool?>("conventionAnalyzeOnSave")
            ?? conventions.AnalyzeOnSave;
        conventions.AnalyzeOnRename =
            projectConventions?.Value<bool?>("analyzeOnRename")
            ?? json.Value<bool?>("conventionAnalyzeOnRename")
            ?? conventions.AnalyzeOnRename;
        conventions.AnalyzeOnNewFile =
            projectConventions?.Value<bool?>("analyzeOnNewFile")
            ?? json.Value<bool?>("conventionAnalyzeOnNewFile")
            ?? conventions.AnalyzeOnNewFile;
        conventions.Scope =
            projectConventions?.Value<string>("scope")
            ?? json.Value<string>("conventionScope")
            ?? conventions.Scope;
        conventions.IgnoreGeneratedCode =
            projectConventions?.Value<bool?>("ignoreGeneratedCode")
            ?? json.Value<bool?>("conventionIgnoreGeneratedCode")
            ?? conventions.IgnoreGeneratedCode;
        conventions.IgnoreTestProjects =
            projectConventions?.Value<bool?>("ignoreTestProjects")
            ?? json.Value<bool?>("conventionIgnoreTestProjects")
            ?? conventions.IgnoreTestProjects;
        conventions.MaxFiles =
            projectConventions?.Value<int?>("maxFiles")
            ?? json.Value<int?>("projectConventionMaxFiles")
            ?? conventions.MaxFiles;
        conventions.MinEvidenceCount =
            projectConventions?.Value<int?>("minEvidenceCount")
            ?? json.Value<int?>("projectConventionMinEvidenceCount")
            ?? conventions.MinEvidenceCount;
        conventions.StatisticalAnomalyThreshold =
            projectConventions?.Value<double?>("statisticalAnomalyThreshold")
            ?? json.Value<double?>("statisticalAnomalyThreshold")
            ?? conventions.StatisticalAnomalyThreshold;
        conventions.AiAnomalyThreshold =
            projectConventions?.Value<double?>("aiAnomalyThreshold")
            ?? json.Value<double?>("aiAnomalyThreshold")
            ?? conventions.AiAnomalyThreshold;
        conventions.ConventionProfilePath =
            projectConventions?.Value<string>("profilePath")
            ?? json.Value<string>("projectConventionProfilePath")
            ?? conventions.ConventionProfilePath;
        conventions.ConventionProfileCachePath =
            projectConventions?.Value<string>("profileCachePath")
            ?? json.Value<string>("projectConventionProfileCachePath")
            ?? conventions.ConventionProfileCachePath;
        conventions.ConventionAnomalyModelPath =
            projectConventions?.Value<string>("anomalyModelPath")
            ?? json.Value<string>("projectConventionAnomalyModelPath")
            ?? conventions.ConventionAnomalyModelPath;
        conventions.ConventionScanSummaryPath =
            projectConventions?.Value<string>("scanSummaryPath")
            ?? json.Value<string>("projectConventionScanSummaryPath")
            ?? conventions.ConventionScanSummaryPath;
        conventions.ConventionIgnoreListPath =
            projectConventions?.Value<string>("ignoreListPath")
            ?? json.Value<string>("projectConventionIgnoreListPath")
            ?? conventions.ConventionIgnoreListPath;

        var includePatterns = projectConventions?["includePatterns"]?.Values<string>()?.ToList()
            ?? json["projectConventionIncludePatterns"]?.Values<string>()?.ToList();
        if (includePatterns is { Count: > 0 })
        {
            conventions.IncludePatterns = includePatterns;
        }

        var excludePatterns = projectConventions?["excludePatterns"]?.Values<string>()?.ToList()
            ?? json["projectConventionExcludePatterns"]?.Values<string>()?.ToList();
        if (excludePatterns is { Count: > 0 })
        {
            conventions.ExcludePatterns = excludePatterns;
        }

        var supportedExtensions = projectConventions?["supportedExtensions"]?.Values<string>()?.ToList()
            ?? json["projectConventionSupportedExtensions"]?.Values<string>()?.ToList();
        if (supportedExtensions is { Count: > 0 })
        {
            conventions.SupportedExtensions = supportedExtensions
                .Where(v => !string.IsNullOrWhiteSpace(v))
                .Select(v => v.Trim().TrimStart('.').ToLowerInvariant())
                .ToList();
        }

        config.ProjectConventions = conventions;

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
            case "kospellcheck_ui_language":
                if (SharedUiText.TryNormalizeConfiguredLanguage(value, out var normalizedUiLanguage))
                {
                    config.UiLanguage = normalizedUiLanguage;
                }
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
            case "kospellcheck_project_convention_mapping_enabled":
                config.ProjectConventions.EnableProjectConventionMapping =
                    ParseBool(value, config.ProjectConventions.EnableProjectConventionMapping);
                break;
            case "kospellcheck_naming_convention_diagnostics_enabled":
                config.ProjectConventions.EnableNamingConventionDiagnostics =
                    ParseBool(value, config.ProjectConventions.EnableNamingConventionDiagnostics);
                break;
            case "kospellcheck_statistical_anomaly_detection_enabled":
                config.ProjectConventions.EnableStatisticalAnomalyDetection =
                    ParseBool(value, config.ProjectConventions.EnableStatisticalAnomalyDetection);
                break;
            case "kospellcheck_ai_naming_anomaly_detection_enabled":
                config.ProjectConventions.EnableAiNamingAnomalyDetection =
                    ParseBool(value, config.ProjectConventions.EnableAiNamingAnomalyDetection);
                break;
            case "kospellcheck_use_coral_tpu_if_available":
                config.ProjectConventions.UseCoralTpuIfAvailable =
                    ParseBool(value, config.ProjectConventions.UseCoralTpuIfAvailable);
                break;
            case "kospellcheck_auto_rebuild_convention_profile":
                config.ProjectConventions.AutoRebuildConventionProfile =
                    ParseBool(value, config.ProjectConventions.AutoRebuildConventionProfile);
                break;
            case "kospellcheck_convention_analyze_on_save":
                config.ProjectConventions.AnalyzeOnSave =
                    ParseBool(value, config.ProjectConventions.AnalyzeOnSave);
                break;
            case "kospellcheck_convention_analyze_on_rename":
                config.ProjectConventions.AnalyzeOnRename =
                    ParseBool(value, config.ProjectConventions.AnalyzeOnRename);
                break;
            case "kospellcheck_convention_analyze_on_new_file":
                config.ProjectConventions.AnalyzeOnNewFile =
                    ParseBool(value, config.ProjectConventions.AnalyzeOnNewFile);
                break;
            case "kospellcheck_convention_scope":
                config.ProjectConventions.Scope = value;
                break;
            case "kospellcheck_convention_ignore_generated_code":
                config.ProjectConventions.IgnoreGeneratedCode =
                    ParseBool(value, config.ProjectConventions.IgnoreGeneratedCode);
                break;
            case "kospellcheck_convention_ignore_test_projects":
                config.ProjectConventions.IgnoreTestProjects =
                    ParseBool(value, config.ProjectConventions.IgnoreTestProjects);
                break;
            case "kospellcheck_project_convention_include_patterns":
                config.ProjectConventions.IncludePatterns = ParseList(value);
                break;
            case "kospellcheck_project_convention_exclude_patterns":
                config.ProjectConventions.ExcludePatterns = ParseList(value);
                break;
            case "kospellcheck_project_convention_supported_extensions":
                config.ProjectConventions.SupportedExtensions = ParseList(value)
                    .Select(v => v.Trim().TrimStart('.').ToLowerInvariant())
                    .Where(v => !string.IsNullOrWhiteSpace(v))
                    .ToList();
                break;
            case "kospellcheck_project_convention_max_files":
                config.ProjectConventions.MaxFiles = ParseInt(value, config.ProjectConventions.MaxFiles);
                break;
            case "kospellcheck_project_convention_min_evidence_count":
                config.ProjectConventions.MinEvidenceCount = ParseInt(value, config.ProjectConventions.MinEvidenceCount);
                break;
            case "kospellcheck_statistical_anomaly_threshold":
                config.ProjectConventions.StatisticalAnomalyThreshold =
                    ParseDouble(value, config.ProjectConventions.StatisticalAnomalyThreshold);
                break;
            case "kospellcheck_ai_anomaly_threshold":
                config.ProjectConventions.AiAnomalyThreshold =
                    ParseDouble(value, config.ProjectConventions.AiAnomalyThreshold);
                break;
            case "kospellcheck_project_convention_profile_path":
                config.ProjectConventions.ConventionProfilePath = value;
                break;
            case "kospellcheck_project_convention_profile_cache_path":
                config.ProjectConventions.ConventionProfileCachePath = value;
                break;
            case "kospellcheck_project_convention_anomaly_model_path":
                config.ProjectConventions.ConventionAnomalyModelPath = value;
                break;
            case "kospellcheck_project_convention_scan_summary_path":
                config.ProjectConventions.ConventionScanSummaryPath = value;
                break;
            case "kospellcheck_project_convention_ignore_list_path":
                config.ProjectConventions.ConventionIgnoreListPath = value;
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

    private static double ParseDouble(string value, double fallback)
    {
        return double.TryParse(value, out var parsed) ? parsed : fallback;
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
