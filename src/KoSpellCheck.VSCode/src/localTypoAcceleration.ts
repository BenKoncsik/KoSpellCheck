import fs from 'node:fs';
import crypto from 'node:crypto';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import * as vscode from 'vscode';
import {
  AcceleratorAvailabilityResult,
  AcceleratorAvailabilityStatus,
  IAcceleratorAvailabilityService,
  IAcceleratorNotificationService,
  ILocalTypoClassifier,
  KoSpellCheckConfig,
  SpellIssue,
  Suggestion,
  TypoClassificationCategory,
  TypoClassificationRequest,
  TypoClassificationResult,
  TypoAccelerationMode
} from './types';

type ContextResolver = (range: vscode.Range) => 'identifier' | 'literal';
type LogFn = (message: string, uri?: vscode.Uri, force?: boolean) => void;

const DETECTION_CACHE_TTL_MS = 60_000;
const DOWNLOAD_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const PROVIDER_ID = 'google-coral-edgetpu';
const LINUX_ACCELERATOR_PATHS = ['/dev/apex_0', '/dev/apex_1'];
const DEFAULT_RUNTIME_BASE_URL =
  'https://raw.githubusercontent.com/BenKoncsik/KoSpellCheck/main/Coral-tpu';

type RuntimePlatformFolder = 'MacOs' | 'Linux' | 'Windows';

interface RuntimeManifestFile {
  path: string;
  url: string;
  sha256?: string;
}

interface RuntimeManifest {
  schemaVersion: number;
  platform: string;
  arch?: string;
  runtimeVersion?: string;
  files: RuntimeManifestFile[];
}

interface LocalRuntimeStatus {
  present: boolean;
  detail: string;
  runtimeRoot?: string;
}

export class LocalTypoAccelerationController {
  private readonly runtimeProvisioner: GitHubRuntimeProvisioner;
  private readonly availabilityService: IAcceleratorAvailabilityService;
  private readonly classifier: ILocalTypoClassifier;
  private readonly notificationService: IAcceleratorNotificationService;
  private readonly log: LogFn;
  private lastAvailability?: AcceleratorAvailabilityStatus;
  private lastPath?: 'off' | 'fallback' | 'accelerated';
  private lastStatusSignature?: string;
  private hadAcceleratorPath = false;

  constructor(context: vscode.ExtensionContext, _extensionPath: string, log: LogFn) {
    this.runtimeProvisioner = new GitHubRuntimeProvisioner(context, log);
    this.availabilityService = new CoralAcceleratorAvailabilityService(this.runtimeProvisioner);
    this.classifier = new HeuristicLocalTypoClassifier();
    this.notificationService = new VscodeAcceleratorNotificationService(context, log);
    this.log = log;
  }

  public requestRuntimeDownload(
    config: KoSpellCheckConfig,
    uri?: vscode.Uri,
    force = false
  ): void {
    this.runtimeProvisioner.ensureRuntimeDownloaded(config, uri, force);
  }

  public inspectAvailability(forceRefresh = false): AcceleratorAvailabilityResult {
    return this.availabilityService.getAvailability(forceRefresh);
  }

