using Microsoft.VisualStudio.Language.Intellisense;
using Microsoft.VisualStudio.Imaging.Interop;
using Microsoft.VisualStudio.Text;

namespace KoSpellCheck.VS2022.Editor.Suggestions.Actions;

internal sealed class ReplaceWithSuggestionAction : ISuggestedAction
{
    private readonly ITextBuffer _textBuffer;
    private readonly ITrackingSpan _trackingSpan;
    private readonly string _replacement;

    public ReplaceWithSuggestionAction(
        ITextBuffer textBuffer,
        ITrackingSpan trackingSpan,
        string replacement)
    {
        _textBuffer = textBuffer;
        _trackingSpan = trackingSpan;
        _replacement = replacement;
    }

    public string DisplayText => $"Replace with '{_replacement}'";

    public bool HasPreview => true;

    public bool HasActionSets => false;

    public ImageMoniker IconMoniker => default;

    public string IconAutomationText => string.Empty;

    public string InputGestureText => string.Empty;

    public void Dispose()
    {
        // No-op.
    }

    public Task<IEnumerable<SuggestedActionSet>?> GetActionSetsAsync(CancellationToken cancellationToken)
    {
        return Task.FromResult<IEnumerable<SuggestedActionSet>?>(Array.Empty<SuggestedActionSet>());
    }

    public Task<object?> GetPreviewAsync(CancellationToken cancellationToken)
    {
        return Task.FromResult<object?>($"Replace with '{_replacement}'");
    }

    public void Invoke(CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested)
        {
            return;
        }

        var currentSnapshot = _textBuffer.CurrentSnapshot;
        var span = _trackingSpan.GetSpan(currentSnapshot);
        if (span.Length <= 0)
        {
            return;
        }

        _textBuffer.Replace(span.Span, _replacement);
    }

    public bool TryGetTelemetryId(out Guid telemetryId)
    {
        telemetryId = Guid.Empty;
        return false;
    }
}
