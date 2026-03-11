using System.ComponentModel.Design;
using System.Runtime.InteropServices;
using KoSpellCheck.Core.Localization;
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
    internal ProjectConventionDashboardService? DashboardService { get; private set; }

    protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
    {
        await base.InitializeAsync(cancellationToken, progress);

        await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
        _ = await EnsureDashboardServiceAsync(cancellationToken).ConfigureAwait(true);
        await KoSpellCheckDashboardCommand.InitializeAsync(this).ConfigureAwait(true);
    }

    internal async Task ShowDashboardToolWindowAsync()
    {
        _ = await EnsureDashboardServiceAsync(DisposalToken).ConfigureAwait(true);
        var pane = await ShowToolWindowAsync(typeof(KoSpellCheckDashboardToolWindow), 0, true, DisposalToken).ConfigureAwait(true);
        if (pane?.Frame == null)
        {
            throw new InvalidOperationException(
                SharedUiText.Get("vs2022.dashboard.toolWindowCreateFailed", "auto"));
        }
    }

    internal async Task<ProjectConventionDashboardService?> EnsureDashboardServiceAsync(CancellationToken cancellationToken)
    {
        if (DashboardService != null)
        {
            return DashboardService;
        }

        await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
        var componentModel = await GetServiceAsync(typeof(SComponentModel)).ConfigureAwait(true) as IComponentModel;
        var textDocumentFactory = componentModel?.GetService<ITextDocumentFactoryService>();
        if (textDocumentFactory == null)
        {
            return null;
        }

        var services = SpellServiceRegistry.GetServices(textDocumentFactory);
        DashboardService = services.ProjectConventionDashboardService;
        return DashboardService;
    }
}