  public applyToIssues(
    document: vscode.TextDocument,
    issues: SpellIssue[],
    config: KoSpellCheckConfig,
    resolveContext: ContextResolver
  ): SpellIssue[] {
    if (config.localTypoAccelerationMode !== 'off') {
      this.runtimeProvisioner.ensureRuntimeDownloaded(config, document.uri);
    }

    if (config.localTypoAccelerationMode === 'off') {
      this.logStatus(
        {
          status: 'Unavailable',
          provider: PROVIDER_ID,
          detail: 'mode=off',
          detectedAtUtc: new Date().toISOString()
        },
        config,
        document.uri
      );
      this.logPath('off', config, document.uri);
      this.hadAcceleratorPath = false;
      return issues;
    }

    this.trace('local-typo-acceleration detection started', config, document.uri);
    const availability = this.availabilityService.getAvailability();
    this.logStatus(availability, config, document.uri);
    if (this.lastAvailability !== availability.status || availability.status === 'Error') {
      this.log(
        `local-typo-acceleration detection result status=${availability.status} provider=${availability.provider} detail=${availability.detail ?? 'n/a'}`,
        document.uri,
        false
      );
      if (availability.status === 'Error') {
        this.log(
          'local-typo-acceleration detection failed; fallback activated',
          document.uri,
          true
        );
      } else if (availability.status === 'Available') {
        this.log('local-typo-acceleration detection succeeded', document.uri, true);
      }
    }
    this.lastAvailability = availability.status;

    if (availability.status !== 'Available') {
      if (this.hadAcceleratorPath) {
        this.log(
          `local-typo-acceleration became unavailable status=${availability.status}; fallback activated`,
          document.uri,
          true
        );
      }

      this.hadAcceleratorPath = false;
      this.logPath('fallback', config, document.uri);
      if (config.localTypoAccelerationMode === 'on') {
        this.notificationService.notifyOnModeUnavailable(availability.status);
      }

      return issues;
    }

    this.log(
      'local-typo-acceleration coral-communication status=active typo-classifier-backend=heuristic-local (Coral model adapter pending integration)',
      document.uri,
      false
    );

    if (config.localTypoAccelerationMode === 'auto') {
      this.notificationService.notifyAutoModeDetection(
        config.localTypoAccelerationMode,
        config.localTypoAccelerationShowDetectionPrompt
      );
    }

    this.hadAcceleratorPath = true;
    this.logPath('accelerated', config, document.uri);
    return this.classifyIssues(document, issues, resolveContext, config);
  }

  private classifyIssues(
    document: vscode.TextDocument,
    issues: SpellIssue[],
    resolveContext: ContextResolver,
    config: KoSpellCheckConfig
  ): SpellIssue[] {
    const output: SpellIssue[] = [];
    let suppressed = 0;
    let misspellCount = 0;

    for (const issue of issues) {
      if (issue.type !== 'misspell') {
        output.push(issue);
        continue;
      }
      misspellCount += 1;

      const range = new vscode.Range(
        document.positionAt(issue.start),
        document.positionAt(issue.end)
      );
      const context = resolveContext(range);
      const result = this.classifier.classify({
        token: issue.token,
        suggestions: issue.suggestions,
        context
      });

      this.trace(
        `local-typo-acceleration classify token='${issue.token}' category=${result.category} confidence=${result.confidence.toFixed(2)} backend=${result.backend}`,
        config,
        document.uri
      );

      if (result.category === 'NotTypo' && result.confidence >= 0.65) {
        suppressed += 1;
        this.trace(
          `local-typo-acceleration decision token='${issue.token}' topSuggestion='${topSuggestionText(issue.suggestions)}' action=suppress category=${result.category} confidence=${result.confidence.toFixed(2)}`,
          config,
          document.uri
        );
        continue;
      }

      const message =
        result.category === 'Uncertain'
          ? `Low-confidence typo signal: ${issue.message}`
          : issue.message;
      this.trace(
        `local-typo-acceleration decision token='${issue.token}' topSuggestion='${topSuggestionText(issue.suggestions)}' action=keep category=${result.category} confidence=${result.confidence.toFixed(2)}`,
        config,
        document.uri
      );
      output.push({
        ...issue,
        message,
        typoClassification: result
      });
    }

    this.log(
      `local-typo-acceleration summary misspell=${misspellCount} kept=${misspellCount - suppressed} suppressed=${suppressed} suggestionsSource=KoSpellCheck spell engine acceleratorRole=typo-gate`,
      document.uri,
      false
    );

    return output;
  }

