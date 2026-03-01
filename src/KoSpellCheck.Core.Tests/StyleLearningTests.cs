using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Diagnostics;
using KoSpellCheck.Core.Engine;
using KoSpellCheck.Core.Style;
using Xunit;

namespace KoSpellCheck.Core.Tests;

public sealed class StyleLearningTests
{
    [Fact]
    public async Task Detector_PrefersDominantVariant()
    {
        var workspaceRoot = CreateTempWorkspace();
        try
        {
            var sourcePath = Path.Combine(workspaceRoot, "Sample.cs");
            var content = string.Join(" ", Enumerable.Repeat("Test", 50)) + " " + string.Join(" ", Enumerable.Repeat("test", 2));
            File.WriteAllText(sourcePath, content);

            var config = new KoSpellCheckConfig
            {
                StyleLearningEnabled = true,
                StyleLearningMaxFiles = 10,
                StyleLearningMaxTokens = 10000,
                StyleLearningTimeBudgetMs = 2000,
                StyleLearningMinTokenLength = 2,
                StyleLearningFileExtensions = new List<string> { "cs" },
                StyleLearningCachePath = ".kospellcheck/style-profile.json",
            };

            var detector = new ProjectStyleDetector();
            var profile = await detector.DetectWorkspaceAsync(workspaceRoot, config);
            var stats = profile.TryGetStats("test");

            Assert.NotNull(stats);
            Assert.Equal("Test", stats!.PreferredVariant);
        }
        finally
        {
            TryDeleteDirectory(workspaceRoot);
        }
    }

    [Fact]
    public void Ranker_PrioritizesPreferredCaseVariant()
    {
        var profile = CreateProfile(
            "/tmp/workspace",
            new Dictionary<string, int>(StringComparer.Ordinal)
            {
                ["Test"] = 50,
                ["test"] = 2,
                ["TEST"] = 1,
            });

        var ctx = new SpellCheckContext(new KoSpellCheckConfig(), workspaceRoot: "/tmp/workspace", projectStyleProfile: profile);
        var ranker = new ProjectStyleRanker();
        var ranked = ranker.Rank(
            "Tset",
            new[]
            {
                new Suggestion("test", 0.8, "fake"),
                new Suggestion("Test", 0.8, "fake"),
                new Suggestion("TEST", 0.8, "fake"),
            },
            ctx);

        Assert.Equal("Test", ranked[0].Replacement);
    }

    [Fact]
    public void Ranker_PreferTermsOverrideStyleLearning()
    {
        var config = new KoSpellCheckConfig
        {
            PreferTerms = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["model"] = "modell",
            },
        };

        var profile = CreateProfile(
            "/tmp/workspace",
            new Dictionary<string, int>(StringComparer.Ordinal)
            {
                ["model"] = 100,
                ["Model"] = 30,
            });

        var ctx = new SpellCheckContext(config, workspaceRoot: "/tmp/workspace", projectStyleProfile: profile);
        var ranker = new ProjectStyleRanker();
        var ranked = ranker.Rank(
            "model",
            new[]
            {
                new Suggestion("model", 0.95, "fake"),
                new Suggestion("modell", 0.75, "fake"),
            },
            ctx);

        Assert.Equal("modell", ranked[0].Replacement);
    }

    [Fact]
    public async Task IntegrationSmoke_HttpClientVariantWinsForHttpClinet()
    {
        var sampleRoot = FindSampleWorkspaceRoot();
        var config = new KoSpellCheckConfig
        {
            StyleLearningEnabled = true,
            StyleLearningMaxFiles = 200,
            StyleLearningMaxTokens = 50000,
            StyleLearningTimeBudgetMs = 3000,
            StyleLearningFileExtensions = new List<string> { "cs" },
            StyleLearningIgnoreFolders = new List<string> { "bin", "obj", ".git", ".vs", "node_modules", "artifacts" },
        };

        var detector = new ProjectStyleDetector();
        var profile = await detector.DetectWorkspaceAsync(sampleRoot, config);
        Assert.Equal("HttpClient", profile.TryGetStats("HttpClient")?.PreferredVariant);
        Assert.Equal("HttpClient", profile.TryGetStats("HTTPClient")?.PreferredVariant);
        var ctx = new SpellCheckContext(config, workspaceRoot: sampleRoot, projectStyleProfile: profile);
        var ranker = new ProjectStyleRanker();

        var ranked = ranker.Rank(
            "HttpClinet",
            new[]
            {
                new Suggestion("HTTPClient", 0.75, "fake"),
                new Suggestion("httpClient", 0.75, "fake"),
                new Suggestion("HttpClient", 0.75, "fake"),
            },
            ctx);

        Assert.Equal("HttpClient", ranked[0].Replacement);
    }

    private static ProjectStyleProfile CreateProfile(string workspaceRoot, IDictionary<string, int> variants)
    {
        var stats = new TokenStyleStats();
        foreach (var variant in variants)
        {
            for (var i = 0; i < variant.Value; i++)
            {
                stats.AddVariant(variant.Key);
            }
        }

        var key = StyleTokenNormalizer.NormalizeKey(variants.Keys.First());
        return new ProjectStyleProfile
        {
            WorkspaceRoot = workspaceRoot,
            TokenStats = new Dictionary<string, TokenStyleStats>(StringComparer.Ordinal)
            {
                [key] = stats,
            },
        };
    }

    private static string CreateTempWorkspace()
    {
        var path = Path.Combine(Path.GetTempPath(), "KoSpellCheck.StyleTests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
            }
        }
        catch
        {
            // ignore cleanup failures
        }
    }

    private static string FindSampleWorkspaceRoot()
    {
        var probe = Directory.GetCurrentDirectory();
        for (var i = 0; i < 12; i++)
        {
            var candidate = Path.Combine(probe, "samples", "style-learning", "httpclient-workspace");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }

            var parent = Directory.GetParent(probe);
            if (parent == null)
            {
                break;
            }

            probe = parent.FullName;
        }

        throw new InvalidOperationException("Sample workspace not found.");
    }
}
