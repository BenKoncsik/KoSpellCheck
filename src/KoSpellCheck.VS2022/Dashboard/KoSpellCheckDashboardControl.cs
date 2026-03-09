using System.Collections.ObjectModel;
using System.IO;
using EnvDTE;
using EnvDTE80;
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
    private readonly DispatcherTimer _refreshTimer;

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
        _dashboardService.StateChanged += OnDashboardStateChanged;

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

        _refreshTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(8),
        };
        _refreshTimer.Tick += (_, _) =>
        {
            if (_disposed)
            {
                return;
            }

            _package.JoinableTaskFactory.RunAsync(async () =>
            {
                await RefreshAsync(deepScan: false).ConfigureAwait(false);
            });
        };
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _refreshTimer.Stop();
        _dashboardService.StateChanged -= OnDashboardStateChanged;
    }

    private UIElement BuildToolbar()
    {
        var panel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Margin = new Thickness(8, 8, 8, 0),
        };

        panel.Children.Add(CreateButton("Refresh", async () => await RefreshAsync(deepScan: true).ConfigureAwait(false)));
        panel.Children.Add(CreateButton("Rebuild Profile", async () => await RebuildAsync().ConfigureAwait(false)));
        panel.Children.Add(CreateButton("Refresh Map", async () => await RefreshAsync(deepScan: true).ConfigureAwait(false)));
        panel.Children.Add(CreateButton("Clear Logs", async () =>
        {
            _dashboardService.ClearLogs();
            await RefreshAsync(deepScan: false).ConfigureAwait(false);
        }));
        panel.Children.Add(CreateButton("Open Settings", async () =>
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
        panel.Children.Add(CreateExpander("Overview", _overviewText, isExpanded: true));

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
        _settingsGrid.Columns.Add(new DataGridTextColumn { Header = "Setting", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardSettingItem.Label)), Width = new DataGridLength(2, DataGridLengthUnitType.Star) });
        _settingsGrid.Columns.Add(new DataGridTextColumn { Header = "Value", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardSettingItem.Value)), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
        panel.Children.Add(CreateExpander("Settings", _settingsGrid, isExpanded: false));

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
        _conventionGrid.Columns.Add(new DataGridTextColumn { Header = "Folder", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardMapItem.Folder)), Width = new DataGridLength(2, DataGridLengthUnitType.Star) });
        _conventionGrid.Columns.Add(new DataGridTextColumn { Header = "Suffix", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardMapItem.ExpectedSuffix)), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
        _conventionGrid.Columns.Add(new DataGridTextColumn { Header = "Prefix", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardMapItem.ExpectedPrefix)), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
        _conventionGrid.Columns.Add(new DataGridTextColumn { Header = "Kind", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardMapItem.DominantKind)), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
        _conventionGrid.Columns.Add(new DataGridTextColumn { Header = "Confidence", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardMapItem.Confidence)) { StringFormat = "0.00" }, Width = new DataGridLength(0.9, DataGridLengthUnitType.Star) });
        _conventionGrid.Columns.Add(new DataGridTextColumn { Header = "Examples", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardMapItem.Examples)), Width = new DataGridLength(2.4, DataGridLengthUnitType.Star) });
        panel.Children.Add(CreateExpander("Convention Map", _conventionGrid, isExpanded: true));

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
        _diagnosticGrid.Columns.Add(new DataGridTextColumn { Header = "Severity", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardDiagnosticItem.Severity)), Width = new DataGridLength(0.8, DataGridLengthUnitType.Star) });
        _diagnosticGrid.Columns.Add(new DataGridTextColumn { Header = "File", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardDiagnosticItem.FilePath)), Width = new DataGridLength(2.3, DataGridLengthUnitType.Star) });
        _diagnosticGrid.Columns.Add(new DataGridTextColumn { Header = "Rule", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardDiagnosticItem.RuleId)), Width = new DataGridLength(1.1, DataGridLengthUnitType.Star) });
        _diagnosticGrid.Columns.Add(new DataGridTextColumn { Header = "Confidence", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardDiagnosticItem.Confidence)) { StringFormat = "0.00" }, Width = new DataGridLength(0.8, DataGridLengthUnitType.Star) });
        _diagnosticGrid.Columns.Add(new DataGridTextColumn { Header = "Message", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardDiagnosticItem.Message)), Width = new DataGridLength(3.1, DataGridLengthUnitType.Star) });
        _diagnosticGrid.Columns.Add(new DataGridTextColumn { Header = "Suggestion", Binding = new System.Windows.Data.Binding(nameof(ConventionDashboardDiagnosticItem.Suggestion)), Width = new DataGridLength(2.2, DataGridLengthUnitType.Star) });
        _diagnosticGrid.MouseDoubleClick += async (_, _) =>
        {
            if (_diagnosticGrid.SelectedItem is ConventionDashboardDiagnosticItem item)
            {
                await RevealDiagnosticAsync(item).ConfigureAwait(false);
            }
        };
        panel.Children.Add(CreateExpander("Diagnostics", _diagnosticGrid, isExpanded: true));

        _logList = new ListBox
        {
            ItemsSource = _logs,
            DisplayMemberPath = nameof(ConventionDashboardLogEntry.Message),
            MinHeight = 130,
            Margin = new Thickness(2),
        };
        panel.Children.Add(CreateExpander("Logs", _logList, isExpanded: false));

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
            UpdateStatus("No workspace detected.");
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
            UpdateStatus("No workspace detected.");
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

        var filePath = Path.Combine(context.WorkspaceRoot!, "kospellcheck.json");
        if (!File.Exists(filePath))
        {
            var payload = "{\n  \"projectConventions\": {\n    \"enabled\": true\n  }\n}\n";
            File.WriteAllText(filePath, payload);
        }

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
        if (_disposed)
        {
            return;
        }

        var root = _currentWorkspaceRoot;
        if (string.IsNullOrWhiteSpace(root))
        {
            return;
        }

        var snapshot = _dashboardService.GetSnapshot(root!);
        await Dispatcher.InvokeAsync(() => ApplySnapshot(snapshot));
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        await RefreshAsync(deepScan: true).ConfigureAwait(false);
        _refreshTimer.Start();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        _refreshTimer.Stop();
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

    private static string BuildStatusText(ConventionDashboardSnapshot snapshot)
    {
        var updated = snapshot.ProfileUpdatedUtc?.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") ?? "n/a";
        var state = snapshot.IsRebuilding
            ? "Rebuilding profile..."
            : snapshot.IsRefreshing
                ? "Refreshing..."
                : "Idle";
        var error = string.IsNullOrWhiteSpace(snapshot.LastError) ? string.Empty : $" | Error: {snapshot.LastError}";
        return $"{state} | Workspace: {snapshot.WorkspaceRoot} | Profile updated: {updated}{error}";
    }

    private static string BuildOverviewText(ConventionDashboardSnapshot snapshot)
    {
        return
            $"Files scanned: {snapshot.FilesScanned}\n" +
            $"Types scanned: {snapshot.TypesScanned}\n" +
            $"Dominant case style: {snapshot.DominantCaseStyle}\n" +
            $"Diagnostics count: {snapshot.DiagnosticCount}\n" +
            $"Convention feature enabled: {snapshot.FeatureEnabled}\n" +
            $"AI anomaly detection: {snapshot.AiEnabled}\n" +
            $"Coral requested: {snapshot.CoralEnabled}\n" +
            $"Coral active: {snapshot.CoralActive}\n" +
            $"Coral status: {snapshot.CoralStatus}\n" +
            $"Profile path: {snapshot.ProfilePath}\n" +
            $"Summary path: {snapshot.SummaryPath}";
    }
}
