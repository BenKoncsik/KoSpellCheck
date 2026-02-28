using KoSpellCheck.Core.Config;

namespace KoSpellCheck.Core.Engine;

public sealed class SpellCheckContext
{
    public SpellCheckContext(KoSpellCheckConfig config, string? filePath = null)
    {
        Config = config ?? throw new ArgumentNullException(nameof(config));
        FilePath = filePath;
    }

    public KoSpellCheckConfig Config { get; }

    public string? FilePath { get; }
}
