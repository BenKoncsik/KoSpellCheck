"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const coreCliClient_1 = require("../projectConventions/adapters/coreCliClient");
const extensionPath = node_path_1.default.resolve(__dirname, '..', '..');
(0, node_test_1.default)('core convention CLI bridge builds profile and analyzes file', async () => {
    const workspaceRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'kospellcheck-conv-cli-'));
    const client = new coreCliClient_1.CoreConventionCliClient(extensionPath, () => { });
    try {
        writeFile(workspaceRoot, 'Services/CustomerService.cs', 'namespace App.Services; public class CustomerService {}');
        writeFile(workspaceRoot, 'Services/OrderService.cs', 'namespace App.Services; public class OrderService {}');
        writeFile(workspaceRoot, 'Dtos/CustomerDto.cs', 'namespace App.Dtos; public class CustomerDto {}');
        const profileResult = await client.buildProfile({
            WorkspaceRoot: workspaceRoot,
            Scope: 'workspace',
            PersistArtifacts: false,
            Options: {
                EnableProjectConventionMapping: true,
                EnableNamingConventionDiagnostics: true,
                EnableStatisticalAnomalyDetection: true,
                EnableAiNamingAnomalyDetection: false,
                UseCoralTpuIfAvailable: false,
                AutoRebuildConventionProfile: true,
                AnalyzeOnSave: true,
                AnalyzeOnRename: true,
                AnalyzeOnNewFile: true,
                Scope: 'workspace',
                IgnoreGeneratedCode: true,
                IgnoreTestProjects: false,
                IncludePatterns: ['**/*.cs'],
                ExcludePatterns: ['**/bin/**', '**/obj/**'],
                SupportedExtensions: ['cs'],
                MaxFiles: 100,
                MinEvidenceCount: 2,
                StatisticalAnomalyThreshold: 0.5,
                AiAnomalyThreshold: 0.7,
                ConventionProfilePath: '.kospellcheck/project-conventions.json',
                ConventionProfileCachePath: '.kospellcheck/project-profile-cache.json',
                ConventionAnomalyModelPath: '.kospellcheck/project-anomaly-model.json',
                ConventionScanSummaryPath: '.kospellcheck/project-scan-summary.json',
                ConventionIgnoreListPath: '.kospellcheck/convention-ignores.json'
            }
        });
        node_assert_1.default.ok(profileResult);
        node_assert_1.default.ok(profileResult.Profile);
        const analysisResult = await client.analyze({
            WorkspaceRoot: workspaceRoot,
            FilePath: node_path_1.default.join(workspaceRoot, 'Services', 'CustomerHandler.cs'),
            FileContent: 'namespace App.Services; public class CustomerHandler {}',
            Options: {
                EnableProjectConventionMapping: true,
                EnableNamingConventionDiagnostics: true,
                EnableStatisticalAnomalyDetection: true,
                EnableAiNamingAnomalyDetection: false,
                UseCoralTpuIfAvailable: false,
                AutoRebuildConventionProfile: true,
                AnalyzeOnSave: true,
                AnalyzeOnRename: true,
                AnalyzeOnNewFile: true,
                Scope: 'workspace',
                IgnoreGeneratedCode: true,
                IgnoreTestProjects: false,
                IncludePatterns: ['**/*.cs'],
                ExcludePatterns: ['**/bin/**', '**/obj/**'],
                SupportedExtensions: ['cs'],
                MaxFiles: 100,
                MinEvidenceCount: 2,
                StatisticalAnomalyThreshold: 0.5,
                AiAnomalyThreshold: 0.7,
                ConventionProfilePath: '.kospellcheck/project-conventions.json',
                ConventionProfileCachePath: '.kospellcheck/project-profile-cache.json',
                ConventionAnomalyModelPath: '.kospellcheck/project-anomaly-model.json',
                ConventionScanSummaryPath: '.kospellcheck/project-scan-summary.json',
                ConventionIgnoreListPath: '.kospellcheck/convention-ignores.json'
            },
            Profile: profileResult.Profile,
            IgnoreList: { schemaVersion: 1, entries: [] }
        });
        node_assert_1.default.ok(analysisResult);
        const diagnostics = (analysisResult.Analysis?.Diagnostics ?? []);
        node_assert_1.default.ok(diagnostics.some((item) => item.RuleId === 'KS_CONV_001'));
    }
    finally {
        node_fs_1.default.rmSync(workspaceRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)('core convention CLI bridge discovers CLI project from workspace root when extension path is installed-layout', () => {
    const fakeInstalledExtensionPath = node_path_1.default.join(node_os_1.default.tmpdir(), 'kospellcheck-installed-extension', '.vscode', 'extensions', 'kospellcheckv2.kospellcheck-0.1.15');
    const repoRoot = node_path_1.default.resolve(__dirname, '..', '..', '..', '..');
    const expectedCliProjectPath = node_path_1.default.join(repoRoot, 'src', 'KoSpellCheck.ProjectConventions.Cli', 'KoSpellCheck.ProjectConventions.Cli.csproj');
    const client = new coreCliClient_1.CoreConventionCliClient(fakeInstalledExtensionPath, () => { });
    const candidates = client
        .resolveCliProjectCandidates(repoRoot);
    node_assert_1.default.ok(candidates.includes(expectedCliProjectPath));
    node_assert_1.default.ok(node_fs_1.default.existsSync(expectedCliProjectPath));
});
(0, node_test_1.default)('core convention CLI bridge prioritizes RID-specific packaged host candidates', () => {
    const client = new coreCliClient_1.CoreConventionCliClient(extensionPath, () => { });
    const candidates = client.packagedCliDllCandidates;
    const hostSegment = `${node_path_1.default.sep}core-cli${node_path_1.default.sep}hosts${node_path_1.default.sep}`;
    const firstHostIndex = candidates.findIndex((entry) => entry.includes(hostSegment));
    const firstLegacyFrameworkIndex = candidates.findIndex((entry) => entry.includes(`${node_path_1.default.sep}core-cli${node_path_1.default.sep}net9.0${node_path_1.default.sep}`));
    node_assert_1.default.ok(firstHostIndex >= 0);
    node_assert_1.default.ok(firstLegacyFrameworkIndex >= 0);
    node_assert_1.default.ok(firstHostIndex < firstLegacyFrameworkIndex);
});
(0, node_test_1.default)('core convention CLI bridge prioritizes host RID matching current platform and arch', () => {
    const scenarios = [
        { platform: 'darwin', arch: 'arm64', expectedRid: 'osx-arm64' },
        { platform: 'win32', arch: 'ia32', expectedRid: 'win-x86' },
        { platform: 'linux', arch: 'x64', expectedRid: 'linux-x64' }
    ];
    for (const scenario of scenarios) {
        withProcessPlatformAndArch(scenario.platform, scenario.arch, () => {
            const client = new coreCliClient_1.CoreConventionCliClient(extensionPath, () => { });
            const candidates = client.packagedCliDllCandidates;
            const hostCandidates = candidates.filter((entry) => entry.includes(`${node_path_1.default.sep}core-cli${node_path_1.default.sep}hosts${node_path_1.default.sep}`));
            node_assert_1.default.ok(hostCandidates.length > 0);
            node_assert_1.default.ok(hostCandidates[0].includes(`${node_path_1.default.sep}hosts${node_path_1.default.sep}${scenario.expectedRid}${node_path_1.default.sep}`));
        });
    }
});
(0, node_test_1.default)('core convention CLI bridge uses apphost when dotnet is missing from PATH', async () => {
    if (process.platform === 'win32') {
        return;
    }
    const workspaceRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'kospellcheck-conv-cli-fallback-workspace-'));
    const fakeCliRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'kospellcheck-conv-cli-fallback-host-'));
    const originalPath = process.env.PATH;
    try {
        const fakeDllPath = node_path_1.default.join(fakeCliRoot, 'KoSpellCheck.ProjectConventions.Cli.dll');
        const fakeAppHostPath = node_path_1.default.join(fakeCliRoot, 'KoSpellCheck.ProjectConventions.Cli');
        node_fs_1.default.writeFileSync(fakeDllPath, 'placeholder', 'utf8');
        node_fs_1.default.writeFileSync(fakeAppHostPath, '#!/bin/sh\nprintf "%s" "{\\"Profile\\":{\\"SchemaVersion\\":1}}"\n', 'utf8');
        node_fs_1.default.chmodSync(fakeAppHostPath, 0o755);
        process.env.PATH = '';
        const client = new coreCliClient_1.CoreConventionCliClient(extensionPath, () => { }, () => fakeCliRoot);
        const profileResult = await client.buildProfile({
            WorkspaceRoot: workspaceRoot,
            Scope: 'workspace',
            PersistArtifacts: false,
            Options: {}
        });
        node_assert_1.default.ok(profileResult);
        node_assert_1.default.ok(profileResult.Profile);
    }
    finally {
        process.env.PATH = originalPath;
        node_fs_1.default.rmSync(workspaceRoot, { recursive: true, force: true });
        node_fs_1.default.rmSync(fakeCliRoot, { recursive: true, force: true });
    }
});
function writeFile(root, relativePath, content) {
    const fullPath = node_path_1.default.join(root, relativePath);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(fullPath), { recursive: true });
    node_fs_1.default.writeFileSync(fullPath, content, 'utf8');
}
function withProcessPlatformAndArch(platform, arch, callback) {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    const archDescriptor = Object.getOwnPropertyDescriptor(process, 'arch');
    if (!platformDescriptor?.configurable || !archDescriptor?.configurable) {
        throw new Error('process platform/arch descriptors are not configurable in this runtime');
    }
    try {
        Object.defineProperty(process, 'platform', { value: platform });
        Object.defineProperty(process, 'arch', { value: arch });
        callback();
    }
    finally {
        Object.defineProperty(process, 'platform', platformDescriptor);
        Object.defineProperty(process, 'arch', archDescriptor);
    }
}
//# sourceMappingURL=projectConventions.test.js.map