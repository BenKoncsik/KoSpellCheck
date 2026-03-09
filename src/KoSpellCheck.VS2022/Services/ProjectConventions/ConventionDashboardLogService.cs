namespace KoSpellCheck.VS2022.Services.ProjectConventions;

internal sealed class ConventionDashboardLogService
{
    private readonly object _gate = new();
    private readonly List<ConventionDashboardLogEntry> _entries = new();

    public ConventionDashboardLogService(int maxEntries = 300)
    {
        MaxEntries = Math.Max(50, maxEntries);
    }

    public int MaxEntries { get; }

    public void Info(string message)
    {
        Append("info", message);
    }

    public void Warn(string message)
    {
        Append("warn", message);
    }

    public void Error(string message)
    {
        Append("error", message);
    }

    public void Clear()
    {
        lock (_gate)
        {
            _entries.Clear();
        }
    }

    public IReadOnlyList<ConventionDashboardLogEntry> Snapshot()
    {
        lock (_gate)
        {
            return _entries
                .OrderByDescending(item => item.TimestampUtc)
                .ToList();
        }
    }

    private void Append(string level, string message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return;
        }

        lock (_gate)
        {
            _entries.Add(new ConventionDashboardLogEntry
            {
                TimestampUtc = DateTime.UtcNow,
                Level = level,
                Message = message.Trim(),
            });

            if (_entries.Count > MaxEntries)
            {
                _entries.RemoveRange(0, _entries.Count - MaxEntries);
            }
        }
    }
}
