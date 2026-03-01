using Microsoft.VisualStudio.Language.Intellisense;
using Microsoft.VisualStudio.Imaging.Interop;
using Microsoft.VisualStudio.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Rename;

namespace KoSpellCheck.VS2022.Editor.Suggestions.Actions;

internal sealed class ReplaceWithSuggestionAction : ISuggestedAction
{
    private readonly ITextBuffer _textBuffer;
    private readonly ITrackingSpan _trackingSpan;
    private readonly string _replacement;
    private readonly string? _filePath;

    public ReplaceWithSuggestionAction(
        ITextBuffer textBuffer,
        ITrackingSpan trackingSpan,
        string replacement,
        string? filePath = null)
    {
        _textBuffer = textBuffer;
        _trackingSpan = trackingSpan;
        _replacement = replacement;
        _filePath = filePath;
    }

    public string DisplayText =>
        IsLikelyIdentifier(_replacement)
            ? $"Rename symbol to '{_replacement}'"
            : $"Replace with '{_replacement}'";

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

        if (TryRenameSymbol(cancellationToken))
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

    private bool TryRenameSymbol(CancellationToken cancellationToken)
    {
        try
        {
            return Task.Run(() => TryRenameSymbolAsync(cancellationToken), cancellationToken)
                .GetAwaiter()
                .GetResult();
        }
        catch
        {
            return false;
        }
    }

    private async Task<bool> TryRenameSymbolAsync(CancellationToken cancellationToken)
    {
        if (!IsLikelyIdentifier(_replacement))
        {
            return false;
        }

        if (!_textBuffer.Properties.TryGetProperty(typeof(Workspace), out Workspace? workspace) || workspace == null)
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(_filePath))
        {
            return false;
        }

        var snapshot = _textBuffer.CurrentSnapshot;
        var span = _trackingSpan.GetSpan(snapshot);
        if (span.Length <= 0)
        {
            return false;
        }

        var documentId = workspace.CurrentSolution
            .GetDocumentIdsWithFilePath(_filePath!)
            .FirstOrDefault();
        if (documentId == null)
        {
            return false;
        }

        var document = workspace.CurrentSolution.GetDocument(documentId);
        if (document == null)
        {
            return false;
        }

        var root = await document.GetSyntaxRootAsync(cancellationToken).ConfigureAwait(false);
        var semanticModel = await document.GetSemanticModelAsync(cancellationToken).ConfigureAwait(false);
        if (root == null || semanticModel == null)
        {
            return false;
        }

        var token = root.FindToken(span.Start.Position);
        var node = token.Parent;
        if (node == null)
        {
            return false;
        }

        var symbol = semanticModel.GetDeclaredSymbol(node, cancellationToken)
            ?? semanticModel.GetSymbolInfo(node, cancellationToken).Symbol
            ?? (node.Parent != null ? semanticModel.GetDeclaredSymbol(node.Parent, cancellationToken) : null)
            ?? (node.Parent != null ? semanticModel.GetSymbolInfo(node.Parent, cancellationToken).Symbol : null);

        if (symbol == null || symbol.Kind == SymbolKind.ErrorType)
        {
            return false;
        }

#pragma warning disable CS0618
        var renamedSolution = await Renamer
            .RenameSymbolAsync(workspace.CurrentSolution, symbol, _replacement, workspace.Options, cancellationToken)
            .ConfigureAwait(false);
#pragma warning restore CS0618

        return workspace.TryApplyChanges(renamedSolution);
    }

    private static bool IsLikelyIdentifier(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var token = value.StartsWith("@", StringComparison.Ordinal) ? value.Substring(1) : value;
        if (token.Length == 0)
        {
            return false;
        }

        if (!(char.IsLetter(token[0]) || token[0] == '_'))
        {
            return false;
        }

        for (var i = 1; i < token.Length; i++)
        {
            var c = token[i];
            if (!(char.IsLetterOrDigit(c) || c == '_'))
            {
                return false;
            }
        }

        return true;
    }

    public bool TryGetTelemetryId(out Guid telemetryId)
    {
        telemetryId = Guid.Empty;
        return false;
    }
}
