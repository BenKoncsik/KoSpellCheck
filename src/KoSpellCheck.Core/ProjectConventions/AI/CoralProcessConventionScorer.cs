using System.Diagnostics;
using KoSpellCheck.Core.ProjectConventions.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace KoSpellCheck.Core.ProjectConventions.AI;

public sealed class CoralProcessConventionScorer : ICoralConventionScorer
{
    public double? TryScore(CoralRuntimeContext runtime, AnomalyFeatureVector vector)
    {
        if (!runtime.Available || string.IsNullOrWhiteSpace(runtime.AdapterPath) || !File.Exists(runtime.AdapterPath))
        {
            return null;
        }

        var payload = JsonConvert.SerializeObject(new
        {
            deterministicViolationCount = vector.DeterministicViolationCount,
            suffixMismatchScore = vector.SuffixMismatchScore,
            folderKindMismatchScore = vector.FolderKindMismatchScore,
            namespaceMismatchScore = vector.NamespaceMismatchScore,
            fileTypeMismatchScore = vector.FileTypeMismatchScore,
            abbreviationMismatchScore = vector.AbbreviationMismatchScore,
            tokenRarityScore = vector.TokenRarityScore,
        });

        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = runtime.AdapterPath,
                    Arguments = "--naming-score " + QuoteArgument(payload),
                    WorkingDirectory = string.IsNullOrWhiteSpace(runtime.RuntimeRoot)
                        ? Path.GetDirectoryName(runtime.AdapterPath) ?? Environment.CurrentDirectory
                        : runtime.RuntimeRoot,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                }
            };

            if (!process.Start())
            {
                return null;
            }

            if (!process.WaitForExit(1200))
            {
                try
                {
                    process.Kill();
                }
                catch
                {
                    // Ignore best-effort termination failures.
                }

                return null;
            }

            if (process.ExitCode != 0)
            {
                return null;
            }

            var output = process.StandardOutput.ReadToEnd().Trim();
            if (string.IsNullOrWhiteSpace(output))
            {
                return null;
            }

            if (double.TryParse(output, out var value))
            {
                return Clamp01(value);
            }

            var parsed = JObject.Parse(output);
            var scoreToken = parsed["score"];
            if (scoreToken != null &&
                (scoreToken.Type == JTokenType.Float || scoreToken.Type == JTokenType.Integer))
            {
                var fromJson = scoreToken.Value<double>();
                return Clamp01(fromJson);
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    private static double Clamp01(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return 0;
        }

        if (value <= 0)
        {
            return 0;
        }

        if (value >= 1)
        {
            return 1;
        }

        return value;
    }

    private static string QuoteArgument(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "\"\"";
        }

        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
}
