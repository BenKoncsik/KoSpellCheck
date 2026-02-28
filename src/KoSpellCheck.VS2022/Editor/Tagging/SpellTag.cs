namespace KoSpellCheck.VS2022.Editor.Tagging;

internal sealed class SpellTag
{
    public SpellTag(string token, string message)
    {
        Token = token;
        Message = message;
    }

    public string Token { get; }

    public string Message { get; }
}
