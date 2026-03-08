namespace KoSpellCheck.Core.ProjectConventions.Utils;

internal static class ConventionPathUtils
{
    public static string GetRelativePath(string workspaceRoot, string fullPath)
    {
        if (string.IsNullOrWhiteSpace(workspaceRoot) || string.IsNullOrWhiteSpace(fullPath))
        {
            return fullPath ?? string.Empty;
        }

        try
        {
            var baseUri = new Uri(AppendDirectorySeparator(workspaceRoot));
            var fileUri = new Uri(fullPath);
            if (!string.Equals(baseUri.Scheme, fileUri.Scheme, StringComparison.OrdinalIgnoreCase))
            {
                return fullPath;
            }

            var relativeUri = baseUri.MakeRelativeUri(fileUri);
            var relative = Uri.UnescapeDataString(relativeUri.ToString());
            return relative.Replace('/', Path.DirectorySeparatorChar);
        }
        catch
        {
            return fullPath;
        }
    }

    public static string NormalizeRelativePath(string workspaceRoot, string fullPath)
    {
        var relative = GetRelativePath(workspaceRoot, fullPath);
        return string.IsNullOrWhiteSpace(relative)
            ? string.Empty
            : relative.Replace('\\', '/');
    }

    private static string AppendDirectorySeparator(string path)
    {
        if (path.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal) ||
            path.EndsWith(Path.AltDirectorySeparatorChar.ToString(), StringComparison.Ordinal))
        {
            return path;
        }

        return path + Path.DirectorySeparatorChar;
    }
}
