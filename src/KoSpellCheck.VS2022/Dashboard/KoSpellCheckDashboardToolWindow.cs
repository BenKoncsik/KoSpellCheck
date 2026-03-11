using KoSpellCheck.Core.Localization;
using Microsoft.VisualStudio.Shell;
using System.Windows;
using System.Windows.Controls;
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

        if (Package is not KoSpellCheckDashboardPackage dashboardPackage)
        {
            Content = CreateFallbackContent(SharedUiText.Get("dashboard.serviceUnavailable", "auto"), null);
            return;
        }

        dashboardPackage.Telemetry.Info("Dashboard tool window created.");

        if (dashboardPackage.DashboardService == null)
        {
            dashboardPackage.Telemetry.Info("Dashboard tool window using fallback because dashboard service is unavailable.");
            Content = CreateFallbackContent(SharedUiText.Get("dashboard.serviceUnavailable", "auto"), null);
            return;
        }

        try
        {
            dashboardPackage.Telemetry.Info("Dashboard control initialization started.");
            Content = new KoSpellCheckDashboardControl(dashboardPackage, dashboardPackage.DashboardService);
            dashboardPackage.Telemetry.Info("Dashboard control initialization finished.");
        }
        catch (Exception ex)
        {
            dashboardPackage.Telemetry.Error($"Dashboard control initialization failed with HResult=0x{ex.HResult:X8}.", ex);
            Content = CreateFallbackContent(
                SharedUiText.Get("dashboard.serviceUnavailable", "auto"),
                SharedUiText.Get("vs2022.dashboard.toolWindowCreateFailed", "auto"));
        }
    }

    private static UIElement CreateFallbackContent(string message, string? detail)
    {
        var panel = new StackPanel
        {
            Margin = new Thickness(12),
        };

        panel.Children.Add(new TextBlock
        {
            Text = message,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 6),
        });

        if (!string.IsNullOrWhiteSpace(detail))
        {
            panel.Children.Add(new TextBlock
            {
                Text = detail,
                TextWrapping = TextWrapping.Wrap,
                Opacity = 0.85,
            });
        }

        return panel;
    }
}
