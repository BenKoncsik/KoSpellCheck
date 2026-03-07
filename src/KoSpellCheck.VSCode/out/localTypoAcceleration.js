"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalTypoAccelerationController = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_https_1 = __importDefault(require("node:https"));
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const vscode = __importStar(require("vscode"));
const DETECTION_CACHE_TTL_MS = 60_000;
const DOWNLOAD_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const PROVIDER_ID = 'google-coral-edgetpu';
const LINUX_ACCELERATOR_PATHS = ['/dev/apex_0', '/dev/apex_1'];
const DEFAULT_RUNTIME_BASE_URL = 'https://raw.githubusercontent.com/BenKoncsik/KoSpellCheck/main/Coral-tpu';
class LocalTypoAccelerationController {
    constructor(context, _extensionPath, log, onRuntimeDownloadProgress) {
        this.hadAcceleratorPath = false;
        this.runtimeProvisioner = new GitHubRuntimeProvisioner(context, log, onRuntimeDownloadProgress);
        this.availabilityService = new CoralAcceleratorAvailabilityService(this.runtimeProvisioner);
        this.heuristicClassifier = new HeuristicLocalTypoClassifier();
        this.notificationService = new VscodeAcceleratorNotificationService(context, log);
        this.log = log;
    }
    requestRuntimeDownload(config, uri, force = false) {
        this.runtimeProvisioner.ensureRuntimeDownloaded(config, uri, force);
    }
    inspectAvailability(forceRefresh = false) {
        return this.availabilityService.getAvailability(forceRefresh);
    }
    inspectClassifierBackend(config) {
        return this.resolveClassifierBackendStatus(config);
    }
    listInstalledModels() {
        return this.runtimeProvisioner.listInstalledModels();
    }
    applyToIssues(document, issues, config, resolveContext) {
        if (config.localTypoAccelerationMode !== 'off') {
            this.runtimeProvisioner.ensureRuntimeDownloaded(config, document.uri);
        }
        if (config.localTypoAccelerationMode === 'off') {
            this.logStatus({
                status: 'Unavailable',
                provider: PROVIDER_ID,
                detail: 'mode=off',
                detectedAtUtc: new Date().toISOString()
            }, config, document.uri);
            this.logPath('off', config, document.uri);
            this.hadAcceleratorPath = false;
            return issues;
        }
        this.trace('local-typo-acceleration detection started', config, document.uri);
        const availability = this.availabilityService.getAvailability();
        this.logStatus(availability, config, document.uri);
        if (this.lastAvailability !== availability.status || availability.status === 'Error') {
            this.log(`local-typo-acceleration detection result status=${availability.status} provider=${availability.provider} detail=${availability.detail ?? 'n/a'}`, document.uri, false);
            if (availability.status === 'Error') {
                this.log('local-typo-acceleration detection failed; fallback activated', document.uri, true);
            }
            else if (availability.status === 'Available') {
                this.log('local-typo-acceleration detection succeeded', document.uri, true);
            }
        }
        this.lastAvailability = availability.status;
        if (availability.status !== 'Available') {
            if (this.hadAcceleratorPath) {
                this.log(`local-typo-acceleration became unavailable status=${availability.status}; fallback activated`, document.uri, true);
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
            this.trace(`local-typo-acceleration backend fallback active reason='${backendStatus.detail}'`, config, document.uri);
            return this.classifyIssues(document, issues, resolveContext, config, backendStatus);
        }
        if (config.localTypoAccelerationMode === 'auto') {
            this.notificationService.notifyAutoModeDetection(config.localTypoAccelerationMode, config.localTypoAccelerationShowDetectionPrompt);
        }
        this.hadAcceleratorPath = true;
        this.logPath('accelerated', config, document.uri);
        return this.classifyIssues(document, issues, resolveContext, config, backendStatus);
    }
    classifyIssues(document, issues, resolveContext, config, backendStatus) {
        const output = [];
        let suppressed = 0;
        let misspellCount = 0;
        for (const issue of issues) {
            if (issue.type !== 'misspell') {
                output.push(issue);
                continue;
            }
            misspellCount += 1;
            const range = new vscode.Range(document.positionAt(issue.start), document.positionAt(issue.end));
            const context = resolveContext(range);
            const request = {
                token: issue.token,
                suggestions: issue.suggestions,
                context
            };
            const result = this.classifyRequestWithBestAvailableBackend(request, backendStatus, config, document.uri);
            this.trace(`local-typo-acceleration classify token='${issue.token}' category=${result.category} confidence=${result.confidence.toFixed(2)} backend=${result.backend}`, config, document.uri);
            if (result.category === 'NotTypo' && result.confidence >= 0.65) {
                suppressed += 1;
                this.trace(`local-typo-acceleration decision token='${issue.token}' topSuggestion='${topSuggestionText(issue.suggestions)}' action=suppress category=${result.category} confidence=${result.confidence.toFixed(2)}`, config, document.uri);
                continue;
            }
            const message = result.category === 'Uncertain'
                ? `Low-confidence typo signal: ${issue.message}`
                : issue.message;
            this.trace(`local-typo-acceleration decision token='${issue.token}' topSuggestion='${topSuggestionText(issue.suggestions)}' action=keep category=${result.category} confidence=${result.confidence.toFixed(2)}`, config, document.uri);
            output.push({
                ...issue,
                message,
                typoClassification: result
            });
        }
        this.log(`local-typo-acceleration summary misspell=${misspellCount} kept=${misspellCount - suppressed} suppressed=${suppressed} suggestionsSource=KoSpellCheck spell engine acceleratorRole=typo-gate`, document.uri, false);
        return output;
    }
    logPath(pathValue, config, uri) {
        if (this.lastPath === pathValue && !config.localTypoAccelerationVerboseLogging) {
            return;
        }
        this.lastPath = pathValue;
        this.log(`local-typo-acceleration classification path=${pathValue} (acceleratorRole=typo-gate suggestionsSource=KoSpellCheck spell engine)`, uri, false);
    }
    logStatus(availability, config, uri) {
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
        this.log(`local-typo-acceleration status mode=${config.localTypoAccelerationMode} availability=${availability.status} provider=${availability.provider} detail=${availability.detail ?? 'n/a'}`, uri, false);
        if (availability.status === 'UnavailableMissingRuntime') {
            this.log('local-typo-acceleration info: Coral runtime hiányzik; automatikus letöltés (ha engedélyezett) a KoSpellCheck GitHub Coral-tpu mappájából próbálkozik. TPU communication=inactive.', uri, false);
        }
    }
    trace(message, config, uri) {
        if (!config.localTypoAccelerationVerboseLogging) {
            return;
        }
        this.log(message, uri);
    }
    resolveClassifierBackendStatus(config) {
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
                detail: `Coral adapter missing (` +
                    `${node_path_1.default.join(runtimeStatus.runtimeRoot, 'bin', 'coral-typo-classifier-native')} | ` +
                    `${node_path_1.default.join(runtimeStatus.runtimeRoot, 'bin', 'coral-typo-classifier')})`,
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
        if (!node_fs_1.default.existsSync(selectedModel.absolutePath)) {
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
        const health = this.inspectCoralAdapterHealth(adapterPath, runtimeStatus.runtimeRoot, selectedModel.absolutePath, config);
        return {
            backend: 'coral-process',
            tpuInferenceActive: health.tpuInferenceActive,
            detail: health.detail,
            runtimeRoot: runtimeStatus.runtimeRoot,
            adapterPath,
            modelPath: selectedModel.absolutePath,
            selectedModelId: selectedModel.id,
            selectedModelDisplayName: selectedModel.displayName,
            availableModels
        };
    }
    pickAdapterPath(runtimeRoot) {
        const candidates = [
            node_path_1.default.join(runtimeRoot, 'bin', 'coral-typo-classifier-native'),
            node_path_1.default.join(runtimeRoot, 'bin', 'coral-typo-classifier')
        ];
        return candidates.find((candidate) => node_fs_1.default.existsSync(candidate));
    }
    logBackendStatus(backendStatus, config, uri) {
        const signature = [
            backendStatus.backend,
            backendStatus.tpuInferenceActive ? '1' : '0',
            backendStatus.detail
        ].join('|');
        if (signature === this.lastBackendSignature && !config.localTypoAccelerationVerboseLogging) {
            return;
        }
        this.lastBackendSignature = signature;
        this.log(`local-typo-acceleration coral-runtime status=active tpu-inference=${backendStatus.tpuInferenceActive ? 'active' : 'inactive'} typo-classifier-backend=${backendStatus.backend} model=${backendStatus.selectedModelId ?? 'n/a'} detail=${backendStatus.detail}`, uri, false);
    }
    inspectCoralAdapterHealth(adapterPath, runtimeRoot, modelPath, config) {
        const result = (0, node_child_process_1.spawnSync)(adapterPath, ['--health', '--model', modelPath], {
            cwd: runtimeRoot,
            encoding: 'utf8',
            timeout: 1500,
            maxBuffer: 1024 * 1024
        });
        if (result.error) {
            const reason = `adapter health check spawn error: ${formatError(result.error)}`;
            if (config?.localTypoAccelerationVerboseLogging) {
                this.log(`local-typo-acceleration ${reason}`, undefined, false);
            }
            return {
                tpuInferenceActive: false,
                detail: `${reason}; model='${modelPath}'`
            };
        }
        if (result.status !== 0) {
            return {
                tpuInferenceActive: false,
                detail: `adapter health check failed (status=${result.status}) stderr='${(result.stderr ?? '').trim()}' model='${modelPath}'`
            };
        }
        const stdout = (result.stdout ?? '').trim();
        if (!stdout) {
            return {
                tpuInferenceActive: false,
                detail: `adapter health check returned empty output; model='${modelPath}'`
            };
        }
        try {
            const parsed = JSON.parse(stdout);
            const tpuInferenceActive = Boolean(parsed.tpuInferenceActive);
            const adapterDetail = typeof parsed.detail === 'string' && parsed.detail.trim().length > 0
                ? parsed.detail.trim()
                : 'adapter health check ok';
            const backend = typeof parsed.backend === 'string' && parsed.backend.trim().length > 0
                ? parsed.backend.trim()
                : 'coral-process';
            return {
                tpuInferenceActive,
                detail: `adapter='${adapterPath}', model='${modelPath}', backend='${backend}', ` +
                    `tpuInferenceActive=${tpuInferenceActive ? 'true' : 'false'}, detail='${adapterDetail}'`
            };
        }
        catch (error) {
            return {
                tpuInferenceActive: false,
                detail: `adapter health JSON parse failed: ${formatError(error)} stdout='${stdout.slice(0, 220)}' model='${modelPath}'`
            };
        }
    }
    classifyRequestWithBestAvailableBackend(request, backendStatus, config, uri) {
        if (backendStatus.backend === 'coral-process') {
            const result = this.tryClassifyWithCoralProcess(request, backendStatus, config, uri);
            if (result) {
                return result;
            }
        }
        return this.heuristicClassifier.classify(request);
    }
    tryClassifyWithCoralProcess(request, backendStatus, config, uri) {
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
        const adapterCandidates = resolveAdapterCandidates(backendStatus.adapterPath, backendStatus.runtimeRoot);
        for (const adapterPath of adapterCandidates) {
            const result = this.tryClassifyWithAdapterExecutable(adapterPath, backendStatus.runtimeRoot, payload, config, uri);
            if (result) {
                return result;
            }
        }
        return undefined;
    }
    tryClassifyWithAdapterExecutable(adapterPath, runtimeRoot, payload, config, uri) {
        const result = (0, node_child_process_1.spawnSync)(adapterPath, [], {
            cwd: runtimeRoot,
            encoding: 'utf8',
            timeout: 1500,
            maxBuffer: 1024 * 1024,
            input: payload
        });
        if (result.error) {
            this.trace(`local-typo-acceleration coral-process adapter='${adapterPath}' fallback reason=spawn-error ${formatError(result.error)}`, config, uri);
            return undefined;
        }
        if (result.status !== 0) {
            this.trace(`local-typo-acceleration coral-process adapter='${adapterPath}' fallback reason=non-zero-exit status=${result.status} stderr='${(result.stderr ?? '').trim()}'`, config, uri);
            return undefined;
        }
        const stdout = (result.stdout ?? '').trim();
        if (!stdout) {
            this.trace(`local-typo-acceleration coral-process adapter='${adapterPath}' fallback reason=empty-stdout`, config, uri);
            return undefined;
        }
        try {
            const parsed = JSON.parse(stdout);
            const category = parseTypoCategory(parsed.category);
            if (!category) {
                this.trace(`local-typo-acceleration coral-process adapter='${adapterPath}' fallback reason=invalid-category raw='${String(parsed.category ?? '')}'`, config, uri);
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
        }
        catch (error) {
            this.trace(`local-typo-acceleration coral-process adapter='${adapterPath}' fallback reason=parse-error ${formatError(error)} stdout='${stdout.slice(0, 220)}'`, config, uri);
            return undefined;
        }
    }
}
exports.LocalTypoAccelerationController = LocalTypoAccelerationController;
class CoralAcceleratorAvailabilityService {
    constructor(runtimeProvisioner) {
        this.cachedAt = 0;
        this.runtimeProvisioner = runtimeProvisioner;
    }
    getAvailability(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this.cached && now - this.cachedAt <= DETECTION_CACHE_TTL_MS) {
            return this.cached;
        }
        const detected = this.detect();
        this.cached = detected;
        this.cachedAt = now;
        return detected;
    }
    detect() {
        try {
            if (process.env.KOSPELLCHECK_LOCAL_ACCELERATOR_FORCE_AVAILABLE === '1') {
                return this.result('Available', 'forced-by-env');
            }
            const runtimeStatus = this.runtimeProvisioner.getRuntimeStatus();
            if (!runtimeStatus.present) {
                return this.result('UnavailableMissingRuntime', runtimeStatus.detail);
            }
            if (process.platform === 'darwin') {
                const probe = probeCoralOnMacOs();
                if (!probe.available) {
                    return this.result('Unavailable', probe.detail);
                }
                return this.result('Available', `${probe.detail}; runtimeRoot='${runtimeStatus.runtimeRoot ?? 'n/a'}'`);
            }
            if (process.platform === 'linux') {
                const foundDevice = LINUX_ACCELERATOR_PATHS.find((item) => node_fs_1.default.existsSync(item));
                if (!foundDevice) {
                    return this.result('Unavailable', 'no Coral Edge TPU device node found (/dev/apex_*)');
                }
                return this.result('Available', `detected '${foundDevice}'; runtimeRoot='${runtimeStatus.runtimeRoot ?? 'n/a'}'`);
            }
            return this.result('UnavailableUnsupportedPlatform', `platform '${process.platform}' not wired yet`);
        }
        catch (error) {
            return this.result('Error', formatError(error));
        }
    }
    result(status, detail) {
        return {
            status,
            provider: PROVIDER_ID,
            detail,
            detectedAtUtc: new Date().toISOString()
        };
    }
}
class GitHubRuntimeProvisioner {
    constructor(context, log, onProgress) {
        this.lastDownloadAttemptAt = 0;
        this.log = log;
        this.installRoot = node_path_1.default.join(context.globalStorageUri.fsPath, 'coral-tpu-runtime');
        this.runtimeBaseUrl = DEFAULT_RUNTIME_BASE_URL;
        this.onProgress = onProgress;
    }
    getRuntimeStatus() {
        const folder = platformFolderForCurrentPlatform();
        if (!folder) {
            return {
                present: false,
                detail: `platform '${process.platform}' nem támogatott a Coral runtime letöltőben`
            };
        }
        return this.getRuntimeStatusFor(folder, process.arch);
    }
    listInstalledModels() {
        const folder = platformFolderForCurrentPlatform();
        if (!folder) {
            return [];
        }
        const runtimeStatus = this.getRuntimeStatusFor(folder, process.arch);
        if (!runtimeStatus.present || !runtimeStatus.runtimeRoot) {
            return [];
        }
        let manifest;
        try {
            manifest = this.readInstalledManifest(runtimeStatus.runtimeRoot);
        }
        catch {
            return [];
        }
        if (!manifest) {
            return [];
        }
        const fromManifest = modelsFromManifest(manifest, runtimeStatus.runtimeRoot);
        if (fromManifest.length > 0) {
            return fromManifest;
        }
        const fallbackPath = node_path_1.default.join(runtimeStatus.runtimeRoot, 'model', 'typo_classifier_edgetpu.tflite');
        if (!node_fs_1.default.existsSync(fallbackPath)) {
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
    ensureRuntimeDownloaded(config, uri, force = false) {
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
        this.log(`local-typo-acceleration runtime-download start source=${this.runtimeBaseUrl}/${folder}/runtime-manifest.json platform=${process.platform} arch=${process.arch} force=${force}`, uri, false);
        this.downloadInFlight = this.downloadRuntime(folder, process.arch)
            .then((runtimeRoot) => {
            this.emitProgress({
                phase: 'success',
                statusText: `Runtime telepítve: ${runtimeRoot}`
            });
            this.log(`local-typo-acceleration runtime-download success runtimeRoot='${runtimeRoot}'`, uri, false);
        })
            .catch((error) => {
            this.emitProgress({
                phase: 'failed',
                statusText: `Runtime letöltési hiba: ${formatError(error)}`
            });
            this.log(`local-typo-acceleration runtime-download failed reason=${formatError(error)}`, uri, true);
        })
            .finally(() => {
            this.downloadInFlight = undefined;
        });
    }
    getRuntimeStatusFor(folder, arch) {
        const archCandidates = [arch, 'universal'];
        for (const candidateArch of archCandidates) {
            const runtimeRoot = this.getRuntimeRoot(folder, candidateArch);
            const manifestPath = node_path_1.default.join(runtimeRoot, 'runtime-manifest.json');
            let manifest;
            try {
                manifest = this.readInstalledManifest(runtimeRoot);
            }
            catch (error) {
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
                    const fullPath = node_path_1.default.join(runtimeRoot, relative);
                    if (!node_fs_1.default.existsSync(fullPath)) {
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
            }
            catch (error) {
                return {
                    present: false,
                    detail: `runtime manifest olvasási hiba '${manifestPath}': ${formatError(error)}`
                };
            }
        }
        return {
            present: false,
            detail: `runtime nincs telepítve (${folder}/${arch}). Várható manifest: '${node_path_1.default.join(this.getRuntimeRoot(folder, arch), 'runtime-manifest.json')}'`
        };
    }
    readInstalledManifest(runtimeRoot) {
        const manifestPath = node_path_1.default.join(runtimeRoot, 'runtime-manifest.json');
        if (!node_fs_1.default.existsSync(manifestPath)) {
            return undefined;
        }
        const parsed = JSON.parse(node_fs_1.default.readFileSync(manifestPath, 'utf8'));
        return parsed;
    }
    async downloadRuntime(folder, arch) {
        const manifestUrl = `${this.runtimeBaseUrl}/${folder}/runtime-manifest.json`;
        const rawManifest = await httpsGetBuffer(manifestUrl);
        const manifest = JSON.parse(rawManifest.toString('utf8'));
        if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
            throw new Error(`üres runtime manifest (${manifestUrl})`);
        }
        if (manifest.arch && manifest.arch !== arch && manifest.arch !== 'universal') {
            throw new Error(`manifest arch mismatch (manifest=${manifest.arch}, local=${arch})`);
        }
        this.emitProgress({
            phase: 'manifest',
            statusText: `Runtime manifest letöltve (${manifest.files.length} fájl)`,
            fileCount: manifest.files.length
        });
        const targetArch = manifest.arch && manifest.arch.length > 0 ? manifest.arch : arch;
        const runtimeRoot = this.getRuntimeRoot(folder, targetArch);
        node_fs_1.default.mkdirSync(runtimeRoot, { recursive: true });
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
                const percent = Math.max(0, Math.min(100, Math.floor((receivedBytes / totalBytes) * 100)));
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
                    throw new Error(`checksum mismatch '${relativePath}' expected=${expectedSha} actual=${actualSha}`);
                }
            }
            const outputPath = node_path_1.default.join(runtimeRoot, relativePath);
            const outputDir = node_path_1.default.dirname(outputPath);
            node_fs_1.default.mkdirSync(outputDir, { recursive: true });
            const tmpPath = `${outputPath}.download`;
            node_fs_1.default.writeFileSync(tmpPath, payload);
            node_fs_1.default.renameSync(tmpPath, outputPath);
            if (file.executable === true || isLikelyExecutableRuntimePath(relativePath)) {
                node_fs_1.default.chmodSync(outputPath, 0o755);
            }
        }
        const installedManifestPath = node_path_1.default.join(runtimeRoot, 'runtime-manifest.json');
        const installedManifest = {
            ...manifest,
            downloadedAtUtc: new Date().toISOString(),
            sourceManifestUrl: manifestUrl
        };
        node_fs_1.default.writeFileSync(installedManifestPath, JSON.stringify(installedManifest, null, 2));
        return runtimeRoot;
    }
    getRuntimeRoot(folder, arch) {
        return node_path_1.default.join(this.installRoot, folder, arch);
    }
    emitProgress(progress) {
        if (!this.onProgress) {
            return;
        }
        try {
            this.onProgress(progress);
        }
        catch {
            // progress callback must never break runtime provisioning
        }
    }
}
function platformFolderForCurrentPlatform() {
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
function probeCoralOnMacOs() {
    const systemProfiler = (0, node_child_process_1.spawnSync)('system_profiler', ['SPUSBDataType'], {
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
    const ioreg = (0, node_child_process_1.spawnSync)('ioreg', ['-p', 'IOUSB', '-l', '-w', '0'], {
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
        detail: `Coral USB eszköz nem látható a system_profiler vagy ioreg kimenetben` +
            ` (system_profiler status=${systemProfiler.status ?? 'n/a'}, ioreg status=${ioreg.status ?? 'n/a'})`
    };
}
function looksLikeCoralIoreg(output) {
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
class HeuristicLocalTypoClassifier {
    classify(request) {
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
        let likelyTypo = distance <= 1 ||
            (distance === 2 && similarity >= 0.55) ||
            (distance === 3 && similarity >= 0.72 && normalizedToken.length >= 8);
        if (domainToken && distance > 2) {
            likelyTypo = false;
        }
        if (likelyTypo) {
            const category = request.context === 'identifier' ? 'IdentifierTypo' : 'TextTypo';
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
class VscodeAcceleratorNotificationService {
    constructor(context, log) {
        this.autoPromptKey = 'kospellcheck.localTypoAcceleration.autoPromptShown.v1';
        this.onUnavailablePromptKey = 'kospellcheck.localTypoAcceleration.onUnavailablePromptShown.v1';
        this.context = context;
        this.log = log;
    }
    notifyAutoModeDetection(mode, showPrompt) {
        if (mode !== 'auto' || !showPrompt) {
            return;
        }
        if (this.context.globalState.get(this.autoPromptKey, false)) {
            return;
        }
        void this.context.globalState.update(this.autoPromptKey, true);
        const enableAlwaysOn = 'Enable Always On';
        const keepAuto = 'Keep Auto';
        void vscode.window
            .showInformationMessage('Local typo accelerator detected. Enable faster local typo classification?', enableAlwaysOn, keepAuto)
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
    notifyOnModeUnavailable(status) {
        if (this.context.globalState.get(this.onUnavailablePromptKey, false)) {
            return;
        }
        void this.context.globalState.update(this.onUnavailablePromptKey, true);
        const detail = status === 'UnavailableMissingRuntime'
            ? 'Bundled local runtime is not present in this build.'
            : status === 'UnavailableUnsupportedPlatform'
                ? 'Current platform is not supported by this optional path.'
                : 'A compatible local accelerator is not available right now.';
        void vscode.window.showInformationMessage(`KoSpellCheck local typo acceleration is ON, but unavailable. ${detail} Falling back to standard local spell checking.`);
    }
}
function buildResult(isTypo, confidence, category, reason) {
    return {
        isTypo,
        confidence,
        category,
        backend: 'heuristic-local',
        reason
    };
}
function normalizeForMatch(value) {
    return value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\s+/gu, '');
}
function looksLikeDomainToken(token) {
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
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function clampNumber(value, min, max, fallback) {
    const numberValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numberValue)) {
        return fallback;
    }
    return clamp(numberValue, min, max);
}
function parseTypoCategory(value) {
    if (value === 'IdentifierTypo' || value === 'TextTypo' || value === 'NotTypo' || value === 'Uncertain') {
        return value;
    }
    return undefined;
}
function isExecutableFile(targetPath) {
    try {
        node_fs_1.default.accessSync(targetPath, node_fs_1.default.constants.F_OK | node_fs_1.default.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function topSuggestionText(suggestions) {
    const top = suggestions[0]?.replacement?.trim();
    return top && top.length > 0 ? top : 'n/a';
}
function sanitizeModelSelection(value) {
    const normalized = (value ?? '').trim();
    return normalized.length > 0 ? normalized : 'auto';
}
function chooseRuntimeModel(models, requestedModelId) {
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
function modelsFromManifest(manifest, runtimeRoot) {
    if (!Array.isArray(manifest.models)) {
        return [];
    }
    const output = [];
    const usedIds = new Set();
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
            const absolutePath = node_path_1.default.join(runtimeRoot, relativePath);
            if (!node_fs_1.default.existsSync(absolutePath)) {
                continue;
            }
            usedIds.add(id);
            output.push({
                id,
                displayName: typeof model.displayName === 'string' && model.displayName.trim().length > 0
                    ? model.displayName.trim()
                    : id,
                description: typeof model.description === 'string' && model.description.trim().length > 0
                    ? model.description.trim()
                    : undefined,
                format: typeof model.format === 'string' && model.format.trim().length > 0
                    ? model.format.trim()
                    : 'edgetpu-tflite',
                relativePath,
                absolutePath,
                isDefault: model.default === true
            });
        }
        catch {
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
function isLikelyExecutableRuntimePath(relativePath) {
    return relativePath.startsWith('bin/') && !relativePath.endsWith('.json');
}
function resolveAdapterCandidates(primaryAdapterPath, runtimeRoot) {
    const candidates = [primaryAdapterPath];
    const fallback = node_path_1.default.join(runtimeRoot, 'bin', 'coral-typo-classifier');
    if (!candidates.includes(fallback) && node_fs_1.default.existsSync(fallback)) {
        candidates.push(fallback);
    }
    return candidates;
}
function sanitizeRelativePath(inputPath) {
    const normalized = inputPath.replace(/\\/gu, '/').trim();
    if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
        throw new Error(`érvénytelen runtime path: '${inputPath}'`);
    }
    return normalized;
}
function resolveManifestFileUrl(manifestUrl, fileUrl) {
    if (!fileUrl || fileUrl.trim().length === 0) {
        throw new Error('runtime file url hiányzik');
    }
    return new URL(fileUrl, manifestUrl).toString();
}
function sha256Hex(buffer) {
    return node_crypto_1.default.createHash('sha256').update(buffer).digest('hex');
}
function httpsGetBuffer(url, redirectDepth = 0, onProgress) {
    return new Promise((resolve, reject) => {
        if (redirectDepth > 5) {
            reject(new Error(`túl sok redirect: ${url}`));
            return;
        }
        const target = new URL(url);
        if (target.protocol !== 'https:') {
            reject(new Error(`csak https támogatott: ${url}`));
            return;
        }
        const req = node_https_1.default.get(target, {
            headers: {
                'User-Agent': 'KoSpellCheck/0.1.10'
            }
        }, (res) => {
            const statusCode = res.statusCode ?? 0;
            if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
                const redirected = new URL(res.headers.location, target).toString();
                res.resume();
                void httpsGetBuffer(redirected, redirectDepth + 1, onProgress).then(resolve, reject);
                return;
            }
            if (statusCode !== 200) {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                res.on('end', () => {
                    reject(new Error(`letöltési hiba status=${statusCode} url=${url} body=${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`));
                });
                return;
            }
            const chunks = [];
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
        });
        req.setTimeout(20_000, () => {
            req.destroy(new Error(`időtúllépés: ${url}`));
        });
        req.on('error', reject);
    });
}
function parseContentLengthHeader(value) {
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
function boundedDamerauLevenshtein(left, right, maxDistance) {
    if (Math.abs(left.length - right.length) > maxDistance) {
        return maxDistance + 1;
    }
    const previousPrevious = new Array(right.length + 1).fill(0);
    let previous = new Array(right.length + 1).fill(0);
    let current = new Array(right.length + 1).fill(0);
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
            if (i > 1 &&
                j > 1 &&
                left[i - 1] === right[j - 2] &&
                left[i - 2] === right[j - 1]) {
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
        current = new Array(right.length + 1).fill(0);
    }
    return previous[right.length];
}
function formatError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
//# sourceMappingURL=localTypoAcceleration.js.map