  private logPath(pathValue: 'off' | 'fallback' | 'accelerated', config: KoSpellCheckConfig, uri: vscode.Uri): void {
    if (this.lastPath === pathValue && !config.localTypoAccelerationVerboseLogging) {
      return;
    }

    this.lastPath = pathValue;
    this.log(
      `local-typo-acceleration classification path=${pathValue} (acceleratorRole=typo-gate suggestionsSource=KoSpellCheck spell engine)`,
      uri,
      false
    );
  }

  private logStatus(
    availability: AcceleratorAvailabilityResult,
    config: KoSpellCheckConfig,
    uri: vscode.Uri
  ): void {
    const signature = [
      config.localTypoAccelerationMode,
      availability.status,
      availability.provider,
      availability.detail ?? ''
    ].join('|');
    if (signature === this.lastStatusSignature && !config.localTypoAccelerationVerboseLogging) {
      return;
    }

    this.lastStatusSignature = signature;
    this.log(
      `local-typo-acceleration status mode=${config.localTypoAccelerationMode} availability=${availability.status} provider=${availability.provider} detail=${availability.detail ?? 'n/a'}`,
      uri,
      false
    );

    if (availability.status === 'UnavailableMissingRuntime') {
      this.log(
        'local-typo-acceleration info: Coral runtime hiányzik; automatikus letöltés (ha engedélyezett) a KoSpellCheck GitHub Coral-tpu mappájából próbálkozik. TPU communication=inactive.',
        uri,
        false
      );
    }
  }

  private trace(message: string, config: KoSpellCheckConfig, uri?: vscode.Uri): void {
    if (!config.localTypoAccelerationVerboseLogging) {
      return;
    }

    this.log(message, uri);
  }
}

class CoralAcceleratorAvailabilityService implements IAcceleratorAvailabilityService {
  private readonly runtimeProvisioner: GitHubRuntimeProvisioner;
  private cached?: AcceleratorAvailabilityResult;
  private cachedAt = 0;

  constructor(runtimeProvisioner: GitHubRuntimeProvisioner) {
    this.runtimeProvisioner = runtimeProvisioner;
  }

  public getAvailability(forceRefresh = false): AcceleratorAvailabilityResult {
    const now = Date.now();
    if (!forceRefresh && this.cached && now - this.cachedAt <= DETECTION_CACHE_TTL_MS) {
      return this.cached;
    }

    const detected = this.detect();
    this.cached = detected;
    this.cachedAt = now;
    return detected;
  }

  private detect(): AcceleratorAvailabilityResult {
    try {
      if (process.env.KOSPELLCHECK_LOCAL_ACCELERATOR_FORCE_AVAILABLE === '1') {
        return this.result('Available', 'forced-by-env');
      }

      const runtimeStatus = this.runtimeProvisioner.getRuntimeStatus();
      if (!runtimeStatus.present) {
        return this.result(
          'UnavailableMissingRuntime',
          runtimeStatus.detail
        );
      }

      if (process.platform === 'darwin') {
        const probe = probeCoralOnMacOs();
        if (!probe.available) {
          return this.result('Unavailable', probe.detail);
        }

        return this.result(
          'Available',
          `${probe.detail}; runtimeRoot='${runtimeStatus.runtimeRoot ?? 'n/a'}'`
        );
      }

      if (process.platform === 'linux') {
        const foundDevice = LINUX_ACCELERATOR_PATHS.find((item) => fs.existsSync(item));
        if (!foundDevice) {
          return this.result('Unavailable', 'no Coral Edge TPU device node found (/dev/apex_*)');
        }

        return this.result(
          'Available',
          `detected '${foundDevice}'; runtimeRoot='${runtimeStatus.runtimeRoot ?? 'n/a'}'`
        );
      }

      return this.result(
        'UnavailableUnsupportedPlatform',
        `platform '${process.platform}' not wired yet`
      );
    } catch (error) {
      return this.result('Error', formatError(error));
    }
  }

