"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const config_1 = require("../config");
const engine_1 = require("../engine");
(0, node_test_1.default)('engine prioritizes focus offsets when token budget is exceeded', () => {
    const config = (0, config_1.defaultConfig)();
    config.maxTokensPerDocument = 2000;
    const filler = Array.from({ length: 2200 }, () => 'helyes').join(' ');
    const text = `${filler} TesztiresAlmmaKorte`;
    const targetOffset = text.lastIndexOf('Almma');
    const service = {
        check(token) {
            const misspelled = token.toLowerCase() === 'almma';
            return {
                correct: !misspelled,
                languages: misspelled ? [] : ['hu']
            };
        },
        suggest(token) {
            if (token.toLowerCase() === 'almma') {
                return [{ replacement: 'alma', confidence: 1, sourceDictionary: 'hu' }];
            }
            return [];
        }
    };
    const noFocus = (0, engine_1.checkDocument)(text, config, service);
    node_assert_1.default.equal(noFocus.some((issue) => issue.token === 'Almma'), false);
    const withFocus = (0, engine_1.checkDocument)(text, config, service, {
        focusOffsets: [targetOffset]
    });
    node_assert_1.default.equal(withFocus.some((issue) => issue.token === 'Almma'), true);
    const almmaIssue = withFocus.find((issue) => issue.token === 'Almma');
    node_assert_1.default.ok(almmaIssue);
    node_assert_1.default.ok(almmaIssue.message.includes('alma'));
});
(0, node_test_1.default)('engine produces a single fix for multi-part identifier misspellings', () => {
    const config = (0, config_1.defaultConfig)();
    const text = 'public void TesztirsaAlmmakorte() {}';
    const service = {
        check(token) {
            const normalized = token.toLowerCase();
            const misspelled = normalized === 'tesztirsa' || normalized === 'almmakorte';
            return {
                correct: !misspelled,
                languages: misspelled ? [] : ['hu']
            };
        },
        suggest(token) {
            const normalized = token.toLowerCase();
            if (normalized === 'tesztirsa') {
                return [{ replacement: 'Tesztiras', confidence: 0.95, sourceDictionary: 'hu' }];
            }
            if (normalized === 'almmakorte') {
                return [{ replacement: 'AlmaKorte', confidence: 0.97, sourceDictionary: 'hu' }];
            }
            return [];
        }
    };
    const issues = (0, engine_1.checkDocument)(text, config, service);
    node_assert_1.default.equal(issues.length, 1);
    const issue = issues[0];
    node_assert_1.default.equal(issue.token, 'TesztirsaAlmmakorte');
    node_assert_1.default.equal(issue.suggestions[0]?.replacement, 'TesztirasAlmaKorte');
});
//# sourceMappingURL=engine.test.js.map