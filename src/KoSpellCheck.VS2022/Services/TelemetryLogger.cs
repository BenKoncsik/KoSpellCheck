using System.Diagnostics;

namespace KoSpellCheck.VS2022.Services;

internal sealed class TelemetryLogger
{
    public void Info(string message)
    {
        Debug.WriteLine($"[KoSpellCheck][INFO] {message}");
    }

    public void Error(string message, Exception exception)
    {
        Debug.WriteLine($"[KoSpellCheck][ERROR] {message}: {exception}");
    }
}
