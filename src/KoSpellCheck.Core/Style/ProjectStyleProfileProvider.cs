using System.Collections.Concurrent;
using KoSpellCheck.Core.Config;

namespace KoSpellCheck.Core.Style;

public sealed class ProjectStyleProfileProvider : IProjectStyleProfileProvider
{
    private sealed class Entry
    {
        public readonly object Gate = new();

        public ProjectStyleProfile? Profile;

        public DateTime LastRequestUtc = DateTime.MinValue;

        public Task<ProjectStyleProfile?>? InFlightTask;
    }

    private readonly ConcurrentDictionary<string, Entry> _entries =
        new(StringComparer.OrdinalIgnoreCase);

    private readonly ProjectStyleDetector _detector;
    private readonly TimeSpan _refreshThrottle;

    public ProjectStyleProfileProvider(
        ProjectStyleDetector? detector = null,
        TimeSpan? refreshThrottle = null)
    {
        _detector = detector ?? new ProjectStyleDetector();
        _refreshThrottle = refreshThrottle ?? TimeSpan.FromSeconds(30);
    }

    public ProjectStyleProfile? GetProfile(string workspaceRoot)
    {
        if (string.IsNullOrWhiteSpace(workspaceRoot))
        {
            return null;
        }

        if (!_entries.TryGetValue(workspaceRoot, out var entry))
        {
            return null;
        }

        lock (entry.Gate)
        {
            return entry.Profile;
        }
    }

    public void RequestRefresh(string workspaceRoot, KoSpellCheckConfig config, bool force = false)
    {
        if (string.IsNullOrWhiteSpace(workspaceRoot))
        {
            return;
        }

        var entry = _entries.GetOrAdd(workspaceRoot, _ => new Entry());
        lock (entry.Gate)
        {
            if (!config.StyleLearningEnabled)
            {
                entry.Profile = null;
                entry.InFlightTask = null;
                entry.LastRequestUtc = DateTime.UtcNow;
                return;
            }

            var now = DateTime.UtcNow;
            if (!force && now - entry.LastRequestUtc < _refreshThrottle)
            {
                return;
            }

            entry.LastRequestUtc = now;
            if (entry.InFlightTask != null && !entry.InFlightTask.IsCompleted)
            {
                return;
            }

            entry.InFlightTask = RefreshInternalAsync(entry, workspaceRoot, config, CancellationToken.None);
        }
    }

    public Task<ProjectStyleProfile?> RefreshAsync(
        string workspaceRoot,
        KoSpellCheckConfig config,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(workspaceRoot) || !config.StyleLearningEnabled)
        {
            return Task.FromResult<ProjectStyleProfile?>(null);
        }

        var entry = _entries.GetOrAdd(workspaceRoot, _ => new Entry());
        lock (entry.Gate)
        {
            if (entry.InFlightTask != null && !entry.InFlightTask.IsCompleted)
            {
                return entry.InFlightTask;
            }

            entry.LastRequestUtc = DateTime.UtcNow;
            entry.InFlightTask = RefreshInternalAsync(entry, workspaceRoot, config, cancellationToken);
            return entry.InFlightTask;
        }
    }

    private async Task<ProjectStyleProfile?> RefreshInternalAsync(
        Entry entry,
        string workspaceRoot,
        KoSpellCheckConfig config,
        CancellationToken cancellationToken)
    {
        try
        {
            var profile = await _detector
                .DetectWorkspaceAsync(workspaceRoot, config, cancellationToken)
                .ConfigureAwait(false);

            lock (entry.Gate)
            {
                entry.Profile = profile;
            }

            return profile;
        }
        catch
        {
            return null;
        }
        finally
        {
            lock (entry.Gate)
            {
                entry.InFlightTask = null;
            }
        }
    }
}
