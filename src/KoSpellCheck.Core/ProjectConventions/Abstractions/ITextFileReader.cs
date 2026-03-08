namespace KoSpellCheck.Core.ProjectConventions.Abstractions;

public interface ITextFileReader
{
    bool TryRead(string filePath, out string content);
}
