using KoSpellCheck.Core.Engine;
using KoSpellCheck.LanguagePack.HuEn;

namespace KoSpellCheck.VS2022.Services;

internal sealed class DictionaryService
{
    private readonly object _gate = new();
    private readonly ResourcePathResolver _resourcePathResolver;
    private readonly TelemetryLogger _telemetryLogger;

    private SpellEngine? _engine;
    private string? _loadedDictionaryRoot;

    public DictionaryService(ResourcePathResolver resourcePathResolver, TelemetryLogger telemetryLogger)
    {
        _resourcePathResolver = resourcePathResolver;
        _telemetryLogger = telemetryLogger;
    }

    public SpellEngine GetEngine()
    {
        lock (_gate)
        {
            if (_engine != null)
            {
                return _engine;
            }

            var contentRoot = _resourcePathResolver.ResolveContentRoot();
            _loadedDictionaryRoot = HuEnLanguagePack.ResolveDictionaryRoot(contentRoot);
            var compositeDictionary = HuEnLanguagePack.CreateCompositeDictionary(contentRoot: contentRoot);

            _engine = new SpellEngine(compositeDictionary);
            _telemetryLogger.Info($"Loaded dictionaries from '{_loadedDictionaryRoot}'.");

            return _engine;
        }
    }

    public string LoadedDictionaryRoot => _loadedDictionaryRoot ?? string.Empty;
}
