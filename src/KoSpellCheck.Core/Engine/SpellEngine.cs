using System.Text.RegularExpressions;
using KoSpellCheck.Core.Abstractions;
using KoSpellCheck.Core.Caching;
using KoSpellCheck.Core.Config;
using KoSpellCheck.Core.Diagnostics;
using KoSpellCheck.Core.Dictionaries;
using KoSpellCheck.Core.Normalization;
using KoSpellCheck.Core.Tokenization;
using KoSpellCheck.Core.Utils;

namespace KoSpellCheck.Core.Engine;

public sealed class SpellEngine
{
    private readonly ISpellDictionary _dictionary;
    private readonly CodeAwareTokenizer _tokenizer;
    private readonly LruCache<string, CachedTokenResult> _cache;
    private readonly object _cacheLock = new();

    private sealed class CachedTokenResult
    {
        public CachedTokenResult(bool isCorrect, IReadOnlyList<Suggestion> suggestions, string? languageHint)
        {
            IsCorrect = isCorrect;
            Suggestions = suggestions;
            LanguageHint = languageHint;
        }

        public bool IsCorrect { get; }

        public IReadOnlyList<Suggestion> Suggestions { get; }

        public string? LanguageHint { get; }
    }

    public SpellEngine(ISpellDictionary dictionary, CodeAwareTokenizer? tokenizer = null, int cacheSize = 5000)
    {
        _dictionary = dictionary;
        _tokenizer = tokenizer ?? new CodeAwareTokenizer();
        _cache = new LruCache<string, CachedTokenResult>(cacheSize);
    }

    public IReadOnlyList<SpellDiagnostic> CheckDocument(
        string text,
        SpellCheckContext ctx,
        ISet<int>? changedLines = null)
    {
        if (!ctx.Config.Enabled || string.IsNullOrEmpty(text))
        {
            return Array.Empty<SpellDiagnostic>();
        }

        var diagnostics = new List<SpellDiagnostic>();
        var lineMap = new LineMap(text);
        var ignoreRegexes = ctx.Config.BuildIgnoreRegexes().ToList();
        var tokens = _tokenizer.Tokenize(text, ctx.Config);

        var processedTokens = 0;
        foreach (var token in tokens)
        {
            if (processedTokens >= ctx.Config.MaxTokensPerDocument)
            {
                break;
            }

            var tokenText = token.Value;
            if (ShouldIgnoreToken(tokenText, ctx.Config, ignoreRegexes))
            {
                continue;
            }

            var line = lineMap.GetLine(token.Start);
            if (changedLines != null && changedLines.Count > 0)
            {
                var isHit = changedLines.Contains(line) || changedLines.Contains(line + 1);
                if (!isHit)
                {
                    continue;
                }
            }

            processedTokens++;
            var normalized = TextNormalizer.Normalize(tokenText);
            var cacheKey = BuildCacheKey(normalized, ctx.Config);
            var cached = GetOrCompute(cacheKey, tokenText, ctx);
            var suggestions = ApplyPreferenceSuggestions(tokenText, normalized, ctx, cached.Suggestions).ToList();

            if (!cached.IsCorrect)
            {
                diagnostics.Add(CreateDiagnostic(
                    lineMap,
                    token,
                    tokenText,
                    $"Possible misspelling: '{tokenText}'.",
                    cached.LanguageHint,
                    suggestions));
                continue;
            }

            if (TryGetPreferredTerm(normalized, ctx.Config, out var preferred) &&
                !string.Equals(preferred, normalized, StringComparison.OrdinalIgnoreCase))
            {
                diagnostics.Add(CreateDiagnostic(
                    lineMap,
                    token,
                    tokenText,
                    $"Preferred term is '{preferred}'.",
                    cached.LanguageHint,
                    suggestions));
            }
        }

        return diagnostics;
    }

