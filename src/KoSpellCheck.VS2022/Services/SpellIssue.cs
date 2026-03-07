using KoSpellCheck.Core.Diagnostics;
using KoSpellCheck.Core.TypoAcceleration;
using Microsoft.VisualStudio.Text;

namespace KoSpellCheck.VS2022.Services;

internal sealed class SpellIssue
{
    public SpellIssue(
        ITrackingSpan trackingSpan,
        string token,
        string message,
        IReadOnlyList<Suggestion> suggestions,
        string? languageHint,
        TypoClassificationResult? typoClassification)
    {
        TrackingSpan = trackingSpan;
        Token = token;
        Message = message;
        Suggestions = suggestions;
        LanguageHint = languageHint;
        TypoClassification = typoClassification;
    }

    public ITrackingSpan TrackingSpan { get; }

    public string Token { get; }

    public string Message { get; }

    public IReadOnlyList<Suggestion> Suggestions { get; }

    public string? LanguageHint { get; }

    public TypoClassificationResult? TypoClassification { get; }
}

internal sealed class SpellIssueSnapshot
{
    public SpellIssueSnapshot(SnapshotSpan span, SpellIssue issue)
    {
        Span = span;
        Token = issue.Token;
        Message = issue.Message;
        Suggestions = issue.Suggestions;
        LanguageHint = issue.LanguageHint;
        TypoClassification = issue.TypoClassification;
    }

    public SnapshotSpan Span { get; }

    public string Token { get; }

    public string Message { get; }

    public IReadOnlyList<Suggestion> Suggestions { get; }

    public string? LanguageHint { get; }

    public TypoClassificationResult? TypoClassification { get; }
}
