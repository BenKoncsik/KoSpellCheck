using KoSpellCheck.Core.Abstractions;
using KoSpellCheck.Core.Diagnostics;
using KoSpellCheck.Core.Engine;
using KoSpellCheck.Core.Normalization;
using WeCantSpell.Hunspell;

namespace KoSpellCheck.Core.Dictionaries;

public sealed class HunspellDictionary : ISpellDictionary
{
    private readonly WordList _wordList;
    private readonly bool _supportsHungarianAsciiFold;
    private readonly Dictionary<string, List<string>> _asciiFoldReverseIndex;

    public HunspellDictionary(string id, string languageCode, string affPath, string dicPath)
    {
        Id = id;
        LanguageCode = languageCode;

        if (!File.Exists(affPath))
        {
            throw new FileNotFoundException("Hunspell aff file not found", affPath);
        }

        if (!File.Exists(dicPath))
        {
            throw new FileNotFoundException("Hunspell dic file not found", dicPath);
        }

        _wordList = WordList.CreateFromFiles(dicPath, affPath);
        _supportsHungarianAsciiFold =
            string.Equals(languageCode, "hu", StringComparison.OrdinalIgnoreCase);
        _asciiFoldReverseIndex = BuildAsciiFoldReverseIndex(dicPath);
    }

    public string Id { get; }

    public string LanguageCode { get; }

    public bool Check(string token, SpellCheckContext ctx)
    {
        var normalized = TextNormalizer.Normalize(token);
        if (normalized.Length == 0)
        {
            return true;
        }

        if (_wordList.Check(normalized))
        {
            return true;
        }

        if (_supportsHungarianAsciiFold &&
            ctx.Config.TreatAsHungarianWhenAsciiOnly &&
            TextNormalizer.IsAsciiOnly(normalized))
        {
            var folded = TextNormalizer.AsciiFold(normalized);
            return _asciiFoldReverseIndex.ContainsKey(folded);
        }

        return false;
    }

    public IReadOnlyList<Suggestion> Suggest(string token, SpellCheckContext ctx)
    {
        var suggestions = new List<Suggestion>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var normalized = TextNormalizer.Normalize(token);

        IEnumerable<string> hunspellSuggestions;
        try
        {
            hunspellSuggestions = _wordList.Suggest(normalized);
        }
        catch
        {
            hunspellSuggestions = Array.Empty<string>();
        }

        foreach (var item in hunspellSuggestions)
        {
            if (!seen.Add(item))
            {
                continue;
            }

            suggestions.Add(new Suggestion(item, 0.75, Id));
            if (suggestions.Count >= ctx.Config.SuggestionsMax)
            {
                return suggestions;
            }
        }

        if (_supportsHungarianAsciiFold &&
            ctx.Config.TreatAsHungarianWhenAsciiOnly &&
            TextNormalizer.IsAsciiOnly(normalized))
        {
            var folded = TextNormalizer.AsciiFold(normalized);
            if (_asciiFoldReverseIndex.TryGetValue(folded, out var originals))
            {
                foreach (var candidate in originals)
                {
                    if (!seen.Add(candidate))
                    {
                        continue;
                    }

                    suggestions.Add(new Suggestion(candidate, 0.9, Id));
                    if (suggestions.Count >= ctx.Config.SuggestionsMax)
                    {
                        return suggestions;
                    }
                }
            }
        }

        return suggestions;
    }

    private static Dictionary<string, List<string>> BuildAsciiFoldReverseIndex(string dicPath)
    {
        var result = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        var lines = File.ReadAllLines(dicPath);
        for (var i = 1; i < lines.Length; i++)
        {
            var raw = lines[i].Trim();
            if (raw.Length == 0 || raw.StartsWith("#", StringComparison.Ordinal))
            {
                continue;
            }

            var slashIdx = raw.IndexOf('/');
            var word = slashIdx > 0 ? raw.Substring(0, slashIdx) : raw;
            word = TextNormalizer.Normalize(word);
            if (word.Length == 0)
            {
                continue;
            }

            var folded = TextNormalizer.AsciiFold(word);
            if (!result.TryGetValue(folded, out var list))
            {
                list = new List<string>();
                result[folded] = list;
            }

            if (list.Contains(word, StringComparer.OrdinalIgnoreCase))
            {
                continue;
            }

            list.Add(word);
        }

        return result;
    }
}
