using KoSpellCheck.Core.Abstractions;
using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Diagnostics;
using KoSpellCheck.Core.Engine;
using KoSpellCheck.Core.Normalization;
using Xunit;

namespace KoSpellCheck.Core.Tests;

public sealed class PreferenceTests
{
    [Fact]
    public void PreferTerms_ProducesDiagnosticOnPreferredReplacement()
    {
        var config = new KoSpellCheckConfig
        {
            PreferTerms = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["model"] = "modell",
            },
            LanguagesEnabled = new List<string> { "en", "hu" },
        };

        var dictionary = new FakeDictionary(new[] { "model", "modell" });
        var engine = new SpellEngine(dictionary);
        var diagnostics = engine.CheckDocument("model", new SpellCheckContext(config));

        Assert.Single(diagnostics);
        Assert.Contains(diagnostics[0].Suggestions, s =>
            string.Equals(s.Replacement, "modell", StringComparison.OrdinalIgnoreCase));
    }

    private sealed class FakeDictionary : ISpellDictionary
    {
        private readonly HashSet<string> _words;

        public FakeDictionary(IEnumerable<string> words)
        {
            _words = new HashSet<string>(words.Select(TextNormalizer.Normalize), StringComparer.OrdinalIgnoreCase);
        }

        public string Id => "fake";

        public string LanguageCode => "en";

        public bool Check(string token, SpellCheckContext ctx)
        {
            return _words.Contains(TextNormalizer.Normalize(token));
        }

        public IReadOnlyList<Suggestion> Suggest(string token, SpellCheckContext ctx)
        {
            return _words.Select(w => new Suggestion(w, 0.5, "fake")).ToList();
        }
    }
}
