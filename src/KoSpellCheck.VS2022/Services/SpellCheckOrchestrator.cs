using KoSpellCheck.Core.Diagnostics;
using KoSpellCheck.Core.Engine;
using KoSpellCheck.Core.Style;
using KoSpellCheck.VS2022.Services.ProjectConventions;
using KoSpellCheck.VS2022.Services.TypoAcceleration;
using Microsoft.VisualStudio.Text;

namespace KoSpellCheck.VS2022.Services;

internal sealed class SpellCheckOrchestrator : IDisposable
{
    private static readonly object BufferPropertyKey = typeof(SpellCheckOrchestrator);

    private readonly ITextBuffer _textBuffer;
    private readonly ConfigService _configService;
    private readonly DictionaryService _dictionaryService;
    private readonly DocumentTextExtractor _documentTextExtractor;
    private readonly TelemetryLogger _telemetryLogger;
    private readonly IProjectStyleProfileProvider _projectStyleProfileProvider;
    private readonly TypoAccelerationCoordinator _typoAccelerationCoordinator;
    private readonly ProjectConventionDashboardService _projectConventionDashboardService;
    private readonly object _gate = new();
    private readonly SynchronizationContext? _uiContext;

    private readonly TimeSpan _debounce = TimeSpan.FromMilliseconds(500);
    private readonly List<SpellIssue> _issues = new();

    private CancellationTokenSource? _runCancellation;
    private Timer? _timer;
    private bool _disposed;

    private SpellCheckOrchestrator(
        ITextBuffer textBuffer,
        ConfigService configService,
        DictionaryService dictionaryService,
        DocumentTextExtractor documentTextExtractor,
        TelemetryLogger telemetryLogger,
        IProjectStyleProfileProvider projectStyleProfileProvider,
        TypoAccelerationCoordinator typoAccelerationCoordinator,
        ProjectConventionDashboardService projectConventionDashboardService)
    {
        _textBuffer = textBuffer;
        _configService = configService;
        _dictionaryService = dictionaryService;
        _documentTextExtractor = documentTextExtractor;
        _telemetryLogger = telemetryLogger;
        _projectStyleProfileProvider = projectStyleProfileProvider;
        _typoAccelerationCoordinator = typoAccelerationCoordinator;
        _projectConventionDashboardService = projectConventionDashboardService;
        _uiContext = SynchronizationContext.Current;

        _textBuffer.Changed += OnBufferChanged;
        _configService.ConfigChanged += OnConfigChanged;
        var initialSettings = _configService.GetSettings(_textBuffer);
        _projectStyleProfileProvider.RequestRefresh(initialSettings.WorkspaceRoot, initialSettings.Config, force: true);

        ScheduleSpellCheck(_debounce);
    }

    public event EventHandler? IssuesChanged;

    public static SpellCheckOrchestrator GetOrCreate(
        ITextBuffer textBuffer,
        ConfigService configService,
        DictionaryService dictionaryService,
        DocumentTextExtractor documentTextExtractor,
        TelemetryLogger telemetryLogger,
        IProjectStyleProfileProvider projectStyleProfileProvider,
        TypoAccelerationCoordinator typoAccelerationCoordinator,
        ProjectConventionDashboardService projectConventionDashboardService)
    {
        return textBuffer.Properties.GetOrCreateSingletonProperty(
            BufferPropertyKey,
            () => new SpellCheckOrchestrator(
                textBuffer,
                configService,
                dictionaryService,
                documentTextExtractor,
                telemetryLogger,
                projectStyleProfileProvider,
                typoAccelerationCoordinator,
                projectConventionDashboardService));
    }

