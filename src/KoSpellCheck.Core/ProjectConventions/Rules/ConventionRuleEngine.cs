using KoSpellCheck.Core.ProjectConventions.Models;
using KoSpellCheck.Core.ProjectConventions.Utils;

namespace KoSpellCheck.Core.ProjectConventions.Rules;

public sealed class ConventionRuleEngine
{
    public IReadOnlyList<ConventionDiagnostic> Evaluate(
        ProjectFileFacts file,
        ProjectConventionProfile profile,
        int minEvidenceCount)
    {
        var context = new RuleContext
        {
            Profile = profile,
            MinEvidenceCount = minEvidenceCount,
            SuffixToFolderDominance = BuildDominantFolderBySuffix(profile),
        };

        var diagnostics = new List<ConventionDiagnostic>();
        diagnostics.AddRange(CheckFileToPrimaryTypeMapping(file, context));
        diagnostics.AddRange(CheckNamespaceConventions(file, context));

        foreach (var symbol in file.Types)
        {
            diagnostics.AddRange(CheckFolderSuffixConvention(file, symbol, context));
            diagnostics.AddRange(CheckInterfacePrefixConvention(file, symbol, context));
            diagnostics.AddRange(CheckEnumConvention(file, symbol, context));
            diagnostics.AddRange(CheckAbbreviationConvention(file, symbol, context));
            diagnostics.AddRange(CheckPluralityConvention(file, symbol, context));
            diagnostics.AddRange(CheckFolderBySuffixConvention(file, symbol, context));
        }

        return DedupeDiagnostics(diagnostics);
    }

    private static IEnumerable<ConventionDiagnostic> CheckFileToPrimaryTypeMapping(ProjectFileFacts file, RuleContext context)
    {
        if (file.PrimaryType == null || string.Equals(file.FileStem, file.PrimaryType.Name, StringComparison.Ordinal))
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        var confidence = context.Profile.FileToPrimaryTypeMatchRate;
        if (confidence < 0.65 || context.Profile.FilesScanned < context.MinEvidenceCount)
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        var primary = file.PrimaryType;
        return new[]
        {
            CreateDiagnostic(
                file,
                primary,
                "KS_CONV_003",
                "File name does not match primary type",
                confidence >= 0.85 ? ConventionSeverity.Error : ConventionSeverity.Warning,
                confidence,
                $"The file name {file.FileName} does not match the primary type {primary.Name}.",
                "This project mostly maps one file to one primary type with matching names, but this file deviates from that dominant pattern.",
                new[]
                {
                    new ConventionEvidence
                    {
                        Metric = "file->primary-type match rate",
                        Expected = $"~{Math.Round(confidence * 100)}% files follow file-name==primary-type",
                        Observed = $"{file.FileStem} vs {primary.Name}",
                        Ratio = confidence,
                        SampleSize = context.Profile.FilesScanned,
                    },
                },
                new[]
                {
                    $"Rename file to {primary.Name}.{file.Extension}",
                    $"Rename primary type to {file.FileStem}",
                },
                new[]
                {
                    new ConventionQuickFix
                    {
                        Kind = ConventionQuickFixKind.RenameFileToPrimaryType,
                        Title = $"Rename file to {primary.Name}.{file.Extension}",
                        Replacement = $"{primary.Name}.{file.Extension}",
                    },
                    new ConventionQuickFix
                    {
                        Kind = ConventionQuickFixKind.RenamePrimaryTypeToFileName,
                        Title = $"Rename primary type to {file.FileStem}",
                        Replacement = file.FileStem,
                    },
                })
        };
    }

