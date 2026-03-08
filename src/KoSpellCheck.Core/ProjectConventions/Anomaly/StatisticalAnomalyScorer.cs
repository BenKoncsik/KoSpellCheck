using KoSpellCheck.Core.ProjectConventions.Models;
using KoSpellCheck.Core.ProjectConventions.Utils;

namespace KoSpellCheck.Core.ProjectConventions.Anomaly;

public sealed class StatisticalAnomalyScorer : IAnomalyScorer
{
    public (StatisticalAnomalyResult result, AnomalyFeatureVector vector) Score(
        ProjectFileFacts file,
        ProjectConventionProfile profile,
        int deterministicViolationCount)
    {
        if (file.PrimaryType == null)
        {
            return (new StatisticalAnomalyResult { Score = 0 }, new AnomalyFeatureVector { DeterministicViolationCount = deterministicViolationCount });
        }

        var evidence = new List<ConventionEvidence>();
        var folderKey = ConventionNamingUtils.NormalizeFolderKey(file.FolderPath);
        profile.Folders.TryGetValue(folderKey, out var folder);

        var suffixMismatch = ComputeSuffixMismatch(file.PrimaryType, folder);
        if (suffixMismatch.evidence != null)
        {
            evidence.Add(suffixMismatch.evidence);
        }

        var kindMismatch = ComputeKindMismatch(file.PrimaryType, folder);
        if (kindMismatch.evidence != null)
        {
            evidence.Add(kindMismatch.evidence);
        }

        var namespaceMismatch = ComputeNamespaceMismatch(file, profile, folderKey);
        if (namespaceMismatch.evidence != null)
        {
            evidence.Add(namespaceMismatch.evidence);
        }

        var fileTypeMismatch = ComputeFileTypeMismatch(file, profile);
        if (fileTypeMismatch.evidence != null)
        {
            evidence.Add(fileTypeMismatch.evidence);
        }

        var abbreviationMismatch = ComputeAbbreviationMismatch(file.PrimaryType, profile);
        if (abbreviationMismatch.evidence != null)
        {
            evidence.Add(abbreviationMismatch.evidence);
        }

        var tokenRarity = ComputeTokenRarity(file.PrimaryType, profile);
        if (tokenRarity.evidence != null)
        {
            evidence.Add(tokenRarity.evidence);
        }

        var vector = new AnomalyFeatureVector
        {
            DeterministicViolationCount = deterministicViolationCount,
            SuffixMismatchScore = suffixMismatch.score,
            FolderKindMismatchScore = kindMismatch.score,
            NamespaceMismatchScore = namespaceMismatch.score,
            FileTypeMismatchScore = fileTypeMismatch.score,
            AbbreviationMismatchScore = abbreviationMismatch.score,
            TokenRarityScore = tokenRarity.score,
        };

        var weighted =
            vector.SuffixMismatchScore * 0.24 +
            vector.FolderKindMismatchScore * 0.17 +
            vector.NamespaceMismatchScore * 0.20 +
            vector.FileTypeMismatchScore * 0.16 +
            vector.AbbreviationMismatchScore * 0.11 +
            vector.TokenRarityScore * 0.12;

        return (
            new StatisticalAnomalyResult
            {
                Score = Clamp01(weighted),
                Signals = evidence,
            },
            vector);
    }

    private static (double score, ConventionEvidence? evidence) ComputeSuffixMismatch(
        TypeSymbolFacts symbol,
        FolderConventionProfile? folder)
    {
        var topSuffix = folder?.DominantSuffixes.FirstOrDefault();
        if (topSuffix == null || topSuffix.Ratio < 0.45)
        {
            return (0, null);
        }

        if (symbol.Name.EndsWith(topSuffix.Value, StringComparison.Ordinal))
        {
            return (0, null);
        }

        var observedSuffix = ConventionNamingUtils.DetectKnownSuffix(symbol.Name) ?? "none";
        return (Clamp01(topSuffix.Ratio), new ConventionEvidence
        {
            Metric = "folder suffix likelihood",
            Expected = topSuffix.Value,
            Observed = observedSuffix,
            Ratio = 1 - topSuffix.Ratio,
        });
    }

    private static (double score, ConventionEvidence? evidence) ComputeKindMismatch(
        TypeSymbolFacts symbol,
        FolderConventionProfile? folder)
    {
        var topKind = folder?.DominantTypeKinds.FirstOrDefault();
        if (topKind == null || topKind.Ratio < 0.5)
        {
            return (0, null);
        }

        if (string.Equals(topKind.Value, symbol.Kind.ToString(), StringComparison.OrdinalIgnoreCase))
        {
            return (0, null);
        }

        return (Clamp01(topKind.Ratio), new ConventionEvidence
        {
            Metric = "folder type-kind likelihood",
            Expected = topKind.Value,
            Observed = symbol.Kind.ToString(),
            Ratio = 1 - topKind.Ratio,
        });
    }

