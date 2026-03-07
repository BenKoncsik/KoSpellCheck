using Microsoft.VisualStudio.Text;
using KoSpellCheck.Core.Style;
using KoSpellCheck.Core.TypoAcceleration;
using KoSpellCheck.VS2022.Services.TypoAcceleration;

namespace KoSpellCheck.VS2022.Services;

internal static class SpellServiceRegistry
{
    private static readonly object Gate = new();

    private static ConfigService? _configService;
    private static DictionaryService? _dictionaryService;
    private static DocumentTextExtractor? _documentTextExtractor;
    private static TelemetryLogger? _telemetryLogger;
    private static IProjectStyleProfileProvider? _projectStyleProfileProvider;
    private static IAcceleratorAvailabilityService? _acceleratorAvailabilityService;
    private static IAcceleratorNotificationService? _acceleratorNotificationService;
    private static ILocalTypoClassifier? _localTypoClassifier;
    private static TypoAccelerationCoordinator? _typoAccelerationCoordinator;

    public static (
        ConfigService ConfigService,
        DictionaryService DictionaryService,
        DocumentTextExtractor DocumentTextExtractor,
        TelemetryLogger TelemetryLogger,
        IProjectStyleProfileProvider ProjectStyleProfileProvider,
        TypoAccelerationCoordinator TypoAccelerationCoordinator) GetServices(ITextDocumentFactoryService textDocumentFactoryService)
    {
        lock (Gate)
        {
            _telemetryLogger ??= new TelemetryLogger();
            _documentTextExtractor ??= new DocumentTextExtractor();
            _configService ??= new ConfigService(textDocumentFactoryService);
            _dictionaryService ??= new DictionaryService(new ResourcePathResolver(), _telemetryLogger);
            _projectStyleProfileProvider ??= new ProjectStyleProfileProvider();
            _acceleratorAvailabilityService ??= new CoralAcceleratorAvailabilityService(new ResourcePathResolver());
            _localTypoClassifier ??= new HeuristicLocalTypoClassifier();
            _acceleratorNotificationService ??= new TelemetryAcceleratorNotificationService(_telemetryLogger);
            _typoAccelerationCoordinator ??= new TypoAccelerationCoordinator(
                _acceleratorAvailabilityService,
                _acceleratorNotificationService,
                _localTypoClassifier,
                _telemetryLogger);

            return (
                _configService,
                _dictionaryService,
                _documentTextExtractor,
                _telemetryLogger,
                _projectStyleProfileProvider,
                _typoAccelerationCoordinator);
        }
    }
}
