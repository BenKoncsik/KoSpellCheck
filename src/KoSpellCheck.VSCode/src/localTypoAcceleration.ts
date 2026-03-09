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
import { text } from './sharedUiText';

type ContextResolver = (range: vscode.Range) => 'identifier' | 'literal';
type LogFn = (message: string, uri?: vscode.Uri, force?: boolean) => void;

const DETECTION_CACHE_TTL_MS = 60_000;
const DOWNLOAD_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const CORAL_HEALTH_CHECK_TIMEOUT_MS = 7_000;
const CORAL_CLASSIFY_TIMEOUT_MS = 7_000;
const PROVIDER_ID = 'google-coral-edgetpu';
const LINUX_ACCELERATOR_PATHS = ['/dev/apex_0', '/dev/apex_1'];
const DEFAULT_RUNTIME_BASE_URL =
  'https://raw.githubusercontent.com/BenKoncsik/KoSpellCheck/main/Coral-tpu';

type RuntimePlatformFolder = 'MacOs' | 'Linux' | 'Windows';

interface RuntimeManifestFile {
  path: string;
  url: string;
  sha256?: string;
  executable?: boolean;
}

interface RuntimeManifestModel {
  id: string;
  displayName?: string;
  path: string;
  format?: string;
  description?: string;
  default?: boolean;
}

interface RuntimeManifest {
  schemaVersion: number;
  platform: string;
  arch?: string;
  runtimeVersion?: string;
  files: RuntimeManifestFile[];
  models?: RuntimeManifestModel[];
}

interface LocalRuntimeStatus {
  present: boolean;
  detail: string;
  runtimeRoot?: string;
}

export interface InstalledRuntimeModel {
  id: string;
  displayName: string;
  description?: string;
  format: string;
  relativePath: string;
  absolutePath: string;
  isDefault: boolean;
}

export type RuntimeDownloadPhase = 'started' | 'manifest' | 'file' | 'success' | 'failed';

export interface RuntimeDownloadProgress {
  phase: RuntimeDownloadPhase;
  statusText: string;
  filePath?: string;
  fileIndex?: number;
  fileCount?: number;
  percent?: number;
}

type RuntimeDownloadProgressHandler = (progress: RuntimeDownloadProgress) => void;

export type TypoClassifierBackendKind = 'heuristic-local' | 'coral-process';

export interface TypoClassifierBackendStatus {
  backend: TypoClassifierBackendKind;
  tpuInferenceActive: boolean;
  tfliteRuntimeLoaded?: boolean;
  modelLoadable?: boolean;
  modelPlaceholder?: boolean;
  detail: string;
  runtimeRoot?: string;
  adapterPath?: string;
  modelPath?: string;
  selectedModelId?: string;
  selectedModelDisplayName?: string;
  availableModels?: InstalledRuntimeModel[];
}

export class LocalTypoAccelerationController {
  private readonly runtimeProvisioner: GitHubRuntimeProvisioner;
  private readonly availabilityService: IAcceleratorAvailabilityService;
  private readonly heuristicClassifier: ILocalTypoClassifier;
  private readonly notificationService: IAcceleratorNotificationService;
  private readonly log: LogFn;
  private lastAvailability?: AcceleratorAvailabilityStatus;
  private lastPath?: 'off' | 'fallback' | 'accelerated';
  private lastStatusSignature?: string;
  private lastBackendSignature?: string;
  private hadAcceleratorPath = false;

