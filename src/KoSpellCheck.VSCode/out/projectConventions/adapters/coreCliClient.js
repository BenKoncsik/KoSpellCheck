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
const CLI_PROJECT_NAME = 'KoSpellCheck.ProjectConventions.Cli';
const CLI_PROJECT_FILE = `${CLI_PROJECT_NAME}.csproj`;
const CLI_DLL_NAME = `${CLI_PROJECT_NAME}.dll`;
const CLI_TARGET_FRAMEWORKS = ['net9.0', 'net8.0'];
const CLI_HOST_RUNTIME_IDENTIFIERS = ['win-x64', 'win-arm64', 'win-x86', 'linux-x64', 'linux-arm64', 'linux-x86', 'osx-x64', 'osx-arm64'];
class CoreConventionCliClient {
    constructor(extensionPath, log, getConfiguredCliPath) {
        this.extensionPath = extensionPath;
        this.log = log;
        this.getConfiguredCliPath = getConfiguredCliPath;
        this.incompatibleCliDllPaths = new Set();
        this.ensureBuiltTasks = new Map();
        const ridCandidates = resolveRuntimeRidCandidates(process.platform, process.arch);
        const packagedHostCandidates = ridCandidates.flatMap((rid) => {
            const candidates = [];
            for (const framework of CLI_TARGET_FRAMEWORKS) {
                candidates.push(node_path_1.default.join(this.extensionPath, 'resources', 'projectConventions', 'core-cli', 'hosts', rid, framework, CLI_DLL_NAME));
            }
            candidates.push(node_path_1.default.join(this.extensionPath, 'resources', 'projectConventions', 'core-cli', 'hosts', rid, CLI_DLL_NAME));
            return candidates;
        });
        this.packagedCliDllCandidates = [
            ...packagedHostCandidates,
            ...CLI_TARGET_FRAMEWORKS.map((framework) => node_path_1.default.join(this.extensionPath, 'resources', 'projectConventions', 'core-cli', framework, CLI_DLL_NAME)),
            node_path_1.default.join(this.extensionPath, 'resources', 'projectConventions', 'core-cli', CLI_DLL_NAME)
        ];
        this.extensionSearchRoots = [
            node_path_1.default.resolve(this.extensionPath),
            node_path_1.default.resolve(this.extensionPath, '..'),
            node_path_1.default.resolve(this.extensionPath, '..', '..')
        ];
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
        const workspaceRoot = this.extractWorkspaceRoot(payload);
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const available = await this.ensureBuilt(workspaceRoot);
            if (!available) {
                return undefined;
            }
            if (!this.resolvedCliDllPath) {
                this.logUnavailable('missing resolved CLI path');
                return undefined;
            }
            const tempPath = node_path_1.default.join(node_os_1.default.tmpdir(), `kospellcheck-conventions-${command}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
            try {
                node_fs_1.default.writeFileSync(tempPath, JSON.stringify(payload), 'utf8');
                const launchAttempts = this.buildLaunchAttempts(this.resolvedCliDllPath, command, tempPath);
                let runtimeMismatchError;
                let lastError;
                for (const launch of launchAttempts) {
                    try {
                        const { stdout, stderr } = await execFileAsync(launch.executable, launch.args, {
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
                        lastError = error;
                        if (!runtimeMismatchError &&
                            String(error).includes('You must install or update .NET to run this application')) {
                            runtimeMismatchError = error;
                        }
                    }
                }
                const retryError = runtimeMismatchError ?? lastError;
                if (attempt === 0 && retryError && this.handleRuntimeMismatch(retryError)) {
                    continue;
                }
                if (lastError !== undefined) {
                    this.log(`project-conventions core-cli command=${command} failed reason=${String(lastError)}`);
                }
                return undefined;
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
        return undefined;
    }
    buildLaunchAttempts(cliDllPath, command, requestPath) {
        const attempts = [];
        const appHostPath = this.resolveAppHostPath(cliDllPath);
        if (appHostPath) {
            attempts.push({
                executable: appHostPath,
                args: [command, '--request', requestPath]
            });
        }
        attempts.push({
            executable: 'dotnet',
            args: [cliDllPath, command, '--request', requestPath]
        });
        return attempts;
    }
    resolveAppHostPath(cliDllPath) {
        if (!cliDllPath.toLowerCase().endsWith('.dll')) {
            return undefined;
        }
        const appHostBasePath = cliDllPath.slice(0, -4);
        const candidates = process.platform === 'win32'
            ? [`${appHostBasePath}.exe`, appHostBasePath]
            : [appHostBasePath, `${appHostBasePath}.exe`];
        return candidates.find((candidate) => node_fs_1.default.existsSync(candidate));
    }
    async ensureBuilt(workspaceRoot) {
        if (this.resolvedCliDllPath && node_fs_1.default.existsSync(this.resolvedCliDllPath)) {
            return true;
        }
        const taskKey = workspaceRootTaskKey(workspaceRoot);
        const existingTask = this.ensureBuiltTasks.get(taskKey);
        if (existingTask) {
            return existingTask;
        }
        const task = this.doEnsureBuilt(parseWorkspaceRootFromTaskKey(taskKey))
            .finally(() => {
            this.ensureBuiltTasks.delete(taskKey);
        });
        this.ensureBuiltTasks.set(taskKey, task);
        return task;
    }
    async doEnsureBuilt(workspaceRoot) {
        const configured = this.resolveConfiguredCliPath();
        if (configured && 'dllPath' in configured) {
            this.resolvedCliDllPath = configured.dllPath;
            this.markAvailable(`project-conventions core-cli resolved source=configured path='${configured.dllPath}'`);
            return true;
        }
        if (configured && 'projectPath' in configured) {
            const available = await this.ensureBuiltFromProjectPath(configured.projectPath, 'configured');
            if (available) {
                return true;
            }
        }
        else if (configured && 'error' in configured) {
            this.logUnavailable(configured.error);
        }
        const packagedDll = this.resolveFirstExisting(this.packagedCliDllCandidates);
        if (packagedDll) {
            this.resolvedCliDllPath = packagedDll;
            this.markAvailable(`project-conventions core-cli resolved source=packaged path='${packagedDll}'`);
            return true;
        }
        const projectCandidates = this.resolveCliProjectCandidates(workspaceRoot);
        const cliProjectPath = this.resolveFirstExisting(projectCandidates);
        if (!cliProjectPath) {
            const preview = projectCandidates.slice(0, 6).join(' | ');
            const reason = `CLI project not found (workspaceRoot=${workspaceRoot ?? 'n/a'}; candidates=${preview || 'none'})`;
            this.logUnavailable(reason);
            return false;
        }
        const existingPath = this.resolveBuiltDllPath(node_path_1.default.dirname(cliProjectPath));
        if (existingPath) {
            this.resolvedCliDllPath = existingPath;
            this.markAvailable(`project-conventions core-cli resolved source=existing-build path='${existingPath}'`);
            return true;
        }
        try {
            const { stderr } = await execFileAsync('dotnet', ['build', cliProjectPath, '-c', 'Release', '--nologo'], {
                windowsHide: true,
                timeout: 60_000,
                maxBuffer: 8 * 1024 * 1024
            });
            if (stderr?.trim()) {
                this.log(`project-conventions core-cli build stderr=${stderr.trim()}`);
            }
        }
        catch (error) {
            this.logUnavailable(String(error));
            return false;
        }
        const resolvedAfterBuild = this.resolveBuiltDllPath(node_path_1.default.dirname(cliProjectPath));
        if (!resolvedAfterBuild) {
            this.logUnavailable(`CLI DLL not found after build for project: ${cliProjectPath}`);
            return false;
        }
        this.resolvedCliDllPath = resolvedAfterBuild;
        this.markAvailable(`project-conventions core-cli resolved source=built path='${resolvedAfterBuild}'`);
        return true;
    }
    async ensureBuiltFromProjectPath(cliProjectPath, source) {
        const projectDirectory = node_path_1.default.dirname(cliProjectPath);
        const existingPath = this.resolveBuiltDllPath(projectDirectory);
        if (existingPath) {
            this.resolvedCliDllPath = existingPath;
            this.markAvailable(`project-conventions core-cli resolved source=${source}-existing-build path='${existingPath}'`);
            return true;
        }
        try {
            const { stderr } = await execFileAsync('dotnet', ['build', cliProjectPath, '-c', 'Release', '--nologo'], {
                windowsHide: true,
                timeout: 60_000,
                maxBuffer: 8 * 1024 * 1024
            });
            if (stderr?.trim()) {
                this.log(`project-conventions core-cli build stderr=${stderr.trim()}`);
            }
        }
        catch (error) {
            this.logUnavailable(`configured CLI project build failed path='${cliProjectPath}' reason='${String(error)}'`);
            return false;
        }
        const resolvedAfterBuild = this.resolveBuiltDllPath(projectDirectory);
        if (!resolvedAfterBuild) {
            this.logUnavailable(`configured CLI DLL not found after build for project: ${cliProjectPath}`);
            return false;
        }
        this.resolvedCliDllPath = resolvedAfterBuild;
        this.markAvailable(`project-conventions core-cli resolved source=${source}-built path='${resolvedAfterBuild}'`);
        return true;
    }
    resolveBuiltDllPath(projectDirectory) {
        const candidates = CLI_TARGET_FRAMEWORKS.map((framework) => node_path_1.default.join(projectDirectory, 'bin', 'Release', framework, CLI_DLL_NAME));
        return this.resolveFirstExisting(candidates);
    }
    resolveCliProjectCandidates(workspaceRoot) {
        const roots = [];
        const seenRoots = new Set();
        const addRoot = (value) => {
            const normalized = node_path_1.default.resolve(value);
            if (seenRoots.has(normalized)) {
                return;
            }
            seenRoots.add(normalized);
            roots.push(normalized);
        };
        if (workspaceRoot?.trim()) {
            for (const ancestor of this.collectAncestorRoots(workspaceRoot.trim(), 8)) {
                addRoot(ancestor);
            }
        }
        for (const extensionRoot of this.extensionSearchRoots) {
            addRoot(extensionRoot);
        }
        const candidates = [];
        const seenCandidates = new Set();
        const addCandidate = (value) => {
            const normalized = node_path_1.default.normalize(value);
            if (seenCandidates.has(normalized)) {
                return;
            }
            seenCandidates.add(normalized);
            candidates.push(normalized);
        };
        for (const root of roots) {
            addCandidate(node_path_1.default.join(root, 'src', CLI_PROJECT_NAME, CLI_PROJECT_FILE));
            addCandidate(node_path_1.default.join(root, CLI_PROJECT_NAME, CLI_PROJECT_FILE));
        }
        return candidates;
    }
    collectAncestorRoots(start, maxDepth) {
        const output = [];
        let current = node_path_1.default.resolve(start);
        for (let depth = 0; depth <= maxDepth; depth += 1) {
            output.push(current);
            const next = node_path_1.default.dirname(current);
            if (next === current) {
                break;
            }
            current = next;
        }
        return output;
    }
    extractWorkspaceRoot(payload) {
        if (!payload || typeof payload !== 'object') {
            return undefined;
        }
        const value = payload.WorkspaceRoot;
        if (typeof value !== 'string' || !value.trim()) {
            return undefined;
        }
        return value.trim();
    }
    resolveFirstExisting(candidates) {
        return candidates.find((candidate) => node_fs_1.default.existsSync(candidate) && !this.incompatibleCliDllPaths.has(node_path_1.default.resolve(candidate)));
    }
    resolveConfiguredCliPath() {
        const raw = this.getConfiguredCliPath?.()?.trim();
        if (!raw) {
            return undefined;
        }
        const fullPath = node_path_1.default.resolve(raw);
        if (!node_fs_1.default.existsSync(fullPath)) {
            return { error: `configured coreCliPath does not exist: ${fullPath}` };
        }
        const stat = node_fs_1.default.statSync(fullPath);
        if (stat.isDirectory()) {
            const dllCandidate = this.resolveFirstExisting([
                node_path_1.default.join(fullPath, CLI_DLL_NAME),
                ...CLI_TARGET_FRAMEWORKS.map((framework) => node_path_1.default.join(fullPath, framework, CLI_DLL_NAME)),
                ...CLI_TARGET_FRAMEWORKS.map((framework) => node_path_1.default.join(fullPath, 'bin', 'Release', framework, CLI_DLL_NAME))
            ]);
            if (dllCandidate) {
                return { dllPath: dllCandidate };
            }
            const projectCandidate = node_path_1.default.join(fullPath, CLI_PROJECT_FILE);
            if (node_fs_1.default.existsSync(projectCandidate)) {
                return { projectPath: projectCandidate };
            }
            return { error: `configured coreCliPath directory has no CLI DLL or csproj: ${fullPath}` };
        }
        const extension = node_path_1.default.extname(fullPath).toLowerCase();
        if (extension === '.dll') {
            return { dllPath: fullPath };
        }
        if (extension === '.csproj') {
            return { projectPath: fullPath };
        }
        return { error: `configured coreCliPath must point to a .dll, .csproj, or folder: ${fullPath}` };
    }
    markAvailable(message) {
        this.unavailableReason = undefined;
        this.lastUnavailableReason = undefined;
        this.log(message);
    }
    logUnavailable(reason) {
        const normalized = reason.trim();
        this.unavailableReason = normalized;
        if (this.lastUnavailableReason === normalized) {
            return;
        }
        this.lastUnavailableReason = normalized;
        this.log(`project-conventions core-cli unavailable reason='${normalized}'`);
    }
    handleRuntimeMismatch(error) {
        const message = String(error);
        if (!message.includes('You must install or update .NET to run this application') ||
            !this.resolvedCliDllPath) {
            return false;
        }
        const incompatiblePath = node_path_1.default.resolve(this.resolvedCliDllPath);
        this.incompatibleCliDllPaths.add(incompatiblePath);
        this.log(`project-conventions core-cli runtime mismatch path='${incompatiblePath}' action='retrying-alternate-artifact'`);
        this.resolvedCliDllPath = undefined;
        return true;
    }
}
exports.CoreConventionCliClient = CoreConventionCliClient;
function resolveRuntimeRidCandidates(platform, architecture) {
    const normalizedArch = architecture.toLowerCase();
    const addCandidates = (all, selected) => {
        for (const rid of selected) {
            if (!all.includes(rid)) {
                all.push(rid);
            }
        }
    };
    const candidates = [];
    switch (platform) {
        case 'win32':
            if (normalizedArch === 'arm64') {
                addCandidates(candidates, ['win-arm64', 'win-x64', 'win-x86']);
            }
            else if (normalizedArch === 'ia32') {
                addCandidates(candidates, ['win-x86', 'win-x64']);
            }
            else {
                addCandidates(candidates, ['win-x64', 'win-x86']);
            }
            break;
        case 'darwin':
            if (normalizedArch === 'arm64') {
                addCandidates(candidates, ['osx-arm64', 'osx-x64']);
            }
            else {
                addCandidates(candidates, ['osx-x64', 'osx-arm64']);
            }
            break;
        default:
            if (normalizedArch === 'arm64') {
                addCandidates(candidates, ['linux-arm64', 'linux-x64', 'linux-x86']);
            }
            else if (normalizedArch === 'ia32') {
                addCandidates(candidates, ['linux-x86', 'linux-x64', 'linux-arm64']);
            }
            else {
                addCandidates(candidates, ['linux-x64', 'linux-arm64', 'linux-x86']);
            }
            break;
    }
    addCandidates(candidates, [...CLI_HOST_RUNTIME_IDENTIFIERS]);
    return candidates;
}
function workspaceRootTaskKey(workspaceRoot) {
    return workspaceRoot?.trim()
        ? `workspace:${node_path_1.default.resolve(workspaceRoot.trim())}`
        : 'workspace:unknown';
}
function parseWorkspaceRootFromTaskKey(taskKey) {
    const prefix = 'workspace:';
    if (!taskKey.startsWith(prefix)) {
        return undefined;
    }
    const value = taskKey.slice(prefix.length);
    return value === 'unknown' ? undefined : value;
}
//# sourceMappingURL=coreCliClient.js.map