namespace KoSpellCheck.Core.TypoAcceleration;

public sealed class TypoClassificationResult
{
    public TypoClassificationResult(
        bool isTypo,
        double confidence,
        TypoClassificationCategory category,
        string backend,
        string? reason = null)
    {
        IsTypo = isTypo;
        Confidence = confidence;
        Category = category;
        Backend = backend;
        Reason = reason;
    }

    public bool IsTypo { get; }

    public double Confidence { get; }

    public TypoClassificationCategory Category { get; }

    public string Backend { get; }

    public string? Reason { get; }
}
