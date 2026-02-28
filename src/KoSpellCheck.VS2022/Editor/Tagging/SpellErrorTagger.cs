using KoSpellCheck.VS2022.Services;
using Microsoft.VisualStudio.Text.Adornments;
using Microsoft.VisualStudio.Text;
using Microsoft.VisualStudio.Text.Tagging;

namespace KoSpellCheck.VS2022.Editor.Tagging;

internal sealed class SpellErrorTagger : ITagger<ErrorTag>, IDisposable
{
    private readonly ITextBuffer _buffer;
    private readonly SpellCheckOrchestrator _orchestrator;
    private bool _disposed;

    public SpellErrorTagger(ITextBuffer buffer, SpellCheckOrchestrator orchestrator)
    {
        _buffer = buffer;
        _orchestrator = orchestrator;

        _orchestrator.IssuesChanged += OnIssuesChanged;
    }

    public event EventHandler<SnapshotSpanEventArgs>? TagsChanged;

    public IEnumerable<ITagSpan<ErrorTag>> GetTags(NormalizedSnapshotSpanCollection spans)
    {
        if (_disposed || spans.Count == 0)
        {
            yield break;
        }

        var snapshot = spans[0].Snapshot;
        var issues = _orchestrator.GetIssues(snapshot);
        foreach (var issue in issues)
        {
            if (!IntersectsAny(spans, issue.Span))
            {
                continue;
            }

            var tag = new ErrorTag(PredefinedErrorTypeNames.SyntaxError, issue.Message);
            yield return new TagSpan<ErrorTag>(issue.Span, tag);
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _orchestrator.IssuesChanged -= OnIssuesChanged;
    }

    private void OnIssuesChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        var snapshot = _buffer.CurrentSnapshot;
        var entireDocument = new SnapshotSpan(snapshot, 0, snapshot.Length);
        TagsChanged?.Invoke(this, new SnapshotSpanEventArgs(entireDocument));
    }

    private static bool IntersectsAny(NormalizedSnapshotSpanCollection spans, SnapshotSpan candidate)
    {
        foreach (var span in spans)
        {
            if (span.IntersectsWith(candidate))
            {
                return true;
            }
        }

        return false;
    }
}
