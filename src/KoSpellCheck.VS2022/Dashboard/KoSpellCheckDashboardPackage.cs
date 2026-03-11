using System.ComponentModel.Design;
using System.Runtime.InteropServices;
using KoSpellCheck.VS2022.Services;
using KoSpellCheck.VS2022.Services.ProjectConventions;
using Microsoft.VisualStudio.ComponentModelHost;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Text;
using Task = System.Threading.Tasks.Task;

namespace KoSpellCheck.VS2022.Dashboard;

[PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
[InstalledProductRegistration("KoSpellCheck", "KoSpellCheck dashboard and project convention insights", "0.1.15")]
[ProvideMenuResource("Menus.ctmenu", 1)]
[ProvideToolWindow(typeof(KoSpellCheckDashboardToolWindow))]
[Guid(KoSpellCheckDashboardPackageGuids.PackageString)]
public sealed class KoSpellCheckDashboardPackage : AsyncPackage
{
    private TelemetryLogger? _telemetry;
    internal ProjectConventionDashboardService? DashboardService { get; private set; }
    internal TelemetryLogger Telemetry => _telemetry ??= new TelemetryLogger();

    protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
    {
        await base.InitializeAsync(cancellationToken, progress);

        await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
        Telemetry.Info("Dashboard package initialization started.");
        try
        {
            _ = await EnsureDashboardServiceAsync(cancellationToken).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            Telemetry.Error($"Dashboard service initialization failed during package startup with HResult=0x{ex.HResult:X8}.", ex);
        }

        await KoSpellCheckDashboardCommand.InitializeAsync(this).ConfigureAwait(true);
        Telemetry.Info("Dashboard package initialization finished.");
    }

    internal async Task<bool> ShowDashboardToolWindowAsync()
    {
        await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
        Telemetry.Info("Dashboard tool window open requested.");
        _ = await EnsureDashboardServiceAsync(DisposalToken).ConfigureAwait(true);

        ToolWindowPane? pane;
        try
        {
            pane = await ShowToolWindowAsync(typeof(KoSpellCheckDashboardToolWindow), 0, true, DisposalToken).ConfigureAwait(true);
        }
        catch (OperationCanceledException)
        {
            Telemetry.Info("Dashboard tool window creation canceled.");
            return false;
        }
        catch (Exception ex)
        {
            Telemetry.Error($"ShowToolWindowAsync failed with HResult=0x{ex.HResult:X8}.", ex);
            return false;
        }

        if (pane?.Frame == null)
        {
            Telemetry.Info("Dashboard tool window creation returned null pane or frame.");
            return false;
        }

        Telemetry.Info("Dashboard tool window opened successfully.");
        return true;
    }

    internal async Task<ProjectConventionDashboardService?> EnsureDashboardServiceAsync(CancellationToken cancellationToken)
    {
        if (DashboardService != null)
        {
            return DashboardService;
        }

        await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
        IComponentModel? componentModel;
        try
        {
            componentModel = await GetServiceAsync(typeof(SComponentModel)).ConfigureAwait(true) as IComponentModel;
            if (componentModel == null)
            {
                Telemetry.Info("Dashboard service unavailable: SComponentModel service not found.");
                return null;
            }

            var textDocumentFactory = componentModel.GetService<ITextDocumentFactoryService>();
            if (textDocumentFactory == null)
            {
                Telemetry.Info("Dashboard service unavailable: ITextDocumentFactoryService not found.");
                return null;
            }

            var services = SpellServiceRegistry.GetServices(textDocumentFactory);
            _telemetry = services.TelemetryLogger;
            DashboardService = services.ProjectConventionDashboardService;
            Telemetry.Info("Dashboard service initialized.");
            return DashboardService;
        }
        catch (OperationCanceledException)
        {
            Telemetry.Info("Dashboard service initialization canceled.");
            return null;
        }
        catch (Exception ex)
        {
            Telemetry.Error($"Dashboard service initialization failed with HResult=0x{ex.HResult:X8}.", ex);
            return null;
        }
    }
}
