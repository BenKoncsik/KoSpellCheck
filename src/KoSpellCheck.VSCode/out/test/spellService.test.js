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
//# sourceMappingURL=spellService.test.js.map