    private static IEnumerable<ConventionDiagnostic> CheckFolderSuffixConvention(ProjectFileFacts file, TypeSymbolFacts symbol, RuleContext context)
    {
        var folderKey = ConventionNamingUtils.NormalizeFolderKey(file.FolderPath);
        if (!context.Profile.Folders.TryGetValue(folderKey, out var folder))
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        var dominantSuffix = folder.DominantSuffixes.FirstOrDefault();
        if (dominantSuffix == null || dominantSuffix.Count < context.MinEvidenceCount || dominantSuffix.Ratio < 0.55)
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        if (symbol.Name.EndsWith(dominantSuffix.Value, StringComparison.Ordinal))
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        if (symbol.Kind == ConventionTypeKind.Interface && symbol.Name.StartsWith("I", StringComparison.Ordinal))
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        var suggestion = ConventionNamingUtils.ReplaceSuffix(
            symbol.Name,
            ConventionNamingUtils.DetectKnownSuffix(symbol.Name, context.Profile.KnownSuffixes),
            dominantSuffix.Value);

        return new[]
        {
            CreateDiagnostic(
                file,
                symbol,
                "KS_CONV_001",
                "Type name does not fit folder naming convention",
                dominantSuffix.Ratio >= 0.80 ? ConventionSeverity.Warning : ConventionSeverity.Info,
                dominantSuffix.Ratio,
                $"The type {symbol.Name} deviates from the dominant *{dominantSuffix.Value} pattern used in {folderKey}.",
                "The learned folder convention indicates a strong suffix trend in this folder. The current type name does not match that local pattern.",
                new[]
                {
                    new ConventionEvidence
                    {
                        Metric = "folder dominant suffix",
                        Expected = $"*{dominantSuffix.Value}",
                        Observed = symbol.Name,
                        Ratio = dominantSuffix.Ratio,
                        SampleSize = dominantSuffix.Count,
                    },
                },
                new[] { $"Suggested name: {suggestion}" },
                new[]
                {
                    new ConventionQuickFix
                    {
                        Kind = ConventionQuickFixKind.RenameSuffix,
                        Title = $"Rename type to {suggestion}",
                        Replacement = suggestion,
                    },
                }),
            CreateDiagnostic(
                file,
                symbol,
                "KS_CONV_008",
                "Unexpected or missing suffix",
                ConventionSeverity.Info,
                Clamp01(dominantSuffix.Ratio * 0.90),
                $"Expected suffix *{dominantSuffix.Value} is missing for {symbol.Name} in {folderKey}.",
                "The dominant suffix in this folder was learned from existing project files and appears consistently.",
                new[]
                {
                    new ConventionEvidence
                    {
                        Metric = "dominant suffix consistency",
                        Expected = $"suffix {dominantSuffix.Value}",
                        Observed = symbol.Name,
                        Ratio = dominantSuffix.Ratio,
                        SampleSize = dominantSuffix.Count,
                    },
                },
                new[] { $"Use suffix {dominantSuffix.Value} for consistency" },
                new[]
                {
                    new ConventionQuickFix
                    {
                        Kind = ConventionQuickFixKind.RenameSuffix,
                        Title = $"Apply {dominantSuffix.Value} suffix",
                        Replacement = suggestion,
                    },
                }),
        };
    }

    private static IEnumerable<ConventionDiagnostic> CheckInterfacePrefixConvention(ProjectFileFacts file, TypeSymbolFacts symbol, RuleContext context)
    {
        if (symbol.Kind != ConventionTypeKind.Interface)
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        var convention = context.Profile.InterfaceConvention;
        if (convention.TotalCount < context.MinEvidenceCount || convention.Confidence < 0.70)
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        if (symbol.Name.StartsWith(convention.ExpectedPrefix, StringComparison.Ordinal))
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        var suggestedName = $"{convention.ExpectedPrefix}{symbol.Name}";

        return new[]
        {
            CreateDiagnostic(
                file,
                symbol,
                "KS_CONV_004",
                "Interface prefix convention mismatch",
                convention.Confidence >= 0.90 ? ConventionSeverity.Warning : ConventionSeverity.Info,
                convention.Confidence,
                $"Interface {symbol.Name} does not start with {convention.ExpectedPrefix}, but this project expects that pattern.",
                "Interface naming was learned from existing interfaces where the I-prefix is dominant.",
                new[]
                {
                    new ConventionEvidence
                    {
                        Metric = "interface prefix ratio",
                        Expected = $"{convention.ExpectedPrefix}*",
                        Observed = symbol.Name,
                        Ratio = convention.Confidence,
                        SampleSize = convention.TotalCount,
                    },
                },
                new[] { $"Suggested name: {suggestedName}" },
                new[]
                {
                    new ConventionQuickFix
                    {
                        Kind = ConventionQuickFixKind.RenamePrimaryTypeToFileName,
                        Title = $"Rename interface to {suggestedName}",
                        Replacement = suggestedName,
                    },
                })
        };
    }

