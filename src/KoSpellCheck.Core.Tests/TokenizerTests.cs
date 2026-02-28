using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Tokenization;
using Xunit;

namespace KoSpellCheck.Core.Tests;

public sealed class TokenizerTests
{
    private readonly CodeAwareTokenizer _tokenizer = new();
    private readonly KoSpellCheckConfig _config = new();

    [Fact]
    public void SplitCamelCase_Works()
    {
        var tokens = _tokenizer.Tokenize("KoSpellCheck", _config).Select(t => t.Value).ToArray();
        Assert.Equal(new[] { "Ko", "Spell", "Check" }, tokens);
    }

    [Fact]
    public void SplitSnakeCase_Works()
    {
        var tokens = _tokenizer.Tokenize("gps_coordinate_lat", _config).Select(t => t.Value).ToArray();
        Assert.Equal(new[] { "gps", "coordinate", "lat" }, tokens);
    }

    [Fact]
    public void SplitAbbreviation_Works()
    {
        var tokens = _tokenizer.Tokenize("HTTPServerConfig", _config).Select(t => t.Value).ToArray();
        Assert.Equal(new[] { "HTTP", "Server", "Config" }, tokens);
    }

    [Fact]
    public void Guid_IsIgnored()
    {
        var tokens = _tokenizer.Tokenize("a8098c1a-f86e-11da-bd1a-00112444be1e", _config);
        Assert.Empty(tokens);
    }
}
