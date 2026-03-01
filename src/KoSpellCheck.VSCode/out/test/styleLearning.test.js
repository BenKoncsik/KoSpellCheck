"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const config_1 = require("../config");
const styleDetector_1 = require("../styleDetector");
const styleRanker_1 = require("../styleRanker");
(0, node_test_1.default)('style learning ranks HttpClient variant first for HttpClinet', async () => {
    const workspaceRoot = node_path_1.default.resolve(__dirname, '..', '..', '..', '..', 'samples', 'style-learning', 'httpclient-workspace');
    const files = collectFiles(workspaceRoot);
    const config = (0, config_1.defaultConfig)();
    config.styleLearningEnabled = true;
    config.styleLearningFileExtensions = ['cs'];
    config.styleLearningIgnoreFolders = ['bin', 'obj', '.git', '.vs', 'node_modules', 'artifacts'];
    config.styleLearningMaxFiles = 200;
    config.styleLearningMaxTokens = 50000;
    config.styleLearningTimeBudgetMs = 3000;
    const profile = await (0, styleDetector_1.detectProjectStyleProfile)(workspaceRoot, files, config);
    const ranked = (0, styleRanker_1.rankSuggestionsByStyle)('HttpClinet', [
        { replacement: 'HTTPClient', confidence: 0.8, sourceDictionary: 'fake' },
        { replacement: 'httpClient', confidence: 0.8, sourceDictionary: 'fake' },
        { replacement: 'HttpClient', confidence: 0.8, sourceDictionary: 'fake' }
    ], config, profile);
    node_assert_1.default.equal(ranked[0]?.replacement, 'HttpClient');
});
function collectFiles(root) {
    const output = [];
    const pending = [root];
    while (pending.length > 0) {
        const current = pending.pop();
        if (!current) {
            continue;
        }
        const entries = node_fs_1.default.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = node_path_1.default.join(current, entry.name);
            if (entry.isDirectory()) {
                pending.push(fullPath);
                continue;
            }
            output.push(fullPath);
        }
    }
    return output;
}
//# sourceMappingURL=styleLearning.test.js.map