    private static IEnumerable<ConventionDiagnostic> CheckEnumConvention(ProjectFileFacts file, TypeSymbolFacts symbol, RuleContext context)
    {
        if (symbol.Kind != ConventionTypeKind.Enum)
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        var diagnostics = new List<ConventionDiagnostic>();
        var convention = context.Profile.EnumConvention;
        var observedStyle = ConventionNamingUtils.DetectCaseStyle(symbol.Name);

        if (convention.Confidence >= 0.60 &&
            convention.DominantCaseStyle != ConventionCaseStyle.Unknown &&
            observedStyle != convention.DominantCaseStyle)
        {
            diagnostics.Add(CreateDiagnostic(
                file,
                symbol,
                "KS_CONV_005",
                "Enum naming style mismatch",
                ConventionSeverity.Info,
                convention.Confidence,
                $"Enum {symbol.Name} uses {observedStyle}, but this project usually uses {convention.DominantCaseStyle} for enums.",
                "Enum case style was inferred from existing enums in this project.",
                new[]
                {
                    new ConventionEvidence
                    {
                        Metric = "enum case style",
                        Expected = convention.DominantCaseStyle.ToString(),
                        Observed = observedStyle.ToString(),
                        Ratio = convention.Confidence,
                    },
                },
                new[] { $"Rename enum to follow {convention.DominantCaseStyle}" },
                Array.Empty<ConventionQuickFix>()));
        }

        if (!string.IsNullOrWhiteSpace(convention.DominantSuffix) &&
            !symbol.Name.EndsWith(convention.DominantSuffix, StringComparison.Ordinal))
        {
            var rename = symbol.Name + convention.DominantSuffix;
            diagnostics.Add(CreateDiagnostic(
                file,
                symbol,
                "KS_CONV_005",
                "Enum suffix mismatch",
                ConventionSeverity.Info,
                Math.Max(0.50, convention.Confidence),
                $"Enum {symbol.Name} does not follow the dominant *{convention.DominantSuffix} suffix.",
                "The learned enum suffix indicates a recurring pattern in the existing code.",
                new[]
                {
                    new ConventionEvidence
                    {
                        Metric = "enum suffix",
                        Expected = convention.DominantSuffix!,
                        Observed = symbol.Name,
                        Ratio = convention.Confidence,
                    },
                },
                new[] { $"Suggested name: {rename}" },
                new[]
                {
                    new ConventionQuickFix
                    {
                        Kind = ConventionQuickFixKind.RenameSuffix,
                        Title = $"Rename enum to {rename}",
                        Replacement = rename,
                    },
                }));
        }

        return diagnostics;
    }

