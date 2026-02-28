namespace KoSpellCheck.Core.Diagnostics;

public sealed class Suggestion
{
    public Suggestion(string replacement, double confidence, string sourceDictionary)
    {
        Replacement = replacement;
        Confidence = confidence;
        SourceDictionary = sourceDictionary;
    }

    public string Replacement { get; }

    public double Confidence { get; }

    public string SourceDictionary { get; }
}
