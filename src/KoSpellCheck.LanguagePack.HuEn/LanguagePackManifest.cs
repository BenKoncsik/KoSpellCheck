namespace KoSpellCheck.LanguagePack.HuEn;

public sealed class LanguagePackManifest
{
    public string PackId { get; set; } = "HuEn";

    public string Version { get; set; } = "0.1.0";

    public IReadOnlyList<string> Languages { get; set; } = new[] { "hu", "en" };

    public IReadOnlyList<string> DictionaryFiles { get; set; } = new[]
    {
        "dictionaries/hu_HU/hu_HU.aff",
        "dictionaries/hu_HU/hu_HU.dic",
        "dictionaries/en_US/en_US.aff",
        "dictionaries/en_US/en_US.dic",
    };
}
