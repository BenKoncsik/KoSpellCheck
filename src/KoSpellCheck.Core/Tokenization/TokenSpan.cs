namespace KoSpellCheck.Core.Tokenization;

public sealed class TokenSpan
{
    public TokenSpan(string value, int start, int end)
    {
        Value = value;
        Start = start;
        End = end;
    }

    public string Value { get; }

    public int Start { get; }

    public int End { get; }
}
