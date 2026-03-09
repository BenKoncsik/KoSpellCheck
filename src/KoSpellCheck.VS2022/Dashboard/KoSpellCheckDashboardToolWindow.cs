using KoSpellCheck.VS2022.Services.ProjectConventions;
using KoSpellCheck.Core.Localization;
using Microsoft.VisualStudio.Shell;
using System.Runtime.InteropServices;

namespace KoSpellCheck.VS2022.Dashboard;

[Guid(KoSpellCheckDashboardPackageGuids.ToolWindowString)]
public sealed class KoSpellCheckDashboardToolWindow : ToolWindowPane
{
    public KoSpellCheckDashboardToolWindow() : base(null)
    {
        Caption = SharedUiText.Get("vs2022.dashboard.toolWindowCaption", "auto");
    }

    public override void OnToolWindowCreated()
    {
        base.OnToolWindowCreated();
        if (Package is KoSpellCheckDashboardPackage dashboardPackage &&
            dashboardPackage.DashboardService != null)
        {
            Content = new KoSpellCheckDashboardControl(dashboardPackage, dashboardPackage.DashboardService);
            return;
        }

        Content = new System.Windows.Controls.TextBlock
        {
            Text = SharedUiText.Get("dashboard.serviceUnavailable", "auto"),
            Margin = new System.Windows.Thickness(12),
        };
    }
}
