namespace KoSpellCheck.Core.TypoAcceleration;

public interface IAcceleratorAvailabilityService
{
    AcceleratorAvailabilityResult GetAvailability(bool forceRefresh = false);
}
