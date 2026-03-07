using KoSpellCheck.VS2022.Editor.Suggestions.Actions;
using KoSpellCheck.VS2022.Services;
using KoSpellCheck.Core.TypoAcceleration;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.VisualStudio.Language.Intellisense;
using Microsoft.VisualStudio.Text;

namespace KoSpellCheck.VS2022.Editor.Suggestions;

internal sealed class SpellSuggestedActionsSource : ISuggestedActionsSource
{
    private readonly ITextBuffer _textBuffer;
    private readonly SpellCheckOrchestrator _orchestrator;
    private readonly ConfigService _configService;

    public SpellSuggestedActionsSource(
        ITextBuffer textBuffer,
        SpellCheckOrchestrator orchestrator,
        ConfigService configService)
    {
        _textBuffer = textBuffer;
        _orchestrator = orchestrator;
        _configService = configService;

        _orchestrator.IssuesChanged += OnIssuesChanged;
    }

    public event EventHandler<EventArgs>? SuggestedActionsChanged;

    public void Dispose()
    {
        _orchestrator.IssuesChanged -= OnIssuesChanged;
    }

    public IEnumerable<SuggestedActionSet> GetSuggestedActions(
        ISuggestedActionCategorySet requestedActionCategories,
        SnapshotSpan range,
        CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested)
        {
            return Array.Empty<SuggestedActionSet>();
        }

        var issue = FindIssue(range);
        if (issue == null)
        {
            return Array.Empty<SuggestedActionSet>();
        }

        var actions = new List<ISuggestedAction>();
        var trackingSpan = range.Snapshot.CreateTrackingSpan(issue.Span, SpanTrackingMode.EdgeInclusive);
        var filePath = _configService.GetDocumentFilePath(_textBuffer);
        var issueContext = ClassifyIssueContext(range.Snapshot, issue);
        var forceLiteralSuggestions = issue.TypoClassification?.Category == TypoClassificationCategory.TextTypo;

        foreach (var suggestion in issue.Suggestions
                     .Select(s => s.Replacement)
                     .Where(s => !string.IsNullOrWhiteSpace(s))
                     .Distinct(StringComparer.OrdinalIgnoreCase)
                     .Take(5))
        {
            if (issueContext == IssueContextKind.Identifier &&
                !forceLiteralSuggestions &&
                IsLikelyIdentifier(issue.Token))
            {
                if (!IsLikelyIdentifier(suggestion))
                {
                    continue;
                }

                var renameTarget = BuildRenameTarget(range.Snapshot, issue.Span, suggestion);
                actions.Add(new ReplaceWithSuggestionAction(
                    _textBuffer,
                    trackingSpan,
                    suggestion,
                    SuggestionApplyMode.RenameSymbol,
                    filePath,
                    renameTarget));
                continue;
            }

            actions.Add(new ReplaceWithSuggestionAction(
                _textBuffer,
                trackingSpan,
                suggestion,
                SuggestionApplyMode.ReplaceSpan,
                filePath));
        }

        actions.Add(new AddToProjectDictionaryAction(_textBuffer, _orchestrator, _configService, issue.Token));

