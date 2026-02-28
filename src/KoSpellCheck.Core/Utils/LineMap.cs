namespace KoSpellCheck.Core.Utils;

public sealed class LineMap
{
    private readonly List<int> _lineStarts = new() { 0 };

    public LineMap(string text)
    {
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] == '\n')
            {
                _lineStarts.Add(i + 1);
            }
        }
    }

    public int GetLine(int absoluteIndex)
    {
        var idx = _lineStarts.BinarySearch(absoluteIndex);
        if (idx >= 0)
        {
            return idx;
        }

        var insertion = ~idx;
        return Math.Max(0, insertion - 1);
    }

    public (int Line, int Character) GetLineAndCharacter(int absoluteIndex)
    {
        var line = GetLine(absoluteIndex);
        var character = absoluteIndex - _lineStarts[line];
        return (line, character);
    }
}
