using KoSpellCheck.Core.Normalization;
using Xunit;

namespace KoSpellCheck.Core.Tests;

public sealed class NormalizationTests
{
    [Fact]
    public void Normalize_LowercasesAndNormalizesUnicode()
    {
        Assert.Equal("model", TextNormalizer.Normalize("Model"));
    }

    [Fact]
    public void AsciiFold_RemovesDiacritics()
    {
        Assert.Equal("homerseklet", TextNormalizer.AsciiFold("hőmérséklet"));
    }
}