    private static IEnumerable<ConventionDiagnostic> CheckAbbreviationConvention(ProjectFileFacts file, TypeSymbolFacts symbol, RuleContext context)
    {
        var diagnostics = new List<ConventionDiagnostic>();
        foreach (var token in ConventionNamingUtils.SplitIdentifierTokens(symbol.Name))
        {
            var normalized = token.ToLowerInvariant();
            if (!context.Profile.AbbreviationPreferredForms.TryGetValue(normalized, out var preferred) ||
                string.Equals(token, preferred, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            context.Profile.AbbreviationFrequencies.TryGetValue(normalized, out var abbreviationCount);
            context.Profile.TokenFrequencies.TryGetValue(preferred.ToLowerInvariant(), out var preferredCount);
            if (preferredCount < context.MinEvidenceCount || preferredCount <= abbreviationCount)
            {
                continue;
            }

            var replacement = symbol.Name.Replace(token, preferred);
            var ratio = (double)preferredCount / Math.Max(1, preferredCount + abbreviationCount);

            diagnostics.Add(CreateDiagnostic(
                file,
                symbol,
                "KS_CONV_006",
                "Suspicious abbreviation",
                ratio > 0.80 ? ConventionSeverity.Warning : ConventionSeverity.Info,
                Clamp01(ratio),
                $"The abbreviation '{token}' is unusual in this project. The dominant pattern is '{preferred}'.",
                "Abbreviation usage was learned from project token frequencies, where the expanded term appears significantly more often.",
                new[]
                {
                    new ConventionEvidence
                    {
                        Metric = "abbreviation usage",
                        Expected = preferred,
                        Observed = token,
                        Ratio = ratio,
                        SampleSize = preferredCount + abbreviationCount,
                    },
                },
                new[] { $"Suggested name: {replacement}" },
                new[]
                {
                    new ConventionQuickFix
                    {
                        Kind = ConventionQuickFixKind.RenameAbbreviation,
                        Title = $"Replace {token} with {preferred}",
                        Replacement = replacement,
                    },
                }));

            if (string.Equals(normalized, "repo", StringComparison.OrdinalIgnoreCase))
            {
                diagnostics.Add(CreateDiagnostic(
                    file,
                    symbol,
                    "KS_CONV_011",
                    "Near-duplicate naming pattern inconsistency",
                    ConventionSeverity.Info,
                    Clamp01(ratio),
                    $"{symbol.Name} uses 'Repo', while this project predominantly uses 'Repository'.",
                    "Near-duplicate naming forms were detected across the project and this token is the minority variant.",
                    new[]
                    {
                        new ConventionEvidence
                        {
                            Metric = "pattern variant frequency",
                            Expected = "Repository",
                            Observed = "Repo",
                            Ratio = ratio,
                            SampleSize = preferredCount + abbreviationCount,
                        },
                    },
                    new[] { $"Suggested name: {replacement}" },
                    new[]
                    {
                        new ConventionQuickFix
                        {
                            Kind = ConventionQuickFixKind.RenameAbbreviation,
                            Title = "Use Repository instead of Repo",
                            Replacement = replacement,
                        },
                    }));
            }
        }

        return diagnostics;
    }

    private static IEnumerable<ConventionDiagnostic> CheckPluralityConvention(ProjectFileFacts file, TypeSymbolFacts symbol, RuleContext context)
    {
        if (!context.Profile.Folders.TryGetValue(ConventionNamingUtils.NormalizeFolderKey(file.FolderPath), out var folder) ||
            folder.TypeCount < context.MinEvidenceCount)
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        var total = folder.SingularNames + folder.PluralNames;
        if (total < context.MinEvidenceCount)
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        var singularRatio = (double)folder.SingularNames / Math.Max(1, total);
        var pluralRatio = (double)folder.PluralNames / Math.Max(1, total);
        var observedPlural = ConventionNamingUtils.IsPluralWord(symbol.Name);

        if (singularRatio >= 0.80 && observedPlural)
        {
            return new[]
            {
                CreateDiagnostic(
                    file,
                    symbol,
                    "KS_CONV_007",
                    "Plural/singular mismatch",
                    ConventionSeverity.Info,
                    singularRatio,
                    $"{symbol.Name} is plural, but {folder.FolderPath} mostly contains singular type names.",
                    "Singular/plural tendencies were learned from names in this folder.",
                    new[]
                    {
                        new ConventionEvidence
                        {
                            Metric = "folder singular ratio",
                            Expected = "singular names",
                            Observed = "plural name",
                            Ratio = singularRatio,
                            SampleSize = total,
                        },
                    },
                    new[] { "Consider using singular type naming in this folder" },
                    Array.Empty<ConventionQuickFix>()),
            };
        }

        if (pluralRatio >= 0.80 && !observedPlural)
        {
            return new[]
            {
                CreateDiagnostic(
                    file,
                    symbol,
                    "KS_CONV_007",
                    "Plural/singular mismatch",
                    ConventionSeverity.Info,
                    pluralRatio,
                    $"{symbol.Name} is singular, but {folder.FolderPath} mostly contains plural type names.",
                    "Singular/plural tendencies were learned from names in this folder.",
                    new[]
                    {
                        new ConventionEvidence
                        {
                            Metric = "folder plural ratio",
                            Expected = "plural names",
                            Observed = "singular name",
                            Ratio = pluralRatio,
                            SampleSize = total,
                        },
                    },
                    new[] { "Consider using plural type naming in this folder" },
                    Array.Empty<ConventionQuickFix>()),
            };
        }

        return Array.Empty<ConventionDiagnostic>();
    }

    private static IEnumerable<ConventionDiagnostic> CheckFolderBySuffixConvention(ProjectFileFacts file, TypeSymbolFacts symbol, RuleContext context)
    {
        var suffix = ConventionNamingUtils.DetectKnownSuffix(symbol.Name, context.Profile.KnownSuffixes);
        if (string.IsNullOrWhiteSpace(suffix))
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        if (!context.SuffixToFolderDominance.TryGetValue(suffix!, out var recommendedFolder) ||
            string.Equals(recommendedFolder, ConventionNamingUtils.NormalizeFolderKey(file.FolderPath), StringComparison.OrdinalIgnoreCase))
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        return new[]
        {
            CreateDiagnostic(
                file,
                symbol,
                "KS_CONV_009",
                "Type appears in unexpected folder",
                ConventionSeverity.Warning,
                0.72,
                $"{symbol.Name} looks like a *{suffix} type, but it is located in {file.FolderPath}.",
                "The learned suffix-to-folder correlation suggests this type should be placed in another folder.",
                new[]
                {
                    new ConventionEvidence
                    {
                        Metric = "suffix->folder correlation",
                        Expected = recommendedFolder,
                        Observed = ConventionNamingUtils.NormalizeFolderKey(file.FolderPath),
                    },
                },
                new[] { $"Move file to {recommendedFolder}" },
                new[]
                {
                    new ConventionQuickFix
                    {
                        Kind = ConventionQuickFixKind.MoveFileToFolder,
                        Title = $"Move file to {recommendedFolder}",
                        TargetPath = recommendedFolder,
                    },
                })
        };
    }

    private static IEnumerable<ConventionDiagnostic> CheckNamespaceConventions(ProjectFileFacts file, RuleContext context)
    {
        if (string.IsNullOrWhiteSpace(file.Namespace))
        {
            return Array.Empty<ConventionDiagnostic>();
        }

        var diagnostics = new List<ConventionDiagnostic>();
        var namespaceSegments = ConventionNamingUtils.NormalizeNamespace(file.Namespace!);
        var folderKey = ConventionNamingUtils.NormalizeFolderKey(file.FolderPath);

        if (context.Profile.NamespaceConvention.FolderToNamespace.TryGetValue(folderKey, out var folderNamespace) &&
            folderNamespace.Count > 0)
        {
            var expected = folderNamespace.Select(segment => segment.ToLowerInvariant()).ToList();
            var observed = namespaceSegments.Select(segment => segment.ToLowerInvariant()).ToList();
            var score = ConventionNamingUtils.SimilarityScore(expected, observed);
            if (score < 0.60)
            {
                diagnostics.Add(CreateDiagnostic(
                    file,
                    file.PrimaryType ?? FallbackSymbol(file),
                    "KS_CONV_002",
                    "Namespace does not align with folder convention",
                    ConventionSeverity.Warning,
                    Math.Max(0.55, 1 - score),
                    "The namespace does not align with the folder-to-namespace convention observed in this project.",
                    "Namespace-to-folder mapping was learned from existing files in the same folder and this namespace is a low-similarity outlier.",
                    new[]
                    {
                        new ConventionEvidence
                        {
                            Metric = "namespace-folder similarity",
                            Expected = string.Join(".", folderNamespace),
                            Observed = file.Namespace!,
                            Ratio = score,
                        },
                    },
                    new[] { $"Update namespace to {string.Join(".", folderNamespace)}" },
                    new[]
                    {
                        new ConventionQuickFix
                        {
                            Kind = ConventionQuickFixKind.UpdateNamespaceToFolderConvention,
                            Title = $"Update namespace to {string.Join(".", folderNamespace)}",
                            Replacement = string.Join(".", folderNamespace),
                        },
                    }));
            }
        }

        var rootSegments = context.Profile.NamespaceConvention.RootSegments;
        if (rootSegments.Count > 0 && namespaceSegments.Count > 0)
        {
            var expectedRoot = rootSegments[0].ToLowerInvariant();
            var observedRoot = namespaceSegments[0].ToLowerInvariant();
            if (!string.Equals(expectedRoot, observedRoot, StringComparison.Ordinal))
            {
                diagnostics.Add(CreateDiagnostic(
                    file,
                    file.PrimaryType ?? FallbackSymbol(file),
                    "KS_CONV_010",
                    "Unexpected namespace root segment",
                    ConventionSeverity.Info,
                    Math.Max(0.50, context.Profile.NamespaceConvention.Confidence),
                    $"Namespace root '{namespaceSegments[0]}' is unusual. Project convention usually starts with '{rootSegments[0]}'.",
                    "Namespace root usage was learned from existing files and this root differs from the dominant root segment.",
                    new[]
                    {
                        new ConventionEvidence
                        {
                            Metric = "namespace root segment",
                            Expected = rootSegments[0],
                            Observed = namespaceSegments[0],
                            Ratio = context.Profile.NamespaceConvention.Confidence,
                            SampleSize = context.Profile.FilesScanned,
                        },
                    },
                    new[] { $"Use namespace root {rootSegments[0]}" },
                    Array.Empty<ConventionQuickFix>()));
            }
        }

        var folderSegments = ConventionNamingUtils.NormalizePathSegments(file.FolderPath);
        if (folderSegments.Count > 0 && namespaceSegments.Count > 0)
        {
            var score = ConventionNamingUtils.SimilarityScore(folderSegments, namespaceSegments);
            if (score < 0.35)
            {
                diagnostics.Add(CreateDiagnostic(
                    file,
                    file.PrimaryType ?? FallbackSymbol(file),
                    "KS_CONV_010",
                    "Namespace segment mismatch for file location",
                    ConventionSeverity.Info,
                    Clamp01(1 - score),
                    "The namespace segments are weakly correlated with the current folder path segments.",
                    "Folder-path to namespace-segment correlation was learned across the project and this file is an outlier.",
                    new[]
                    {
                        new ConventionEvidence
                        {
                            Metric = "path-namespace segment overlap",
                            Expected = string.Join(".", folderSegments),
                            Observed = string.Join(".", namespaceSegments),
                            Ratio = score,
                        },
                    },
                    new[] { "Align namespace with folder path segments" },
                    Array.Empty<ConventionQuickFix>()));
            }
        }

        return diagnostics;
    }

    private static Dictionary<string, string> BuildDominantFolderBySuffix(ProjectConventionProfile profile)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var perSuffix = new Dictionary<string, List<(string folder, double ratio, int count)>>(StringComparer.OrdinalIgnoreCase);

        foreach (var folder in profile.Folders.Values)
        {
            foreach (var suffix in folder.DominantSuffixes)
            {
                if (!perSuffix.TryGetValue(suffix.Value, out var list))
                {
                    list = new List<(string folder, double ratio, int count)>();
                    perSuffix[suffix.Value] = list;
                }

                list.Add((folder.FolderPath, suffix.Ratio, suffix.Count));
            }
        }

        foreach (var suffixEntry in perSuffix)
        {
            var top = suffixEntry.Value
                .OrderByDescending(item => item.count)
                .ThenByDescending(item => item.ratio)
                .FirstOrDefault();

            if (top.count >= 3 && top.ratio >= 0.50)
            {
                map[suffixEntry.Key] = top.folder;
            }
        }

        return map;
    }

    private static TypeSymbolFacts FallbackSymbol(ProjectFileFacts file)
    {
        return new TypeSymbolFacts
        {
            Name = file.FileStem,
            Kind = ConventionTypeKind.Unknown,
            Line = 0,
            Column = 0,
        };
    }

    private static IReadOnlyList<ConventionDiagnostic> DedupeDiagnostics(IEnumerable<ConventionDiagnostic> input)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var output = new List<ConventionDiagnostic>();

        foreach (var diagnostic in input)
        {
            var key = $"{diagnostic.RuleId}|{diagnostic.FilePath}|{diagnostic.Line}|{diagnostic.Message}";
            if (!seen.Add(key))
            {
                continue;
            }

            output.Add(diagnostic);
        }

        return output;
    }

    private static ConventionDiagnostic CreateDiagnostic(
        ProjectFileFacts file,
        TypeSymbolFacts symbol,
        string ruleId,
        string title,
        ConventionSeverity severity,
        double confidence,
        string message,
        string explanation,
        IEnumerable<ConventionEvidence> evidence,
        IEnumerable<string> suggestions,
        IEnumerable<ConventionQuickFix> quickFixes)
    {
        return new ConventionDiagnostic
        {
            RuleId = ruleId,
            Title = title,
            Severity = severity,
            Confidence = Clamp01(confidence),
            Message = message,
            Explanation = explanation,
            Evidence = evidence.ToList(),
            Suggestions = suggestions.ToList(),
            QuickFixes = quickFixes.ToList(),
            FilePath = file.RelativePath,
            Line = symbol.Line,
            Column = symbol.Column,
        };
    }

    private static double Clamp01(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return 0;
        }

        if (value <= 0)
        {
            return 0;
        }

        if (value >= 1)
        {
            return 1;
        }

        return value;
    }

    private sealed class RuleContext
    {
        public ProjectConventionProfile Profile { get; set; } = new();

        public int MinEvidenceCount { get; set; }

        public IDictionary<string, string> SuffixToFolderDominance { get; set; } =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    }
}
