using System.ComponentModel.Design;
using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Localization;
using KoSpellCheck.VS2022.Services.ProjectConventions;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
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
        AddCommand(commandService, KoSpellCheckDashboardPackageIds.ToggleSpellChecker, ExecuteToggleSpellChecker);
        AddCommand(commandService, KoSpellCheckDashboardPackageIds.OpenSettingsFile, ExecuteOpenSettingsFile);
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

    private void ExecuteToggleSpellChecker(object? sender, EventArgs e)
    {
        _ = _package.JoinableTaskFactory.RunAsync(async () =>
        {
            var context = await WorkspaceContextResolver.ResolveAsync(_package, _package.DisposalToken).ConfigureAwait(true);
            if (string.IsNullOrWhiteSpace(context.WorkspaceRoot))
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(_package.DisposalToken);
                ShowInfoMessage(SharedUiText.Get("vs2022.toggleSpellChecker.noWorkspace", "auto"));
                return;
            }

            var workspaceRoot = context.WorkspaceRoot!;
            var config = ConfigLoader.Load(workspaceRoot);
            var nextEnabledValue = !config.Enabled;
            if (!TryWriteEnabledConfigValue(workspaceRoot, nextEnabledValue, out var writeError))
            {
                var messageKey = writeError == "invalid-json"
                    ? "vs2022.toggleSpellChecker.invalidJson"
                    : "vs2022.toggleSpellChecker.writeFailed";
                var message = messageKey == "vs2022.toggleSpellChecker.writeFailed"
                    ? SharedUiText.Get(messageKey, config.UiLanguage, ("error", writeError ?? "unknown"))
                    : SharedUiText.Get(messageKey, config.UiLanguage);
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(_package.DisposalToken);
                ShowWarningMessage(message);
                return;
            }

            var state = nextEnabledValue
                ? SharedUiText.Get("general.enabled", config.UiLanguage)
                : SharedUiText.Get("general.disabled", config.UiLanguage);
            var updatedMessage = SharedUiText.Get(
                "vs2022.toggleSpellChecker.updated",
                config.UiLanguage,
                ("state", state));
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(_package.DisposalToken);
            ShowInfoMessage(updatedMessage);
        });
    }

    private void ExecuteOpenSettingsFile(object? sender, EventArgs e)
    {
        _ = _package.JoinableTaskFactory.RunAsync(async () =>
        {
            var context = await WorkspaceContextResolver.ResolveAsync(_package, _package.DisposalToken).ConfigureAwait(true);
            if (string.IsNullOrWhiteSpace(context.WorkspaceRoot))
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(_package.DisposalToken);
                ShowInfoMessage(SharedUiText.Get("vs2022.toggleSpellChecker.noWorkspace", "auto"));
                return;
            }

            var filePath = DashboardSettingsFileHelper.EnsureSettingsFile(context.WorkspaceRoot!);
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(_package.DisposalToken);
            VsShellUtilities.OpenDocument(_package, filePath);
        });
    }

    private void ShowInfoMessage(string message)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        VsShellUtilities.ShowMessageBox(
            _package,
            message,
            "KoSpellCheck",
            OLEMSGICON.OLEMSGICON_INFO,
            OLEMSGBUTTON.OLEMSGBUTTON_OK,
            OLEMSGDEFBUTTON.OLEMSGDEFBUTTON_FIRST);
    }

    private void ShowWarningMessage(string message)
    {
        ThreadHelper.ThrowIfNotOnUIThread();
        VsShellUtilities.ShowMessageBox(
            _package,
            message,
            "KoSpellCheck",
            OLEMSGICON.OLEMSGICON_WARNING,
            OLEMSGBUTTON.OLEMSGBUTTON_OK,
            OLEMSGDEFBUTTON.OLEMSGDEFBUTTON_FIRST);
    }

    private static bool TryWriteEnabledConfigValue(string workspaceRoot, bool enabled, out string? error)
    {
        error = null;
        var jsonPath = Path.Combine(workspaceRoot, "kospellcheck.json");
        JObject root;

        if (File.Exists(jsonPath))
        {
            try
            {
                root = JObject.Parse(File.ReadAllText(jsonPath));
            }
            catch (JsonReaderException)
            {
                error = "invalid-json";
                return false;
            }
        }
        else
        {
            root = new JObject();
        }

        root["enabled"] = enabled;

        try
        {
            File.WriteAllText(jsonPath, root.ToString(Formatting.Indented) + Environment.NewLine);
            return true;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }
}
