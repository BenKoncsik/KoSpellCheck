using KoSpellCheck.VS2022.Services.ProjectConventions;
using Microsoft.VisualStudio.Shell;
using System.Runtime.InteropServices;

namespace KoSpellCheck.VS2022.Dashboard;

[Guid(KoSpellCheckDashboardPackageGuids.ToolWindowString)]
public sealed class KoSpellCheckDashboardToolWindow : ToolWindowPane
{
    public KoSpellCheckDashboardToolWindow() : base(null)
    {
        Caption = "KoSpellCheck Dashboard";
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
            Text = "KoSpellCheck dashboard service is not available.",
            Margin = new System.Windows.Thickness(12),
        };
    }
}
