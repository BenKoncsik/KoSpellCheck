using KoSpellCheck.Core.Normalization;

namespace KoSpellCheck.Core.TypoAcceleration;

public sealed class HeuristicLocalTypoClassifier : ILocalTypoClassifier
{
    public TypoClassificationResult Classify(TypoClassificationRequest request)
    {
        if (request == null)
        {
            throw new ArgumentNullException(nameof(request));
        }

        var token = request.Token?.Trim() ?? string.Empty;
        if (token.Length == 0)
        {
            return BuildResult(false, 0.0, TypoClassificationCategory.Uncertain, "empty-token");
        }

        var normalizedToken = TextNormalizer.Normalize(token);
        if (normalizedToken.Length < 2)
        {
            return BuildResult(false, 0.45, TypoClassificationCategory.Uncertain, "too-short");
        }

        var topSuggestion = request.Suggestions.FirstOrDefault()?.Replacement ?? string.Empty;
        if (topSuggestion.Length == 0)
        {
            if (LooksLikeDomainToken(token))
            {
                return BuildResult(false, 0.68, TypoClassificationCategory.NotTypo, "domain-token-no-suggestion");
            }

            return BuildResult(false, 0.5, TypoClassificationCategory.Uncertain, "no-suggestion");
        }

        var normalizedSuggestion = TextNormalizer.Normalize(topSuggestion);
        if (normalizedSuggestion.Length == 0 || string.Equals(normalizedToken, normalizedSuggestion, StringComparison.Ordinal))
        {
            return BuildResult(false, 0.4, TypoClassificationCategory.Uncertain, "suggestion-equivalent");
        }

        var distance = BoundedDamerauLevenshtein(normalizedToken, normalizedSuggestion, 4);
        var maxLength = Math.Max(normalizedToken.Length, normalizedSuggestion.Length);
        var similarity = maxLength == 0 ? 1.0 : 1.0 - (distance / (double)maxLength);
        var looksDomainToken = LooksLikeDomainToken(token);

        var likelyTypo = distance <= 1 ||
                         (distance == 2 && similarity >= 0.55) ||
                         (distance == 3 && similarity >= 0.72 && normalizedToken.Length >= 8);
        if (looksDomainToken && distance > 2)
        {
            likelyTypo = false;
        }

        if (likelyTypo)
        {
            var category = request.Context == TypoClassificationContext.Identifier
                ? TypoClassificationCategory.IdentifierTypo
                : TypoClassificationCategory.TextTypo;
            var contextBoost = request.Context == TypoClassificationContext.Identifier ? 0.05 : 0.0;
            var confidence = Clamp(0.62 + ((4 - Math.Min(distance, 4)) * 0.08) + contextBoost, 0.6, 0.98);
            return BuildResult(true, confidence, category, "distance-match");
        }

        if (looksDomainToken && similarity < 0.5)
        {
            return BuildResult(false, 0.72, TypoClassificationCategory.NotTypo, "domain-token-low-similarity");
        }

        if (similarity < 0.42)
        {
            return BuildResult(false, 0.66, TypoClassificationCategory.NotTypo, "low-similarity");
        }

        return BuildResult(false, 0.5, TypoClassificationCategory.Uncertain, "uncertain");
    }

    private static TypoClassificationResult BuildResult(
        bool isTypo,
        double confidence,
        TypoClassificationCategory category,
        string reason)
    {
        return new TypoClassificationResult(isTypo, confidence, category, "heuristic-local", reason);
    }

    private static double Clamp(double value, double min, double max)
    {
        if (value < min)
        {
            return min;
        }

        if (value > max)
        {
            return max;
        }

        return value;
    }

    private static bool LooksLikeDomainToken(string token)
    {
        if (token.Length <= 1)
        {
            return true;
        }

        var hasDigit = false;
        var hasUpper = false;
        var hasLower = false;
        var hasUnderscore = false;
        var hasDash = false;
        foreach (var c in token)
        {
            if (char.IsDigit(c))
            {
                hasDigit = true;
            }
            else if (c == '_')
            {
                hasUnderscore = true;
            }
            else if (c == '-')
            {
                hasDash = true;
            }
            else if (char.IsLetter(c))
            {
                if (char.IsUpper(c))
                {
                    hasUpper = true;
                }
                else
                {
                    hasLower = true;
                }
            }
        }

        if (hasUnderscore || hasDash)
        {
            return true;
        }

        if (hasDigit && hasUpper)
        {
            return true;
        }

        if (token.Length >= 8 && hasUpper && hasLower && !token.Contains(' '))
        {
            return true;
        }

        return false;
    }

    private static int BoundedDamerauLevenshtein(string left, string right, int maxDistance)
    {
        var leftLength = left.Length;
        var rightLength = right.Length;
        if (Math.Abs(leftLength - rightLength) > maxDistance)
        {
            return maxDistance + 1;
        }

        var previousPrevious = new int[rightLength + 1];
        var previous = new int[rightLength + 1];
        var current = new int[rightLength + 1];

        for (var j = 0; j <= rightLength; j++)
        {
            previous[j] = j;
        }

        for (var i = 1; i <= leftLength; i++)
        {
            current[0] = i;
            var minInRow = current[0];
            for (var j = 1; j <= rightLength; j++)
            {
                var cost = left[i - 1] == right[j - 1] ? 0 : 1;
                var deletion = previous[j] + 1;
                var insertion = current[j - 1] + 1;
                var substitution = previous[j - 1] + cost;
                var value = Math.Min(Math.Min(deletion, insertion), substitution);

                if (i > 1 && j > 1 &&
                    left[i - 1] == right[j - 2] &&
                    left[i - 2] == right[j - 1])
                {
                    value = Math.Min(value, previousPrevious[j - 2] + 1);
                }

                current[j] = value;
                if (value < minInRow)
                {
                    minInRow = value;
                }
            }

            if (minInRow > maxDistance)
            {
                return maxDistance + 1;
            }

            var swap = previousPrevious;
            previousPrevious = previous;
            previous = current;
            current = swap;
        }

        return previous[rightLength];
    }
}
