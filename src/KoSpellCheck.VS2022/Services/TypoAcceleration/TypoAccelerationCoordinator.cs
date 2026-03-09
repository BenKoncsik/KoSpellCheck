using KoSpellCheck.Core.Diagnostics;
using KoSpellCheck.Core.TypoAcceleration;
using KoSpellCheck.Core.Localization;
using Microsoft.VisualStudio.Text;

namespace KoSpellCheck.VS2022.Services.TypoAcceleration;

internal sealed class TypoAccelerationCoordinator
{
    private readonly object _gate = new();
    private readonly IAcceleratorAvailabilityService _availabilityService;
    private readonly IAcceleratorNotificationService _notificationService;
    private readonly ILocalTypoClassifier _classifier;
    private readonly TelemetryLogger _telemetryLogger;
    private AcceleratorAvailabilityState? _lastAvailabilityState;
    private string? _lastPath;
    private bool _hadAcceleratorPath;

    public TypoAccelerationCoordinator(
        IAcceleratorAvailabilityService availabilityService,
        IAcceleratorNotificationService notificationService,
        ILocalTypoClassifier classifier,
        TelemetryLogger telemetryLogger)
    {
        _availabilityService = availabilityService;
        _notificationService = notificationService;
        _classifier = classifier;
        _telemetryLogger = telemetryLogger;
    }

    public IReadOnlyList<SpellIssue> MapDiagnostics(
        ITextSnapshot snapshot,
        IReadOnlyList<SpellDiagnostic> diagnostics,
        SpellSettings settings)
    {
        if (settings.Config.LocalTypoAccelerationMode == TypoAccelerationMode.Off)
        {
            UpdatePath("off", settings.Config.LocalTypoAccelerationVerboseLogging);
            lock (_gate)
            {
                _hadAcceleratorPath = false;
            }

            return MapWithoutClassification(snapshot, diagnostics);
        }

        Trace("local-typo-acceleration detection started", settings);
        var availability = _availabilityService.GetAvailability();
        HandleAvailabilityLogging(settings, availability);

        if (availability.State != AcceleratorAvailabilityState.Available)
        {
            var wasActive = false;
            lock (_gate)
            {
                wasActive = _hadAcceleratorPath;
                _hadAcceleratorPath = false;
            }

            if (wasActive)
            {
                _telemetryLogger.Info(
                    $"Local typo accelerator became unavailable ({availability.State}); fallback activated.");
            }

            UpdatePath("fallback", settings.Config.LocalTypoAccelerationVerboseLogging);
            if (settings.Config.LocalTypoAccelerationMode == TypoAccelerationMode.On)
            {
                _notificationService.NotifyOnModeUnavailableIfNeeded(settings, availability);
            }

            return MapWithoutClassification(snapshot, diagnostics);
        }

        lock (_gate)
        {
            _hadAcceleratorPath = true;
        }

        if (settings.Config.LocalTypoAccelerationMode == TypoAccelerationMode.Auto)
        {
            _notificationService.NotifyAutoModeDetectionIfNeeded(settings, availability);
        }

        UpdatePath("accelerated", settings.Config.LocalTypoAccelerationVerboseLogging);
        return MapWithClassification(snapshot, diagnostics, settings);
    }

    private void HandleAvailabilityLogging(SpellSettings settings, AcceleratorAvailabilityResult availability)
    {
        var shouldLog = false;
        lock (_gate)
        {
            if (_lastAvailabilityState != availability.State ||
                availability.State == AcceleratorAvailabilityState.Error ||
                settings.Config.LocalTypoAccelerationVerboseLogging)
            {
                shouldLog = true;
            }

            _lastAvailabilityState = availability.State;
        }

        if (!shouldLog)
        {
            return;
        }

        _telemetryLogger.Info(
            $"Local typo accelerator detection result: status={availability.State}, provider={availability.Provider}, detail={availability.Detail ?? "n/a"}");
        if (availability.State == AcceleratorAvailabilityState.Error)
        {
            _telemetryLogger.Info("Local typo accelerator detection failed; fallback activated.");
        }
        else if (availability.State == AcceleratorAvailabilityState.Available)
        {
            _telemetryLogger.Info("Local typo accelerator detection succeeded.");
        }
    }

