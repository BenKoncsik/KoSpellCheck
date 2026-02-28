namespace KoSpellCheck.Core.Diagnostics;

public sealed class SpellDiagnostic
{
    public SpellDiagnostic(
        TextRange range,
        string token,
        string message,
        string? languageHint,
        IReadOnlyList<Suggestion> suggestions)
    {
        Range = range;
        Token = token;
        Message = message;
        LanguageHint = languageHint;
        Suggestions = suggestions;
    }

    public TextRange Range { get; }

    public string Token { get; }

    public string Message { get; }

    public string? LanguageHint { get; }

    public IReadOnlyList<Suggestion> Suggestions { get; }
}
