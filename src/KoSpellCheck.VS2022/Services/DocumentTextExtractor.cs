using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace KoSpellCheck.VS2022.Services;

internal sealed class DocumentTextExtractor
{
    public string ExtractForSpellCheck(string text, SpellCheckScope scope)
    {
        if (scope == SpellCheckScope.Document)
        {
            return text;
        }

        var masked = Enumerable.Repeat(' ', text.Length).ToArray();
        var tree = CSharpSyntaxTree.ParseText(text);
        var root = tree.GetRoot();

        foreach (var token in root.DescendantTokens())
        {
            if (token.IsKind(SyntaxKind.IdentifierToken))
            {
                CopyToMasked(text, masked, token.SpanStart, token.Span.Length);
                continue;
            }

            if (scope == SpellCheckScope.IdentifiersCommentsAndStrings && IsStringToken(token.Kind()))
            {
                CopyToMasked(text, masked, token.SpanStart, token.Span.Length);
            }
        }

        if (scope is SpellCheckScope.IdentifiersAndComments or SpellCheckScope.IdentifiersCommentsAndStrings)
        {
            foreach (var trivia in root.DescendantTrivia(descendIntoTrivia: true))
            {
                if (IsCommentTrivia(trivia.Kind()))
                {
                    CopyToMasked(text, masked, trivia.SpanStart, trivia.Span.Length);
                }
            }
        }

        return new string(masked);
    }

    private static void CopyToMasked(string text, char[] masked, int start, int length)
    {
        var safeStart = Math.Max(0, start);
        var safeLength = Math.Min(length, text.Length - safeStart);

        for (var i = 0; i < safeLength; i++)
        {
            masked[safeStart + i] = text[safeStart + i];
        }
    }

    private static bool IsCommentTrivia(SyntaxKind kind)
    {
        return kind is SyntaxKind.SingleLineCommentTrivia
            or SyntaxKind.MultiLineCommentTrivia
            or SyntaxKind.SingleLineDocumentationCommentTrivia
            or SyntaxKind.MultiLineDocumentationCommentTrivia;
    }

    private static bool IsStringToken(SyntaxKind kind)
    {
        return kind is SyntaxKind.StringLiteralToken
            or SyntaxKind.InterpolatedStringTextToken
            or SyntaxKind.CharacterLiteralToken
            or SyntaxKind.Utf8StringLiteralToken;
    }
}
