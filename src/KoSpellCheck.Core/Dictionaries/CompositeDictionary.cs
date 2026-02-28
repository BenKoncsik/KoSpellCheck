using KoSpellCheck.Core.Abstractions;
using KoSpellCheck.Core.Diagnostics;
using KoSpellCheck.Core.Engine;

namespace KoSpellCheck.Core.Dictionaries;

public sealed class CompositeDictionary : ISpellDictionary
{
    private readonly IReadOnlyList<ISpellDictionary> _dictionaries;

    public CompositeDictionary(IEnumerable<ISpellDictionary> dictionaries)
    {
        _dictionaries = dictionaries.ToList();
    }

    public string Id => "composite";

    public string LanguageCode => "multi";

    public bool Check(string token, SpellCheckContext ctx)
    {
        if (ctx.Config.IgnoreWords.Contains(token) || ctx.Config.ProjectDictionary.Contains(token))
        {
            return true;
        }

        var normalized = token.Trim();
        if (normalized.Length == 0)
        {
            return true;
        }

        if (ctx.Config.IgnoreWords.Contains(normalized) || ctx.Config.ProjectDictionary.Contains(normalized))
        {
            return true;
        }

        foreach (var dictionary in GetEnabledDictionaries(ctx))
        {
            if (dictionary.Check(token, ctx))
            {
                return true;
            }
        }

        return false;
    }

    public IReadOnlyList<Suggestion> Suggest(string token, SpellCheckContext ctx)
    {
        var combined = new List<Suggestion>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var dictionary in GetEnabledDictionaries(ctx))
        {
            foreach (var suggestion in dictionary.Suggest(token, ctx))
            {
                if (!seen.Add(suggestion.Replacement))
                {
                    continue;
                }

                combined.Add(suggestion);
                if (combined.Count >= ctx.Config.SuggestionsMax)
                {
                    return combined;
                }
            }
        }

        return combined;
    }

    public IReadOnlyList<string> GetMatchingLanguages(string token, SpellCheckContext ctx)
    {
        var matches = new List<string>();
        foreach (var dictionary in GetEnabledDictionaries(ctx))
        {
            if (dictionary.Check(token, ctx))
            {
                matches.Add(dictionary.LanguageCode);
            }
        }

        return matches;
    }

    private IEnumerable<ISpellDictionary> GetEnabledDictionaries(SpellCheckContext ctx)
    {
        foreach (var dictionary in _dictionaries)
        {
            if (ctx.Config.IsLanguageEnabled(dictionary.LanguageCode))
            {
                yield return dictionary;
            }
        }
    }
}
