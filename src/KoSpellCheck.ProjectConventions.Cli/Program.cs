using KoSpellCheck.Core.ProjectConventions.Config;
using KoSpellCheck.Core.ProjectConventions.Models;
using KoSpellCheck.Core.ProjectConventions.Services;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace KoSpellCheck.ProjectConventions.Cli;

internal static class Program
{
    private static readonly JsonSerializerSettings JsonSettings = new()
    {
        Formatting = Formatting.Indented,
        NullValueHandling = NullValueHandling.Ignore,
        Converters = { new StringEnumConverter() },
    };

    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: kospellcheck-conventions <profile|analyze|ignore> --request <jsonPath>");
            return 1;
        }

        var command = args[0].Trim().ToLowerInvariant();
        var requestPath = ResolveRequestPath(args);
        if (string.IsNullOrWhiteSpace(requestPath) || !File.Exists(requestPath))
        {
            Console.Error.WriteLine("Missing or invalid --request <jsonPath> argument.");
            return 1;
        }

        try
        {
            var service = new ProjectConventionService();
            switch (command)
            {
                case "profile":
                    return RunProfile(service, requestPath);
                case "analyze":
                    return RunAnalyze(service, requestPath);
                case "ignore":
                    return RunIgnore(service, requestPath);
                default:
                    Console.Error.WriteLine($"Unknown command '{command}'.");
                    return 1;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.ToString());
            return 1;
        }
    }

    private static int RunProfile(ProjectConventionService service, string requestPath)
    {
        var request = ReadRequest<ConventionProfileBuildRequest>(requestPath);
        var result = service.BuildProfile(request);
        Console.WriteLine(JsonConvert.SerializeObject(result, JsonSettings));
        return 0;
    }

    private static int RunAnalyze(ProjectConventionService service, string requestPath)
    {
        var request = ReadRequest<ConventionAnalysisRequest>(requestPath);
        var result = service.Analyze(request);
        Console.WriteLine(JsonConvert.SerializeObject(result, JsonSettings));
        return 0;
    }

    private static int RunIgnore(ProjectConventionService service, string requestPath)
    {
        var request = ReadRequest<IgnoreRequest>(requestPath);
        service.IgnoreDiagnostic(
            request.WorkspaceRoot,
            request.Options ?? new ProjectConventionOptions(),
            request.RuleId,
            request.Scope,
            request.Target);

        Console.WriteLine("{\"ok\":true}");
        return 0;
    }

    private static T ReadRequest<T>(string path)
    {
        var raw = File.ReadAllText(path);
        var parsed = JsonConvert.DeserializeObject<T>(raw, JsonSettings);
        if (parsed == null)
        {
            throw new InvalidOperationException("Request JSON was empty or invalid.");
        }

        return parsed;
    }

    private static string? ResolveRequestPath(string[] args)
    {
        for (var i = 1; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--request", StringComparison.OrdinalIgnoreCase))
            {
                return args[i + 1];
            }
        }

        return null;
    }

    private sealed class IgnoreRequest
    {
        public string WorkspaceRoot { get; set; } = string.Empty;

        public string RuleId { get; set; } = string.Empty;

        public string Scope { get; set; } = "file";

        public string Target { get; set; } = string.Empty;

        public ProjectConventionOptions? Options { get; set; }
    }
}
