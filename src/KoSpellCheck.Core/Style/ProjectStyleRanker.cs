using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Diagnostics;
using KoSpellCheck.Core.Engine;
using KoSpellCheck.Core.Normalization;

namespace KoSpellCheck.Core.Style;

public sealed class ProjectStyleRanker : IStyleRanker
{
    public IReadOnlyList<Suggestion> Rank(
        string originalToken,
        IReadOnlyList<Suggestion> suggestions,
        SpellCheckContext ctx)
    {
        if (suggestions.Count <= 1)
        {
            return suggestions;
        }

        var originalNormalized = StyleTokenNormalizer.NormalizeKey(originalToken);
        var ranked = suggestions
            .Select((suggestion, index) => new RankedSuggestion(
                suggestion,
                index,
                ComputeScore(originalNormalized, suggestion, ctx)))
            .OrderByDescending(entry => entry.Score)
            .ThenBy(entry => entry.OriginalIndex)
            .Select(entry => entry.Suggestion)
            .ToList();

        return ranked;
    }

    private static double ComputeScore(
        string originalNormalized,
        Suggestion suggestion,
        SpellCheckContext ctx)
    {
        var score = suggestion.Confidence;

        if (IsPreferredTermOverride(originalNormalized, suggestion.Replacement, ctx.Config))
        {
            score += 1000;
        }

        var profile = ctx.ProjectStyleProfile;
        if (profile == null)
        {
            return score;
        }

        var stats = profile.TryGetStats(suggestion.Replacement);
        if (stats == null || stats.TotalCount == 0)
        {
            return score;
        }

        if (string.Equals(stats.PreferredVariant, suggestion.Replacement, StringComparison.Ordinal))
        {
            score += 100;
        }

        var dominantPattern = ResolveDominantPattern(stats);
        if (dominantPattern != TokenCasePattern.Unknown &&
            ClassifyPattern(suggestion.Replacement) == dominantPattern)
        {
            score += 50;
        }

        score += Math.Min(25, stats.TotalCount);
        return score;
    }

    private static bool IsPreferredTermOverride(string normalizedOriginalToken, string replacement, KoSpellCheckConfig config)
    {
        var replacementNormalized = TextNormalizer.Normalize(replacement);

        foreach (var pair in config.PreferTerms)
        {
            if (!string.Equals(TextNormalizer.Normalize(pair.Key), normalizedOriginalToken, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            return string.Equals(TextNormalizer.Normalize(pair.Value), replacementNormalized, StringComparison.OrdinalIgnoreCase);
        }

        return false;
    }

    private static TokenCasePattern ResolveDominantPattern(TokenStyleStats stats)
    {
        var byPattern = new Dictionary<TokenCasePattern, int>();

        foreach (var variant in stats.Variants)
        {
            var pattern = ClassifyPattern(variant.Key);
            if (!byPattern.TryGetValue(pattern, out var count))
            {
                count = 0;
            }

            byPattern[pattern] = count + variant.Value;
        }

        var dominant = TokenCasePattern.Unknown;
        var maxCount = -1;
        foreach (var entry in byPattern)
        {
            if (entry.Value > maxCount)
            {
                dominant = entry.Key;
                maxCount = entry.Value;
            }
        }

        return dominant;
    }

    private static TokenCasePattern ClassifyPattern(string token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return TokenCasePattern.Unknown;
        }

        if (token.Contains('_'))
        {
            if (token.All(c => !char.IsLetter(c) || char.IsLower(c)))
            {
                return TokenCasePattern.SnakeLower;
            }

            if (token.All(c => !char.IsLetter(c) || char.IsUpper(c)))
            {
                return TokenCasePattern.SnakeUpper;
            }

            return TokenCasePattern.Unknown;
        }

        if (token.Contains('-'))
        {
            if (token.All(c => !char.IsLetter(c) || char.IsLower(c)))
            {
                return TokenCasePattern.KebabLower;
            }

            if (token.All(c => !char.IsLetter(c) || char.IsUpper(c)))
            {
                return TokenCasePattern.KebabUpper;
            }

            return TokenCasePattern.Unknown;
        }

        if (token.All(c => !char.IsLetter(c) || char.IsUpper(c)))
        {
            return TokenCasePattern.Upper;
        }

        if (token.All(c => !char.IsLetter(c) || char.IsLower(c)))
        {
            return TokenCasePattern.Lower;
        }

        if (char.IsUpper(token[0]) && token.Skip(1).Any(char.IsLower))
        {
            return TokenCasePattern.Pascal;
        }

        if (char.IsLower(token[0]) && token.Any(char.IsUpper))
        {
            return TokenCasePattern.Camel;
        }

        return TokenCasePattern.Unknown;
    }

    private sealed class RankedSuggestion
    {
        public RankedSuggestion(Suggestion suggestion, int originalIndex, double score)
        {
            Suggestion = suggestion;
            OriginalIndex = originalIndex;
            Score = score;
        }

        public Suggestion Suggestion { get; }

        public int OriginalIndex { get; }

        public double Score { get; }
    }

    private enum TokenCasePattern
    {
        Unknown = 0,
        Lower = 1,
        Upper = 2,
        Pascal = 3,
        Camel = 4,
        SnakeLower = 5,
        SnakeUpper = 6,
        KebabLower = 7,
        KebabUpper = 8,
    }
}