    private CachedTokenResult GetOrCompute(string cacheKey, string token, SpellCheckContext ctx)
    {
        lock (_cacheLock)
        {
            if (_cache.TryGet(cacheKey, out var hit) && hit != null)
            {
                return hit;
            }
        }

        var isCorrect = _dictionary.Check(token, ctx);
        var suggestions = _dictionary.Suggest(token, ctx);
        var languageHint = ResolveLanguageHint(token, ctx);
        var value = new CachedTokenResult(isCorrect, suggestions, languageHint);

        lock (_cacheLock)
        {
            _cache.Set(cacheKey, value);
        }

        return value;
    }

    private static bool ShouldIgnoreToken(string token, KoSpellCheckConfig config, IReadOnlyList<Regex> ignoreRegexes)
    {
        if (token.Length < config.MinTokenLength || token.Length > config.MaxTokenLength)
        {
            return true;
        }

        if (TextNormalizer.IsAllCaps(token) && token.Length <= config.IgnoreAllCapsLengthThreshold)
        {
            return true;
        }

        if (config.IgnoreWords.Contains(token) || config.ProjectDictionary.Contains(token))
        {
            return true;
        }

        foreach (var regex in ignoreRegexes)
        {
            if (regex.IsMatch(token))
            {
                return true;
            }
        }

        return false;
    }

    private static SpellDiagnostic CreateDiagnostic(
        LineMap lineMap,
        TokenSpan token,
        string tokenText,
        string message,
        string? languageHint,
        IReadOnlyList<Suggestion> suggestions)
    {
        var (startLine, startCharacter) = lineMap.GetLineAndCharacter(token.Start);
        var (endLine, endCharacter) = lineMap.GetLineAndCharacter(token.End);

        return new SpellDiagnostic(
            new TextRange(token.Start, token.End, startLine, startCharacter, endLine, endCharacter),
            tokenText,
            message,
            languageHint,
            suggestions);
    }

    private static string BuildCacheKey(string normalizedToken, KoSpellCheckConfig config)
    {
        var languages = string.Join(",", config.LanguagesEnabled.OrderBy(v => v, StringComparer.OrdinalIgnoreCase));
        return $"{normalizedToken}|{languages}|{config.TreatAsHungarianWhenAsciiOnly}|{config.SuggestionsMax}";
    }

    private string? ResolveLanguageHint(string token, SpellCheckContext ctx)
    {
        if (_dictionary is CompositeDictionary composite)
        {
            var matches = composite.GetMatchingLanguages(token, ctx);
            if (matches.Count == 0)
            {
                return null;
            }

            foreach (var lang in ctx.Config.LanguagesEnabled)
            {
                if (matches.Any(m => string.Equals(m, lang, StringComparison.OrdinalIgnoreCase)))
                {
                    return lang;
                }
            }

            return matches[0];
        }

        return null;
    }

    private IEnumerable<Suggestion> ApplyPreferenceSuggestions(
        string originalToken,
        string normalizedToken,
        SpellCheckContext ctx,
        IReadOnlyList<Suggestion> rawSuggestions)
    {
        var list = new List<Suggestion>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (TryGetPreferredTerm(normalizedToken, ctx.Config, out var preferred) &&
            !string.Equals(preferred, normalizedToken, StringComparison.OrdinalIgnoreCase))
        {
            list.Add(new Suggestion(preferred, 1.0, "preference"));
            seen.Add(preferred);
        }

        foreach (var suggestion in rawSuggestions)
        {
            if (!seen.Add(suggestion.Replacement))
            {
                continue;
            }

            list.Add(suggestion);
            if (list.Count >= ctx.Config.SuggestionsMax)
            {
                break;
            }
        }

        if (list.Count == 0 &&
            TryGetPreferredTerm(normalizedToken, ctx.Config, out preferred) &&
            !string.Equals(preferred, originalToken, StringComparison.OrdinalIgnoreCase))
        {
            list.Add(new Suggestion(preferred, 1.0, "preference"));
        }

        return list;
    }

    private static bool TryGetPreferredTerm(string normalizedToken, KoSpellCheckConfig config, out string preferred)
    {
        foreach (var pair in config.PreferTerms)
        {
            var key = TextNormalizer.Normalize(pair.Key);
            if (!string.Equals(key, normalizedToken, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            preferred = TextNormalizer.Normalize(pair.Value);
            return true;
        }

        preferred = string.Empty;
        return false;
    }
}
