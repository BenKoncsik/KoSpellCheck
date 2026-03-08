using KoSpellCheck.Core.ProjectConventions.Models;
using KoSpellCheck.Core.ProjectConventions.Utils;

namespace KoSpellCheck.Core.ProjectConventions.Profiling;

public sealed class ConventionProfiler
{
    public (ProjectConventionProfile profile, ConventionScanSummary summary, LightweightAnomalyModel anomalyModel)
        BuildProfile(
            string workspaceRoot,
            IReadOnlyList<ProjectFileFacts> files,
            string scope,
            int minEvidenceCount)
    {
        var now = DateTime.UtcNow;

        var folderStats = new Dictionary<string, MutableFolderStats>(StringComparer.OrdinalIgnoreCase);
        var globalSuffixes = new Dictionary<string, int>(StringComparer.Ordinal);
        var globalPrefixes = new Dictionary<string, int>(StringComparer.Ordinal);
        var caseStyles = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var tokenFrequencies = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var abbreviationFrequencies = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var abbreviationPreferredForms = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var folderToNamespaceSamples = new Dictionary<string, Dictionary<string, int>>(StringComparer.OrdinalIgnoreCase);
        var namespaceRoots = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var interfacePrefixed = 0;
        var interfaceTotal = 0;
        var enumSuffixes = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var enumCaseStyles = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var suffixToFolderCount = new Dictionary<string, Dictionary<string, int>>(StringComparer.OrdinalIgnoreCase);

        var typeCount = 0;
        var fileToPrimaryTypeMatches = 0;

        foreach (var file in files)
        {
            var folderKey = ConventionNamingUtils.NormalizeFolderKey(file.FolderPath);
            if (!folderStats.TryGetValue(folderKey, out var folder))
            {
                folder = new MutableFolderStats();
                folderStats[folderKey] = folder;
            }

            folder.Files++;

            if (file.PrimaryType != null && string.Equals(file.FileStem, file.PrimaryType.Name, StringComparison.Ordinal))
            {
                fileToPrimaryTypeMatches++;
            }

            if (!string.IsNullOrWhiteSpace(file.Namespace))
            {
                Increment(folder.Namespaces, file.Namespace!);
                if (!folderToNamespaceSamples.TryGetValue(folderKey, out var namespaceMap))
                {
                    namespaceMap = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                    folderToNamespaceSamples[folderKey] = namespaceMap;
                }

                Increment(namespaceMap, file.Namespace!);
                var segments = ConventionNamingUtils.NormalizeNamespace(file.Namespace!);
                if (segments.Count > 0)
                {
                    Increment(namespaceRoots, segments[0]);
                }
            }

            foreach (var symbol in file.Types)
            {
                typeCount++;
                folder.Types++;
                Increment(folder.Kinds, symbol.Kind.ToString().ToLowerInvariant());

                var style = ConventionNamingUtils.DetectCaseStyle(symbol.Name).ToString();
                Increment(caseStyles, style);
                Increment(folder.CaseStyles, style);

                var suffix = ConventionNamingUtils.DetectKnownSuffix(symbol.Name, ConventionNamingUtils.BuiltInSuffixes());
                if (!string.IsNullOrWhiteSpace(suffix))
                {
                    Increment(globalSuffixes, suffix!);
                    Increment(folder.Suffixes, suffix!);

                    if (!suffixToFolderCount.TryGetValue(suffix!, out var suffixFolders))
                    {
                        suffixFolders = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                        suffixToFolderCount[suffix!] = suffixFolders;
                    }

                    Increment(suffixFolders, folderKey);
                }

                var prefix = ConventionNamingUtils.DetectKnownPrefix(symbol.Name);
                if (!string.IsNullOrWhiteSpace(prefix))
                {
                    Increment(globalPrefixes, prefix!);
                    Increment(folder.Prefixes, prefix!);
                }

                foreach (var token in ConventionNamingUtils.SplitIdentifierTokens(symbol.Name))
                {
                    var normalized = ConventionNamingUtils.NormalizeToken(token);
                    if (normalized.Length == 0)
                    {
                        continue;
                    }

                    Increment(tokenFrequencies, normalized);
                    if (normalized.Length <= 4)
                    {
                        Increment(abbreviationFrequencies, normalized);
                        var preferred = ConventionNamingUtils.AbbreviationToPreferred(normalized);
                        if (!string.IsNullOrWhiteSpace(preferred))
                        {
                            abbreviationPreferredForms[normalized] = preferred!;
                        }
                    }
                }

                if (symbol.Kind == ConventionTypeKind.Interface)
                {
                    interfaceTotal++;
                    if (symbol.Name.StartsWith("I", StringComparison.Ordinal) &&
                        symbol.Name.Length > 1 &&
                        char.IsUpper(symbol.Name[1]))
                    {
                        interfacePrefixed++;
                    }
                }

                if (symbol.Kind == ConventionTypeKind.Enum)
                {
                    Increment(enumCaseStyles, style);
                    var enumSuffix = ConventionNamingUtils.DetectKnownSuffix(symbol.Name, new[] { "Enum", "Flags" });
                    if (!string.IsNullOrWhiteSpace(enumSuffix))
                    {
                        Increment(enumSuffixes, enumSuffix!);
                    }
                }

                if (ConventionNamingUtils.IsPluralWord(symbol.Name))
                {
                    folder.PluralNames++;
                }
                else
                {
                    folder.SingularNames++;
                }
            }
        }

        var folderProfiles = folderStats.ToDictionary(
            entry => entry.Key,
            entry => new FolderConventionProfile
            {
                FolderPath = entry.Key,
                Files = entry.Value.Files,
                TypeCount = entry.Value.Types,
                DominantSuffixes = ToFrequencyEntries(entry.Value.Suffixes),
                DominantPrefixes = ToFrequencyEntries(entry.Value.Prefixes),
                DominantTypeKinds = ToFrequencyEntries(entry.Value.Kinds),
                DominantCaseStyles = ToFrequencyEntries(entry.Value.CaseStyles),
                NamespaceSamples = ToFrequencyEntries(entry.Value.Namespaces),
                SingularNames = entry.Value.SingularNames,
                PluralNames = entry.Value.PluralNames,
            },
            StringComparer.OrdinalIgnoreCase);

        var dominantCaseDistribution = ToFrequencyEntries(caseStyles);
        var dominantCaseStyle = ParseCaseStyle(dominantCaseDistribution.FirstOrDefault()?.Value);

        var interfaceConfidence = interfaceTotal == 0 ? 0 : (double)interfacePrefixed / interfaceTotal;

        var folderToNamespace = new Dictionary<string, IList<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in folderToNamespaceSamples)
        {
            var top = ToFrequencyEntries(item.Value).FirstOrDefault();
            if (top == null)
            {
                continue;
            }

            folderToNamespace[item.Key] = top.Value.Split(new[] { '.' }, StringSplitOptions.RemoveEmptyEntries).ToList();
        }

