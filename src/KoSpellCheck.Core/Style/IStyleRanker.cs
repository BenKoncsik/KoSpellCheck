using KoSpellCheck.Core.Diagnostics;
using KoSpellCheck.Core.Engine;

namespace KoSpellCheck.Core.Style;

public interface IStyleRanker
{
    IReadOnlyList<Suggestion> Rank(
        string originalToken,
        IReadOnlyList<Suggestion> suggestions,
        SpellCheckContext ctx);
}
