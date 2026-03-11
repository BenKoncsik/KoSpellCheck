using System.Collections.ObjectModel;
using System.IO;
using EnvDTE;
using EnvDTE80;
using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Localization;
using KoSpellCheck.VS2022.Services;
using KoSpellCheck.VS2022.Services.ProjectConventions;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace KoSpellCheck.VS2022.Dashboard;

internal sealed class KoSpellCheckDashboardControl : UserControl, IDisposable
{
    private readonly KoSpellCheckDashboardPackage _package;
    private readonly ProjectConventionDashboardService _dashboardService;
    private readonly TelemetryLogger _telemetry;
    private readonly DispatcherTimer _refreshTimer;
    private bool _isDashboardStateSubscribed;

    private readonly TextBlock _statusText;
    private TextBlock _overviewText = null!;
    private DataGrid _settingsGrid = null!;
    private DataGrid _conventionGrid = null!;
    private DataGrid _diagnosticGrid = null!;
    private ListBox _logList = null!;

    private readonly ObservableCollection<ConventionDashboardSettingItem> _settings = new();
    private readonly ObservableCollection<ConventionDashboardMapItem> _map = new();
    private readonly ObservableCollection<ConventionDashboardDiagnosticItem> _diagnostics = new();
    private readonly ObservableCollection<ConventionDashboardLogEntry> _logs = new();

    private string? _currentWorkspaceRoot;
    private bool _disposed;

    public KoSpellCheckDashboardControl(
        KoSpellCheckDashboardPackage package,
        ProjectConventionDashboardService dashboardService)
    {
        _package = package;
        _dashboardService = dashboardService;
        _telemetry = package.Telemetry;
        _refreshTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(8),
        };
        _refreshTimer.Tick += OnRefreshTimerTick;

        try
        {
            _dashboardService.StateChanged += OnDashboardStateChanged;
            _isDashboardStateSubscribed = true;

            var root = new DockPanel();
            var toolbar = BuildToolbar();
            DockPanel.SetDock(toolbar, Dock.Top);
            root.Children.Add(toolbar);

            _statusText = new TextBlock
            {
                Margin = new Thickness(10, 4, 10, 8),
                TextWrapping = TextWrapping.Wrap,
            };
            DockPanel.SetDock(_statusText, Dock.Top);
            root.Children.Add(_statusText);

            var scroll = new ScrollViewer
            {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                Content = BuildSections(),
            };
            root.Children.Add(scroll);

            Content = root;

            Loaded += OnLoaded;
            Unloaded += OnUnloaded;
        }
        catch (Exception ex)
        {
            _telemetry.Error($"Dashboard control constructor failed with HResult=0x{ex.HResult:X8}.", ex);
            if (_isDashboardStateSubscribed)
            {
                _dashboardService.StateChanged -= OnDashboardStateChanged;
                _isDashboardStateSubscribed = false;
            }

            _statusText = new TextBlock
            {
                Margin = new Thickness(10, 4, 10, 8),
                TextWrapping = TextWrapping.Wrap,
            };
            Content = CreateFallbackContent(
                SharedUiText.Get("dashboard.serviceUnavailable", "auto"),
                SharedUiText.Get("vs2022.dashboard.toolWindowCreateFailed", "auto"));
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _refreshTimer.Stop();
        if (_isDashboardStateSubscribed)
        {
            _dashboardService.StateChanged -= OnDashboardStateChanged;
            _isDashboardStateSubscribed = false;
        }
    }

    private UIElement BuildToolbar()
    {
        var panel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Margin = new Thickness(8, 8, 8, 0),
        };

