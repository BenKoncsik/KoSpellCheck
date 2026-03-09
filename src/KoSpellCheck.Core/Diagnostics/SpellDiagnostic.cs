namespace KoSpellCheck.Core.Diagnostics;

public enum SpellDiagnosticKind
{
    Misspelling = 0,
    PreferredTerm = 1,
}

public sealed class SpellDiagnostic
{
    public SpellDiagnostic(
        SpellDiagnosticKind kind,
        TextRange range,
        string token,
        string message,
        string? languageHint,
        IReadOnlyList<Suggestion> suggestions)
    {
        Kind = kind;
        Range = range;
        Token = token;
        Message = message;
        LanguageHint = languageHint;
        Suggestions = suggestions;
    }

    public SpellDiagnosticKind Kind { get; }

    public TextRange Range { get; }

    public string Token { get; }

    public string Message { get; }

    public string? LanguageHint { get; }

    public IReadOnlyList<Suggestion> Suggestions { get; }
}