  private result(status: AcceleratorAvailabilityStatus, detail?: string): AcceleratorAvailabilityResult {
    return {
      status,
      provider: PROVIDER_ID,
      detail,
      detectedAtUtc: new Date().toISOString()
    };
  }
}

class GitHubRuntimeProvisioner {
  private readonly log: LogFn;
  private readonly installRoot: string;
  private readonly runtimeBaseUrl: string;
  private downloadInFlight?: Promise<void>;
  private lastDownloadAttemptAt = 0;

  constructor(context: vscode.ExtensionContext, log: LogFn) {
    this.log = log;
    this.installRoot = path.join(context.globalStorageUri.fsPath, 'coral-tpu-runtime');
    this.runtimeBaseUrl = DEFAULT_RUNTIME_BASE_URL;
  }

  public getRuntimeStatus(): LocalRuntimeStatus {
    const folder = platformFolderForCurrentPlatform();
    if (!folder) {
      return {
        present: false,
        detail: `platform '${process.platform}' nem támogatott a Coral runtime letöltőben`
      };
    }

    return this.getRuntimeStatusFor(folder, process.arch);
  }

  public ensureRuntimeDownloaded(
    config: KoSpellCheckConfig,
    uri?: vscode.Uri,
    force = false
  ): void {
    if (!force && !config.localTypoAccelerationAutoDownloadRuntime) {
      return;
    }

    const folder = platformFolderForCurrentPlatform();
    if (!folder) {
      return;
    }

    const current = this.getRuntimeStatusFor(folder, process.arch);
    if (current.present && !force) {
      return;
    }

    const now = Date.now();
    if (!force) {
      if (this.downloadInFlight) {
        return;
      }

      if (now - this.lastDownloadAttemptAt < DOWNLOAD_RETRY_INTERVAL_MS) {
        return;
      }
    }

    this.lastDownloadAttemptAt = now;
    this.log(
      `local-typo-acceleration runtime-download start source=${this.runtimeBaseUrl}/${folder}/runtime-manifest.json platform=${process.platform} arch=${process.arch} force=${force}`,
      uri,
      false
    );

    this.downloadInFlight = this.downloadRuntime(folder, process.arch)
      .then((runtimeRoot) => {
        this.log(
          `local-typo-acceleration runtime-download success runtimeRoot='${runtimeRoot}'`,
          uri,
          false
        );
      })
      .catch((error) => {
        this.log(
          `local-typo-acceleration runtime-download failed reason=${formatError(error)}`,
          uri,
          false
        );
      })
      .finally(() => {
        this.downloadInFlight = undefined;
      });
  }