    private IReadOnlyList<SpellIssue> MapWithoutClassification(
        ITextSnapshot snapshot,
        IReadOnlyList<SpellDiagnostic> diagnostics)
    {
        var list = new List<SpellIssue>(diagnostics.Count);
        foreach (var diagnostic in diagnostics)
        {
            if (!TryCreateIssue(snapshot, diagnostic, out var issue))
            {
                continue;
            }

            list.Add(issue!);
        }

        return list;
    }

    private IReadOnlyList<SpellIssue> MapWithClassification(
        ITextSnapshot snapshot,
        IReadOnlyList<SpellDiagnostic> diagnostics,
        SpellSettings settings)
    {
        var list = new List<SpellIssue>(diagnostics.Count);
        var text = snapshot.GetText();
        var suppressed = 0;

        foreach (var diagnostic in diagnostics)
        {
            if (!TryCreateIssue(snapshot, diagnostic, out var baseIssue))
            {
                continue;
            }

            if (!IsMisspellDiagnostic(diagnostic))
            {
                list.Add(baseIssue!);
                continue;
            }

            var span = baseIssue!.TrackingSpan.GetSpan(snapshot);
            var context = TypoContextClassifier.Classify(text, span.Start.Position);
            var classification = _classifier.Classify(
                new TypoClassificationRequest(diagnostic.Token, diagnostic.Suggestions, context));
            Trace(
                $"local-typo-acceleration classify token='{diagnostic.Token}' category={classification.Category} confidence={classification.Confidence:F2} backend={classification.Backend}",
                settings);

            if (classification.Category == TypoClassificationCategory.NotTypo &&
                classification.Confidence >= 0.65)
            {
                suppressed++;
                continue;
            }

            var message = classification.Category == TypoClassificationCategory.Uncertain
                ? SharedUiText.Get(
                    settings.Config,
                    "spell.lowConfidenceTypoSignal",
                    ("message", diagnostic.Message))
                : diagnostic.Message;

            list.Add(new SpellIssue(
                baseIssue.TrackingSpan,
                baseIssue.Kind,
                baseIssue.Token,
                message,
                baseIssue.Suggestions,
                baseIssue.LanguageHint,
                classification));
        }

        if (suppressed > 0)
        {
            _telemetryLogger.Info($"Local typo acceleration suppressed {suppressed} low-value diagnostics.");
        }

        return list;
    }

    private static bool IsMisspellDiagnostic(SpellDiagnostic diagnostic)
    {
        return diagnostic.Kind == SpellDiagnosticKind.Misspelling;
    }

    private static bool TryCreateIssue(ITextSnapshot snapshot, SpellDiagnostic diagnostic, out SpellIssue? issue)
    {
        issue = null;
        var start = Math.Max(0, diagnostic.Range.Start);
        var end = Math.Min(snapshot.Length, diagnostic.Range.End);
        var length = end - start;
        if (length <= 0)
        {
            return false;
        }

        var trackingSpan = snapshot.CreateTrackingSpan(start, length, SpanTrackingMode.EdgeInclusive);
        issue = new SpellIssue(
            trackingSpan,
            diagnostic.Kind,
            diagnostic.Token,
            diagnostic.Message,
            diagnostic.Suggestions,
            diagnostic.LanguageHint,
            typoClassification: null);
        return true;
    }

    private void UpdatePath(string path, bool verboseLogging)
    {
        var shouldLog = false;
        lock (_gate)
        {
            if (!string.Equals(_lastPath, path, StringComparison.Ordinal) || verboseLogging)
            {
                _lastPath = path;
                shouldLog = true;
            }
        }

        if (shouldLog)
        {
            _telemetryLogger.Info($"Local typo acceleration classification path: {path}");
        }
    }

    private void Trace(string message, SpellSettings settings)
    {
        if (!settings.Config.LocalTypoAccelerationVerboseLogging)
        {
            return;
        }

        _telemetryLogger.Info(message);
    }
}
