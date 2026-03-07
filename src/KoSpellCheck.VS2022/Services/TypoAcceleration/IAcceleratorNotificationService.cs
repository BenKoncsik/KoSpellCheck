using KoSpellCheck.Core.TypoAcceleration;

namespace KoSpellCheck.VS2022.Services.TypoAcceleration;

internal interface IAcceleratorNotificationService
{
    void NotifyAutoModeDetectionIfNeeded(SpellSettings settings, AcceleratorAvailabilityResult availability);

    void NotifyOnModeUnavailableIfNeeded(SpellSettings settings, AcceleratorAvailabilityResult availability);
}
