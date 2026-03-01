using System.ComponentModel.Composition;
using KoSpellCheck.Core.Style;
using KoSpellCheck.VS2022.Services;
using Microsoft.VisualStudio.Language.Intellisense;
using Microsoft.VisualStudio.Text;
using Microsoft.VisualStudio.Text.Editor;
using Microsoft.VisualStudio.Utilities;

namespace KoSpellCheck.VS2022.Editor.Suggestions;

[Export(typeof(ISuggestedActionsSourceProvider))]
[Name("KoSpellCheck Suggested Actions")]
[ContentType("CSharp")]
internal sealed class SpellSuggestedActionsSourceProvider : ISuggestedActionsSourceProvider
{
    private readonly ConfigService _configService;
    private readonly DictionaryService _dictionaryService;
    private readonly DocumentTextExtractor _documentTextExtractor;
    private readonly TelemetryLogger _telemetryLogger;
    private readonly IProjectStyleProfileProvider _projectStyleProfileProvider;

    [ImportingConstructor]
    public SpellSuggestedActionsSourceProvider(ITextDocumentFactoryService textDocumentFactoryService)
    {
        (_configService, _dictionaryService, _documentTextExtractor, _telemetryLogger, _projectStyleProfileProvider) =
            SpellServiceRegistry.GetServices(textDocumentFactoryService);
    }

    public ISuggestedActionsSource CreateSuggestedActionsSource(ITextView textView, ITextBuffer textBuffer)
    {
        var orchestrator = SpellCheckOrchestrator.GetOrCreate(
            textBuffer,
            _configService,
            _dictionaryService,
            _documentTextExtractor,
            _telemetryLogger,
            _projectStyleProfileProvider);

        return textBuffer.Properties.GetOrCreateSingletonProperty(
            typeof(SpellSuggestedActionsSource),
            () => new SpellSuggestedActionsSource(textBuffer, orchestrator, _configService));
    }
}
