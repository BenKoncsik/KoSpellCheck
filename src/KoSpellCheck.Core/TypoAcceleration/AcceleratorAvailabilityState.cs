namespace KoSpellCheck.Core.TypoAcceleration;

public enum AcceleratorAvailabilityState
{
    Available = 0,
    Unavailable = 1,
    UnavailableMissingRuntime = 2,
    UnavailableUnsupportedPlatform = 3,
    Error = 4,
}
