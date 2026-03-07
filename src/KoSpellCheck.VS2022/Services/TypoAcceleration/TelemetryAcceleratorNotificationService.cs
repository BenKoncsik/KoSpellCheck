using KoSpellCheck.Core.TypoAcceleration;

namespace KoSpellCheck.VS2022.Services.TypoAcceleration;

internal sealed class TelemetryAcceleratorNotificationService : IAcceleratorNotificationService
{
    private readonly TelemetryLogger _telemetryLogger;
    private readonly object _gate = new();
    private readonly HashSet<string> _autoDetectionLogged = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _onUnavailableLogged = new(StringComparer.OrdinalIgnoreCase);

    public TelemetryAcceleratorNotificationService(TelemetryLogger telemetryLogger)
    {
        _telemetryLogger = telemetryLogger;
    }

    public void NotifyAutoModeDetectionIfNeeded(SpellSettings settings, AcceleratorAvailabilityResult availability)
    {
        if (!settings.Config.LocalTypoAccelerationShowDetectionPrompt)
        {
            return;
        }

        if (!TryMarkOnce(_autoDetectionLogged, settings.WorkspaceRoot))
        {
            return;
        }

        _telemetryLogger.Info(
            $"Local typo accelerator detected for workspace '{settings.WorkspaceRoot}'. " +
            "Auto mode will use it when available. Set localTypoAcceleration.mode to 'on' to make it explicit.");
    }

    public void NotifyOnModeUnavailableIfNeeded(SpellSettings settings, AcceleratorAvailabilityResult availability)
    {
        var key = $"{settings.WorkspaceRoot}|{availability.State}";
        if (!TryMarkOnce(_onUnavailableLogged, key))
        {
            return;
        }

        _telemetryLogger.Info(
            $"Local typo acceleration mode is ON but accelerator is unavailable ({availability.State}). " +
            $"Fallback to standard local spell-check path is active. Detail: {availability.Detail ?? "n/a"}");
    }

    private bool TryMarkOnce(ISet<string> cache, string key)
    {
        lock (_gate)
        {
            return cache.Add(key);
        }
    }
}
