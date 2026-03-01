using Microsoft.VisualStudio.Text;
using KoSpellCheck.Core.Style;

namespace KoSpellCheck.VS2022.Services;

internal static class SpellServiceRegistry
{
    private static readonly object Gate = new();

    private static ConfigService? _configService;
    private static DictionaryService? _dictionaryService;
    private static DocumentTextExtractor? _documentTextExtractor;
    private static TelemetryLogger? _telemetryLogger;
    private static IProjectStyleProfileProvider? _projectStyleProfileProvider;

    public static (
        ConfigService ConfigService,
        DictionaryService DictionaryService,
        DocumentTextExtractor DocumentTextExtractor,
        TelemetryLogger TelemetryLogger,
        IProjectStyleProfileProvider ProjectStyleProfileProvider) GetServices(ITextDocumentFactoryService textDocumentFactoryService)
    {
        lock (Gate)
        {
            _telemetryLogger ??= new TelemetryLogger();
            _documentTextExtractor ??= new DocumentTextExtractor();
            _configService ??= new ConfigService(textDocumentFactoryService);
            _dictionaryService ??= new DictionaryService(new ResourcePathResolver(), _telemetryLogger);
            _projectStyleProfileProvider ??= new ProjectStyleProfileProvider();

            return (_configService, _dictionaryService, _documentTextExtractor, _telemetryLogger, _projectStyleProfileProvider);
        }
    }
}