    public IReadOnlyList<SpellIssueSnapshot> GetIssues(ITextSnapshot snapshot)
    {
        var list = new List<SpellIssueSnapshot>();

        lock (_gate)
        {
            foreach (var issue in _issues)
            {
                try
                {
                    var span = issue.TrackingSpan.GetSpan(snapshot);
                    if (span.Length <= 0)
                    {
                        continue;
                    }

                    list.Add(new SpellIssueSnapshot(span, issue));
                }
                catch
                {
                    // Tracking span could be invalid for this snapshot; ignore it.
                }
            }
        }

        return list;
    }

    public SpellIssueSnapshot? GetIssueAt(SnapshotPoint point)
    {
        foreach (var issue in GetIssues(point.Snapshot))
        {
            if (issue.Span.Contains(point))
            {
                return issue;
            }
        }

        return null;
    }

    public void RequestRefresh()
    {
        ScheduleSpellCheck(TimeSpan.Zero);
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _timer?.Dispose();
            _timer = null;
            _runCancellation?.Cancel();
            _runCancellation?.Dispose();
            _runCancellation = null;
            _issues.Clear();
        }

        _textBuffer.Changed -= OnBufferChanged;
        _configService.ConfigChanged -= OnConfigChanged;
    }

    private void OnBufferChanged(object? sender, TextContentChangedEventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        ScheduleSpellCheck(_debounce);
    }

    private void OnConfigChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        var settings = _configService.GetSettings(_textBuffer);
        _projectStyleProfileProvider.RequestRefresh(settings.WorkspaceRoot, settings.Config, force: true);
        ScheduleSpellCheck(_debounce);
    }

    private void ScheduleSpellCheck(TimeSpan delay)
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _timer?.Dispose();
            _timer = new Timer(
                static state =>
                {
                    var orchestrator = (SpellCheckOrchestrator)state!;
                    orchestrator.StartSpellCheck();
                },
                this,
                delay,
                Timeout.InfiniteTimeSpan);
        }
    }

    private void StartSpellCheck()
    {
        CancellationToken token;

        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _runCancellation?.Cancel();
            _runCancellation?.Dispose();
            _runCancellation = new CancellationTokenSource();
            token = _runCancellation.Token;
        }

        _ = Task.Run(() => RunSpellCheckAsync(token), token);
    }

    private async Task RunSpellCheckAsync(CancellationToken cancellationToken)
    {
        try
        {
            var snapshot = _textBuffer.CurrentSnapshot;
            var settings = _configService.GetSettings(_textBuffer);
            var text = snapshot.GetText();
            var extractedText = _documentTextExtractor.ExtractForSpellCheck(text, settings.Scope);
            _projectStyleProfileProvider.RequestRefresh(settings.WorkspaceRoot, settings.Config);
            var styleProfile = _projectStyleProfileProvider.GetProfile(settings.WorkspaceRoot);
            var context = new SpellCheckContext(settings.Config, settings.FilePath, settings.WorkspaceRoot, styleProfile);
            var engine = _dictionaryService.GetEngine();

            var diagnostics = await Task
                .Run(() => engine.CheckDocument(extractedText, context), cancellationToken)
                .ConfigureAwait(false);

            if (cancellationToken.IsCancellationRequested)
            {
                return;
            }

            var mapped = _typoAccelerationCoordinator.MapDiagnostics(snapshot, diagnostics, settings);
            lock (_gate)
            {
                if (_disposed || cancellationToken.IsCancellationRequested)
                {
                    return;
                }

                _issues.Clear();
                _issues.AddRange(mapped);
            }

            RaiseIssuesChanged();
            await _projectConventionDashboardService
                .UpdateFromDocumentAsync(settings, snapshot, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Expected during rapid typing.
        }
        catch (Exception ex)
        {
            _telemetryLogger.Error("Spell-check pipeline failed", ex);
        }
    }

    private void RaiseIssuesChanged()
    {
        var handler = IssuesChanged;
        if (handler == null)
        {
            return;
        }

        void Raise() => handler(this, EventArgs.Empty);

        if (_uiContext != null)
        {
            _uiContext.Post(_ => Raise(), null);
            return;
        }

        Raise();
    }
}
