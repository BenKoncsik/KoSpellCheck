using System.Text.RegularExpressions;
using KoSpellCheck.Core.Config;

namespace KoSpellCheck.Core.Tokenization;

public sealed class CodeAwareTokenizer
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

    private static readonly Regex EmailRegex =
        new(@"^[^\s@]+@[^\s@]+\.[^\s@]+$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex Base64LikeRegex =
        new(@"^[A-Za-z0-9+/_=-]{24,}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly char[] Separators = ['_', '-', '.', '/', '\\'];

    public IReadOnlyList<TokenSpan> Tokenize(string text, KoSpellCheckConfig config)
    {
        if (string.IsNullOrEmpty(text))
        {
            return Array.Empty<TokenSpan>();
        }

        var result = new List<TokenSpan>();

        foreach (Match match in CandidateRegex.Matches(text))
        {
            if (!match.Success)
            {
                continue;
            }

            var raw = match.Value;
            if (ShouldIgnoreRawToken(raw, config))
            {
                continue;
            }

            foreach (var localToken in SplitBySeparatorsAndCasing(raw))
            {
                if (localToken.Length == 0)
                {
                    continue;
                }

                var start = match.Index + localToken.Start;
                var end = match.Index + localToken.End;
                result.Add(new TokenSpan(localToken.Value, start, end));
            }
        }

        return result;
    }

    private static bool ShouldIgnoreRawToken(string token, KoSpellCheckConfig config)
    {
        if (token.Length == 0)
        {
            return true;
        }

        if (NumberRegex.IsMatch(token) || GuidRegex.IsMatch(token) || HexRegex.IsMatch(token) ||
            UrlRegex.IsMatch(token) || EmailRegex.IsMatch(token) || Base64LikeRegex.IsMatch(token))
        {
            return true;
        }

        if (LooksLikeFilePath(token))
        {
            return true;
        }

        foreach (var regex in config.BuildIgnoreRegexes())
        {
            if (regex.IsMatch(token))
            {
                return true;
            }
        }

        return false;
    }

    private static bool LooksLikeFilePath(string token)
    {
        if (token.Contains('/') || token.Contains('\\'))
        {
            return true;
        }

        return token.Contains('.') && token.Any(char.IsDigit);
    }

    private static IEnumerable<(string Value, int Start, int End, int Length)> SplitBySeparatorsAndCasing(string raw)
    {
        var chunkStart = 0;
        for (var i = 0; i <= raw.Length; i++)
        {
            if (i < raw.Length && Array.IndexOf(Separators, raw[i]) < 0)
            {
                continue;
            }

            if (i > chunkStart)
            {
                foreach (var token in SplitCamelCase(raw, chunkStart, i))
                {
                    yield return token;
                }
            }

            chunkStart = i + 1;
        }
    }

    private static IEnumerable<(string Value, int Start, int End, int Length)> SplitCamelCase(string raw, int start, int end)
    {
        var partStart = start;
        for (var i = start + 1; i < end; i++)
        {
            var prev = raw[i - 1];
            var curr = raw[i];
            var next = i + 1 < end ? raw[i + 1] : '\0';

            if (!IsBoundary(prev, curr, next))
            {
                continue;
            }

            var value = raw.Substring(partStart, i - partStart);
            yield return (value, partStart, i, value.Length);
            partStart = i;
        }

        if (partStart < end)
        {
            var value = raw.Substring(partStart, end - partStart);
            yield return (value, partStart, end, value.Length);
        }
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
}
