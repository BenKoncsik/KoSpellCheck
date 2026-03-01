using KoSpellCheck.Core.Normalization;

namespace KoSpellCheck.Core.Style;

public static class StyleTokenNormalizer
{
    public static string NormalizeKey(string token)
    {
        var normalized = TextNormalizer.Normalize(token);
        if (normalized.Length == 0)
        {
            return string.Empty;
        }

        var folded = TextNormalizer.AsciiFold(normalized);
        return folded.Length == 0 ? normalized : folded;
    }
}
