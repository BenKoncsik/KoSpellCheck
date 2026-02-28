using KoSpellCheck.LanguagePack.HuEn;

namespace KoSpellCheck.VS2022.Services;

internal sealed class ResourcePathResolver
{
    public string ResolveContentRoot()
    {
        foreach (var candidate in GetCandidateRoots())
        {
            try
            {
                HuEnLanguagePack.ResolveDictionaryRoot(candidate);
                return candidate;
            }
            catch
            {
                // Ignore and continue probing candidates.
            }
        }

        return AppContext.BaseDirectory;
    }

    public string ResolveDictionaryRoot()
    {
        var contentRoot = ResolveContentRoot();
        return HuEnLanguagePack.ResolveDictionaryRoot(contentRoot);
    }

    public string ResolveLicensesRoot()
    {
        foreach (var candidate in GetCandidateRoots())
        {
            var direct = Path.Combine(candidate, "licenses");
            var lower = Path.Combine(candidate, "resources", "licenses");
            var upper = Path.Combine(candidate, "Resources", "Licenses");

            if (Directory.Exists(direct))
            {
                return direct;
            }

            if (Directory.Exists(lower))
            {
                return lower;
            }

            if (Directory.Exists(upper))
            {
                return upper;
            }
        }

        return string.Empty;
    }

    private static IEnumerable<string> GetCandidateRoots()
    {
        var roots = new List<string>();
        var baseDir = AppContext.BaseDirectory;
        roots.Add(baseDir);

        var assemblyDir = Path.GetDirectoryName(typeof(ResourcePathResolver).Assembly.Location);
        if (!string.IsNullOrWhiteSpace(assemblyDir))
        {
            roots.Add(assemblyDir);
        }

        roots.Add(Directory.GetCurrentDirectory());

        foreach (var root in roots.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            yield return root;
        }
    }
}