        var namespaceRootEntries = ToFrequencyEntries(namespaceRoots);
        var namespaceRoot = namespaceRootEntries.FirstOrDefault();

        var profile = new ProjectConventionProfile
        {
            SchemaVersion = 1,
            GeneratedAtUtc = now,
            WorkspaceRoot = workspaceRoot,
            Scope = scope,
            FilesScanned = files.Count,
            TypesScanned = typeCount,
            DominantCaseStyle = dominantCaseStyle,
            DominantCaseDistribution = dominantCaseDistribution,
            FileToPrimaryTypeMatchRate = files.Count == 0 ? 0 : (double)fileToPrimaryTypeMatches / files.Count,
            Folders = folderProfiles,
            GlobalSuffixes = ToFrequencyEntries(globalSuffixes),
            GlobalPrefixes = ToFrequencyEntries(globalPrefixes),
            TokenFrequencies = tokenFrequencies,
            AbbreviationFrequencies = abbreviationFrequencies,
            AbbreviationPreferredForms = abbreviationPreferredForms,
            InterfaceConvention = new InterfaceConventionProfile
            {
                ExpectedPrefix = "I",
                PrefixedCount = interfacePrefixed,
                TotalCount = interfaceTotal,
                Confidence = interfaceConfidence,
            },
            EnumConvention = new EnumConventionProfile
            {
                DominantCaseStyle = ParseCaseStyle(ToFrequencyEntries(enumCaseStyles).FirstOrDefault()?.Value),
                DominantSuffix = ToFrequencyEntries(enumSuffixes).FirstOrDefault()?.Value,
                Confidence = ToFrequencyEntries(enumCaseStyles).FirstOrDefault()?.Ratio ?? 0,
            },
            NamespaceConvention = new NamespaceConventionProfile
            {
                RootSegments = namespaceRoot == null ? new List<string>() : new List<string> { namespaceRoot.Value },
                FolderToNamespace = folderToNamespace,
                Confidence = namespaceRoot?.Ratio ?? 0,
            },
            KnownSuffixes = ConventionNamingUtils.BuiltInSuffixes()
                .Union(globalSuffixes.Keys, StringComparer.Ordinal)
                .Distinct(StringComparer.Ordinal)
                .ToList(),
        };

