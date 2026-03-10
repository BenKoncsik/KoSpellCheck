using System.IO;

namespace KoSpellCheck.VS2022.Dashboard;

internal static class DashboardSettingsFileHelper
{
    private const string SettingsFileName = "kospellcheck.json";
    private const string DefaultSettingsPayload = "{\n  \"projectConventions\": {\n    \"enabled\": true\n  }\n}\n";

    public static string EnsureSettingsFile(string workspaceRoot)
    {
        var filePath = Path.Combine(workspaceRoot, SettingsFileName);
        if (!File.Exists(filePath))
        {
            File.WriteAllText(filePath, DefaultSettingsPayload);
        }

        return filePath;
    }
}
