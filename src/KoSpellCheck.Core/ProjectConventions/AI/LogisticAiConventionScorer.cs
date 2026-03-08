using KoSpellCheck.Core.ProjectConventions.Models;

namespace KoSpellCheck.Core.ProjectConventions.AI;

public sealed class LogisticAiConventionScorer : IAiConventionScorer
{
    private readonly ICoralConventionScorer _coralConventionScorer;

    public LogisticAiConventionScorer(ICoralConventionScorer? coralConventionScorer = null)
    {
        _coralConventionScorer = coralConventionScorer ?? new CoralProcessConventionScorer();
    }

    public AiAnomalyScore? Score(
        AnomalyFeatureVector vector,
        LightweightAnomalyModel model,
        CoralRuntimeContext? coralRuntime,
        bool useCoralIfAvailable)
    {
        if (useCoralIfAvailable && coralRuntime != null)
        {
            var coralScore = _coralConventionScorer.TryScore(coralRuntime, vector);
            if (coralScore.HasValue)
            {
                return new AiAnomalyScore
                {
                    Score = coralScore.Value,
                    Backend = "coral-adapter",
                    Detail = coralRuntime.Detail,
                };
            }
        }

        var normalizedDeterministic = Math.Min(1, vector.DeterministicViolationCount / 4.0);
        var weights = model.Weights;
        var z =
            weights.Bias +
            weights.DeterministicViolationCount * normalizedDeterministic +
            weights.SuffixMismatchScore * vector.SuffixMismatchScore +
            weights.FolderKindMismatchScore * vector.FolderKindMismatchScore +
            weights.NamespaceMismatchScore * vector.NamespaceMismatchScore +
            weights.FileTypeMismatchScore * vector.FileTypeMismatchScore +
            weights.AbbreviationMismatchScore * vector.AbbreviationMismatchScore +
            weights.TokenRarityScore * vector.TokenRarityScore;

        return new AiAnomalyScore
        {
            Score = Sigmoid(z),
            Backend = "cpu-logistic",
            Detail = "Fallback CPU logistic regression scorer.",
        };
    }

    private static double Sigmoid(double value)
    {
        return 1 / (1 + Math.Exp(-value));
    }
}
