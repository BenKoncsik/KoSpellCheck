import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CLI_PROJECT_NAME = 'KoSpellCheck.ProjectConventions.Cli';
const CLI_PROJECT_FILE = `${CLI_PROJECT_NAME}.csproj`;
const CLI_DLL_NAME = `${CLI_PROJECT_NAME}.dll`;
const CLI_TARGET_FRAMEWORKS = ['net9.0', 'net8.0'] as const;
const CLI_HOST_RUNTIME_IDENTIFIERS = ['win-x64', 'win-arm64', 'win-x86', 'linux-x64', 'linux-arm64', 'linux-x86', 'osx-x64', 'osx-arm64'] as const;

type LogFn = (message: string) => void;
type ConfiguredCliPathProvider = () => string | undefined;

export interface CoreCliProfileBuildRequest {
  WorkspaceRoot: string;
  Scope: string;
  Options: Record<string, unknown>;
  PersistArtifacts: boolean;
}

export interface CoreCliAnalyzeRequest {
  WorkspaceRoot: string;
  FilePath: string;
  FileContent?: string;
  Options: Record<string, unknown>;
  Profile?: unknown;
  IgnoreList?: unknown;
  CoralRuntime?: {
    Available: boolean;
    AdapterPath?: string;
    RuntimeRoot?: string;
    Detail: string;
  };
}

export interface CoreCliIgnoreRequest {
  WorkspaceRoot: string;
  RuleId: string;
  Scope: 'file' | 'folder' | 'project';
  Target: string;
  Options: Record<string, unknown>;
}

export class CoreConventionCliClient {
  private readonly packagedCliDllCandidates: string[];
  private readonly extensionSearchRoots: string[];
  private resolvedCliDllPath?: string;
  private readonly incompatibleCliDllPaths = new Set<string>();
  private readonly ensureBuiltTasks = new Map<string, Promise<boolean>>();
  private unavailableReason?: string;
  private lastUnavailableReason?: string;

  constructor(
    private readonly extensionPath: string,
    private readonly log: LogFn,
    private readonly getConfiguredCliPath?: ConfiguredCliPathProvider
  ) {
    const ridCandidates = resolveRuntimeRidCandidates(process.platform, process.arch);
    const packagedHostCandidates = ridCandidates.flatMap((rid) => {
      const candidates: string[] = [];
      for (const framework of CLI_TARGET_FRAMEWORKS) {
        candidates.push(
          path.join(
            this.extensionPath,
            'resources',
            'projectConventions',
            'core-cli',
            'hosts',
            rid,
            framework,
            CLI_DLL_NAME
          )
        );
      }

      candidates.push(
        path.join(
          this.extensionPath,
          'resources',
          'projectConventions',
          'core-cli',
          'hosts',
          rid,
          CLI_DLL_NAME
        )
      );
      return candidates;
    });

    this.packagedCliDllCandidates = [
      ...packagedHostCandidates,
      ...CLI_TARGET_FRAMEWORKS.map((framework) =>
        path.join(
          this.extensionPath,
          'resources',
          'projectConventions',
          'core-cli',
          framework,
          CLI_DLL_NAME
        )
      ),
      path.join(
        this.extensionPath,
        'resources',
        'projectConventions',
        'core-cli',
        CLI_DLL_NAME
      )
    ];
    this.extensionSearchRoots = [
      path.resolve(this.extensionPath),
      path.resolve(this.extensionPath, '..'),
      path.resolve(this.extensionPath, '..', '..')
    ];
  }

  public async buildProfile(
    request: CoreCliProfileBuildRequest
  ): Promise<Record<string, unknown> | undefined> {
    return this.runCommand('profile', request);
  }

  public async analyze(
    request: CoreCliAnalyzeRequest
  ): Promise<Record<string, unknown> | undefined> {
    return this.runCommand('analyze', request);
  }

