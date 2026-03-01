namespace KoSpellCheck.Core.Style;

public sealed class TokenStyleStats
{
    public TokenStyleStats()
    {
        Variants = new Dictionary<string, int>(StringComparer.Ordinal);
    }

    public int TotalCount { get; set; }

    public IDictionary<string, int> Variants { get; set; }

    public string PreferredVariant
    {
        get
        {
            if (Variants.Count == 0)
            {
                return string.Empty;
            }

            string preferred = string.Empty;
            var maxCount = -1;

            foreach (var entry in Variants)
            {
                if (entry.Value > maxCount)
                {
                    preferred = entry.Key;
                    maxCount = entry.Value;
                    continue;
                }

                if (entry.Value == maxCount &&
                    string.Compare(entry.Key, preferred, StringComparison.Ordinal) < 0)
                {
                    preferred = entry.Key;
                }
            }

            return preferred;
        }
    }

    public double Confidence => TotalCount <= 0 ? 0 : Math.Min(1.0, TotalCount / 10.0);

    public bool HasConfidence(int minimumCount)
    {
        return TotalCount >= minimumCount;
    }

    public void AddVariant(string variant)
    {
        if (string.IsNullOrWhiteSpace(variant))
        {
            return;
        }

        if (!Variants.TryGetValue(variant, out var count))
        {
            count = 0;
        }

        Variants[variant] = count + 1;
        TotalCount++;
    }
}
