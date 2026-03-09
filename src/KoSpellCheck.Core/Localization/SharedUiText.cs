using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using KoSpellCheck.Core.Config;

namespace KoSpellCheck.Core.Localization;

public static class SharedUiText
{
    private const string ResourceName = "KoSpellCheck.Core.Localization.SharedUiStrings.json";
    private const string DefaultLanguageCode = "en";
    private const string AutoLanguageCode = "auto";
    private static readonly Lazy<LocalizationCatalog> Catalog = new(LoadCatalog);

    public static string Get(KoSpellCheckConfig config, string key, params (string Name, object? Value)[] args)
    {
        return Get(key, config?.UiLanguage, args);
    }

    public static string Get(string key, string? configuredLanguage = null, params (string Name, object? Value)[] args)
    {
        var catalog = Catalog.Value;
        var languageCode = ResolveLanguageCode(configuredLanguage);
        var template = catalog.Lookup(languageCode, key)
            ?? catalog.Lookup(catalog.DefaultLanguage, key)
            ?? key;

        return Format(template, args);
    }

    public static string ResolveLanguageCode(string? configuredLanguage)
    {
        var normalized = NormalizeConfiguredLanguage(configuredLanguage);
        if (!string.Equals(normalized, AutoLanguageCode, StringComparison.Ordinal))
        {
            return normalized;
        }

        var current = CultureInfo.CurrentUICulture?.TwoLetterISOLanguageName?.Trim().ToLowerInvariant();
        if (!string.IsNullOrWhiteSpace(current) && Catalog.Value.HasLanguage(current))
        {
            return current;
        }

        return Catalog.Value.DefaultLanguage;
    }

    public static bool TryNormalizeConfiguredLanguage(string? value, out string normalized)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            normalized = AutoLanguageCode;
            return true;
        }

        var trimmed = value.Trim().ToLowerInvariant();
        switch (trimmed)
        {
            case "auto":
            case "system":
                normalized = AutoLanguageCode;
                return true;
            case "en":
            case "eng":
            case "english":
                normalized = "en";
                return true;
            case "hu":
            case "hun":
            case "hungarian":
            case "magyar":
                normalized = "hu";
                return true;
            default:
                normalized = AutoLanguageCode;
                return false;
        }
    }

    private static string NormalizeConfiguredLanguage(string? value)
    {
        if (TryNormalizeConfiguredLanguage(value, out var normalized))
        {
            return normalized;
        }

        return AutoLanguageCode;
    }

    private static string Format(string template, IReadOnlyList<(string Name, object? Value)> args)
    {
        var output = template;
        foreach (var arg in args)
        {
            if (string.IsNullOrWhiteSpace(arg.Name))
            {
                continue;
            }

            var value = Convert.ToString(arg.Value, CultureInfo.InvariantCulture) ?? string.Empty;
            output = output.Replace("{" + arg.Name + "}", value);
        }

        return output;
    }

    private static LocalizationCatalog LoadCatalog()
    {
        var assembly = typeof(SharedUiText).Assembly;
        using var stream = assembly.GetManifestResourceStream(ResourceName);
        if (stream == null)
        {
            return LocalizationCatalog.Fallback(DefaultLanguageCode);
        }

        using var reader = new StreamReader(stream);
        var content = reader.ReadToEnd();
        if (string.IsNullOrWhiteSpace(content))
        {
            return LocalizationCatalog.Fallback(DefaultLanguageCode);
        }

        try
        {
            var root = JObject.Parse(content);
            var defaultLanguage = root.Value<string>("defaultLanguage")?.Trim().ToLowerInvariant();
            var languagesObject = root["languages"] as JObject;
            if (languagesObject == null)
            {
                return LocalizationCatalog.Fallback(DefaultLanguageCode);
            }

            var languages = new Dictionary<string, IDictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
            foreach (var languageProperty in languagesObject.Properties())
            {
                if (languageProperty.Value is not JObject languageMap)
                {
                    continue;
                }

                var languageCode = languageProperty.Name.Trim().ToLowerInvariant();
                if (string.IsNullOrWhiteSpace(languageCode))
                {
                    continue;
                }

                var entries = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var entry in languageMap.Properties())
                {
                    var key = entry.Name.Trim();
                    var value = entry.Value.Value<string>();
                    if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(value))
                    {
                        continue;
                    }

                    entries[key] = value;
                }

                if (entries.Count > 0)
                {
                    languages[languageCode] = entries;
                }
            }

            if (languages.Count == 0)
            {
                return LocalizationCatalog.Fallback(DefaultLanguageCode);
            }

            if (string.IsNullOrWhiteSpace(defaultLanguage) || !languages.ContainsKey(defaultLanguage))
            {
                defaultLanguage = languages.ContainsKey(DefaultLanguageCode)
                    ? DefaultLanguageCode
                    : languages.Keys.First();
            }

            return new LocalizationCatalog(defaultLanguage, languages);
        }
        catch
        {
            return LocalizationCatalog.Fallback(DefaultLanguageCode);
        }
    }

    private sealed class LocalizationCatalog
    {
        private readonly IDictionary<string, IDictionary<string, string>> _languages;

        public LocalizationCatalog(string defaultLanguage, IDictionary<string, IDictionary<string, string>> languages)
        {
            DefaultLanguage = defaultLanguage;
            _languages = languages;
        }

        public string DefaultLanguage { get; }

        public bool HasLanguage(string code)
        {
            return _languages.ContainsKey(code);
        }

        public string? Lookup(string languageCode, string key)
        {
            if (_languages.TryGetValue(languageCode, out var language) &&
                language.TryGetValue(key, out var value))
            {
                return value;
            }

            return null;
        }

        public static LocalizationCatalog Fallback(string defaultLanguage)
        {
            var languages = new Dictionary<string, IDictionary<string, string>>(StringComparer.OrdinalIgnoreCase)
            {
                [defaultLanguage] = new Dictionary<string, string>(StringComparer.Ordinal)
            };

            return new LocalizationCatalog(defaultLanguage, languages);
        }
    }
}
