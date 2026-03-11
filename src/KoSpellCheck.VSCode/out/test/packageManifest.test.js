"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
(0, node_test_1.default)('VS Code manifest configuration defaults to window scope', () => {
    const packageJsonPath = node_path_1.default.resolve(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(node_fs_1.default.readFileSync(packageJsonPath, 'utf8'));
    const configuration = packageJson.contributes?.configuration;
    node_assert_1.default.ok(configuration, 'contributes.configuration must exist');
    node_assert_1.default.equal(configuration?.scope, 'window', 'contributes.configuration.scope must remain window so settings stay visible in Workspace scope');
    node_assert_1.default.ok(Object.keys(configuration?.properties ?? {}).length > 1, 'manifest should expose multiple extension settings');
});
//# sourceMappingURL=packageManifest.test.js.map