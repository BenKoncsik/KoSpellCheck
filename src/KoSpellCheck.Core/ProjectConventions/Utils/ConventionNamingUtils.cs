using System.Text;
using System.Text.RegularExpressions;
using KoSpellCheck.Core.ProjectConventions.Models;

namespace KoSpellCheck.Core.ProjectConventions.Utils;

public static class ConventionNamingUtils
{
    private static readonly Regex LowerToUpperBoundary = new("([a-z0-9])([A-Z])", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex UpperToWordBoundary = new("([A-Z])([A-Z][a-z])", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex TokenSeparators = new("[_\\-.\\s]+", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly string[] KnownSuffixes =
    {
        "Base",
        "Dto",
        "Service",
        "Controller",
        "Repository",
        "ViewModel",
        "Manager",
        "Provider",
        "Factory",
        "Options",
        "Config",
        "Request",
        "Response",
        "Entity",
        "Model",
        "Handler",
        "Command",
        "Query",
    };

    private static readonly string[] KnownPrefixes = { "I" };

    private static readonly IDictionary<string, string> AbbreviationExpansions =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["repo"] = "Repository",
            ["svc"] = "Service",
            ["cfg"] = "Config",
            ["ctrl"] = "Controller",
            ["dto"] = "Dto",
            ["vm"] = "ViewModel",
            ["req"] = "Request",
            ["resp"] = "Response",
            ["mgr"] = "Manager",
            ["prov"] = "Provider",
        };

    public static ConventionCaseStyle DetectCaseStyle(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return ConventionCaseStyle.Unknown;
        }

        if (Regex.IsMatch(value, "^[A-Z][a-zA-Z0-9]*$"))
        {
            return ConventionCaseStyle.PascalCase;
        }

        if (Regex.IsMatch(value, "^[a-z][a-zA-Z0-9]*$"))
        {
            return ConventionCaseStyle.CamelCase;
        }

        if (Regex.IsMatch(value, "^[a-z][a-z0-9_]*$") && value.Contains('_'))
        {
            return ConventionCaseStyle.SnakeCase;
        }

        if (Regex.IsMatch(value, "^[a-z][a-z0-9-]*$") && value.Contains('-'))
        {
            return ConventionCaseStyle.KebabCase;
        }

        if (Regex.IsMatch(value, "^[A-Z][A-Z0-9_]*$") && value.Contains('_'))
        {
            return ConventionCaseStyle.UpperCase;
        }

        return ConventionCaseStyle.Unknown;
    }

    public static IList<string> SplitIdentifierTokens(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return Array.Empty<string>();
        }

        var separated = LowerToUpperBoundary.Replace(value, "$1 $2");
        separated = UpperToWordBoundary.Replace(separated, "$1 $2");
        separated = TokenSeparators.Replace(separated, " ");
        separated = separated.Trim();
        if (separated.Length == 0)
        {
            return Array.Empty<string>();
        }

        return separated
            .Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(token => token.Trim())
            .Where(token => token.Length > 0)
            .ToList();
    }

    public static string? DetectKnownSuffix(string name, IEnumerable<string>? additional = null)
    {
        var suffixes = new HashSet<string>(KnownSuffixes, StringComparer.Ordinal);
        if (additional != null)
        {
            foreach (var value in additional)
            {
                if (!string.IsNullOrWhiteSpace(value))
                {
                    suffixes.Add(value);
                }
            }
        }

        foreach (var suffix in suffixes.OrderByDescending(v => v.Length))
        {
            if (name.Length > suffix.Length && name.EndsWith(suffix, StringComparison.Ordinal))
            {
                return suffix;
            }
        }

        return null;
    }

    public static string? DetectKnownPrefix(string name, IEnumerable<string>? additional = null)
    {
        var prefixes = new HashSet<string>(KnownPrefixes, StringComparer.Ordinal);
        if (additional != null)
        {
            foreach (var value in additional)
            {
                if (!string.IsNullOrWhiteSpace(value))
                {
                    prefixes.Add(value);
                }
            }
        }

        foreach (var prefix in prefixes.OrderByDescending(v => v.Length))
        {
            if (name.Length > prefix.Length && name.StartsWith(prefix, StringComparison.Ordinal))
            {
                return prefix;
            }
        }

        return null;
    }

    public static bool IsPluralWord(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length <= 2)
        {
            return false;
        }

        var lowered = value.ToLowerInvariant();
        if (lowered.EndsWith("ss", StringComparison.Ordinal))
        {
            return false;
        }

        return lowered.EndsWith("s", StringComparison.Ordinal);
    }

    public static string NormalizeToken(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var normalized = value.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalized.Length);

        foreach (var ch in normalized)
        {
            var category = System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch);
            if (category == System.Globalization.UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (char.IsLetterOrDigit(ch))
            {
                builder.Append(char.ToLowerInvariant(ch));
            }
        }

        return builder.ToString();
    }

    public static IList<string> NormalizeNamespace(string namespaceValue)
    {
        if (string.IsNullOrWhiteSpace(namespaceValue))
        {
            return Array.Empty<string>();
        }

        return namespaceValue
            .Split(new[] { '.' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(NormalizeToken)
            .Where(token => token.Length > 0)
            .ToList();
    }

    public static IList<string> NormalizePathSegments(string pathValue)
    {
        if (string.IsNullOrWhiteSpace(pathValue))
        {
            return Array.Empty<string>();
        }

        return pathValue
            .Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(NormalizeToken)
            .Where(token => token.Length > 0)
            .ToList();
    }

    public static string NormalizeFolderKey(string folderPath)
    {
        if (string.IsNullOrWhiteSpace(folderPath) || folderPath == ".")
        {
            return ".";
        }

        var normalized = folderPath.Replace('\\', '/').Trim('/');
        return string.IsNullOrWhiteSpace(normalized) ? "." : normalized;
    }

    public static string ReplaceSuffix(string name, string? fromSuffix, string toSuffix)
    {
        if (!string.IsNullOrEmpty(fromSuffix) &&
            name.EndsWith(fromSuffix, StringComparison.Ordinal) &&
            name.Length > fromSuffix.Length)
        {
            return name.Substring(0, name.Length - fromSuffix.Length) + toSuffix;
        }

        return string.Concat(name, toSuffix);
    }

    public static string ToPascalCase(string value)
    {
        var tokens = SplitIdentifierTokens(value);
        if (tokens.Count == 0)
        {
            return value;
        }

        return string.Concat(tokens.Select(token =>
            token.Length == 0
                ? token
                : char.ToUpperInvariant(token[0]) + token.Substring(1)));
    }

    public static string? AbbreviationToPreferred(string token)
    {
        var key = NormalizeToken(token);
        return AbbreviationExpansions.TryGetValue(key, out var preferred)
            ? preferred
            : null;
    }

    public static double SimilarityScore(IList<string> left, IList<string> right)
    {
        if (left.Count == 0 || right.Count == 0)
        {
            return 0;
        }

        var leftSet = new HashSet<string>(left);
        var rightSet = new HashSet<string>(right);
        var intersect = leftSet.Count(rightSet.Contains);

        var union = new HashSet<string>(leftSet);
        union.UnionWith(rightSet);
        if (union.Count == 0)
        {
            return 0;
        }

        return (double)intersect / union.Count;
    }

    public static IList<string> BuiltInSuffixes()
    {
        return KnownSuffixes.ToList();
    }
}