  private getRuntimeStatusFor(folder: RuntimePlatformFolder, arch: string): LocalRuntimeStatus {
    const archCandidates = [arch, 'universal'];
    for (const candidateArch of archCandidates) {
      const runtimeRoot = this.getRuntimeRoot(folder, candidateArch);
      const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
      if (!fs.existsSync(manifestPath)) {
        continue;
      }

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RuntimeManifest;
        if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
          return {
            present: false,
            detail: `runtime manifest érvénytelen vagy üres: '${manifestPath}'`
          };
        }

        for (const file of manifest.files) {
          const relative = sanitizeRelativePath(file.path);
          const fullPath = path.join(runtimeRoot, relative);
          if (!fs.existsSync(fullPath)) {
            return {
              present: false,
              detail: `runtime fájl hiányzik: '${fullPath}'`
            };
          }
        }

        return {
          present: true,
          detail: `runtime elérhető: '${runtimeRoot}'`,
          runtimeRoot
        };
      } catch (error) {
        return {
          present: false,
          detail: `runtime manifest olvasási hiba '${manifestPath}': ${formatError(error)}`
        };
      }
    }

    return {
      present: false,
      detail: `runtime nincs telepítve (${folder}/${arch}). Várható manifest: '${path.join(this.getRuntimeRoot(folder, arch), 'runtime-manifest.json')}'`
    };
  }

  private async downloadRuntime(folder: RuntimePlatformFolder, arch: string): Promise<string> {
    const manifestUrl = `${this.runtimeBaseUrl}/${folder}/runtime-manifest.json`;
    const rawManifest = await httpsGetBuffer(manifestUrl);
    const manifest = JSON.parse(rawManifest.toString('utf8')) as RuntimeManifest;

    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new Error(`üres runtime manifest (${manifestUrl})`);
    }

    if (manifest.arch && manifest.arch !== arch && manifest.arch !== 'universal') {
      throw new Error(
        `manifest arch mismatch (manifest=${manifest.arch}, local=${arch})`
      );
    }

    const targetArch = manifest.arch && manifest.arch.length > 0 ? manifest.arch : arch;
    const runtimeRoot = this.getRuntimeRoot(folder, targetArch);
    fs.mkdirSync(runtimeRoot, { recursive: true });

    for (const file of manifest.files) {
      const relativePath = sanitizeRelativePath(file.path);
      const sourceUrl = resolveManifestFileUrl(manifestUrl, file.url);
      const payload = await httpsGetBuffer(sourceUrl);

      if (file.sha256 && file.sha256.trim().length > 0) {
        const actualSha = sha256Hex(payload);
        const expectedSha = file.sha256.trim().toLowerCase();
        if (actualSha !== expectedSha) {
          throw new Error(
            `checksum mismatch '${relativePath}' expected=${expectedSha} actual=${actualSha}`
          );
        }
      }

      const outputPath = path.join(runtimeRoot, relativePath);
      const outputDir = path.dirname(outputPath);
      fs.mkdirSync(outputDir, { recursive: true });
      const tmpPath = `${outputPath}.download`;
      fs.writeFileSync(tmpPath, payload);
      fs.renameSync(tmpPath, outputPath);
    }

    const installedManifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
    const installedManifest = {
      ...manifest,
      downloadedAtUtc: new Date().toISOString(),
      sourceManifestUrl: manifestUrl
    };
    fs.writeFileSync(installedManifestPath, JSON.stringify(installedManifest, null, 2));
    return runtimeRoot;
  }

  private getRuntimeRoot(folder: RuntimePlatformFolder, arch: string): string {
    return path.join(this.installRoot, folder, arch);
  }
}

function platformFolderForCurrentPlatform(): RuntimePlatformFolder | undefined {
  if (process.platform === 'darwin') {
    return 'MacOs';
  }

  if (process.platform === 'linux') {
    return 'Linux';
  }

  if (process.platform === 'win32') {
    return 'Windows';
  }

  return undefined;
}

