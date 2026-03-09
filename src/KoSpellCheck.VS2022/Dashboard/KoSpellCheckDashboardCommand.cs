using System.ComponentModel.Design;
using KoSpellCheck.VS2022.Services.ProjectConventions;
using Microsoft.VisualStudio.Shell;
using Task = System.Threading.Tasks.Task;

namespace KoSpellCheck.VS2022.Dashboard;

internal sealed class KoSpellCheckDashboardCommand
{
    private readonly KoSpellCheckDashboardPackage _package;
    private readonly ProjectConventionDashboardService _dashboardService;

    private KoSpellCheckDashboardCommand(
        KoSpellCheckDashboardPackage package,
        ProjectConventionDashboardService dashboardService,
        OleMenuCommandService commandService)
    {
        _package = package;
        _dashboardService = dashboardService;

        AddCommand(commandService, KoSpellCheckDashboardPackageIds.OpenDashboard, ExecuteOpenDashboard);
        AddCommand(commandService, KoSpellCheckDashboardPackageIds.RefreshDashboard, ExecuteRefreshDashboard);
        AddCommand(commandService, KoSpellCheckDashboardPackageIds.RebuildConventionProfile, ExecuteRebuildConventionProfile);
        AddCommand(commandService, KoSpellCheckDashboardPackageIds.ClearDashboardLogs, ExecuteClearDashboardLogs);
    }

    public static async Task InitializeAsync(
        KoSpellCheckDashboardPackage package,
        ProjectConventionDashboardService dashboardService)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
        var commandService = await package.GetServiceAsync(typeof(IMenuCommandService)).ConfigureAwait(true) as OleMenuCommandService;
        if (commandService == null)
        {
            return;
        }

        _ = new KoSpellCheckDashboardCommand(package, dashboardService, commandService);
    }

    private static void AddCommand(OleMenuCommandService commandService, int commandId, EventHandler handler)
    {
        var menuCommandId = new CommandID(new Guid(KoSpellCheckDashboardPackageGuids.CommandSetString), commandId);
        var menuCommand = new OleMenuCommand(handler, menuCommandId);
        commandService.AddCommand(menuCommand);
    }

    private void ExecuteOpenDashboard(object? sender, EventArgs e)
    {
        _ = _package.JoinableTaskFactory.RunAsync(async () =>
        {
            await _package.ShowDashboardToolWindowAsync().ConfigureAwait(true);
        });
    }

    private void ExecuteRefreshDashboard(object? sender, EventArgs e)
    {
        _ = _package.JoinableTaskFactory.RunAsync(async () =>
        {
            var context = await WorkspaceContextResolver.ResolveAsync(_package, _package.DisposalToken).ConfigureAwait(true);
            if (string.IsNullOrWhiteSpace(context.WorkspaceRoot))
            {
                return;
            }

            await _dashboardService.RefreshWorkspaceAsync(
                context.WorkspaceRoot!,
                context.ActiveFilePath,
                deepScan: true,
                _package.DisposalToken).ConfigureAwait(false);
            await _package.ShowDashboardToolWindowAsync().ConfigureAwait(true);
        });
    }

    private void ExecuteRebuildConventionProfile(object? sender, EventArgs e)
    {
        _ = _package.JoinableTaskFactory.RunAsync(async () =>
        {
            var context = await WorkspaceContextResolver.ResolveAsync(_package, _package.DisposalToken).ConfigureAwait(true);
            if (string.IsNullOrWhiteSpace(context.WorkspaceRoot))
            {
                return;
            }

            await _dashboardService.RebuildWorkspaceAsync(context.WorkspaceRoot!, _package.DisposalToken).ConfigureAwait(false);
            await _dashboardService.RefreshWorkspaceAsync(
                context.WorkspaceRoot!,
                context.ActiveFilePath,
                deepScan: true,
                _package.DisposalToken).ConfigureAwait(false);
            await _package.ShowDashboardToolWindowAsync().ConfigureAwait(true);
        });
    }

    private void ExecuteClearDashboardLogs(object? sender, EventArgs e)
    {
        _dashboardService.ClearLogs();
    }
}
