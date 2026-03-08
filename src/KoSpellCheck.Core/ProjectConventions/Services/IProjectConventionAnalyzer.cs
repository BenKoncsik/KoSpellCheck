using KoSpellCheck.Core.ProjectConventions.Models;

namespace KoSpellCheck.Core.ProjectConventions.Services;

public interface IProjectConventionAnalyzer
{
    ConventionAnalysisResult Analyze(ConventionAnalysisRequest request);
}
