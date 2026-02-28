"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const config_1 = require("../config");
const tokenizer_1 = require("../tokenizer");
(0, node_test_1.default)('tokenizer splits camel and snake case', () => {
    const config = (0, config_1.defaultConfig)();
    const ignoreRegexes = (0, config_1.compileIgnorePatterns)(config.ignorePatterns);
    const tokens = (0, tokenizer_1.tokenize)('KoSpellCheck gps_coordinate_lat HTTPServerConfig', config, ignoreRegexes).map((x) => x.value);
    node_assert_1.default.deepStrictEqual(tokens, [
        'Ko',
        'Spell',
        'Check',
        'gps',
        'coordinate',
        'lat',
        'HTTP',
        'Server',
        'Config'
    ]);
});
//# sourceMappingURL=tokenizer.test.js.map