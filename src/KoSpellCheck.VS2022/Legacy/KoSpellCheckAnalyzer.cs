using System.Collections.Concurrent;
using System.Collections.Immutable;
using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Engine;
using KoSpellCheck.LanguagePack.HuEn;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Text;

namespace KoSpellCheck.VS2022;

[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class KoSpellCheckAnalyzer : DiagnosticAnalyzer
{
    public const string MisspellDiagnosticId = "KOSPELL001";
    public const string PreferenceDiagnosticId = "KOSPELL002";

    public static readonly DiagnosticDescriptor MisspellRule = new(
        MisspellDiagnosticId,
        "Spelling issue",
        "{0}",
        "Spelling",
        DiagnosticSeverity.Warning,
        isEnabledByDefault: true,
        description: "Potential misspelling in C# identifier token.");

    public static readonly DiagnosticDescriptor PreferenceRule = new(
        PreferenceDiagnosticId,
        "Preferred term",
        "{0}",
        "Spelling",
        DiagnosticSeverity.Info,
        isEnabledByDefault: true,
        description: "Preferred term rule from KoSpellCheck configuration.");

    private static readonly Lazy<SpellEngine> Engine = new(CreateEngine, true);
    private static readonly ConcurrentDictionary<string, KoSpellCheckConfig> ConfigCache = new(StringComparer.OrdinalIgnoreCase);

    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics =>
        ImmutableArray.Create(MisspellRule, PreferenceRule);

    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();
        context.RegisterSyntaxTreeAction(AnalyzeSyntaxTree);
    }

    private static void AnalyzeSyntaxTree(SyntaxTreeAnalysisContext context)
    {
        if (Engine.Value is null)
        {
            return;
        }

        var root = context.Tree.GetRoot(context.CancellationToken);
        var cfg = LoadConfig(context.Tree.FilePath);

        var spellCtx = new SpellCheckContext(cfg, context.Tree.FilePath);

        foreach (var token in root.DescendantTokens())
        {
            if (!token.IsKind(SyntaxKind.IdentifierToken))
            {
                continue;
            }

            var identifier = token.ValueText;
            if (string.IsNullOrWhiteSpace(identifier))
            {
                continue;
            }

            var diagnostics = Engine.Value.CheckDocument(identifier, spellCtx);
            foreach (var item in diagnostics)
            {
                if (item.Range.End <= item.Range.Start || item.Range.End > identifier.Length)
                {
                    continue;
                }

                var start = token.Span.Start + item.Range.Start;
                var length = item.Range.End - item.Range.Start;
                if (length <= 0)
                {
                    continue;
                }

                var properties = ImmutableDictionary<string, string?>.Empty
                    .Add("token", item.Token)
                    .Add("suggestions", string.Join("|", item.Suggestions.Select(s => s.Replacement)));

                var descriptor = item.Message.StartsWith("Preferred term", StringComparison.OrdinalIgnoreCase)
                    ? PreferenceRule
                    : MisspellRule;

                var diagnostic = Diagnostic.Create(
                    descriptor,
                    Location.Create(context.Tree, new TextSpan(start, length)),
                    properties,
                    item.Message);

                context.ReportDiagnostic(diagnostic);
            }
        }
    }

    private static SpellEngine CreateEngine()
    {
        try
        {
            var dictionary = HuEnLanguagePack.CreateCompositeDictionary();
            return new SpellEngine(dictionary);
        }
        catch
        {
            var contentRoot = FindRootContainingDictionaries();
            var dictionary = HuEnLanguagePack.CreateCompositeDictionary(contentRoot: contentRoot);
            return new SpellEngine(dictionary);
        }
    }

    private static KoSpellCheckConfig LoadConfig(string? filePath)
    {
        var workspaceRoot = ResolveWorkspaceRoot(filePath);
        return ConfigCache.GetOrAdd(workspaceRoot, ConfigLoader.Load);
    }

    private static string ResolveWorkspaceRoot(string? filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            return Directory.GetCurrentDirectory();
        }

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

    private static string FindRootContainingDictionaries()
    {
        var probe = Directory.GetCurrentDirectory();
        for (var i = 0; i < 8; i++)
        {
            if (Directory.Exists(Path.Combine(probe, "tools", "dictionaries")))
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

        return Directory.GetCurrentDirectory();
    }
}
