using KoSpellCheck.Core.ProjectConventions.Config;

namespace KoSpellCheck.Core.ProjectConventions.Abstractions;

public interface IWorkspaceFileProvider
{
    IReadOnlyList<string> EnumerateFiles(string workspaceRoot, ProjectConventionOptions options);
}
