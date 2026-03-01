using System.ComponentModel.Composition;
using KoSpellCheck.VS2022.Services;
using KoSpellCheck.Core.Style;
using Microsoft.VisualStudio.Text;
using Microsoft.VisualStudio.Text.Editor;
using Microsoft.VisualStudio.Text.Tagging;
using Microsoft.VisualStudio.Utilities;

namespace KoSpellCheck.VS2022.Editor.Tagging;

[Export(typeof(IViewTaggerProvider))]
[ContentType("CSharp")]
[TagType(typeof(ErrorTag))]
internal sealed class SpellErrorTaggerProvider : IViewTaggerProvider
{
    private readonly ConfigService _configService;
    private readonly DictionaryService _dictionaryService;
    private readonly DocumentTextExtractor _documentTextExtractor;
    private readonly TelemetryLogger _telemetryLogger;
    private readonly IProjectStyleProfileProvider _projectStyleProfileProvider;

    [ImportingConstructor]
    public SpellErrorTaggerProvider(ITextDocumentFactoryService textDocumentFactoryService)
    {
        (_configService, _dictionaryService, _documentTextExtractor, _telemetryLogger, _projectStyleProfileProvider) =
            SpellServiceRegistry.GetServices(textDocumentFactoryService);
    }

    public ITagger<T>? CreateTagger<T>(ITextView textView, ITextBuffer buffer)
        where T : ITag
    {
        if (textView.TextBuffer != buffer)
        {
            return null;
        }

        var orchestrator = SpellCheckOrchestrator.GetOrCreate(
            buffer,
            _configService,
            _dictionaryService,
            _documentTextExtractor,
            _telemetryLogger,
            _projectStyleProfileProvider);

        var tagger = buffer.Properties.GetOrCreateSingletonProperty(
            typeof(SpellErrorTagger),
            () => new SpellErrorTagger(buffer, orchestrator));

        return tagger as ITagger<T>;
    }
}
