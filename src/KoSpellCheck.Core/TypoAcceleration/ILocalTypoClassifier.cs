namespace KoSpellCheck.Core.TypoAcceleration;

public interface ILocalTypoClassifier
{
    TypoClassificationResult Classify(TypoClassificationRequest request);
}