  constructor(
    context: vscode.ExtensionContext,
    _extensionPath: string,
    log: LogFn,
    onRuntimeDownloadProgress?: RuntimeDownloadProgressHandler
  ) {
    this.runtimeProvisioner = new GitHubRuntimeProvisioner(
      context,
      log,
      onRuntimeDownloadProgress
    );
    this.availabilityService = new CoralAcceleratorAvailabilityService(this.runtimeProvisioner);
    this.heuristicClassifier = new HeuristicLocalTypoClassifier();
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

  public inspectClassifierBackend(config?: KoSpellCheckConfig): TypoClassifierBackendStatus {
    return this.resolveClassifierBackendStatus(config);
  }

  public listInstalledModels(): InstalledRuntimeModel[] {
    return this.runtimeProvisioner.listInstalledModels();
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

    const backendStatus = this.resolveClassifierBackendStatus(config);
    this.logBackendStatus(backendStatus, config, document.uri);

    if (backendStatus.backend !== 'coral-process') {
      this.hadAcceleratorPath = false;
      this.logPath('fallback', config, document.uri);
      this.trace(
        `local-typo-acceleration backend fallback active reason='${backendStatus.detail}'`,
        config,
        document.uri
      );
      return this.classifyIssues(document, issues, resolveContext, config, backendStatus);
    }

    if (config.localTypoAccelerationMode === 'auto' && backendStatus.tpuInferenceActive) {
      this.notificationService.notifyAutoModeDetection(
        config.localTypoAccelerationMode,
        config.localTypoAccelerationShowDetectionPrompt
      );
    }

    this.hadAcceleratorPath = backendStatus.tpuInferenceActive;
    this.logPath(backendStatus.tpuInferenceActive ? 'accelerated' : 'fallback', config, document.uri);
    if (!backendStatus.tpuInferenceActive) {
      this.trace(
        `local-typo-acceleration local model fallback active reason='${backendStatus.detail}'`,
        config,
        document.uri
      );
    }
    return this.classifyIssues(document, issues, resolveContext, config, backendStatus);
  }

  private classifyIssues(
    document: vscode.TextDocument,
    issues: SpellIssue[],
    resolveContext: ContextResolver,
    config: KoSpellCheckConfig,
    backendStatus: TypoClassifierBackendStatus
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
      const request: TypoClassificationRequest = {
        token: issue.token,
        suggestions: issue.suggestions,
        context
      };
      const result = this.classifyRequestWithBestAvailableBackend(
        request,
        backendStatus,
        config,
        document.uri
      );

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

  private resolveClassifierBackendStatus(config?: KoSpellCheckConfig): TypoClassifierBackendStatus {
    const runtimeStatus = this.runtimeProvisioner.getRuntimeStatus();
    if (!runtimeStatus.present || !runtimeStatus.runtimeRoot) {
      return {
        backend: 'heuristic-local',
        tpuInferenceActive: false,
        detail: `runtime missing: ${runtimeStatus.detail}`,
        runtimeRoot: runtimeStatus.runtimeRoot
      };
    }

    const availableModels = this.runtimeProvisioner.listInstalledModels();
    if (availableModels.length === 0) {
      return {
        backend: 'heuristic-local',
        tpuInferenceActive: false,
        detail: `nem található használható modell a runtime-ban (${runtimeStatus.runtimeRoot})`,
        runtimeRoot: runtimeStatus.runtimeRoot,
        availableModels
      };
    }

    const requestedModelId = sanitizeModelSelection(config?.localTypoAccelerationModel);
    const selectedModel = chooseRuntimeModel(availableModels, requestedModelId);
    if (!selectedModel) {
      return {
        backend: 'heuristic-local',
        tpuInferenceActive: false,
        detail: `nincs választható modell (${requestedModelId ?? 'auto'})`,
        runtimeRoot: runtimeStatus.runtimeRoot,
        availableModels
      };
    }

    const adapterPath = this.pickAdapterPath(runtimeStatus.runtimeRoot);
    if (!adapterPath) {
      return {
        backend: 'heuristic-local',
        tpuInferenceActive: false,
        detail:
          `Coral adapter missing (` +
          `${path.join(runtimeStatus.runtimeRoot, 'bin', 'coral-typo-classifier-native')} | ` +
          `${path.join(runtimeStatus.runtimeRoot, 'bin', 'coral-typo-classifier')})`,
        runtimeRoot: runtimeStatus.runtimeRoot,
        selectedModelId: selectedModel.id,
        selectedModelDisplayName: selectedModel.displayName,
        modelPath: selectedModel.absolutePath,
        availableModels
      };
    }

    if (!isExecutableFile(adapterPath)) {
      return {
        backend: 'heuristic-local',
        tpuInferenceActive: false,
        detail: `Coral adapter nem futtatható (${adapterPath})`,
        runtimeRoot: runtimeStatus.runtimeRoot,
        adapterPath,
        selectedModelId: selectedModel.id,
        selectedModelDisplayName: selectedModel.displayName,
        modelPath: selectedModel.absolutePath,
        availableModels
      };
    }

    if (!fs.existsSync(selectedModel.absolutePath)) {
      return {
        backend: 'heuristic-local',
        tpuInferenceActive: false,
        detail: `Kiválasztott modell hiányzik (${selectedModel.absolutePath})`,
        runtimeRoot: runtimeStatus.runtimeRoot,
        adapterPath,
        modelPath: selectedModel.absolutePath,
        selectedModelId: selectedModel.id,
        selectedModelDisplayName: selectedModel.displayName,
        availableModels
      };
    }

    const health = this.inspectCoralAdapterHealth(
      adapterPath,
      runtimeStatus.runtimeRoot,
      selectedModel.absolutePath,
      config
    );

    const canUseLocalModel = health.modelLoadable === true && health.tfliteRuntimeLoaded !== false;
    if (!health.tpuInferenceActive && !canUseLocalModel) {
      return {
        backend: 'heuristic-local',
        tpuInferenceActive: false,
        tfliteRuntimeLoaded: health.tfliteRuntimeLoaded,
        modelLoadable: health.modelLoadable,
        modelPlaceholder: health.modelPlaceholder,
        detail: `Coral runtime detected, but no usable TPU or TFLite model path is active: ${health.detail}`,
        runtimeRoot: runtimeStatus.runtimeRoot,
        adapterPath,
        modelPath: selectedModel.absolutePath,
        selectedModelId: selectedModel.id,
        selectedModelDisplayName: selectedModel.displayName,
        availableModels
      };
    }

    return {
      backend: 'coral-process',
      tpuInferenceActive: health.tpuInferenceActive,
      tfliteRuntimeLoaded: health.tfliteRuntimeLoaded,
      modelLoadable: health.modelLoadable,
      modelPlaceholder: health.modelPlaceholder,
      detail: health.tpuInferenceActive
        ? health.detail
        : `TPU inference inactive; using local TFLite model: ${health.detail}`,
      runtimeRoot: runtimeStatus.runtimeRoot,
      adapterPath,
      modelPath: selectedModel.absolutePath,
      selectedModelId: selectedModel.id,
      selectedModelDisplayName: selectedModel.displayName,
      availableModels
    };
  }

  private pickAdapterPath(runtimeRoot: string): string | undefined {
    const candidates = [
      path.join(runtimeRoot, 'bin', 'coral-typo-classifier-native'),
      path.join(runtimeRoot, 'bin', 'coral-typo-classifier')
    ];
    return candidates.find((candidate) => fs.existsSync(candidate));
  }

  private logBackendStatus(
    backendStatus: TypoClassifierBackendStatus,
    config: KoSpellCheckConfig,
    uri: vscode.Uri
  ): void {
    const signature = [
      backendStatus.backend,
      backendStatus.tpuInferenceActive ? '1' : '0',
      backendStatus.tfliteRuntimeLoaded === undefined
        ? 'u'
        : (backendStatus.tfliteRuntimeLoaded ? '1' : '0'),
      backendStatus.modelLoadable === undefined
        ? 'u'
        : (backendStatus.modelLoadable ? '1' : '0'),
      backendStatus.modelPlaceholder === undefined
        ? 'u'
        : (backendStatus.modelPlaceholder ? '1' : '0'),
      backendStatus.detail
    ].join('|');
    if (signature === this.lastBackendSignature && !config.localTypoAccelerationVerboseLogging) {
      return;
    }

    this.lastBackendSignature = signature;
    const coralRuntimeState = backendStatus.backend === 'coral-process' ? 'active' : 'inactive';
    this.log(
      `local-typo-acceleration coral-runtime status=${coralRuntimeState} tpu-inference=${backendStatus.tpuInferenceActive ? 'active' : 'inactive'} model-loadable=${backendStatus.modelLoadable === undefined ? 'unknown' : (backendStatus.modelLoadable ? 'yes' : 'no')} model-placeholder=${backendStatus.modelPlaceholder === undefined ? 'unknown' : (backendStatus.modelPlaceholder ? 'yes' : 'no')} tflite-runtime=${backendStatus.tfliteRuntimeLoaded === undefined ? 'unknown' : (backendStatus.tfliteRuntimeLoaded ? 'loaded' : 'not-loaded')} typo-classifier-backend=${backendStatus.backend} model=${backendStatus.selectedModelId ?? 'n/a'} detail=${backendStatus.detail}`,
      uri,
      false
    );
  }

  private inspectCoralAdapterHealth(
    adapterPath: string,
    runtimeRoot: string,
    modelPath: string,
    config?: KoSpellCheckConfig
  ): {
    tpuInferenceActive: boolean;
    tfliteRuntimeLoaded?: boolean;
    modelLoadable?: boolean;
    modelPlaceholder?: boolean;
    detail: string;
  } {
    const candidates = resolveAdapterCandidates(adapterPath, runtimeRoot);
    let lastFailure:
      | {
          tpuInferenceActive: boolean;
          tfliteRuntimeLoaded?: boolean;
          modelLoadable?: boolean;
          modelPlaceholder?: boolean;
          detail: string;
        }
      | undefined;

    for (const candidate of candidates) {
      const attempt = this.inspectSingleAdapterHealth(candidate, runtimeRoot, modelPath, config);
      const isSpawnError = attempt.detail.includes('spawn error');
      const isParseError = attempt.detail.includes('JSON parse failed');
      if (!isSpawnError && !isParseError) {
        return attempt;
      }
      lastFailure = attempt;
    }

    return (
      lastFailure ?? {
        tpuInferenceActive: false,
        tfliteRuntimeLoaded: false,
        modelLoadable: false,
        modelPlaceholder: false,
        detail: `adapter health check failed for all candidates model='${modelPath}'`
      }
    );
  }

  private inspectSingleAdapterHealth(
    adapterPath: string,
    runtimeRoot: string,
    modelPath: string,
    config?: KoSpellCheckConfig
  ): {
    tpuInferenceActive: boolean;
    tfliteRuntimeLoaded?: boolean;
    modelLoadable?: boolean;
    modelPlaceholder?: boolean;
    detail: string;
  } {
    const result = spawnSync(adapterPath, ['--health', '--model', modelPath], {
      cwd: runtimeRoot,
      encoding: 'utf8',
      timeout: CORAL_HEALTH_CHECK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    });

    if (result.error) {
      const reason = `adapter health check spawn error: ${formatError(result.error)}`;
      if (config?.localTypoAccelerationVerboseLogging) {
        this.log(`local-typo-acceleration ${reason}`, undefined, false);
      }
      return {
        tpuInferenceActive: false,
        tfliteRuntimeLoaded: false,
        modelLoadable: false,
        modelPlaceholder: false,
        detail: `${reason}; adapter='${adapterPath}'; model='${modelPath}'`
      };
    }

    if (result.status !== 0) {
      return {
        tpuInferenceActive: false,
        tfliteRuntimeLoaded: false,
        modelLoadable: false,
        modelPlaceholder: false,
        detail:
          `adapter health check failed adapter='${adapterPath}' (status=${result.status}) ` +
          `stderr='${(result.stderr ?? '').trim()}' model='${modelPath}'`
      };
    }

    const stdout = (result.stdout ?? '').trim();
    if (!stdout) {
      return {
        tpuInferenceActive: false,
        tfliteRuntimeLoaded: false,
        modelLoadable: false,
        modelPlaceholder: false,
        detail: `adapter health check returned empty output adapter='${adapterPath}' model='${modelPath}'`
      };
    }

    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      const tpuInferenceActive = Boolean(parsed.tpuInferenceActive);
      const adapterDetail = typeof parsed.detail === 'string' && parsed.detail.trim().length > 0
        ? parsed.detail.trim()
        : 'adapter health check ok';
      const inferredTfliteLoaded = inferTfliteRuntimeLoaded(parsed, adapterDetail);
      const inferredModelLoadable = inferModelLoadable(parsed, adapterDetail);
      const inferredModelPlaceholder = inferModelPlaceholder(parsed, adapterDetail);
      const backend = typeof parsed.backend === 'string' && parsed.backend.trim().length > 0
        ? parsed.backend.trim()
        : 'coral-process';
      return {
        tpuInferenceActive,
        tfliteRuntimeLoaded: inferredTfliteLoaded,
        modelLoadable: inferredModelLoadable,
        modelPlaceholder: inferredModelPlaceholder,
        detail:
          `adapter='${adapterPath}', model='${modelPath}', backend='${backend}', ` +
          `tpuInferenceActive=${tpuInferenceActive ? 'true' : 'false'}, ` +
          `modelLoadable=${typeof inferredModelLoadable === 'boolean' ? (inferredModelLoadable ? 'true' : 'false') : 'unknown'}, ` +
          `modelPlaceholder=${typeof inferredModelPlaceholder === 'boolean' ? (inferredModelPlaceholder ? 'true' : 'false') : 'unknown'}, ` +
          `tfliteRuntimeLoaded=${typeof inferredTfliteLoaded === 'boolean' ? (inferredTfliteLoaded ? 'true' : 'false') : 'unknown'}, ` +
          `detail='${adapterDetail}'`
      };
    } catch (error) {
      return {
        tpuInferenceActive: false,
        tfliteRuntimeLoaded: false,
        modelLoadable: false,
        modelPlaceholder: false,
        detail:
          `adapter health JSON parse failed adapter='${adapterPath}': ${formatError(error)} stdout='${stdout.slice(0, 220)}' model='${modelPath}'`
      };
    }
  }

  private classifyRequestWithBestAvailableBackend(
    request: TypoClassificationRequest,
    backendStatus: TypoClassifierBackendStatus,
    config: KoSpellCheckConfig,
    uri: vscode.Uri
  ): TypoClassificationResult {
    if (backendStatus.backend === 'coral-process') {
      const result = this.tryClassifyWithCoralProcess(request, backendStatus, config, uri);
      if (result) {
        return result;
      }
    }

    return this.heuristicClassifier.classify(request);
  }

  private tryClassifyWithCoralProcess(
    request: TypoClassificationRequest,
    backendStatus: TypoClassifierBackendStatus,
    config: KoSpellCheckConfig,
    uri: vscode.Uri
  ): TypoClassificationResult | undefined {
    if (!backendStatus.adapterPath || !backendStatus.modelPath || !backendStatus.runtimeRoot) {
      return undefined;
    }

    const payload = JSON.stringify({
      token: request.token,
      suggestions: request.suggestions.map((item) => item.replacement),
      context: request.context,
      modelPath: backendStatus.modelPath,
      modelId: backendStatus.selectedModelId ?? 'auto'
    });

    const adapterCandidates = resolveAdapterCandidates(
      backendStatus.adapterPath,
      backendStatus.runtimeRoot
    );
    for (const adapterPath of adapterCandidates) {
      const result = this.tryClassifyWithAdapterExecutable(
        adapterPath,
        backendStatus.runtimeRoot,
        payload,
        config,
        uri
      );
      if (result) {
        return result;
      }
    }

    return undefined;
  }

  private tryClassifyWithAdapterExecutable(
    adapterPath: string,
    runtimeRoot: string,
    payload: string,
    config: KoSpellCheckConfig,
    uri: vscode.Uri
  ): TypoClassificationResult | undefined {
    const result = spawnSync(adapterPath, [], {
      cwd: runtimeRoot,
      encoding: 'utf8',
      timeout: CORAL_CLASSIFY_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      input: payload
    });

    if (result.error) {
      this.trace(
        `local-typo-acceleration coral-process adapter='${adapterPath}' fallback reason=spawn-error ${formatError(result.error)}`,
        config,
        uri
      );
      return undefined;
    }

    if (result.status !== 0) {
      this.trace(
        `local-typo-acceleration coral-process adapter='${adapterPath}' fallback reason=non-zero-exit status=${result.status} stderr='${(result.stderr ?? '').trim()}'`,
        config,
        uri
      );
      return undefined;
    }

    const stdout = (result.stdout ?? '').trim();
    if (!stdout) {
      this.trace(
        `local-typo-acceleration coral-process adapter='${adapterPath}' fallback reason=empty-stdout`,
        config,
        uri
      );
      return undefined;
    }

    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      const category = parseTypoCategory(parsed.category);
      if (!category) {
        this.trace(
          `local-typo-acceleration coral-process adapter='${adapterPath}' fallback reason=invalid-category raw='${String(parsed.category ?? '')}'`,
          config,
          uri
        );
        return undefined;
      }

      const isTypo = typeof parsed.isTypo === 'boolean' ? parsed.isTypo : category !== 'NotTypo';
      const confidence = clampNumber(parsed.confidence, 0, 1, 0.5);
      const reason = typeof parsed.reason === 'string' ? parsed.reason : 'coral-process';

      return {
        isTypo,
        confidence,
        category,
        backend: typeof parsed.backend === 'string' && parsed.backend.length > 0
          ? parsed.backend
          : 'coral-process',
        reason
      };
    } catch (error) {
      this.trace(
        `local-typo-acceleration coral-process adapter='${adapterPath}' fallback reason=parse-error ${formatError(error)} stdout='${stdout.slice(0, 220)}'`,
        config,
        uri
      );
      return undefined;
    }
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
  private readonly onProgress?: RuntimeDownloadProgressHandler;
  private downloadInFlight?: Promise<void>;
  private lastDownloadAttemptAt = 0;

  constructor(
    context: vscode.ExtensionContext,
    log: LogFn,
    onProgress?: RuntimeDownloadProgressHandler
  ) {
    this.log = log;
    this.installRoot = path.join(context.globalStorageUri.fsPath, 'coral-tpu-runtime');
    this.runtimeBaseUrl = DEFAULT_RUNTIME_BASE_URL;
    this.onProgress = onProgress;
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

  public listInstalledModels(): InstalledRuntimeModel[] {
    const folder = platformFolderForCurrentPlatform();
    if (!folder) {
      return [];
    }

    const runtimeStatus = this.getRuntimeStatusFor(folder, process.arch);
    if (!runtimeStatus.present || !runtimeStatus.runtimeRoot) {
      return [];
    }

    let manifest: RuntimeManifest | undefined;
    try {
      manifest = this.readInstalledManifest(runtimeStatus.runtimeRoot);
    } catch {
      return [];
    }
    if (!manifest) {
      return [];
    }

    const fromManifest = modelsFromManifest(manifest, runtimeStatus.runtimeRoot);
    if (fromManifest.length > 0) {
      return fromManifest;
    }

    const fallbackPath = path.join(runtimeStatus.runtimeRoot, 'model', 'typo_classifier_edgetpu.tflite');
    if (!fs.existsSync(fallbackPath)) {
      return [];
    }

    return [
      {
        id: 'typo_classifier_edgetpu',
        displayName: 'Default EdgeTPU Typo Model',
        description: 'Legacy fallback model entry from model/typo_classifier_edgetpu.tflite',
        format: 'edgetpu-tflite',
        relativePath: 'model/typo_classifier_edgetpu.tflite',
        absolutePath: fallbackPath,
        isDefault: true
      }
    ];
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
    this.emitProgress({
      phase: 'started',
      statusText: `Runtime letöltés indul (${folder}/${process.arch})`
    });
    this.log(
      `local-typo-acceleration runtime-download start source=${this.runtimeBaseUrl}/${folder}/runtime-manifest.json platform=${process.platform} arch=${process.arch} force=${force}`,
      uri,
      false
    );

    this.downloadInFlight = this.downloadRuntime(folder, process.arch)
      .then((runtimeRoot) => {
        this.emitProgress({
          phase: 'success',
          statusText: `Runtime telepítve: ${runtimeRoot}`
        });
        this.log(
          `local-typo-acceleration runtime-download success runtimeRoot='${runtimeRoot}'`,
          uri,
          false
        );
      })
      .catch((error) => {
        this.emitProgress({
          phase: 'failed',
          statusText: `Runtime letöltési hiba: ${formatError(error)}`
        });
        this.log(
          `local-typo-acceleration runtime-download failed reason=${formatError(error)}`,
          uri,
          true
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
      let manifest: RuntimeManifest | undefined;
      try {
        manifest = this.readInstalledManifest(runtimeRoot);
      } catch (error) {
        return {
          present: false,
          detail: `runtime manifest olvasási hiba '${manifestPath}': ${formatError(error)}`
        };
      }

      if (!manifest) {
        continue;
      }

      try {
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

  private readInstalledManifest(runtimeRoot: string): RuntimeManifest | undefined {
    const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return undefined;
    }

    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RuntimeManifest;
    return parsed;
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

    this.emitProgress({
      phase: 'manifest',
      statusText: `Runtime manifest letöltve (${manifest.files.length} fájl)`,
      fileCount: manifest.files.length
    });

    const targetArch = manifest.arch && manifest.arch.length > 0 ? manifest.arch : arch;
    const runtimeRoot = this.getRuntimeRoot(folder, targetArch);
    fs.mkdirSync(runtimeRoot, { recursive: true });

    for (let index = 0; index < manifest.files.length; index += 1) {
      const file = manifest.files[index];
      const relativePath = sanitizeRelativePath(file.path);
      const sourceUrl = resolveManifestFileUrl(manifestUrl, file.url);
      const fileNumber = index + 1;
      const fileCount = manifest.files.length;
      let lastProgressBucket = -1;

      this.emitProgress({
        phase: 'file',
        statusText: `Runtime letöltés ${fileNumber}/${fileCount}: ${relativePath}`,
        filePath: relativePath,
        fileIndex: fileNumber,
        fileCount
      });

      const payload = await httpsGetBuffer(sourceUrl, 0, (receivedBytes, totalBytes) => {
        if (!totalBytes || totalBytes <= 0) {
          return;
        }

        const percent = Math.max(
          0,
          Math.min(100, Math.floor((receivedBytes / totalBytes) * 100))
        );
        const bucket = percent === 100 ? 100 : Math.floor(percent / 10) * 10;
        if (bucket === lastProgressBucket) {
          return;
        }

        lastProgressBucket = bucket;
        this.emitProgress({
          phase: 'file',
          statusText: `Runtime letöltés ${fileNumber}/${fileCount}: ${relativePath} (${percent}%)`,
          filePath: relativePath,
          fileIndex: fileNumber,
          fileCount,
          percent
        });
      });

      if (lastProgressBucket < 100) {
        this.emitProgress({
          phase: 'file',
          statusText: `Runtime letöltés ${fileNumber}/${fileCount}: ${relativePath} (100%)`,
          filePath: relativePath,
          fileIndex: fileNumber,
          fileCount,
          percent: 100
        });
      }

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
      if (file.executable === true || isLikelyExecutableRuntimePath(relativePath)) {
        fs.chmodSync(outputPath, 0o755);
      }
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

  private emitProgress(progress: RuntimeDownloadProgress): void {
    if (!this.onProgress) {
      return;
    }

    try {
      this.onProgress(progress);
    } catch {
      // progress callback must never break runtime provisioning
    }
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
  const systemProfiler = spawnSync('system_profiler', ['SPUSBDataType'], {
    encoding: 'utf8',
    timeout: 7000,
    maxBuffer: 10 * 1024 * 1024
  });

  if (!systemProfiler.error && systemProfiler.status === 0) {
    const output = `${systemProfiler.stdout ?? ''}\n${systemProfiler.stderr ?? ''}`;
    if (/(coral|edge\s*tpu|global\s+unichip|google)/iu.test(output)) {
      return {
        available: true,
        detail: 'Coral USB eszköz detektálva (system_profiler)'
      };
    }
  }

  const ioreg = spawnSync('ioreg', ['-p', 'IOUSB', '-l', '-w', '0'], {
    encoding: 'utf8',
    timeout: 7000,
    maxBuffer: 10 * 1024 * 1024
  });
  if (!ioreg.error && ioreg.status === 0) {
    const output = `${ioreg.stdout ?? ''}\n${ioreg.stderr ?? ''}`;
    if (looksLikeCoralIoreg(output)) {
      return {
        available: true,
        detail: 'Coral USB eszköz detektálva (ioreg, idVendor/idProduct)'
      };
    }
  }

  if (systemProfiler.error) {
    return {
      available: false,
      detail: `Coral USB eszköz nem látható. system_profiler hiba: ${formatError(systemProfiler.error)}`
    };
  }

  if (ioreg.error) {
    return {
      available: false,
      detail: `Coral USB eszköz nem látható. ioreg hiba: ${formatError(ioreg.error)}`
    };
  }

  return {
    available: false,
    detail:
      `Coral USB eszköz nem látható a system_profiler vagy ioreg kimenetben` +
      ` (system_profiler status=${systemProfiler.status ?? 'n/a'}, ioreg status=${ioreg.status ?? 'n/a'})`
  };
}

function looksLikeCoralIoreg(output: string): boolean {
  if (/(coral|edge\s*tpu|global\s+unichip)/iu.test(output)) {
    return true;
  }

  const hasGucVendor = /"idVendor"\s*=\s*(6766|0x1a6e)/iu.test(output);
  const hasGucProduct = /"idProduct"\s*=\s*(2202|0x089a)/iu.test(output);
  if (hasGucVendor && hasGucProduct) {
    return true;
  }

  const hasGoogleVendor = /"idVendor"\s*=\s*(6353|0x18d1)/iu.test(output);
  const hasGoogleProduct = /"idProduct"\s*=\s*(37634|0x9302)/iu.test(output);
  if (hasGoogleVendor && hasGoogleProduct) {
    return true;
  }

  if (/"UsbDeviceSignature"\s*=\s*<(6e1a9a08|d1180293)/iu.test(output)) {
    return true;
  }

  return false;
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

  private configuredUiLanguage(): string {
    const uri = vscode.window.activeTextEditor?.document.uri;
    return vscode.workspace.getConfiguration('kospellcheck', uri).get<string>('uiLanguage', 'auto');
  }

  public notifyAutoModeDetection(mode: TypoAccelerationMode, showPrompt: boolean): void {
    if (mode !== 'auto' || !showPrompt) {
      return;
    }

    if (this.context.globalState.get<boolean>(this.autoPromptKey, false)) {
      return;
    }

    void this.context.globalState.update(this.autoPromptKey, true);
    const uiLanguage = this.configuredUiLanguage();
    const enableAlwaysOn = text('localTypo.info.enableAlwaysOn', 'Enable Always On', {
      configuredLanguage: uiLanguage
    });
    const keepAuto = text('localTypo.info.keepAuto', 'Keep Auto', {
      configuredLanguage: uiLanguage
    });
    void vscode.window
      .showInformationMessage(
        text(
          'localTypo.info.detectedEnablePrompt',
          'Local typo accelerator detected. Enable faster local typo classification?',
          { configuredLanguage: uiLanguage }
        ),
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
    const uiLanguage = this.configuredUiLanguage();
    const detail =
      status === 'UnavailableMissingRuntime'
        ? text(
          'localTypo.detail.missingRuntime',
          'Bundled local runtime is not present in this build.',
          { configuredLanguage: uiLanguage }
        )
        : status === 'UnavailableUnsupportedPlatform'
          ? text(
            'localTypo.detail.unsupportedPlatform',
            'Current platform is not supported by this optional path.',
            { configuredLanguage: uiLanguage }
          )
          : text(
            'localTypo.detail.notAvailable',
            'A compatible local accelerator is not available right now.',
            { configuredLanguage: uiLanguage }
          );
    void vscode.window.showInformationMessage(
      text(
        'localTypo.info.unavailableOnMode',
        `KoSpellCheck local typo acceleration is ON, but unavailable. ${detail} Falling back to standard local spell checking.`,
        {
          configuredLanguage: uiLanguage,
          args: { detail }
        }
      )
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

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return clamp(numberValue, min, max);
}

function parseTypoCategory(value: unknown): TypoClassificationCategory | undefined {
  if (value === 'IdentifierTypo' || value === 'TextTypo' || value === 'NotTypo' || value === 'Uncertain') {
    return value;
  }

  return undefined;
}

function isExecutableFile(targetPath: string): boolean {
  try {
    fs.accessSync(targetPath, fs.constants.F_OK | fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function topSuggestionText(suggestions: Suggestion[]): string {
  const top = suggestions[0]?.replacement?.trim();
  return top && top.length > 0 ? top : 'n/a';
}

function sanitizeModelSelection(value: string | undefined): string {
  const normalized = (value ?? '').trim();
  return normalized.length > 0 ? normalized : 'auto';
}

function chooseRuntimeModel(
  models: InstalledRuntimeModel[],
  requestedModelId: string
): InstalledRuntimeModel | undefined {
  if (models.length === 0) {
    return undefined;
  }

  if (requestedModelId !== 'auto') {
    const selected = models.find((item) => item.id === requestedModelId);
    if (selected) {
      return selected;
    }
  }

  return models.find((item) => item.isDefault) ?? models[0];
}

function modelsFromManifest(manifest: RuntimeManifest, runtimeRoot: string): InstalledRuntimeModel[] {
  if (!Array.isArray(manifest.models)) {
    return [];
  }

  const output: InstalledRuntimeModel[] = [];
  const usedIds = new Set<string>();
  for (const model of manifest.models) {
    try {
      if (!model || typeof model.id !== 'string' || typeof model.path !== 'string') {
        continue;
      }

      const id = model.id.trim();
      if (!id || usedIds.has(id)) {
        continue;
      }

      const relativePath = sanitizeRelativePath(model.path);
      const absolutePath = path.join(runtimeRoot, relativePath);
      if (!fs.existsSync(absolutePath)) {
        continue;
      }

      usedIds.add(id);
      output.push({
        id,
        displayName:
          typeof model.displayName === 'string' && model.displayName.trim().length > 0
            ? model.displayName.trim()
            : id,
        description:
          typeof model.description === 'string' && model.description.trim().length > 0
            ? model.description.trim()
            : undefined,
        format:
          typeof model.format === 'string' && model.format.trim().length > 0
            ? model.format.trim()
            : 'edgetpu-tflite',
        relativePath,
        absolutePath,
        isDefault: model.default === true
      });
    } catch {
      continue;
    }
  }

  if (output.length > 0 && !output.some((item) => item.isDefault)) {
    output[0] = {
      ...output[0],
      isDefault: true
    };
  }

  return output;
}

function isLikelyExecutableRuntimePath(relativePath: string): boolean {
  return relativePath.startsWith('bin/') && !relativePath.endsWith('.json');
}

function resolveAdapterCandidates(primaryAdapterPath: string, runtimeRoot: string): string[] {
  const candidates = [primaryAdapterPath];
  const fallback = path.join(runtimeRoot, 'bin', 'coral-typo-classifier');
  if (!candidates.includes(fallback) && fs.existsSync(fallback)) {
    candidates.push(fallback);
  }

  return candidates;
}

function inferTfliteRuntimeLoaded(
  parsed: Record<string, unknown>,
  detail: string
): boolean | undefined {
  if (typeof parsed.tfliteRuntimeLoaded === 'boolean') {
    return parsed.tfliteRuntimeLoaded;
  }

  if (/tensorflowlite_c\s+loaded/iu.test(detail)) {
    return true;
  }

  if (/tensorflowlite_c\s+library\s+not\s+found/iu.test(detail)) {
    return false;
  }

  return undefined;
}

function inferModelLoadable(
  parsed: Record<string, unknown>,
  detail: string
): boolean | undefined {
  if (typeof parsed.modelLoadable === 'boolean') {
    return parsed.modelLoadable;
  }

  if (/model\s+load\s+ok/iu.test(detail)) {
    return true;
  }

  if (/model\s+load\s+failed/iu.test(detail)) {
    return false;
  }

  return undefined;
}

function inferModelPlaceholder(
  parsed: Record<string, unknown>,
  detail: string
): boolean | undefined {
  if (typeof parsed.modelPlaceholder === 'boolean') {
    return parsed.modelPlaceholder;
  }

  if (/model\s+placeholder\s+detected/iu.test(detail)) {
    return true;
  }

  return undefined;
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

function httpsGetBuffer(
  url: string,
  redirectDepth = 0,
  onProgress?: (receivedBytes: number, totalBytes?: number) => void
): Promise<Buffer> {
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
          void httpsGetBuffer(redirected, redirectDepth + 1, onProgress).then(resolve, reject);
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
        const totalBytes = parseContentLengthHeader(res.headers['content-length']);
        let receivedBytes = 0;
        if (onProgress) {
          onProgress(0, totalBytes);
        }

        res.on('data', (chunk) => {
          const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          chunks.push(chunkBuffer);
          receivedBytes += chunkBuffer.length;
          if (onProgress) {
            onProgress(receivedBytes, totalBytes);
          }
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );

    req.setTimeout(20_000, () => {
      req.destroy(new Error(`időtúllépés: ${url}`));
    });
    req.on('error', reject);
  });
}

function parseContentLengthHeader(value: string | string[] | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(candidate, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
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
