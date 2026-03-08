using KoSpellCheck.Core.ProjectConventions.Models;

namespace KoSpellCheck.Core.ProjectConventions.AI;

public interface ICoralConventionScorer
{
    double? TryScore(CoralRuntimeContext runtime, AnomalyFeatureVector vector);
}
