"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoreConventionCliClient = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
class CoreConventionCliClient {
    constructor(extensionPath, log) {
        this.extensionPath = extensionPath;
        this.log = log;
        const srcRoot = node_path_1.default.resolve(this.extensionPath, '..');
        this.cliProjectPath = node_path_1.default.join(srcRoot, 'KoSpellCheck.ProjectConventions.Cli', 'KoSpellCheck.ProjectConventions.Cli.csproj');
        this.cliDllCandidates = ['net9.0', 'net8.0'].map((framework) => node_path_1.default.join(srcRoot, 'KoSpellCheck.ProjectConventions.Cli', 'bin', 'Release', framework, 'KoSpellCheck.ProjectConventions.Cli.dll'));
    }
    async buildProfile(request) {
        return this.runCommand('profile', request);
    }
    async analyze(request) {
        return this.runCommand('analyze', request);
    }
    async ignore(request) {
        const response = await this.runCommand('ignore', request);
        return !!response;
    }
    async runCommand(command, payload) {
        const available = await this.ensureBuilt();
        if (!available) {
            return undefined;
        }
        if (!this.resolvedCliDllPath) {
            this.log('project-conventions core-cli unavailable reason=missing resolved CLI path');
            return undefined;
        }
        const tempPath = node_path_1.default.join(node_os_1.default.tmpdir(), `kospellcheck-conventions-${command}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
        try {
            node_fs_1.default.writeFileSync(tempPath, JSON.stringify(payload), 'utf8');
            const { stdout, stderr } = await execFileAsync('dotnet', [this.resolvedCliDllPath, command, '--request', tempPath], {
                windowsHide: true,
                timeout: 20_000,
                maxBuffer: 8 * 1024 * 1024
            });
            if (stderr?.trim()) {
                this.log(`project-conventions core-cli stderr=${stderr.trim()}`);
            }
            const raw = stdout?.trim();
            if (!raw) {
                return undefined;
            }
            return JSON.parse(raw);
        }
        catch (error) {
            this.log(`project-conventions core-cli command=${command} failed reason=${String(error)}`);
            return undefined;
        }
        finally {
            try {
                node_fs_1.default.unlinkSync(tempPath);
            }
            catch {
                // best-effort cleanup
            }
        }
    }
    async ensureBuilt() {
        if (this.ensureBuiltTask) {
            return this.ensureBuiltTask;
        }
        this.ensureBuiltTask = this.doEnsureBuilt();
        return this.ensureBuiltTask;
    }
    async doEnsureBuilt() {
        if (!node_fs_1.default.existsSync(this.cliProjectPath)) {
            this.unavailableReason = `CLI project not found: ${this.cliProjectPath}`;
            this.log(`project-conventions core-cli unavailable reason='${this.unavailableReason}'`);
            return false;
        }
        const existingPath = this.resolveBuiltDllPath();
        if (existingPath) {
            this.resolvedCliDllPath = existingPath;
            return true;
        }
        try {
            const { stderr } = await execFileAsync('dotnet', ['build', this.cliProjectPath, '-c', 'Release', '--nologo'], {
                windowsHide: true,
                timeout: 60_000,
                maxBuffer: 8 * 1024 * 1024
            });
            if (stderr?.trim()) {
                this.log(`project-conventions core-cli build stderr=${stderr.trim()}`);
            }
        }
        catch (error) {
            this.unavailableReason = String(error);
            this.log(`project-conventions core-cli build failed reason='${this.unavailableReason}'`);
            return false;
        }
        const resolvedAfterBuild = this.resolveBuiltDllPath();
        if (!resolvedAfterBuild) {
            this.unavailableReason = `CLI DLL not found after build: ${this.cliDllCandidates.join(' | ')}`;
            this.log(`project-conventions core-cli unavailable reason='${this.unavailableReason}'`);
            return false;
        }
        this.resolvedCliDllPath = resolvedAfterBuild;
        return true;
    }
    resolveBuiltDllPath() {
        return this.cliDllCandidates.find((candidate) => node_fs_1.default.existsSync(candidate));
    }
}
exports.CoreConventionCliClient = CoreConventionCliClient;
//# sourceMappingURL=coreCliClient.js.map