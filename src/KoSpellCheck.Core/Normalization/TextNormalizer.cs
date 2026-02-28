using System.Globalization;
using System.Text;

namespace KoSpellCheck.Core.Normalization;

public static class TextNormalizer
{
    public static string Normalize(string token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return string.Empty;
        }

        return token.Normalize(NormalizationForm.FormKC).ToLowerInvariant();
    }

    public static string AsciiFold(string input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return string.Empty;
        }

        var normalized = input.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalized.Length);

        foreach (var c in normalized)
        {
            var unicodeCategory = CharUnicodeInfo.GetUnicodeCategory(c);
            if (unicodeCategory == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (c <= 127)
            {
                builder.Append(char.ToLowerInvariant(c));
            }
        }

        return builder.ToString().Normalize(NormalizationForm.FormKC);
    }

    public static bool IsAsciiOnly(string input)
    {
        foreach (var c in input)
        {
            if (c > 127)
            {
                return false;
            }
        }

        return true;
    }

    public static bool IsAllCaps(string input)
    {
        var hasLetter = false;
        foreach (var c in input)
        {
            if (!char.IsLetter(c))
            {
                continue;
            }

            hasLetter = true;
            if (!char.IsUpper(c))
            {
                return false;
            }
        }

        return hasLetter;
    }
}
