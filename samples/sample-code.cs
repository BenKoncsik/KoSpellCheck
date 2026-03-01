using System;

namespace KoSpellChek.Sample;

public class ModelServce
{
    public string gps_coordinate_lat { get; set; } = string.Empty;

    public void ValidateHomersekletModel()
    {
        var HTTPServerConfig = "ok";
        var homerseklet = "normal";
        var modell = "domain";
        Console.WriteLine($"{HTTPServerConfig}-{homerseklet}-{modell}");
    }

    public void TesztIrasAlmaKorteView()
    {
        ReplaceViewModel();
        var teszt = "teszt";
        Console.WriteLine(teszt);
    }
}
