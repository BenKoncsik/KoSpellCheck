using System.Collections.Immutable;
using System.Composition;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CodeActions;
using Microsoft.CodeAnalysis.CodeFixes;
using Microsoft.CodeAnalysis.Text;
using Newtonsoft.Json.Linq;

namespace KoSpellCheck.VS2022;

[ExportCodeFixProvider(LanguageNames.CSharp, Name = nameof(KoSpellCheckCodeFixProvider)), Shared]
public sealed class KoSpellCheckCodeFixProvider : CodeFixProvider
{
    public override ImmutableArray<string> FixableDiagnosticIds =>
        ImmutableArray.Create(KoSpellCheckAnalyzer.MisspellDiagnosticId, KoSpellCheckAnalyzer.PreferenceDiagnosticId);

    public override FixAllProvider GetFixAllProvider()
    {
        return WellKnownFixAllProviders.BatchFixer;
    }

    public override async Task RegisterCodeFixesAsync(CodeFixContext context)
    {
        var document = context.Document;
        foreach (var diagnostic in context.Diagnostics)
        {
            var suggestions = ParseSuggestions(diagnostic.Properties);
            if (suggestions.Count > 0)
            {
                foreach (var suggestion in suggestions.Take(5))
                {
                    context.RegisterCodeFix(
                        CodeAction.Create(
                            $"Replace with '{suggestion}'",
                            ct => ReplaceAsync(document, diagnostic.Location.SourceSpan, suggestion, ct),
                            equivalenceKey: $"ReplaceWith_{suggestion}"),
                        diagnostic);
                }
            }

            if (diagnostic.Properties.TryGetValue("token", out var token) && !string.IsNullOrWhiteSpace(token))
            {
                context.RegisterCodeFix(
                    CodeAction.Create(
                        $"Add '{token}' to project dictionary",
                        ct => AddToProjectDictionaryAsync(document, token, ct),
                        equivalenceKey: $"AddToProjectDictionary_{token}"),
                    diagnostic);
            }
        }

        await Task.CompletedTask;
    }

    private static async Task<Document> ReplaceAsync(
        Document document,
        TextSpan span,
        string replacement,
        CancellationToken cancellationToken)
    {
        var text = await document.GetTextAsync(cancellationToken).ConfigureAwait(false);
        var changed = text.WithChanges(new TextChange(span, replacement));
        return document.WithText(changed);
    }

    private static Task<Document> AddToProjectDictionaryAsync(
        Document document,
        string token,
        CancellationToken cancellationToken)
    {
        var filePath = document.FilePath;
        if (string.IsNullOrWhiteSpace(filePath))
        {
            return Task.FromResult(document);
        }

        var root = ResolveWorkspaceRoot(filePath);
        var configPath = Path.Combine(root, "kospellcheck.json");

        JObject json;
        if (File.Exists(configPath))
        {
            json = JObject.Parse(File.ReadAllText(configPath));
        }
        else
        {
            json = new JObject { ["enabled"] = true };
        }

        var array = json["projectDictionary"] as JArray ?? new JArray();
        var exists = array.Values<string>().Any(x => string.Equals(x, token, StringComparison.OrdinalIgnoreCase));
        if (!exists)
        {
            array.Add(token);
            json["projectDictionary"] = array;
            File.WriteAllText(configPath, json.ToString(Newtonsoft.Json.Formatting.Indented));
        }

        return Task.FromResult(document);
    }

    private static List<string> ParseSuggestions(ImmutableDictionary<string, string?> properties)
    {
        if (!properties.TryGetValue("suggestions", out var raw) || string.IsNullOrWhiteSpace(raw))
        {
            return new List<string>();
        }

        return raw.Split(new[] { '|' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string ResolveWorkspaceRoot(string filePath)
    {
        var probe = Path.GetDirectoryName(filePath) ?? Directory.GetCurrentDirectory();
        for (var i = 0; i < 8; i++)
        {
            var hasSln = Directory.EnumerateFiles(probe, "*.sln").Any();
            var hasGit = Directory.Exists(Path.Combine(probe, ".git"));
            var hasConfig = File.Exists(Path.Combine(probe, "kospellcheck.json"));
            if (hasSln || hasGit || hasConfig)
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

        return Path.GetDirectoryName(filePath) ?? Directory.GetCurrentDirectory();
    }
}
