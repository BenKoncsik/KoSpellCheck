"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeFileAgainstProfile = analyzeFileAgainstProfile;
const aiScorer_1 = require("./aiScorer");
const persistence_1 = require("./persistence");
const ruleEngine_1 = require("./ruleEngine");
const statisticalAnomaly_1 = require("./statisticalAnomaly");
function analyzeFileAgainstProfile(file, profile, options) {
    let diagnostics = (0, ruleEngine_1.evaluateDeterministicRules)(file, profile, options.minEvidenceCount);
    diagnostics = diagnostics.filter((diagnostic) => !(0, persistence_1.isIgnored)(options.ignoreList, diagnostic.ruleId, file.relativePath, file.folderPath));
    const deterministicViolationCount = diagnostics.length;
    const statistical = (0, statisticalAnomaly_1.computeStatisticalAnomaly)(file, profile, deterministicViolationCount);
    if (options.statisticalEnabled) {
        diagnostics = diagnostics.map((diagnostic) => {
            const boosted = clamp01(diagnostic.confidence * 0.75 + statistical.result.score * 0.25);
            return {
                ...diagnostic,
                confidence: boosted,
                anomalyScore: statistical.result.score,
                evidence: [
                    ...diagnostic.evidence,
                    ...statistical.result.signals.slice(0, 2)
                ]
            };
        });
        if (diagnostics.length > 0 &&
            statistical.result.score >= options.statisticalThreshold) {
            diagnostics.push(createStatisticalSupportDiagnostic(file, statistical.result.score, statistical.result.signals));
        }
    }
    const ai = (0, aiScorer_1.scoreWithOptionalAi)(statistical.vector, {
        enabled: options.aiEnabled,
        useCoralIfAvailable: options.useCoralIfAvailable,
        modelPath: options.modelPath,
        coralRuntime: options.coralRuntime
    }, options.log);
    if (ai && ai.score >= options.aiThreshold) {
        diagnostics = diagnostics.map((diagnostic) => {
            const boosted = clamp01(diagnostic.confidence * 0.8 + ai.score * 0.2);
            return {
                ...diagnostic,
                confidence: boosted,
                aiScore: ai.score,
                evidence: [
                    ...diagnostic.evidence,
                    {
                        metric: 'local AI anomaly score',
                        expected: 'low anomaly score',
                        observed: ai.score.toFixed(2),
                        ratio: ai.score
                    }
                ]
            };
        });
        if (diagnostics.length > 0) {
            diagnostics.push(createAiSupportDiagnostic(file, ai.score, ai.backend));
        }
    }
    return {
        file,
        diagnostics,
        statistical: options.statisticalEnabled ? statistical.result : undefined,
        ai
    };
}
function createStatisticalSupportDiagnostic(file, score, signals) {
    return {
        ruleId: 'KS_CONV_STAT_001',
        title: 'Statistical naming anomaly signal',
        severity: score >= 0.8 ? 'warning' : 'info',
        confidence: clamp01(score),
        message: `This file has a high statistical naming anomaly score (${score.toFixed(2)}) compared to learned project patterns.`,
        explanation: 'The statistical layer ranked this file as unusual using folder-suffix, namespace-path, and token frequency associations.',
        evidence: signals,
        suggestions: ['Review naming and location for consistency with existing project conventions'],
        quickFixes: [
            {
                kind: 'ignoreRuleForFile',
                title: 'Ignore statistical anomaly for this file',
                ruleId: 'KS_CONV_STAT_001',
                scopeTarget: file.relativePath
            }
        ],
        filePath: file.relativePath,
        line: file.primaryType?.line ?? 0,
        column: file.primaryType?.column ?? 0,
        anomalyScore: score
    };
}
function createAiSupportDiagnostic(file, score, backend) {
    return {
        ruleId: 'KS_CONV_AI_001',
        title: 'Local AI naming anomaly signal',
        severity: score >= 0.85 ? 'warning' : 'info',
        confidence: clamp01(score),
        message: `Local AI anomaly score is ${score.toFixed(2)} (${backend}).`,
        explanation: 'A lightweight local model marked this naming pattern as an outlier. This signal is advisory and complements deterministic rules.',
        evidence: [
            {
                metric: 'local AI backend',
                expected: 'cpu-logistic or coral-adapter',
                observed: backend,
                ratio: score
            }
        ],
        suggestions: ['Review deterministic diagnostics and apply conventions where appropriate'],
        quickFixes: [
            {
                kind: 'ignoreRuleForFile',
                title: 'Ignore AI anomaly for this file',
                ruleId: 'KS_CONV_AI_001',
                scopeTarget: file.relativePath
            }
        ],
        filePath: file.relativePath,
        line: file.primaryType?.line ?? 0,
        column: file.primaryType?.column ?? 0,
        aiScore: score
    };
}
function clamp01(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value <= 0) {
        return 0;
    }
    if (value >= 1) {
        return 1;
    }
    return value;
}
//# sourceMappingURL=analyzer.js.map