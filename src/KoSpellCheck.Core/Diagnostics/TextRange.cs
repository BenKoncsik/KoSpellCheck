namespace KoSpellCheck.Core.Diagnostics;

public sealed class TextRange
{
    public TextRange(int start, int end, int startLine, int startCharacter, int endLine, int endCharacter)
    {
        Start = start;
        End = end;
        StartLine = startLine;
        StartCharacter = startCharacter;
        EndLine = endLine;
        EndCharacter = endCharacter;
    }

    public int Start { get; }

    public int End { get; }

    public int StartLine { get; }

    public int StartCharacter { get; }

    public int EndLine { get; }

    public int EndCharacter { get; }
}
