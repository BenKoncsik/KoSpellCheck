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
    constructor(context, _extensionPath, log) {
        this.hadAcceleratorPath = false;
        this.runtimeProvisioner = new GitHubRuntimeProvisioner(context, log);
        this.availabilityService = new CoralAcceleratorAvailabilityService(this.runtimeProvisioner);
        this.classifier = new HeuristicLocalTypoClassifier();
        this.notificationService = new VscodeAcceleratorNotificationService(context, log);
        this.log = log;
    }
    requestRuntimeDownload(config, uri, force = false) {
        this.runtimeProvisioner.ensureRuntimeDownloaded(config, uri, force);
    }
    inspectAvailability(forceRefresh = false) {
        return this.availabilityService.getAvailability(forceRefresh);
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
        this.log('local-typo-acceleration coral-communication status=active typo-classifier-backend=heuristic-local (Coral model adapter pending integration)', document.uri, false);
        if (config.localTypoAccelerationMode === 'auto') {
            this.notificationService.notifyAutoModeDetection(config.localTypoAccelerationMode, config.localTypoAccelerationShowDetectionPrompt);
        }
        this.hadAcceleratorPath = true;
        this.logPath('accelerated', config, document.uri);
        return this.classifyIssues(document, issues, resolveContext, config);
    }
    classifyIssues(document, issues, resolveContext, config) {
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
            const result = this.classifier.classify({
                token: issue.token,
                suggestions: issue.suggestions,
                context
            });
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
    constructor(context, log) {
        this.lastDownloadAttemptAt = 0;
        this.log = log;
        this.installRoot = node_path_1.default.join(context.globalStorageUri.fsPath, 'coral-tpu-runtime');
        this.runtimeBaseUrl = DEFAULT_RUNTIME_BASE_URL;
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
        this.log(`local-typo-acceleration runtime-download start source=${this.runtimeBaseUrl}/${folder}/runtime-manifest.json platform=${process.platform} arch=${process.arch} force=${force}`, uri, false);
        this.downloadInFlight = this.downloadRuntime(folder, process.arch)
            .then((runtimeRoot) => {
            this.log(`local-typo-acceleration runtime-download success runtimeRoot='${runtimeRoot}'`, uri, false);
        })
            .catch((error) => {
            this.log(`local-typo-acceleration runtime-download failed reason=${formatError(error)}`, uri, false);
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
            if (!node_fs_1.default.existsSync(manifestPath)) {
                continue;
            }
            try {
                const manifest = JSON.parse(node_fs_1.default.readFileSync(manifestPath, 'utf8'));
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
        const targetArch = manifest.arch && manifest.arch.length > 0 ? manifest.arch : arch;
        const runtimeRoot = this.getRuntimeRoot(folder, targetArch);
        node_fs_1.default.mkdirSync(runtimeRoot, { recursive: true });
        for (const file of manifest.files) {
            const relativePath = sanitizeRelativePath(file.path);
            const sourceUrl = resolveManifestFileUrl(manifestUrl, file.url);
            const payload = await httpsGetBuffer(sourceUrl);
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
    const result = (0, node_child_process_1.spawnSync)('system_profiler', ['SPUSBDataType'], {
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
function topSuggestionText(suggestions) {
    const top = suggestions[0]?.replacement?.trim();
    return top && top.length > 0 ? top : 'n/a';
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
function httpsGetBuffer(url, redirectDepth = 0) {
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
                void httpsGetBuffer(redirected, redirectDepth + 1).then(resolve, reject);
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
            res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.setTimeout(20_000, () => {
            req.destroy(new Error(`időtúllépés: ${url}`));
        });
        req.on('error', reject);
    });
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