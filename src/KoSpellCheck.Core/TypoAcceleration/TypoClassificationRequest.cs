using KoSpellCheck.Core.Diagnostics;

namespace KoSpellCheck.Core.TypoAcceleration;

public sealed class TypoClassificationRequest
{
    public TypoClassificationRequest(
        string token,
        IReadOnlyList<Suggestion> suggestions,
        TypoClassificationContext context)
    {
        Token = token;
        Suggestions = suggestions;
        Context = context;
    }

    public string Token { get; }

    public IReadOnlyList<Suggestion> Suggestions { get; }

    public TypoClassificationContext Context { get; }
}
