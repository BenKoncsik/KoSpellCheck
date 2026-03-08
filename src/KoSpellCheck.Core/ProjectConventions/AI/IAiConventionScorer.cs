using KoSpellCheck.Core.ProjectConventions.Models;

namespace KoSpellCheck.Core.ProjectConventions.AI;

public interface IAiConventionScorer
{
    AiAnomalyScore? Score(
        AnomalyFeatureVector vector,
        LightweightAnomalyModel model,
        CoralRuntimeContext? coralRuntime,
        bool useCoralIfAvailable);
}
