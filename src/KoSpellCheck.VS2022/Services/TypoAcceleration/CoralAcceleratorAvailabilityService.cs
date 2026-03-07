using System.Runtime.InteropServices;
using KoSpellCheck.Core.TypoAcceleration;

namespace KoSpellCheck.VS2022.Services.TypoAcceleration;

internal sealed class CoralAcceleratorAvailabilityService : IAcceleratorAvailabilityService
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);
    private static readonly string[] LinuxAcceleratorPaths =
    {
        "/dev/apex_0",
        "/dev/apex_1",
    };

    private readonly object _gate = new();
    private readonly string _runtimeManifestPath;
    private AcceleratorAvailabilityResult? _cached;
    private DateTimeOffset _cachedAtUtc;

    public CoralAcceleratorAvailabilityService(ResourcePathResolver resourcePathResolver)
    {
        var contentRoot = resourcePathResolver.ResolveContentRoot();
        // The manifest is an extension-bundled runtime/model adapter marker.
        // If missing, the accelerator path stays disabled and normal spell-check remains active.
        _runtimeManifestPath = Path.Combine(
            contentRoot,
            "Resources",
            "accelerator",
            "coral-typo-classifier",
            "manifest.json");
    }

    public AcceleratorAvailabilityResult GetAvailability(bool forceRefresh = false)
    {
        lock (_gate)
        {
            var nowUtc = DateTimeOffset.UtcNow;
            if (!forceRefresh &&
                _cached != null &&
                nowUtc - _cachedAtUtc <= CacheTtl)
            {
                return _cached;
            }

            _cached = DetectAvailability();
            _cachedAtUtc = nowUtc;
            return _cached;
        }
    }

    private AcceleratorAvailabilityResult DetectAvailability()
    {
        try
        {
            if (string.Equals(
                    Environment.GetEnvironmentVariable("KOSPELLCHECK_LOCAL_ACCELERATOR_FORCE_AVAILABLE"),
                    "1",
                    StringComparison.Ordinal))
            {
                return BuildResult(AcceleratorAvailabilityState.Available, "forced-by-env");
            }

            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                return BuildResult(
                    AcceleratorAvailabilityState.UnavailableUnsupportedPlatform,
                    $"platform '{RuntimeInformation.OSDescription}' is not currently wired for Coral runtime probing");
            }

            if (!File.Exists(_runtimeManifestPath))
            {
                return BuildResult(
                    AcceleratorAvailabilityState.UnavailableMissingRuntime,
                    $"bundled runtime manifest missing at '{_runtimeManifestPath}'");
            }

            var devicePath = LinuxAcceleratorPaths.FirstOrDefault(File.Exists);
            if (devicePath == null)
            {
                return BuildResult(
                    AcceleratorAvailabilityState.Unavailable,
                    "no Coral Edge TPU device node found (/dev/apex_*)");
            }

            return BuildResult(
                AcceleratorAvailabilityState.Available,
                $"detected '{devicePath}'");
        }
        catch (Exception ex)
        {
            return BuildResult(AcceleratorAvailabilityState.Error, ex.Message);
        }
    }

    private static AcceleratorAvailabilityResult BuildResult(AcceleratorAvailabilityState state, string detail)
    {
        return new AcceleratorAvailabilityResult(
            state,
            provider: "google-coral-edgetpu",
            detail: detail,
            detectedAt: DateTimeOffset.UtcNow);
    }
}
