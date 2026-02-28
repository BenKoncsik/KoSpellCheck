using KoSpellCheck.VS2022.Editor.Suggestions.Actions;
using KoSpellCheck.VS2022.Services;
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

        foreach (var suggestion in issue.Suggestions
                     .Select(s => s.Replacement)
                     .Where(s => !string.IsNullOrWhiteSpace(s))
                     .Distinct(StringComparer.OrdinalIgnoreCase)
                     .Take(5))
        {
            actions.Add(new ReplaceWithSuggestionAction(_textBuffer, trackingSpan, suggestion));
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
        foreach (var issue in issues)
        {
            if (issue.Span.IntersectsWith(range))
            {
                return issue;
            }
        }

        return _orchestrator.GetIssueAt(range.Start);
    }
}
