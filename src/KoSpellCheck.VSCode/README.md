# KoSpellCheck (VS Code)

Offline HU+EN spell checker extension with code-aware tokenization and quick fix suggestions.

## English
KoSpellCheck is an offline Hungarian + English spell checker for VS Code, designed for real coding workflows.
Instead of checking plain text only, it uses code-aware tokenization to understand source files better and reduce noisy false positives.

### Key Features
- Offline operation
No cloud dependency and no external API calls. Spell checking runs fully local.
- Hungarian + English dictionaries
Built for bilingual development teams and mixed-language projects.
- Code-aware tokenization
Splits identifiers and code tokens intelligently (for example: `camelCase`, `snake_case`, mixed symbols), so checks focus on meaningful words.
- Quick Fix suggestions
Detected misspellings can be corrected directly from VS Code's Quick Fix menu.
- Developer-focused behavior
Better signal in comments, strings, docs, and naming-heavy codebases.

### Why KoSpellCheck?
Generic spell checkers often struggle in source code because variable names, technical terms, and mixed naming conventions generate too many irrelevant warnings.
KoSpellCheck is optimized for this environment: it keeps spell checking useful in real projects where Hungarian and English are used together.

Repository: https://github.com/BenKoncsik/KoSpellCheck

## Magyar
A KoSpellCheck egy offline magyar + angol helyesiras-ellenorzo VS Code-hoz, amelyet kifejezetten fejlesztoi munkafolyamatokra terveztek.
Nem csak sima szoveget ellenoriz: kodtudatos tokenizalast hasznal, igy pontosabban kezeli a forraskod sajatossagait, es kevesebb teves talalatot ad.

### Fobb funkciok
- Offline mukodes
Nincs felhofuggoseg, nincs kulso API-hivas. Minden helyben tortenik.
- Magyar + angol szotar
Ketnyelvu fejlesztoi kornyezetre es vegyes nyelvu projektekre optimalizalva.
- Kodtudatos tokenizalas
Intelligensen bontja a kodtokeneket (pl. `camelCase`, `snake_case`, vegyes elnevezesek), igy a valodi szavakra fokuszal.
- Quick Fix javaslatok
Az elirasok kozvetlenul javithatok a VS Code Quick Fix menujebol.
- Fejlesztobarat mukodes
Kulonosen hasznos kommentekben, stringekben, dokumentacioban es nevkonvenciokban gazdag kodnal.

### Miert KoSpellCheck?
Az altalanos helyesiras-ellenorzok kodban gyakran tul sok irrelevans figyelmeztetest adnak.
A KoSpellCheck ezt kezeli: valoban hasznalhato helyesiras-ellenorzest ad ott, ahol a magyar es angol nyelv egyszerre jelenik meg a fejlesztes soran.

Repository: https://github.com/BenKoncsik/KoSpellCheck
