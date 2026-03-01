namespace StyleLearningSample;

public sealed class HttpClientFactory
{
    private readonly HttpClient _client;

    public HttpClientFactory(HttpClient client)
    {
        _client = client;
    }

    public HttpClient CreateHttpClient()
    {
        HttpClient localClient = _client;
        return localClient;
    }

    public HttpClient UseHttpClient(HttpClient inputClient)
    {
        HttpClient HttpClientAlias = inputClient;
        return HttpClientAlias;
    }
}
