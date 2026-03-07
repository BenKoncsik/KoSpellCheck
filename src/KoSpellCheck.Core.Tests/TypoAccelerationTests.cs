using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Diagnostics;
using KoSpellCheck.Core.TypoAcceleration;
using Xunit;

namespace KoSpellCheck.Core.Tests;

public sealed class TypoAccelerationTests
{
    [Fact]
    public void HeuristicClassifier_ClassifiesIdentifierTypo_WhenSuggestionIsClose()
    {
        var classifier = new HeuristicLocalTypoClassifier();
        var request = new TypoClassificationRequest(
            "Almma",
            new[]
            {
                new Suggestion("Alma", 0.9, "fake"),
            },
            TypoClassificationContext.Identifier);

        var result = classifier.Classify(request);

        Assert.True(result.IsTypo);
        Assert.Equal(TypoClassificationCategory.IdentifierTypo, result.Category);
        Assert.True(result.Confidence >= 0.6);
    }

    [Fact]
    public void HeuristicClassifier_ClassifiesNotTypo_ForDomainTokenWithoutSuggestions()
    {
        var classifier = new HeuristicLocalTypoClassifier();
        var request = new TypoClassificationRequest(
            "HTTP2XX",
            Array.Empty<Suggestion>(),
            TypoClassificationContext.Identifier);

        var result = classifier.Classify(request);

        Assert.False(result.IsTypo);
        Assert.Equal(TypoClassificationCategory.NotTypo, result.Category);
        Assert.True(result.Confidence >= 0.65);
    }

    [Fact]
    public void ConfigLoader_ParsesLocalTypoAccelerationSettings_FromJson()
    {
        var workspaceRoot = Path.Combine(
            Path.GetTempPath(),
            "kospellcheck-tests",
            Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workspaceRoot);
        var jsonPath = Path.Combine(workspaceRoot, "kospellcheck.json");

        try
        {
            File.WriteAllText(
                jsonPath,
                """
                {
                  "localTypoAcceleration": {
                    "mode": "on",
                    "showDetectionPrompt": false,
                    "verboseLogging": true
                  }
                }
                """);

            var config = ConfigLoader.Load(workspaceRoot);
            Assert.Equal(TypoAccelerationMode.On, config.LocalTypoAccelerationMode);
            Assert.False(config.LocalTypoAccelerationShowDetectionPrompt);
            Assert.True(config.LocalTypoAccelerationVerboseLogging);
        }
        finally
        {
            Directory.Delete(workspaceRoot, recursive: true);
        }
    }
}