        return new[]
        {
            new SuggestedActionSet(
                PredefinedSuggestedActionCategoryNames.CodeFix,
                actions,
                priority: SuggestedActionSetPriority.Medium,
                title: "KoSpellCheck"),
        };
    }

    public bool HasSuggestedActions(
        ISuggestedActionCategorySet requestedActionCategories,
        SnapshotSpan range,
        CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested)
        {
            return false;
        }

        return FindIssue(range) != null;
    }

    public Task<bool> HasSuggestedActionsAsync(
        ISuggestedActionCategorySet requestedActionCategories,
        SnapshotSpan range,
        CancellationToken cancellationToken)
    {
        return Task.FromResult(HasSuggestedActions(requestedActionCategories, range, cancellationToken));
    }

    public bool TryGetTelemetryId(out Guid telemetryId)
    {
        telemetryId = Guid.Empty;
        return false;
    }

    private void OnIssuesChanged(object? sender, EventArgs e)
    {
        SuggestedActionsChanged?.Invoke(this, EventArgs.Empty);
    }

    private SpellIssueSnapshot? FindIssue(SnapshotSpan range)
    {
        var issues = _orchestrator.GetIssues(range.Snapshot);
        var intersecting = issues
            .Where(issue => issue.Span.IntersectsWith(range))
            .ToList();

        if (intersecting.Count == 0)
        {
            return _orchestrator.GetIssueAt(range.Start);
        }

        var containing = intersecting
            .Where(issue => issue.Span.Contains(range.Start))
            .OrderBy(issue => issue.Span.Length)
            .FirstOrDefault();
        if (containing != null)
        {
            return containing;
        }

        return intersecting
            .OrderBy(issue => DistanceToPoint(range.Start.Position, issue.Span))
            .FirstOrDefault();
    }

    private static int DistanceToPoint(int pointPosition, SnapshotSpan span)
    {
        if (pointPosition < span.Start.Position)
        {
            return span.Start.Position - pointPosition;
        }

        if (pointPosition > span.End.Position)
        {
            return pointPosition - span.End.Position;
        }

        return 0;
    }

    private static IssueContextKind ClassifyIssueContext(ITextSnapshot snapshot, SpellIssueSnapshot issue)
    {
        if (snapshot.Length == 0)
        {
            return IssueContextKind.Identifier;
        }

        var text = snapshot.GetText();
        var tree = CSharpSyntaxTree.ParseText(text);
        var root = tree.GetRoot();
        var position = Math.Min(Math.Max(issue.Span.Start.Position, 0), Math.Max(0, snapshot.Length - 1));

        var trivia = root.FindTrivia(position, findInsideTrivia: true);
        if (IsCommentTrivia(trivia.Kind()))
        {
            return IssueContextKind.Literal;
        }

        var token = root.FindToken(position, findInsideTrivia: true);
        if (IsStringToken(token.Kind()))
        {
            return IssueContextKind.Literal;
        }

        return token.IsKind(SyntaxKind.IdentifierToken)
            ? IssueContextKind.Identifier
            : IssueContextKind.Literal;
    }

    private static string BuildRenameTarget(ITextSnapshot snapshot, SnapshotSpan issueSpan, string replacement)
    {
        if (!IsLikelyIdentifier(replacement))
        {
            return replacement;
        }

        var identifierSpan = FindContainingIdentifierSpan(snapshot, issueSpan.Start.Position);
        if (identifierSpan == null)
        {
            return replacement;
        }

        var fullIdentifier = identifierSpan.Value.GetText();
        var relativeStart = issueSpan.Start.Position - identifierSpan.Value.Start.Position;
        var relativeEnd = issueSpan.End.Position - identifierSpan.Value.Start.Position;

        if (relativeStart < 0 ||
            relativeEnd < relativeStart ||
            relativeEnd > fullIdentifier.Length)
        {
            return replacement;
        }

        var candidate = fullIdentifier.Substring(0, relativeStart) +
                        replacement +
                        fullIdentifier.Substring(relativeEnd);

        return IsLikelyIdentifier(candidate) ? candidate : replacement;
    }

    private static SnapshotSpan? FindContainingIdentifierSpan(ITextSnapshot snapshot, int position)
    {
        var text = snapshot.GetText();
        if (position < 0 || position > text.Length)
        {
            return null;
        }

        var start = position;
        while (start > 0 && IsIdentifierChar(text[start - 1]))
        {
            start--;
        }

        var end = position;
        while (end < text.Length && IsIdentifierChar(text[end]))
        {
            end++;
        }

        if (start > 0 && text[start - 1] == '@')
        {
            start--;
        }

        if (end <= start)
        {
            return null;
        }

        return new SnapshotSpan(snapshot, Span.FromBounds(start, end));
    }

    private static bool IsIdentifierChar(char value)
    {
        if (value == '_')
        {
            return true;
        }

        var category = char.GetUnicodeCategory(value);
        return category is System.Globalization.UnicodeCategory.UppercaseLetter
            or System.Globalization.UnicodeCategory.LowercaseLetter
            or System.Globalization.UnicodeCategory.TitlecaseLetter
            or System.Globalization.UnicodeCategory.ModifierLetter
            or System.Globalization.UnicodeCategory.OtherLetter
            or System.Globalization.UnicodeCategory.DecimalDigitNumber
            or System.Globalization.UnicodeCategory.LetterNumber
            or System.Globalization.UnicodeCategory.NonSpacingMark
            or System.Globalization.UnicodeCategory.SpacingCombiningMark
            or System.Globalization.UnicodeCategory.ConnectorPunctuation;
    }

    private static bool IsLikelyIdentifier(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var token = value.StartsWith("@", StringComparison.Ordinal)
            ? value.Substring(1)
            : value;
        if (token.Length == 0)
        {
            return false;
        }

        var first = token[0];
        if (!(char.IsLetter(first) || first == '_'))
        {
            return false;
        }

        for (var i = 1; i < token.Length; i++)
        {
            if (!IsIdentifierChar(token[i]))
            {
                return false;
            }
        }

        return true;
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

    private enum IssueContextKind
    {
        Identifier = 0,
        Literal = 1
    }
}
