"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const config_1 = require("../config");
const spellService_1 = require("../spellService");
(0, node_test_1.default)('spell service stays functional when HU nspell loader fails', () => {
    const extensionPath = node_path_1.default.resolve(__dirname, '..', '..');
    const service = new spellService_1.SpellService(extensionPath);
    const config = (0, config_1.defaultConfig)();
    config.languages = ['hu'];
    service.ensureInitialized();
    const correct = service.check('Alma', config);
    const misspelled = service.check('Almma', config);
    const suggestions = service.suggest('Almma', config).map((x) => x.replacement.toLowerCase());
    node_assert_1.default.equal(correct.correct, true);
    node_assert_1.default.equal(misspelled.correct, false);
    node_assert_1.default.ok(suggestions.includes('alma'));
});
(0, node_test_1.default)('suggestions preserve capitalization and include transposition fixes', () => {
    const extensionPath = node_path_1.default.resolve(__dirname, '..', '..');
    const service = new spellService_1.SpellService(extensionPath);
    const config = (0, config_1.defaultConfig)();
    config.languages = ['hu'];
    config.suggestionsMax = 8;
    service.ensureInitialized();
    const titleCaseSuggestions = service.suggest('Almma', config).map((x) => x.replacement);
    const tezstSuggestions = service.suggest('tezst', config).map((x) => x.replacement.toLowerCase());
    node_assert_1.default.ok(titleCaseSuggestions.includes('Alma'));
    node_assert_1.default.ok(tezstSuggestions.includes('teszt'));
});
(0, node_test_1.default)('compound suggestions split misspelled hungarian words', () => {
    const extensionPath = node_path_1.default.resolve(__dirname, '..', '..');
    const service = new spellService_1.SpellService(extensionPath);
    const config = (0, config_1.defaultConfig)();
    config.languages = ['hu'];
    config.suggestionsMax = 10;
    service.ensureInitialized();
    const suggestions = service.suggest('Almmakorte', config).map((x) => x.replacement);
    node_assert_1.default.ok(suggestions.some((replacement) => replacement === 'AlmaKorte' || replacement === 'AlmaKörte'));
});
(0, node_test_1.default)('english transposition correction is prioritized in mixed language mode', () => {
    const extensionPath = node_path_1.default.resolve(__dirname, '..', '..');
    const service = new spellService_1.SpellService(extensionPath);
    const config = (0, config_1.defaultConfig)();
    config.languages = ['hu', 'en'];
    config.suggestionsMax = 6;
    service.ensureInitialized();
    const suggestions = service.suggest('Viwe', config).map((x) => x.replacement);
    node_assert_1.default.equal(suggestions[0], 'View');
});
(0, node_test_1.default)('mixed hu+en mode prefers english insertion corrections for neutral ascii tokens', () => {
    const extensionPath = node_path_1.default.resolve(__dirname, '..', '..');
    const service = new spellService_1.SpellService(extensionPath);
    const config = (0, config_1.defaultConfig)();
    config.languages = ['hu', 'en'];
    config.suggestionsMax = 6;
    service.ensureInitialized();
    const chekSuggestions = service.suggest('Chek', config).map((x) => x.replacement);
    const servceSuggestions = service.suggest('Servce', config).map((x) => x.replacement);
    node_assert_1.default.equal(chekSuggestions[0], 'Check');
    node_assert_1.default.equal(servceSuggestions[0], 'Service');
});
(0, node_test_1.default)('mixed hu+en mode keeps hungarian-first ranking for hungarian-looking stems', () => {
    const extensionPath = node_path_1.default.resolve(__dirname, '..', '..');
    const service = new spellService_1.SpellService(extensionPath);
    const config = (0, config_1.defaultConfig)();
    config.languages = ['hu', 'en'];
    config.suggestionsMax = 6;
    service.ensureInitialized();
    const ranked = service.suggest('kerese', config).map((x) => x.replacement);
    node_assert_1.default.equal(/\s/u.test(ranked[0]), false);
    node_assert_1.default.ok(ranked.some((item) => item.toLowerCase() === 'keresd' || item.toLowerCase() === 'kereső'));
});
//# sourceMappingURL=spellService.test.js.map