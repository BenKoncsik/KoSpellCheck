using Microsoft.VisualStudio.Text;

namespace KoSpellCheck.VS2022.Services;

internal static class SpellServiceRegistry
{
    private static readonly object Gate = new();

    private static ConfigService? _configService;
    private static DictionaryService? _dictionaryService;
    private static DocumentTextExtractor? _documentTextExtractor;
    private static TelemetryLogger? _telemetryLogger;

    public static (
        ConfigService ConfigService,
        DictionaryService DictionaryService,
        DocumentTextExtractor DocumentTextExtractor,
        TelemetryLogger TelemetryLogger) GetServices(ITextDocumentFactoryService textDocumentFactoryService)
    {
        lock (Gate)
        {
            _telemetryLogger ??= new TelemetryLogger();
            _documentTextExtractor ??= new DocumentTextExtractor();
            _configService ??= new ConfigService(textDocumentFactoryService);
            _dictionaryService ??= new DictionaryService(new ResourcePathResolver(), _telemetryLogger);

            return (_configService, _dictionaryService, _documentTextExtractor, _telemetryLogger);
        }
    }
}
