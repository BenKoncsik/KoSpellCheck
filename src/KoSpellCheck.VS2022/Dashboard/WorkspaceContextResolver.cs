using EnvDTE80;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace KoSpellCheck.VS2022.Dashboard;

internal sealed class WorkspaceContext
{
    public string? WorkspaceRoot { get; set; }

    public string? ActiveFilePath { get; set; }
}

internal static class WorkspaceContextResolver
{
    public static async Task<WorkspaceContext> ResolveAsync(AsyncPackage package, CancellationToken cancellationToken)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
        var dte = await package.GetServiceAsync(typeof(SDTE)).ConfigureAwait(true) as DTE2;
        var activeFile = dte?.ActiveDocument?.FullName;
        var solutionPath = dte?.Solution?.FullName;

        var workspaceRoot = ResolveWorkspaceRoot(solutionPath, activeFile);
        return new WorkspaceContext
        {
            WorkspaceRoot = workspaceRoot,
            ActiveFilePath = string.IsNullOrWhiteSpace(activeFile) ? null : activeFile,
        };
    }

    public static string? ResolveWorkspaceRoot(string? solutionPath, string? activeFilePath)
    {
        if (!string.IsNullOrWhiteSpace(solutionPath))
        {
            var root = Path.GetDirectoryName(solutionPath);
            if (!string.IsNullOrWhiteSpace(root))
            {
                return root;
            }
        }

        if (string.IsNullOrWhiteSpace(activeFilePath))
        {
            return null;
        }

        var probe = Path.GetDirectoryName(activeFilePath);
        if (string.IsNullOrWhiteSpace(probe))
        {
            return null;
        }

        for (var i = 0; i < 12; i++)
        {
            if (HasWorkspaceMarker(probe))
            {
                return probe;
            }

            var parent = Directory.GetParent(probe);
            if (parent == null)
            {
                break;
            }

            probe = parent.FullName;
        }

        return Path.GetDirectoryName(activeFilePath);
    }

    private static bool HasWorkspaceMarker(string path)
    {
        return File.Exists(Path.Combine(path, "kospellcheck.json")) ||
               File.Exists(Path.Combine(path, ".editorconfig")) ||
               Directory.Exists(Path.Combine(path, ".git")) ||
               Directory.EnumerateFiles(path, "*.sln").Any();
    }
}
