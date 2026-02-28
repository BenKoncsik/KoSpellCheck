# Configuration

A konfiguráció két forrásból töltődik:

1. `.editorconfig`
2. `kospellcheck.json`

A JSON felülírja az `.editorconfig` értékeit.

## `.editorconfig` kulcsok

- `kospellcheck_enabled = true|false`
- `kospellcheck_languages = hu,en`
- `kospellcheck_allow_mixed_languages = true|false`
- `kospellcheck_treat_as_hungarian_when_ascii_only = true|false`
- `kospellcheck_ignore_words = Async,SignalR`
- `kospellcheck_project_dictionary = KoSpellCheck,MyDomainWord`
- `kospellcheck_ignore_patterns = ^https?://,^[0-9a-f]{8}-`
- `kospellcheck_min_token_length = 2`
- `kospellcheck_max_token_length = 64`
- `kospellcheck_ignore_all_caps_length_threshold = 4`
- `kospellcheck_suggestions_max = 5`
- `kospellcheck_prefer_terms = model:modell,endpoint:végpont`

## `kospellcheck.json` séma (MVP)

```json
{
  "enabled": true,
  "languages": ["hu", "en"],
  "allowMixedLanguages": true,
  "preferTerms": {
    "model": "modell"
  },
  "treatAsHungarianWhenAsciiOnly": true,
  "ignoreWords": ["Async", "SignalR", "STM32"],
  "projectDictionary": ["KoSpellCheck"],
  "ignorePatterns": [
    "^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$",
    "^https?://"
  ],
  "minTokenLength": 2,
  "maxTokenLength": 64,
  "ignoreAllCapsLengthThreshold": 4,
  "suggestionsMax": 5,
  "maxTokensPerDocument": 2000
}
```

## preferTerms példák

- Magyarosítás: `{ "model": "modell" }`
- Angolosítás: `{ "modell": "model" }`

## Hungarian ASCII policy

Ha `treatAsHungarianWhenAsciiOnly = true`, akkor a HU szótárra történik ASCII-fold ellenőrzés, így pl. `homerseklet` elfogadható a `hőmérséklet` alapján.
