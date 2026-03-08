using KoSpellCheck.Core.ProjectConventions.Models;

namespace KoSpellCheck.Core.ProjectConventions.Anomaly;

public interface IAnomalyScorer
{
    (StatisticalAnomalyResult result, AnomalyFeatureVector vector) Score(
        ProjectFileFacts file,
        ProjectConventionProfile profile,
        int deterministicViolationCount);
}