    private static (double score, ConventionEvidence? evidence) ComputeNamespaceMismatch(
        ProjectFileFacts file,
        ProjectConventionProfile profile,
        string folderKey)
    {
        if (string.IsNullOrWhiteSpace(file.Namespace) ||
            !profile.NamespaceConvention.FolderToNamespace.TryGetValue(folderKey, out var expected) ||
            expected.Count == 0)
        {
            return (0, null);
        }

        var namespaceTokens = ConventionNamingUtils.NormalizeNamespace(file.Namespace);
        var expectedTokens = expected.Select(ConventionNamingUtils.NormalizeToken).Where(token => token.Length > 0).ToList();
        var overlap = ConventionNamingUtils.SimilarityScore(namespaceTokens, expectedTokens);
        if (overlap >= 0.70)
        {
            return (0, null);
        }

        return (Clamp01(1 - overlap), new ConventionEvidence
        {
            Metric = "namespace-path association",
            Expected = string.Join(".", expected),
            Observed = file.Namespace!,
            Ratio = overlap,
        });
    }

    private static (double score, ConventionEvidence? evidence) ComputeFileTypeMismatch(
        ProjectFileFacts file,
        ProjectConventionProfile profile)
    {
        if (file.PrimaryType == null ||
            string.Equals(file.FileStem, file.PrimaryType.Name, StringComparison.Ordinal) ||
            profile.FileToPrimaryTypeMatchRate < 0.55)
        {
            return (0, null);
        }

        return (Clamp01(profile.FileToPrimaryTypeMatchRate), new ConventionEvidence
        {
            Metric = "file-primary-type similarity",
            Expected = file.FileStem,
            Observed = file.PrimaryType.Name,
            Ratio = 1 - profile.FileToPrimaryTypeMatchRate,
        });
    }

    private static (double score, ConventionEvidence? evidence) ComputeAbbreviationMismatch(
        TypeSymbolFacts symbol,
        ProjectConventionProfile profile)
    {
        var tokens = ConventionNamingUtils.SplitIdentifierTokens(symbol.Name)
            .Select(ConventionNamingUtils.NormalizeToken)
            .Where(token => token.Length > 0)
            .ToList();

        var worst = 0.0;
        string? expected = null;
        string? observed = null;

        foreach (var token in tokens)
        {
            if (!profile.AbbreviationPreferredForms.TryGetValue(token, out var preferred))
            {
                continue;
            }

            if (string.Equals(token, ConventionNamingUtils.NormalizeToken(preferred), StringComparison.Ordinal))
            {
                continue;
            }

            profile.AbbreviationFrequencies.TryGetValue(token, out var tokenCount);
            profile.TokenFrequencies.TryGetValue(ConventionNamingUtils.NormalizeToken(preferred), out var preferredCount);
            var ratio = (double)preferredCount / Math.Max(1, tokenCount + preferredCount);
            if (ratio <= worst)
            {
                continue;
            }

            worst = ratio;
            expected = preferred;
            observed = token;
        }

        if (expected == null || observed == null)
        {
            return (0, null);
        }

        return (Clamp01(worst), new ConventionEvidence
        {
            Metric = "abbreviation preference likelihood",
            Expected = expected,
            Observed = observed,
            Ratio = worst,
        });
    }

    private static (double score, ConventionEvidence? evidence) ComputeTokenRarity(
        TypeSymbolFacts symbol,
        ProjectConventionProfile profile)
    {
        var tokens = ConventionNamingUtils.SplitIdentifierTokens(symbol.Name)
            .Select(ConventionNamingUtils.NormalizeToken)
            .Where(token => token.Length > 0)
            .ToList();
        if (tokens.Count == 0)
        {
            return (0, null);
        }

        var totalFrequency = profile.TokenFrequencies.Values.Sum();
        if (totalFrequency <= 0)
        {
            return (0, null);
        }

        var raritySum = 0.0;
        foreach (var token in tokens)
        {
            profile.TokenFrequencies.TryGetValue(token, out var tokenCount);
            var probability = (double)tokenCount / totalFrequency;
            var rarity = tokenCount <= 0 ? 1 : 1 - Math.Min(1, probability * 25);
            raritySum += rarity;
        }

        var score = Clamp01(raritySum / tokens.Count);
        if (score < 0.6)
        {
            return (0, null);
        }

        return (score, new ConventionEvidence
        {
            Metric = "token rarity",
            Expected = "common project tokens",
            Observed = symbol.Name,
            Ratio = 1 - score,
        });
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
}
