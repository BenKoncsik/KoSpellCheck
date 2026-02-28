using KoSpellCheck.VS2022.Services;
using Microsoft.VisualStudio.Imaging.Interop;
using Microsoft.VisualStudio.Language.Intellisense;
using Microsoft.VisualStudio.Text;

namespace KoSpellCheck.VS2022.Editor.Suggestions.Actions;

internal sealed class AddToProjectDictionaryAction : ISuggestedAction
{
    private readonly ITextBuffer _textBuffer;
    private readonly SpellCheckOrchestrator _orchestrator;
    private readonly ConfigService _configService;
    private readonly string _token;

    public AddToProjectDictionaryAction(
        ITextBuffer textBuffer,
        SpellCheckOrchestrator orchestrator,
        ConfigService configService,
        string token)
    {
        _textBuffer = textBuffer;
        _orchestrator = orchestrator;
        _configService = configService;
        _token = token;
    }

    public string DisplayText => $"Add '{_token}' to project dictionary";

    public bool HasPreview => false;

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
        return Task.FromResult<object?>(string.Empty);
    }

    public void Invoke(CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested)
        {
            return;
        }

        if (_configService.AddWordToProjectDictionary(_textBuffer, _token))
        {
            _orchestrator.RequestRefresh();
        }
    }

    public bool TryGetTelemetryId(out Guid telemetryId)
    {
        telemetryId = Guid.Empty;
        return false;
    }
}
