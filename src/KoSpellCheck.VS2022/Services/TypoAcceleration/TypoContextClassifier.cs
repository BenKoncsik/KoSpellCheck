using KoSpellCheck.Core.TypoAcceleration;

namespace KoSpellCheck.VS2022.Services.TypoAcceleration;

internal static class TypoContextClassifier
{
    public static TypoClassificationContext Classify(string text, int offset)
    {
        if (string.IsNullOrEmpty(text) || offset < 0 || offset >= text.Length)
        {
            return TypoClassificationContext.Identifier;
        }

        if (IsInsideQuotedString(text, offset) || IsInsideLineComment(text, offset))
        {
            return TypoClassificationContext.Text;
        }

        return TypoClassificationContext.Identifier;
    }

    private static bool IsInsideQuotedString(string text, int offset)
    {
        var inSingle = false;
        var inDouble = false;
        var escaped = false;

        for (var i = 0; i < text.Length && i < offset; i++)
        {
            var ch = text[i];
            if (ch == '\n' || ch == '\r')
            {
                if (!inSingle && !inDouble)
                {
                    escaped = false;
                }

                continue;
            }

            if (escaped)
            {
                escaped = false;
                continue;
            }

            if (ch == '\\')
            {
                escaped = inSingle || inDouble;
                continue;
            }

            if (!inDouble && ch == '\'')
            {
                inSingle = !inSingle;
                continue;
            }

            if (!inSingle && ch == '"')
            {
                inDouble = !inDouble;
            }
        }

        return inSingle || inDouble;
    }

    private static bool IsInsideLineComment(string text, int offset)
    {
        var lineStart = text.LastIndexOf('\n', Math.Max(0, offset - 1));
        if (lineStart < 0)
        {
            lineStart = 0;
        }
        else
        {
            lineStart += 1;
        }

        var lineEnd = text.IndexOf('\n', offset);
        if (lineEnd < 0)
        {
            lineEnd = text.Length;
        }

        var line = text.Substring(lineStart, lineEnd - lineStart);
        var localOffset = offset - lineStart;

        var inSingle = false;
        var inDouble = false;
        var escaped = false;
        for (var i = 0; i < line.Length && i < localOffset; i++)
        {
            var ch = line[i];
            var next = i + 1 < line.Length ? line[i + 1] : '\0';

            if (escaped)
            {
                escaped = false;
                continue;
            }

            if (ch == '\\')
            {
                escaped = inSingle || inDouble;
                continue;
            }

            if (!inDouble && ch == '\'')
            {
                inSingle = !inSingle;
                continue;
            }

            if (!inSingle && ch == '"')
            {
                inDouble = !inDouble;
                continue;
            }

            if (!inSingle && !inDouble && ch == '/' && next == '/')
            {
                return true;
            }
        }

        return false;
    }
}
