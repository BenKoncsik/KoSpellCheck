using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Dictionaries;

namespace KoSpellCheck.LanguagePack.HuEn;

public static class HuEnLanguagePack
{
    public static LanguagePackManifest Manifest { get; } = new();

    public static CompositeDictionary CreateCompositeDictionary(KoSpellCheckConfig? config = null, string? contentRoot = null)
    {
        var dictionaryRoot = ResolveDictionaryRoot(contentRoot);

        var huAff = Path.Combine(dictionaryRoot, "hu_HU", "hu_HU.aff");
        var huDic = Path.Combine(dictionaryRoot, "hu_HU", "hu_HU.dic");
        var enAff = Path.Combine(dictionaryRoot, "en_US", "en_US.aff");
        var enDic = Path.Combine(dictionaryRoot, "en_US", "en_US.dic");

        var dictionaries = new[]
        {
            new HunspellDictionary("Hunspell-HU", "hu", huAff, huDic),
            new HunspellDictionary("Hunspell-EN", "en", enAff, enDic),
        };

        return new CompositeDictionary(dictionaries);
    }

    public static string ResolveContentRoot(string? contentRoot = null)
    {
        return ResolveDictionaryRoot(contentRoot);
    }

    public static string ResolveDictionaryRoot(string? contentRoot = null)
    {
        var candidates = new List<string>();

        if (!string.IsNullOrWhiteSpace(contentRoot))
        {
            candidates.Add(contentRoot);
        }

        candidates.Add(AppContext.BaseDirectory);

        var assemblyDir = Path.GetDirectoryName(typeof(HuEnLanguagePack).Assembly.Location);
        if (!string.IsNullOrWhiteSpace(assemblyDir))
        {
            candidates.Add(assemblyDir);
        }

        candidates.Add(Directory.GetCurrentDirectory());

        foreach (var candidate in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (TryResolveDictionaryRoot(candidate, out var dictionaryRoot))
            {
                return dictionaryRoot;
            }
        }

        var probe = Directory.GetCurrentDirectory();
        for (var i = 0; i < 8; i++)
        {
            if (TryResolveDictionaryRoot(probe, out var dictionaryRoot))
            {
                return dictionaryRoot;
            }

            var parent = Directory.GetParent(probe);
            if (parent == null)
            {
                break;
            }

            probe = parent.FullName;
        }

        throw new DirectoryNotFoundException(
            "KoSpellCheck dictionaries were not found. Expected dictionaries in one of: dictionaries/, resources/dictionaries/, Resources/Dictionaries.");
    }

    private static bool TryResolveDictionaryRoot(string root, out string dictionaryRoot)
    {
        var candidates = new[]
        {
            Path.Combine(root, "dictionaries"),
            Path.Combine(root, "resources", "dictionaries"),
            Path.Combine(root, "Resources", "Dictionaries"),
        };

        foreach (var candidate in candidates)
        {
            if (HasRequiredDictionaryFiles(candidate))
            {
                dictionaryRoot = candidate;
                return true;
            }
        }

        dictionaryRoot = string.Empty;
        return false;
    }

    private static bool HasRequiredDictionaryFiles(string dictionariesRoot)
    {
        return File.Exists(Path.Combine(dictionariesRoot, "hu_HU", "hu_HU.aff")) &&
               File.Exists(Path.Combine(dictionariesRoot, "hu_HU", "hu_HU.dic")) &&
               File.Exists(Path.Combine(dictionariesRoot, "en_US", "en_US.aff")) &&
               File.Exists(Path.Combine(dictionariesRoot, "en_US", "en_US.dic"));
    }
}
