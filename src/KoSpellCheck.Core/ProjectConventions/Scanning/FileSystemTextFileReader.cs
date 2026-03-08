using KoSpellCheck.Core.ProjectConventions.Abstractions;

namespace KoSpellCheck.Core.ProjectConventions.Scanning;

public sealed class FileSystemTextFileReader : ITextFileReader
{
    public bool TryRead(string filePath, out string content)
    {
        try
        {
            content = File.ReadAllText(filePath);
            return true;
        }
        catch
        {
            content = string.Empty;
            return false;
        }
    }
}
