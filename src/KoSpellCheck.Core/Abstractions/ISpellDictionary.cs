using KoSpellCheck.Core.Diagnostics;
using KoSpellCheck.Core.Engine;

namespace KoSpellCheck.Core.Abstractions;

public interface ISpellDictionary
{
    string Id { get; }

    string LanguageCode { get; }

    bool Check(string token, SpellCheckContext ctx);

    IReadOnlyList<Suggestion> Suggest(string token, SpellCheckContext ctx);
}
