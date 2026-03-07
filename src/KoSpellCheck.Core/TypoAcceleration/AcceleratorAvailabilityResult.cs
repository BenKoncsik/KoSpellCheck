namespace KoSpellCheck.Core.TypoAcceleration;

public sealed class AcceleratorAvailabilityResult
{
    public AcceleratorAvailabilityResult(
        AcceleratorAvailabilityState state,
        string provider,
        string? detail = null,
        DateTimeOffset? detectedAt = null)
    {
        State = state;
        Provider = provider;
        Detail = detail;
        DetectedAt = detectedAt ?? DateTimeOffset.UtcNow;
    }

    public AcceleratorAvailabilityState State { get; }

    public string Provider { get; }

    public string? Detail { get; }

    public DateTimeOffset DetectedAt { get; }
}
