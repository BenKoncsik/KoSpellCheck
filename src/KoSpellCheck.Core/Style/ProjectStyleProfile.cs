namespace KoSpellCheck.Core.Style;

public sealed class ProjectStyleProfile
{
    public string WorkspaceRoot { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

    public IDictionary<string, TokenStyleStats> TokenStats { get; set; } =
        new Dictionary<string, TokenStyleStats>(StringComparer.Ordinal);

    public TokenStyleStats? TryGetStats(string token)
    {
        var normalized = StyleTokenNormalizer.NormalizeKey(token);
        if (normalized.Length == 0)
        {
            return null;
        }

        return TokenStats.TryGetValue(normalized, out var stats) ? stats : null;
    }
}
