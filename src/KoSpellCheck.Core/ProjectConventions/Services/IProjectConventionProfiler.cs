using KoSpellCheck.Core.ProjectConventions.Models;

namespace KoSpellCheck.Core.ProjectConventions.Services;

public interface IProjectConventionProfiler
{
    ConventionProfileBuildResult BuildProfile(ConventionProfileBuildRequest request);
}