        panel.Children.Add(CreateButton(T("dashboard.toolbar.refresh", "Refresh Dashboard"), async () => await RefreshAsync(deepScan: true).ConfigureAwait(false)));
        panel.Children.Add(CreateButton(T("dashboard.toolbar.rebuild", "Rebuild Convention Profile"), async () => await RebuildAsync().ConfigureAwait(false)));
        panel.Children.Add(CreateButton(T("dashboard.toolbar.refreshMap", "Refresh Convention Map"), async () => await RefreshAsync(deepScan: true).ConfigureAwait(false)));
        panel.Children.Add(CreateButton(T("dashboard.toolbar.clearLogs", "Clear Logs"), async () =>
        {
            _dashboardService.ClearLogs();
            await RefreshAsync(deepScan: false).ConfigureAwait(false);
        }));
        panel.Children.Add(CreateButton(T("dashboard.toolbar.openSettings", "Open Settings"), async () =>
        {
            await OpenSettingsFileAsync().ConfigureAwait(false);
        }));

        return panel;
    }

    private static Button CreateButton(string caption, Func<Task> action)
    {
        var button = new Button
        {
            Content = caption,
            Margin = new Thickness(0, 0, 6, 0),
            Padding = new Thickness(10, 4, 10, 4),
            MinWidth = 92,
        };

        button.Click += async (_, _) =>
        {
            try
            {
                await action().ConfigureAwait(false);
            }
            catch
            {
                // Keep UI resilient.
            }
        };
        return button;
    }

    private UIElement BuildSections()
    {
        var panel = new StackPanel
        {
            Margin = new Thickness(8),
        };

        _overviewText = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(6),
        };
        panel.Children.Add(CreateExpander(T("dashboard.section.overview", "Overview"), _overviewText, isExpanded: true));

        _settingsGrid = new DataGrid
        {
            AutoGenerateColumns = false,
            IsReadOnly = true,
            CanUserAddRows = false,
            CanUserDeleteRows = false,
            HeadersVisibility = DataGridHeadersVisibility.Column,
            ItemsSource = _settings,
            Margin = new Thickness(2),
        };
        _settingsGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.setting", "Setting"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardSettingItem.Label)), Width = new DataGridLength(2, DataGridLengthUnitType.Star) });
        _settingsGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.value", "Value"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardSettingItem.Value)), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
        panel.Children.Add(CreateExpander(T("dashboard.section.settings", "Settings"), _settingsGrid, isExpanded: false));

        _conventionGrid = new DataGrid
        {
            AutoGenerateColumns = false,
            IsReadOnly = true,
            CanUserAddRows = false,
            CanUserDeleteRows = false,
            HeadersVisibility = DataGridHeadersVisibility.Column,
            ItemsSource = _map,
            Margin = new Thickness(2),
            MinHeight = 170,
        };
        _conventionGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.folder", "Folder"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardMapItem.Folder)), Width = new DataGridLength(2, DataGridLengthUnitType.Star) });
        _conventionGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.expectedSuffix", "Expected suffix"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardMapItem.ExpectedSuffix)), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
        _conventionGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.expectedPrefix", "Expected prefix"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardMapItem.ExpectedPrefix)), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
        _conventionGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.dominantKind", "Dominant kind"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardMapItem.DominantKind)), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
        _conventionGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.confidence", "Confidence"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardMapItem.Confidence)) { StringFormat = "0.00" }, Width = new DataGridLength(0.9, DataGridLengthUnitType.Star) });
        _conventionGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.examples", "Examples"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardMapItem.Examples)), Width = new DataGridLength(2.4, DataGridLengthUnitType.Star) });
        panel.Children.Add(CreateExpander(T("dashboard.section.conventionMap", "Convention Map"), _conventionGrid, isExpanded: true));

        _diagnosticGrid = new DataGrid
        {
            AutoGenerateColumns = false,
            IsReadOnly = true,
            CanUserAddRows = false,
            CanUserDeleteRows = false,
            HeadersVisibility = DataGridHeadersVisibility.Column,
            ItemsSource = _diagnostics,
            Margin = new Thickness(2),
            MinHeight = 190,
        };
        _diagnosticGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.severity", "Severity"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardDiagnosticItem.Severity)), Width = new DataGridLength(0.8, DataGridLengthUnitType.Star) });
        _diagnosticGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.file", "File"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardDiagnosticItem.FilePath)), Width = new DataGridLength(2.3, DataGridLengthUnitType.Star) });
        _diagnosticGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.rule", "Rule"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardDiagnosticItem.RuleId)), Width = new DataGridLength(1.1, DataGridLengthUnitType.Star) });
        _diagnosticGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.confidence", "Confidence"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardDiagnosticItem.Confidence)) { StringFormat = "0.00" }, Width = new DataGridLength(0.8, DataGridLengthUnitType.Star) });
        _diagnosticGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.problem", "Problem"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardDiagnosticItem.Message)), Width = new DataGridLength(3.1, DataGridLengthUnitType.Star) });
        _diagnosticGrid.Columns.Add(new DataGridTextColumn { Header = T("dashboard.table.suggestion", "Suggestion"), Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardDiagnosticItem.Suggestion)), Width = new DataGridLength(2.2, DataGridLengthUnitType.Star) });
        _diagnosticGrid.MouseDoubleClick += async (_, _) =>
        {
            if (_diagnosticGrid.SelectedItem is ConventionDashboardDiagnosticItem item)
            {
                await RevealDiagnosticAsync(item).ConfigureAwait(false);
            }
        };
        panel.Children.Add(CreateExpander(T("dashboard.section.diagnostics", "Diagnostics"), _diagnosticGrid, isExpanded: true));

        _logList = new ListBox
        {
            ItemsSource = _logs,
            DisplayMemberPath = nameof(ConventionDashboardLogEntry.Message),
            MinHeight = 130,
            Margin = new Thickness(2),
        };
        panel.Children.Add(CreateExpander(T("dashboard.section.logs", "Logs"), _logList, isExpanded: false));

        return panel;
    }

    private static Expander CreateExpander(string title, UIElement content, bool isExpanded)
    {
        return new Expander
        {
            Header = title,
            IsExpanded = isExpanded,
            Margin = new Thickness(0, 0, 0, 8),
            Content = content,
        };
    }

    private async Task RebuildAsync()
    {
        var context = await WorkspaceContextResolver.ResolveAsync(_package, _package.DisposalToken).ConfigureAwait(true);
        if (string.IsNullOrWhiteSpace(context.WorkspaceRoot))
        {
            UpdateStatus(T("dashboard.status.noWorkspaceDetected", "No workspace detected."));
            return;
        }

        _currentWorkspaceRoot = context.WorkspaceRoot;
        await _dashboardService.RebuildWorkspaceAsync(context.WorkspaceRoot!, _package.DisposalToken).ConfigureAwait(false);
        await _dashboardService.RefreshWorkspaceAsync(context.WorkspaceRoot!, context.ActiveFilePath, deepScan: true, _package.DisposalToken).ConfigureAwait(false);
        ApplySnapshot(_dashboardService.GetSnapshot(context.WorkspaceRoot!));
    }

    private async Task RefreshAsync(bool deepScan)
    {
        var context = await WorkspaceContextResolver.ResolveAsync(_package, _package.DisposalToken).ConfigureAwait(true);
        if (string.IsNullOrWhiteSpace(context.WorkspaceRoot))
        {
            UpdateStatus(T("dashboard.status.noWorkspaceDetected", "No workspace detected."));
            return;
        }

        _currentWorkspaceRoot = context.WorkspaceRoot;
        await _dashboardService.RefreshWorkspaceAsync(context.WorkspaceRoot!, context.ActiveFilePath, deepScan, _package.DisposalToken).ConfigureAwait(false);
        ApplySnapshot(_dashboardService.GetSnapshot(context.WorkspaceRoot!));
    }

    private async Task OpenSettingsFileAsync()
    {
        var context = await WorkspaceContextResolver.ResolveAsync(_package, _package.DisposalToken).ConfigureAwait(true);
        if (string.IsNullOrWhiteSpace(context.WorkspaceRoot))
        {
            return;
        }

        var filePath = DashboardSettingsFileHelper.EnsureSettingsFile(context.WorkspaceRoot!);

        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(_package.DisposalToken);
        VsShellUtilities.OpenDocument(_package, filePath);
    }

    private async Task RevealDiagnosticAsync(ConventionDashboardDiagnosticItem item)
    {
        if (string.IsNullOrWhiteSpace(item.AbsolutePath) || !File.Exists(item.AbsolutePath))
        {
            return;
        }

        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(_package.DisposalToken);
        VsShellUtilities.OpenDocument(_package, item.AbsolutePath);

        var dte = await _package.GetServiceAsync(typeof(SDTE)).ConfigureAwait(true) as DTE2;
        if (dte?.ActiveDocument?.Selection is TextSelection selection)
        {
            selection.MoveToLineAndOffset(Math.Max(1, item.Line + 1), Math.Max(1, item.Column + 1), false);
        }
    }

    private async void OnDashboardStateChanged(object? sender, EventArgs e)
    {
        if (_disposed || !_isDashboardStateSubscribed)
        {
            return;
        }

        try
        {
            var root = _currentWorkspaceRoot;
            if (string.IsNullOrWhiteSpace(root))
            {
                return;
            }

            var snapshot = _dashboardService.GetSnapshot(root!);
            await Dispatcher.InvokeAsync(() => ApplySnapshot(snapshot));
        }
        catch (OperationCanceledException)
        {
            _telemetry.Info("Dashboard state update canceled.");
        }
        catch (Exception ex)
        {
            _telemetry.Error($"Dashboard state update failed with HResult=0x{ex.HResult:X8}.", ex);
        }
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await RefreshAsync(deepScan: true).ConfigureAwait(false);
            _refreshTimer.Start();
        }
        catch (OperationCanceledException)
        {
            _telemetry.Info("Dashboard initial refresh canceled.");
        }
        catch (Exception ex)
        {
            _telemetry.Error($"Dashboard initial refresh failed with HResult=0x{ex.HResult:X8}.", ex);
            UpdateStatus(SharedUiText.Get("dashboard.serviceUnavailable", "auto"));
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        _refreshTimer.Stop();
    }

    private void OnRefreshTimerTick(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        _ = _package.JoinableTaskFactory.RunAsync(async () =>
        {
            try
            {
                await RefreshAsync(deepScan: false).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                _telemetry.Info("Dashboard periodic refresh canceled.");
            }
            catch (Exception ex)
            {
                _telemetry.Error($"Dashboard periodic refresh failed with HResult=0x{ex.HResult:X8}.", ex);
            }
        });
    }

    private void ApplySnapshot(ConventionDashboardSnapshot snapshot)
    {
        UpdateStatus(BuildStatusText(snapshot));
        _overviewText.Text = BuildOverviewText(snapshot);
        Replace(_settings, snapshot.Settings);
        Replace(_map, snapshot.ConventionMap);
        Replace(_diagnostics, snapshot.Diagnostics);
        Replace(_logs, snapshot.Logs);
    }

    private static void Replace<T>(ObservableCollection<T> target, IEnumerable<T> values)
    {
        target.Clear();
        foreach (var value in values)
        {
            target.Add(value);
        }
    }

    private void UpdateStatus(string message)
    {
        _statusText.Text = message;
    }

    private string BuildStatusText(ConventionDashboardSnapshot snapshot)
    {
        var language = ResolveUiLanguage(snapshot.WorkspaceRoot);
        var updated = snapshot.ProfileUpdatedUtc?.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss")
            ?? Translate(language, "general.notAvailable", "n/a");
        var state = snapshot.IsRebuilding
            ? Translate(language, "dashboard.status.rebuilding", "Rebuilding profile...")
            : snapshot.IsRefreshing
                ? Translate(language, "dashboard.status.refreshing", "Refreshing...")
                : Translate(language, "dashboard.status.idle", "Idle");
        var errorLabel = Translate(language, "dashboard.status.error", "Error");
        var workspaceLabel = Translate(language, "dashboard.status.workspace", "Workspace");
        var profileUpdatedLabel = Translate(language, "dashboard.status.profileUpdated", "Profile updated");
        var error = string.IsNullOrWhiteSpace(snapshot.LastError) ? string.Empty : $" | {errorLabel}: {snapshot.LastError}";
        return $"{state} | {workspaceLabel}: {snapshot.WorkspaceRoot} | {profileUpdatedLabel}: {updated}{error}";
    }

    private string BuildOverviewText(ConventionDashboardSnapshot snapshot)
    {
        var language = ResolveUiLanguage(snapshot.WorkspaceRoot);
        return
            $"{Translate(language, "dashboard.overview.filesScannedLine", "Files scanned: {value}", ("value", snapshot.FilesScanned))}\n" +
            $"{Translate(language, "dashboard.overview.typesScannedLine", "Types scanned: {value}", ("value", snapshot.TypesScanned))}\n" +
            $"{Translate(language, "dashboard.overview.dominantCaseLine", "Dominant case style: {value}", ("value", snapshot.DominantCaseStyle))}\n" +
            $"{Translate(language, "dashboard.overview.diagnosticsCountLine", "Diagnostics count: {value}", ("value", snapshot.DiagnosticCount))}\n" +
            $"{Translate(language, "dashboard.overview.conventionFeatureLine", "Convention feature enabled: {value}", ("value", snapshot.FeatureEnabled))}\n" +
            $"{Translate(language, "dashboard.overview.aiAnomalyLine", "AI anomaly detection: {value}", ("value", snapshot.AiEnabled))}\n" +
            $"{Translate(language, "dashboard.overview.coralRequestedLine", "Coral requested: {value}", ("value", snapshot.CoralEnabled))}\n" +
            $"{Translate(language, "dashboard.overview.coralActiveLine", "Coral active: {value}", ("value", snapshot.CoralActive))}\n" +
            $"{Translate(language, "dashboard.overview.coralStatusLine", "Coral status: {value}", ("value", snapshot.CoralStatus))}\n" +
            $"{Translate(language, "dashboard.overview.profilePathLine", "Profile path: {value}", ("value", snapshot.ProfilePath ?? string.Empty))}\n" +
            $"{Translate(language, "dashboard.overview.summaryPathLine", "Summary path: {value}", ("value", snapshot.SummaryPath ?? string.Empty))}";
    }

    private string T(string key, string fallback, params (string Name, object? Value)[] args)
    {
        return Translate(ResolveUiLanguage(), key, fallback, args);
    }

    private string ResolveUiLanguage(string? workspaceRoot = null)
    {
        var root = workspaceRoot ?? _currentWorkspaceRoot;
        if (string.IsNullOrWhiteSpace(root))
        {
            return "auto";
        }

        try
        {
            return ConfigLoader.Load(root!).UiLanguage;
        }
        catch
        {
            return "auto";
        }
    }

    private static string Translate(
        string uiLanguage,
        string key,
        string fallback,
        params (string Name, object? Value)[] args)
    {
        var value = SharedUiText.Get(key, uiLanguage, args);
        return string.Equals(value, key, StringComparison.Ordinal) ? fallback : value;
    }

    private static UIElement CreateFallbackContent(string header, string detail)
    {
        var panel = new StackPanel
        {
            Margin = new Thickness(10),
        };

        panel.Children.Add(new TextBlock
        {
            Text = header,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 6),
        });

        panel.Children.Add(new TextBlock
        {
            Text = detail,
            TextWrapping = TextWrapping.Wrap,
            Opacity = 0.85,
        });

        return panel;
    }
}
