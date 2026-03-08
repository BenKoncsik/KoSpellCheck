using System.Text.RegularExpressions;
using KoSpellCheck.Core.ProjectConventions.Abstractions;
using KoSpellCheck.Core.ProjectConventions.Config;
using KoSpellCheck.Core.ProjectConventions.Utils;

namespace KoSpellCheck.Core.ProjectConventions.Scanning;

public sealed class FileSystemWorkspaceFileProvider : IWorkspaceFileProvider
{
    public IReadOnlyList<string> EnumerateFiles(string workspaceRoot, ProjectConventionOptions options)
    {
        if (string.IsNullOrWhiteSpace(workspaceRoot) || !Directory.Exists(workspaceRoot))
        {
            return Array.Empty<string>();
        }

        var output = new List<string>();
        var pending = new Stack<string>();
        pending.Push(workspaceRoot);

        var supported = new HashSet<string>(
            options.SupportedExtensions.Select(NormalizeExtension),
            StringComparer.OrdinalIgnoreCase);

        while (pending.Count > 0)
        {
            var current = pending.Pop();

            foreach (var directory in SafeEnumerateDirectories(current))
            {
                pending.Push(directory);
            }

            foreach (var file in SafeEnumerateFiles(current))
            {
                if (output.Count >= options.MaxFiles)
                {
                    return output;
                }

                var extension = NormalizeExtension(Path.GetExtension(file));
                if (extension.Length == 0)
                {
                    continue;
                }

                if (supported.Count > 0 && !supported.Contains(extension))
                {
                    continue;
                }

                var relativePath = ToRelativePathNormalized(workspaceRoot, file);
                if (!ShouldInclude(relativePath, options))
                {
                    continue;
                }

                output.Add(file);
            }
        }

        return output;
    }

    private static IEnumerable<string> SafeEnumerateDirectories(string path)
    {
        try
        {
            return Directory.EnumerateDirectories(path).ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static IEnumerable<string> SafeEnumerateFiles(string path)
    {
        try
        {
            return Directory.EnumerateFiles(path).ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static bool ShouldInclude(string relativePath, ProjectConventionOptions options)
    {
        if (options.ExcludePatterns.Any(pattern => GlobMatch(relativePath, pattern)))
        {
            return false;
        }

        if (options.IncludePatterns.Count == 0)
        {
            return true;
        }

        return options.IncludePatterns.Any(pattern => GlobMatch(relativePath, pattern));
    }

    private static bool GlobMatch(string value, string pattern)
    {
        if (string.IsNullOrWhiteSpace(pattern) || pattern == "**/*")
        {
            return true;
        }

        var normalizedPattern = pattern.Replace('\\', '/');
        var escaped = Regex.Escape(normalizedPattern)
            .Replace("\\*\\*", "::DOUBLE_STAR::")
            .Replace("\\*", "[^/]*")
            .Replace("::DOUBLE_STAR::", ".*")
            .Replace("\\?", ".");
        var regex = new Regex($"^{escaped}$", RegexOptions.CultureInvariant);
        return regex.IsMatch(value.Replace('\\', '/'));
    }

    private static string NormalizeExtension(string extension)
    {
        if (string.IsNullOrWhiteSpace(extension))
        {
            return string.Empty;
        }

        return extension.Trim().TrimStart('.').ToLowerInvariant();
    }

    private static string ToRelativePathNormalized(string workspaceRoot, string fullPath)
    {
        return ConventionPathUtils.NormalizeRelativePath(workspaceRoot, fullPath);
    }
}
