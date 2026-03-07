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
        var tezst = "test";
        Console.WriteLine(tezst);
        teszt.All(c => c == 'teszt');
        tezst = "teszt";
        Console.WriteLine(tezst);
        ThreadStart threadStart = new ThreadStart(ReplaceViewModel);
        Thread thread = new Thread(threadStart);
        thread.Start();
    }
}