        InjectSuffixToFolderHints(profile, suffixToFolderCount);

        var summary = new ConventionScanSummary
        {
            SchemaVersion = 1,
            GeneratedAtUtc = now,
            WorkspaceRoot = workspaceRoot,
            Scope = scope,
            FilesScanned = files.Count,
            TypesScanned = typeCount,
            DominantCaseStyle = dominantCaseStyle,
            DominantFolderConventions = profile.Folders.Values
                .Select(folder =>
                {
                    var dominantSuffix = folder.DominantSuffixes.FirstOrDefault();
                    var dominantKind = folder.DominantTypeKinds.FirstOrDefault();
                    return new ConventionScanSummaryEntry
                    {
                        FolderPath = folder.FolderPath,
                        DominantSuffix = dominantSuffix?.Value,
                        DominantKind = dominantKind?.Value,
                        Confidence = Math.Max(dominantSuffix?.Ratio ?? 0, dominantKind?.Ratio ?? 0),
                    };
                })
                .Where(entry => entry.Confidence >= 0.40)
                .OrderByDescending(entry => entry.Confidence)
                .Take(20)
                .ToList(),
        };

        var anomalyModel = new LightweightAnomalyModel
        {
            SchemaVersion = 1,
            ModelType = "logistic-regression",
            CreatedAtUtc = now,
            Weights = new LightweightAnomalyModelWeights
            {
                Bias = -0.35,
                DeterministicViolationCount = 0.85 + Math.Max(1, Math.Min(10, minEvidenceCount)) * 0.02,
                SuffixMismatchScore = 1.30,
                FolderKindMismatchScore = 1.05,
                NamespaceMismatchScore = 0.95,
                FileTypeMismatchScore = 1.10,
                AbbreviationMismatchScore = 0.80,
                TokenRarityScore = 0.70,
            },
        };

        return (profile, summary, anomalyModel);
    }

    private static ConventionCaseStyle ParseCaseStyle(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return ConventionCaseStyle.Unknown;
        }

        return Enum.TryParse<ConventionCaseStyle>(value, true, out var parsed)
            ? parsed
            : ConventionCaseStyle.Unknown;
    }

    private static void InjectSuffixToFolderHints(
        ProjectConventionProfile profile,
        IDictionary<string, Dictionary<string, int>> suffixToFolderCount)
    {
        foreach (var suffixEntry in suffixToFolderCount)
        {
            var topFolder = ToFrequencyEntries(suffixEntry.Value).FirstOrDefault();
            if (topFolder == null)
            {
                continue;
            }

            if (!profile.Folders.TryGetValue(topFolder.Value, out var folder))
            {
                continue;
            }

            if (folder.DominantSuffixes.Any(entry =>
                    string.Equals(entry.Value, suffixEntry.Key, StringComparison.Ordinal)))
            {
                continue;
            }

            folder.DominantSuffixes.Add(new FrequencyEntry
            {
                Value = suffixEntry.Key,
                Count = topFolder.Count,
                Ratio = topFolder.Ratio,
            });
        }
    }

    private static void Increment(IDictionary<string, int> counter, string key)
    {
        var normalized = key?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return;
        }

        counter.TryGetValue(normalized, out var current);
        counter[normalized] = current + 1;
    }

    private static List<FrequencyEntry> ToFrequencyEntries(IDictionary<string, int> counter)
    {
        var values = counter
            .Select(item => new { item.Key, item.Value })
            .OrderByDescending(item => item.Value)
            .ThenBy(item => item.Key, StringComparer.Ordinal)
            .ToList();

        var total = values.Sum(item => item.Value);
        if (total <= 0)
        {
            return new List<FrequencyEntry>();
        }

        return values
            .Select(item => new FrequencyEntry
            {
                Value = item.Key,
                Count = item.Value,
                Ratio = (double)item.Value / total,
            })
            .ToList();
    }

    private sealed class MutableFolderStats
    {
        public int Files { get; set; }

        public int Types { get; set; }

        public Dictionary<string, int> Suffixes { get; } = new(StringComparer.Ordinal);

        public Dictionary<string, int> Prefixes { get; } = new(StringComparer.Ordinal);

        public Dictionary<string, int> Kinds { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Dictionary<string, int> CaseStyles { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Dictionary<string, int> Namespaces { get; } = new(StringComparer.OrdinalIgnoreCase);

        public int SingularNames { get; set; }

        public int PluralNames { get; set; }
    }
}
