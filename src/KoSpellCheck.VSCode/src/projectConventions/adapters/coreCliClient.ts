import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type LogFn = (message: string) => void;

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
  private readonly cliProjectPath: string;
  private readonly cliDllCandidates: string[];
  private resolvedCliDllPath?: string;
  private ensureBuiltTask?: Promise<boolean>;
  private unavailableReason?: string;

  constructor(private readonly extensionPath: string, private readonly log: LogFn) {
    const srcRoot = path.resolve(this.extensionPath, '..');
    this.cliProjectPath = path.join(
      srcRoot,
      'KoSpellCheck.ProjectConventions.Cli',
      'KoSpellCheck.ProjectConventions.Cli.csproj'
    );
    this.cliDllCandidates = ['net9.0', 'net8.0'].map((framework) =>
      path.join(
        srcRoot,
        'KoSpellCheck.ProjectConventions.Cli',
        'bin',
        'Release',
        framework,
        'KoSpellCheck.ProjectConventions.Cli.dll'
      )
    );
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
    const available = await this.ensureBuilt();
    if (!available) {
      return undefined;
    }
    if (!this.resolvedCliDllPath) {
      this.log('project-conventions core-cli unavailable reason=missing resolved CLI path');
      return undefined;
    }

    const tempPath = path.join(
      os.tmpdir(),
      `kospellcheck-conventions-${command}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
    );

    try {
      fs.writeFileSync(tempPath, JSON.stringify(payload), 'utf8');
      const { stdout, stderr } = await execFileAsync(
        'dotnet',
        [this.resolvedCliDllPath, command, '--request', tempPath],
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

  private async ensureBuilt(): Promise<boolean> {
    if (this.ensureBuiltTask) {
      return this.ensureBuiltTask;
    }

    this.ensureBuiltTask = this.doEnsureBuilt();
    return this.ensureBuiltTask;
  }

  private async doEnsureBuilt(): Promise<boolean> {
    if (!fs.existsSync(this.cliProjectPath)) {
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
      const { stderr } = await execFileAsync(
        'dotnet',
        ['build', this.cliProjectPath, '-c', 'Release', '--nologo'],
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

  private resolveBuiltDllPath(): string | undefined {
    return this.cliDllCandidates.find((candidate) => fs.existsSync(candidate));
  }
}