  public async ignore(
    request: CoreCliIgnoreRequest
  ): Promise<boolean> {
    const response = await this.runCommand('ignore', request);
    return !!response;
  }

  private async runCommand(
    command: 'profile' | 'analyze' | 'ignore',
    payload: unknown
  ): Promise<Record<string, unknown> | undefined> {
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

      const tempPath = path.join(
        os.tmpdir(),
        `kospellcheck-conventions-${command}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
      );

      try {
        fs.writeFileSync(tempPath, JSON.stringify(payload), 'utf8');
        const launchAttempts = this.buildLaunchAttempts(this.resolvedCliDllPath, command, tempPath);
        let runtimeMismatchError: unknown;
        let lastError: unknown;

        for (const launch of launchAttempts) {
          try {
            const { stdout, stderr } = await execFileAsync(
              launch.executable,
              launch.args,
              {
                windowsHide: true,
                timeout: 20_000,
                maxBuffer: 8 * 1024 * 1024
              }
            );

            if (stderr?.trim()) {
              this.log(`project-conventions core-cli stderr=${stderr.trim()}`);
            }

            const raw = stdout?.trim();
            if (!raw) {
              return undefined;
            }

            return JSON.parse(raw) as Record<string, unknown>;
          } catch (error) {
            lastError = error;
            if (
              !runtimeMismatchError &&
              String(error).includes('You must install or update .NET to run this application')
            ) {
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
      } catch (error) {
        this.log(`project-conventions core-cli command=${command} failed reason=${String(error)}`);
        return undefined;
      } finally {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // best-effort cleanup
        }
      }
    }

    return undefined;
  }

  private buildLaunchAttempts(
    cliDllPath: string,
    command: 'profile' | 'analyze' | 'ignore',
    requestPath: string
  ): Array<{ executable: string; args: string[] }> {
    const attempts: Array<{ executable: string; args: string[] }> = [];
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

  private resolveAppHostPath(cliDllPath: string): string | undefined {
    if (!cliDllPath.toLowerCase().endsWith('.dll')) {
      return undefined;
    }

    const appHostBasePath = cliDllPath.slice(0, -4);
    const candidates = process.platform === 'win32'
      ? [`${appHostBasePath}.exe`, appHostBasePath]
      : [appHostBasePath, `${appHostBasePath}.exe`];

    return candidates.find((candidate) => fs.existsSync(candidate));
  }

  private async ensureBuilt(workspaceRoot?: string): Promise<boolean> {
    if (this.resolvedCliDllPath && fs.existsSync(this.resolvedCliDllPath)) {
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

  private async doEnsureBuilt(workspaceRoot?: string): Promise<boolean> {
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
    } else if (configured && 'error' in configured) {
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
      const reason =
        `CLI project not found (workspaceRoot=${workspaceRoot ?? 'n/a'}; candidates=${preview || 'none'})`;
      this.logUnavailable(reason);
      return false;
    }

    const existingPath = this.resolveBuiltDllPath(path.dirname(cliProjectPath));
    if (existingPath) {
      this.resolvedCliDllPath = existingPath;
      this.markAvailable(`project-conventions core-cli resolved source=existing-build path='${existingPath}'`);
      return true;
    }

    try {
      const { stderr } = await execFileAsync(
        'dotnet',
        ['build', cliProjectPath, '-c', 'Release', '--nologo'],
        {
          windowsHide: true,
          timeout: 60_000,
          maxBuffer: 8 * 1024 * 1024
        }
      );
      if (stderr?.trim()) {
        this.log(`project-conventions core-cli build stderr=${stderr.trim()}`);
      }
    } catch (error) {
      this.logUnavailable(String(error));
      return false;
    }

    const resolvedAfterBuild = this.resolveBuiltDllPath(path.dirname(cliProjectPath));
    if (!resolvedAfterBuild) {
      this.logUnavailable(`CLI DLL not found after build for project: ${cliProjectPath}`);
      return false;
    }

    this.resolvedCliDllPath = resolvedAfterBuild;
    this.markAvailable(`project-conventions core-cli resolved source=built path='${resolvedAfterBuild}'`);
    return true;
  }

  private async ensureBuiltFromProjectPath(
    cliProjectPath: string,
    source: 'configured'
  ): Promise<boolean> {
    const projectDirectory = path.dirname(cliProjectPath);
    const existingPath = this.resolveBuiltDllPath(projectDirectory);
    if (existingPath) {
      this.resolvedCliDllPath = existingPath;
      this.markAvailable(`project-conventions core-cli resolved source=${source}-existing-build path='${existingPath}'`);
      return true;
    }

    try {
      const { stderr } = await execFileAsync(
        'dotnet',
        ['build', cliProjectPath, '-c', 'Release', '--nologo'],
        {
          windowsHide: true,
          timeout: 60_000,
          maxBuffer: 8 * 1024 * 1024
        }
      );
      if (stderr?.trim()) {
        this.log(`project-conventions core-cli build stderr=${stderr.trim()}`);
      }
    } catch (error) {
      this.logUnavailable(
        `configured CLI project build failed path='${cliProjectPath}' reason='${String(error)}'`
      );
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

  private resolveBuiltDllPath(projectDirectory: string): string | undefined {
    const candidates = CLI_TARGET_FRAMEWORKS.map((framework) =>
      path.join(projectDirectory, 'bin', 'Release', framework, CLI_DLL_NAME)
    );
    return this.resolveFirstExisting(candidates);
  }

  private resolveCliProjectCandidates(workspaceRoot?: string): string[] {
    const roots: string[] = [];
    const seenRoots = new Set<string>();
    const addRoot = (value: string): void => {
      const normalized = path.resolve(value);
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

    const candidates: string[] = [];
    const seenCandidates = new Set<string>();
    const addCandidate = (value: string): void => {
      const normalized = path.normalize(value);
      if (seenCandidates.has(normalized)) {
        return;
      }

      seenCandidates.add(normalized);
      candidates.push(normalized);
    };

    for (const root of roots) {
      addCandidate(path.join(root, 'src', CLI_PROJECT_NAME, CLI_PROJECT_FILE));
      addCandidate(path.join(root, CLI_PROJECT_NAME, CLI_PROJECT_FILE));
    }

    return candidates;
  }

  private collectAncestorRoots(start: string, maxDepth: number): string[] {
    const output: string[] = [];
    let current = path.resolve(start);

    for (let depth = 0; depth <= maxDepth; depth += 1) {
      output.push(current);
      const next = path.dirname(current);
      if (next === current) {
        break;
      }

      current = next;
    }

    return output;
  }

  private extractWorkspaceRoot(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const value = (payload as { WorkspaceRoot?: unknown }).WorkspaceRoot;
    if (typeof value !== 'string' || !value.trim()) {
      return undefined;
    }

    return value.trim();
  }

  private resolveFirstExisting(candidates: string[]): string | undefined {
    return candidates.find(
      (candidate) => fs.existsSync(candidate) && !this.incompatibleCliDllPaths.has(path.resolve(candidate))
    );
  }

  private resolveConfiguredCliPath():
    | { dllPath: string }
    | { projectPath: string }
    | { error: string }
    | undefined {
    const raw = this.getConfiguredCliPath?.()?.trim();
    if (!raw) {
      return undefined;
    }

    const fullPath = path.resolve(raw);
    if (!fs.existsSync(fullPath)) {
      return { error: `configured coreCliPath does not exist: ${fullPath}` };
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const dllCandidate = this.resolveFirstExisting([
        path.join(fullPath, CLI_DLL_NAME),
        ...CLI_TARGET_FRAMEWORKS.map((framework) => path.join(fullPath, framework, CLI_DLL_NAME)),
        ...CLI_TARGET_FRAMEWORKS.map((framework) =>
          path.join(fullPath, 'bin', 'Release', framework, CLI_DLL_NAME)
        )
      ]);
      if (dllCandidate) {
        return { dllPath: dllCandidate };
      }

      const projectCandidate = path.join(fullPath, CLI_PROJECT_FILE);
      if (fs.existsSync(projectCandidate)) {
        return { projectPath: projectCandidate };
      }

      return { error: `configured coreCliPath directory has no CLI DLL or csproj: ${fullPath}` };
    }

    const extension = path.extname(fullPath).toLowerCase();
    if (extension === '.dll') {
      return { dllPath: fullPath };
    }
    if (extension === '.csproj') {
      return { projectPath: fullPath };
    }

    return { error: `configured coreCliPath must point to a .dll, .csproj, or folder: ${fullPath}` };
  }

  private markAvailable(message: string): void {
    this.unavailableReason = undefined;
    this.lastUnavailableReason = undefined;
    this.log(message);
  }

  private logUnavailable(reason: string): void {
    const normalized = reason.trim();
    this.unavailableReason = normalized;
    if (this.lastUnavailableReason === normalized) {
      return;
    }

    this.lastUnavailableReason = normalized;
    this.log(`project-conventions core-cli unavailable reason='${normalized}'`);
  }

  private handleRuntimeMismatch(error: unknown): boolean {
    const message = String(error);
    if (
      !message.includes('You must install or update .NET to run this application') ||
      !this.resolvedCliDllPath
    ) {
      return false;
    }

    const incompatiblePath = path.resolve(this.resolvedCliDllPath);
    this.incompatibleCliDllPaths.add(incompatiblePath);
    this.log(
      `project-conventions core-cli runtime mismatch path='${incompatiblePath}' action='retrying-alternate-artifact'`
    );
    this.resolvedCliDllPath = undefined;
    return true;
  }
}

function resolveRuntimeRidCandidates(platform: NodeJS.Platform, architecture: string): string[] {
  const normalizedArch = architecture.toLowerCase();
  const addCandidates = (all: string[], selected: string[]) => {
    for (const rid of selected) {
      if (!all.includes(rid)) {
        all.push(rid);
      }
    }
  };

  const candidates: string[] = [];
  switch (platform) {
    case 'win32':
      if (normalizedArch === 'arm64') {
        addCandidates(candidates, ['win-arm64', 'win-x64', 'win-x86']);
      } else if (normalizedArch === 'ia32') {
        addCandidates(candidates, ['win-x86', 'win-x64']);
      } else {
        addCandidates(candidates, ['win-x64', 'win-x86']);
      }
      break;
    case 'darwin':
      if (normalizedArch === 'arm64') {
        addCandidates(candidates, ['osx-arm64', 'osx-x64']);
      } else {
        addCandidates(candidates, ['osx-x64', 'osx-arm64']);
      }
      break;
    default:
      if (normalizedArch === 'arm64') {
        addCandidates(candidates, ['linux-arm64', 'linux-x64', 'linux-x86']);
      } else if (normalizedArch === 'ia32') {
        addCandidates(candidates, ['linux-x86', 'linux-x64', 'linux-arm64']);
      } else {
        addCandidates(candidates, ['linux-x64', 'linux-arm64', 'linux-x86']);
      }
      break;
  }

  addCandidates(candidates, [...CLI_HOST_RUNTIME_IDENTIFIERS]);
  return candidates;
}

function workspaceRootTaskKey(workspaceRoot?: string): string {
  return workspaceRoot?.trim()
    ? `workspace:${path.resolve(workspaceRoot.trim())}`
    : 'workspace:unknown';
}

function parseWorkspaceRootFromTaskKey(taskKey: string): string | undefined {
  const prefix = 'workspace:';
  if (!taskKey.startsWith(prefix)) {
    return undefined;
  }

  const value = taskKey.slice(prefix.length);
  return value === 'unknown' ? undefined : value;
}