function probeCoralOnMacOs(): { available: boolean; detail: string } {
  const result = spawnSync('system_profiler', ['SPUSBDataType'], {
    encoding: 'utf8',
    timeout: 7000,
    maxBuffer: 10 * 1024 * 1024
  });

  if (result.error) {
    return {
      available: false,
      detail: `system_profiler hiba: ${formatError(result.error)}`
    };
  }

  if (result.status !== 0) {
    return {
      available: false,
      detail: `system_profiler kilépési kód=${result.status}`
    };
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (/(coral|edge\s*tpu|global\s+unichip)/iu.test(output)) {
    return {
      available: true,
      detail: 'Coral USB eszköz detektálva (system_profiler)'
    };
  }

  return {
    available: false,
    detail: 'Coral USB eszköz nem látható a system_profiler kimenetben'
  };
}

class HeuristicLocalTypoClassifier implements ILocalTypoClassifier {
  public classify(request: TypoClassificationRequest): TypoClassificationResult {
    const token = request.token.trim();
    if (!token) {
      return buildResult(false, 0, 'Uncertain', 'empty-token');
    }

    const normalizedToken = normalizeForMatch(token);
    if (normalizedToken.length < 2) {
      return buildResult(false, 0.45, 'Uncertain', 'too-short');
    }

    const topSuggestion = request.suggestions[0]?.replacement?.trim() ?? '';
    if (!topSuggestion) {
      if (looksLikeDomainToken(token)) {
        return buildResult(false, 0.68, 'NotTypo', 'domain-token-no-suggestion');
      }

      return buildResult(false, 0.5, 'Uncertain', 'no-suggestion');
    }

    const normalizedSuggestion = normalizeForMatch(topSuggestion);
    if (!normalizedSuggestion || normalizedSuggestion === normalizedToken) {
      return buildResult(false, 0.4, 'Uncertain', 'suggestion-equivalent');
    }

    const distance = boundedDamerauLevenshtein(normalizedToken, normalizedSuggestion, 4);
    const maxLength = Math.max(normalizedToken.length, normalizedSuggestion.length);
    const similarity = maxLength === 0 ? 1 : 1 - distance / maxLength;
    const domainToken = looksLikeDomainToken(token);

    let likelyTypo =
      distance <= 1 ||
      (distance === 2 && similarity >= 0.55) ||
      (distance === 3 && similarity >= 0.72 && normalizedToken.length >= 8);
    if (domainToken && distance > 2) {
      likelyTypo = false;
    }

    if (likelyTypo) {
      const category: TypoClassificationCategory =
        request.context === 'identifier' ? 'IdentifierTypo' : 'TextTypo';
      const contextBoost = request.context === 'identifier' ? 0.05 : 0;
      const confidence = clamp(0.62 + (4 - Math.min(distance, 4)) * 0.08 + contextBoost, 0.6, 0.98);
      return buildResult(true, confidence, category, 'distance-match');
    }

    if (domainToken && similarity < 0.5) {
      return buildResult(false, 0.72, 'NotTypo', 'domain-token-low-similarity');
    }

    if (similarity < 0.42) {
      return buildResult(false, 0.66, 'NotTypo', 'low-similarity');
    }

    return buildResult(false, 0.5, 'Uncertain', 'uncertain');
  }
}

class VscodeAcceleratorNotificationService implements IAcceleratorNotificationService {
  private readonly context: vscode.ExtensionContext;
  private readonly log: LogFn;
  private readonly autoPromptKey = 'kospellcheck.localTypoAcceleration.autoPromptShown.v1';
  private readonly onUnavailablePromptKey = 'kospellcheck.localTypoAcceleration.onUnavailablePromptShown.v1';

  constructor(context: vscode.ExtensionContext, log: LogFn) {
    this.context = context;
    this.log = log;
  }

  public notifyAutoModeDetection(mode: TypoAccelerationMode, showPrompt: boolean): void {
    if (mode !== 'auto' || !showPrompt) {
      return;
    }

    if (this.context.globalState.get<boolean>(this.autoPromptKey, false)) {
      return;
    }

    void this.context.globalState.update(this.autoPromptKey, true);
    const enableAlwaysOn = 'Enable Always On';
    const keepAuto = 'Keep Auto';
    void vscode.window
      .showInformationMessage(
        'Local typo accelerator detected. Enable faster local typo classification?',
        enableAlwaysOn,
        keepAuto
      )
      .then((selection) => {
        if (selection !== enableAlwaysOn) {
          return;
        }

        this.log('local-typo-acceleration mode switched to on by user prompt', undefined, true);
        void vscode.workspace
          .getConfiguration('kospellcheck')
          .update('localTypoAcceleration.mode', 'on', vscode.ConfigurationTarget.Global);
      });
  }

  public notifyOnModeUnavailable(status: AcceleratorAvailabilityStatus): void {
    if (this.context.globalState.get<boolean>(this.onUnavailablePromptKey, false)) {
      return;
    }

    void this.context.globalState.update(this.onUnavailablePromptKey, true);
    const detail =
      status === 'UnavailableMissingRuntime'
        ? 'Bundled local runtime is not present in this build.'
        : status === 'UnavailableUnsupportedPlatform'
          ? 'Current platform is not supported by this optional path.'
          : 'A compatible local accelerator is not available right now.';
    void vscode.window.showInformationMessage(
      `KoSpellCheck local typo acceleration is ON, but unavailable. ${detail} Falling back to standard local spell checking.`
    );
  }
}

function buildResult(
  isTypo: boolean,
  confidence: number,
  category: TypoClassificationCategory,
  reason: string
): TypoClassificationResult {
  return {
    isTypo,
    confidence,
    category,
    backend: 'heuristic-local',
    reason
  };
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, '');
}

