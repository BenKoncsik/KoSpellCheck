using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Engine;
using KoSpellCheck.LanguagePack.HuEn;
using Xunit;

namespace KoSpellCheck.Core.Tests;

public sealed class HunspellDictionarySmokeTests
{
    [Fact]
    public void HuEnDictionary_AcceptsMixedAndAsciiFoldedTokens()
    {
        var root = FindRepoRoot();
        var dictionary = HuEnLanguagePack.CreateCompositeDictionary(contentRoot: root);
        var engine = new SpellEngine(dictionary);

        var config = new KoSpellCheckConfig
        {
            LanguagesEnabled = new List<string> { "hu", "en" },
            TreatAsHungarianWhenAsciiOnly = true,
            IgnoreAllCapsLengthThreshold = 4,
        };

        var text = "modell model homerseklet temperature";
        var diagnostics = engine.CheckDocument(text, new SpellCheckContext(config));

        Assert.Empty(diagnostics);
    }

    private static string FindRepoRoot()
    {
        var probe = Directory.GetCurrentDirectory();
        for (var i = 0; i < 8; i++)
        {
            if (Directory.Exists(Path.Combine(probe, "tools", "dictionaries")))
            {
                return probe;
            }

            var parent = Directory.GetParent(probe);
            if (parent == null)
            {
                break;
            }

            probe = parent.FullName;
        }

        throw new InvalidOperationException("Repo root not found for dictionary smoke test.");
    }
}