function looksLikeDomainToken(token: string): boolean {
  if (token.length <= 1) {
    return true;
  }

  const hasDigit = /\d/u.test(token);
  const hasUpper = /\p{Lu}/u.test(token);
  const hasLower = /\p{Ll}/u.test(token);
  const hasUnderscore = token.includes('_');
  const hasDash = token.includes('-');

  if (hasUnderscore || hasDash) {
    return true;
  }

  if (hasDigit && hasUpper) {
    return true;
  }

  return token.length >= 8 && hasUpper && hasLower && !token.includes(' ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function topSuggestionText(suggestions: Suggestion[]): string {
  const top = suggestions[0]?.replacement?.trim();
  return top && top.length > 0 ? top : 'n/a';
}

function sanitizeRelativePath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/gu, '/').trim();
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`érvénytelen runtime path: '${inputPath}'`);
  }

  return normalized;
}

function resolveManifestFileUrl(manifestUrl: string, fileUrl: string): string {
  if (!fileUrl || fileUrl.trim().length === 0) {
    throw new Error('runtime file url hiányzik');
  }

  return new URL(fileUrl, manifestUrl).toString();
}

function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function httpsGetBuffer(url: string, redirectDepth = 0): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    if (redirectDepth > 5) {
      reject(new Error(`túl sok redirect: ${url}`));
      return;
    }

    const target = new URL(url);
    if (target.protocol !== 'https:') {
      reject(new Error(`csak https támogatott: ${url}`));
      return;
    }

    const req = https.get(
      target,
      {
        headers: {
          'User-Agent': 'KoSpellCheck/0.1.10'
        }
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          const redirected = new URL(res.headers.location, target).toString();
          res.resume();
          void httpsGetBuffer(redirected, redirectDepth + 1).then(resolve, reject);
          return;
        }

        if (statusCode !== 200) {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            reject(
              new Error(
                `letöltési hiba status=${statusCode} url=${url} body=${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`
              )
            );
          });
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );

    req.setTimeout(20_000, () => {
      req.destroy(new Error(`időtúllépés: ${url}`));
    });
    req.on('error', reject);
  });
}

function boundedDamerauLevenshtein(left: string, right: string, maxDistance: number): number {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return maxDistance + 1;
  }

  const previousPrevious = new Array<number>(right.length + 1).fill(0);
  let previous = new Array<number>(right.length + 1).fill(0);
  let current = new Array<number>(right.length + 1).fill(0);

  for (let j = 0; j <= right.length; j++) {
    previous[j] = j;
  }

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    let minInRow = current[0];

    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const deletion = previous[j] + 1;
      const insertion = current[j - 1] + 1;
      const substitution = previous[j - 1] + cost;

      let value = Math.min(deletion, insertion, substitution);
      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        value = Math.min(value, previousPrevious[j - 2] + 1);
      }

      current[j] = value;
      if (value < minInRow) {
        minInRow = value;
      }
    }

    if (minInRow > maxDistance) {
      return maxDistance + 1;
    }

    for (let k = 0; k <= right.length; k++) {
      previousPrevious[k] = previous[k];
      previous[k] = current[k];
    }

    current = new Array<number>(right.length + 1).fill(0);
  }

  return previous[right.length];
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
