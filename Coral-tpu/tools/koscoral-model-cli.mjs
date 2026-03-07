#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function printUsage() {
  console.log(`KoSpellCheck Coral model builder

Usage:
  node Coral-tpu/tools/koscoral-model-cli.mjs build \
    --input <training.txt> \
    --model-id <id> \
    [--display-name "My model"] \
    [--description "..."] \
    [--preset balanced|precision|recall] \
    [--outdir Coral-tpu/MacOs/Models] \
    [--manifest Coral-tpu/MacOs/runtime-manifest.json] \
    [--add-to-manifest] \
    [--set-default]

Notes:
- This tool generates a local KoSpellCheck profile-backed .tflite artifact + .meta.json sidecar.
- The generated .tflite file is a lightweight packaging artifact for KoSpellCheck adapters.
- True EdgeTPU compiler output requires an external EdgeTPU training/compilation pipeline.
`);
}

function parseArgs(argv) {
  const out = {
    command: '',
    options: {}
  };

  if (argv.length === 0) {
    return out;
  }

  out.command = argv[0];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out.options[key] = true;
      continue;
    }

    out.options[key] = next;
    i += 1;
  }

  return out;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function toPosixPath(input) {
  return input.replace(/\\/g, '/');
}

function sanitizeModelId(raw) {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  if (!normalized) {
    fail('invalid --model-id');
  }
  return normalized;
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function tokenize(text) {
  const matches = text.match(/[\p{L}\p{M}\p{N}_'-]+/gu) ?? [];
  return matches.map((token) => token.trim()).filter(Boolean);
}

function analyzeCorpus(tokens) {
  const total = tokens.length;
  if (total === 0) {
    return {
      totalTokens: 0,
      avgLength: 0,
      longRatio: 0,
      shortRatio: 0,
      identifierRatio: 0,
      mixedCaseRatio: 0,
      digitRatio: 0,
      noisyRatio: 0
    };
  }

  let totalLength = 0;
  let longCount = 0;
  let shortCount = 0;
  let identifierCount = 0;
  let mixedCaseCount = 0;
  let digitCount = 0;
  let noisyCount = 0;

  for (const token of tokens) {
    totalLength += token.length;
    if (token.length >= 9) {
      longCount += 1;
    }
    if (token.length <= 3) {
      shortCount += 1;
    }
    if (/^[\p{L}_][\p{L}\p{M}\p{N}_-]*$/u.test(token)) {
      identifierCount += 1;
    }
    if (/\p{Lu}/u.test(token) && /\p{Ll}/u.test(token)) {
      mixedCaseCount += 1;
    }
    if (/\d/u.test(token)) {
      digitCount += 1;
    }
    if (/(.)\1{2,}/u.test(token) || /(qz|zx|xq|wq)/iu.test(token)) {
      noisyCount += 1;
    }
  }

  return {
    totalTokens: total,
    avgLength: totalLength / total,
    longRatio: longCount / total,
    shortRatio: shortCount / total,
    identifierRatio: identifierCount / total,
    mixedCaseRatio: mixedCaseCount / total,
    digitRatio: digitCount / total,
    noisyRatio: noisyCount / total
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function baseProfileForPreset(preset) {
  switch (preset) {
    case 'precision':
      return {
        intercept: -0.16,
        distanceWeight: -1.18,
        similarityWeight: 3.15,
        identifierBoost: 0.17,
        literalBoost: 0.05,
        longTokenBoost: 0.03,
        shortTokenPenalty: -0.12,
        typoThreshold: 0.68,
        notTypoThreshold: 0.29
      };
    case 'recall':
      return {
        intercept: 0.02,
        distanceWeight: -0.86,
        similarityWeight: 2.30,
        identifierBoost: 0.29,
        literalBoost: 0.10,
        longTokenBoost: 0.12,
        shortTokenPenalty: -0.08,
        typoThreshold: 0.56,
        notTypoThreshold: 0.38
      };
    case 'balanced':
    default:
      return {
        intercept: -0.08,
        distanceWeight: -1.02,
        similarityWeight: 2.75,
        identifierBoost: 0.24,
        literalBoost: 0.08,
        longTokenBoost: 0.09,
        shortTokenPenalty: -0.10,
        typoThreshold: 0.62,
        notTypoThreshold: 0.34
      };
  }
}

function profileFromCorpus(preset, stats) {
  const profile = baseProfileForPreset(preset);

  const codeLikeRatio = clamp(
    (stats.identifierRatio * 0.55) + (stats.mixedCaseRatio * 0.25) + (stats.digitRatio * 0.20),
    0,
    1
  );

  profile.identifierBoost = clamp(profile.identifierBoost + ((codeLikeRatio - 0.5) * 0.24), 0.05, 0.45);
  profile.literalBoost = clamp(profile.literalBoost - ((codeLikeRatio - 0.5) * 0.10), 0.02, 0.2);
  profile.longTokenBoost = clamp(profile.longTokenBoost + ((stats.longRatio - 0.33) * 0.18), 0.0, 0.2);
  profile.shortTokenPenalty = clamp(profile.shortTokenPenalty - (stats.shortRatio * 0.09), -0.25, -0.02);

  const avgLenAdjustment = clamp((stats.avgLength - 7.5) * 0.02, -0.08, 0.08);
  profile.similarityWeight = clamp(profile.similarityWeight + avgLenAdjustment, 2.1, 3.4);

  profile.typoThreshold = clamp(
    profile.typoThreshold + (stats.noisyRatio * 0.08) + ((codeLikeRatio - 0.5) * 0.04),
    0.50,
    0.90
  );
  profile.notTypoThreshold = clamp(
    profile.notTypoThreshold - (stats.noisyRatio * 0.05) + ((0.5 - codeLikeRatio) * 0.03),
    0.10,
    0.45
  );

  return profile;
}

function buildModelBinary(metaObject) {
  const payload = {
    schemaVersion: 1,
    type: 'kospellcheck-profile-packed-tflite',
    profileHash: sha256Hex(Buffer.from(JSON.stringify(metaObject.profile), 'utf8')),
    id: metaObject.id,
    createdAtUtc: metaObject.createdAtUtc
  };

  const header = Buffer.from('TFL3_KOSPELLCHECK_PROFILE_V1\n', 'utf8');
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  return Buffer.concat([header, body]);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function relativeFromManifest(manifestPath, targetPath) {
  const rel = path.relative(path.dirname(manifestPath), targetPath);
  return toPosixPath(rel);
}

function upsertManifestFile(manifest, entry) {
  if (!Array.isArray(manifest.files)) {
    manifest.files = [];
  }

  const idx = manifest.files.findIndex((item) => item.path === entry.path);
  if (idx >= 0) {
    manifest.files[idx] = entry;
    return;
  }

  manifest.files.push(entry);
}

function upsertManifestModel(manifest, entry, setDefault) {
  if (!Array.isArray(manifest.models)) {
    manifest.models = [];
  }

  const idx = manifest.models.findIndex((item) => item.id === entry.id);
  if (idx >= 0) {
    manifest.models[idx] = entry;
  } else {
    manifest.models.push(entry);
  }

  if (setDefault) {
    for (const model of manifest.models) {
      model.default = model.id === entry.id;
    }
  }
}

function runBuild(options) {
  const inputPath = options.input;
  if (!inputPath) {
    fail('--input is required');
  }

  if (!fs.existsSync(inputPath)) {
    fail(`input not found: ${inputPath}`);
  }

  const presetRaw = String(options.preset ?? 'balanced').toLowerCase();
  const preset = presetRaw === 'precision' || presetRaw === 'recall' ? presetRaw : 'balanced';

  const modelId = sanitizeModelId(options['model-id'] ?? path.parse(inputPath).name);
  const displayName = String(options['display-name'] ?? `${modelId} (${preset})`).trim();
  const description = String(options.description ?? `Local typo profile model built from ${path.basename(inputPath)}`).trim();

  const outDir = path.resolve(String(options.outdir ?? 'Coral-tpu/MacOs/Models'));
  ensureDir(outDir);

  const modelPath = path.join(outDir, `${modelId}.tflite`);
  const metaPath = `${modelPath}.meta.json`;

  const corpus = fs.readFileSync(inputPath, 'utf8');
  const tokens = tokenize(corpus);
  const stats = analyzeCorpus(tokens);
  const profile = profileFromCorpus(preset, stats);

  const createdAtUtc = new Date().toISOString();
  const meta = {
    schemaVersion: 1,
    id: modelId,
    displayName,
    description,
    preset,
    createdAtUtc,
    source: {
      inputFile: path.resolve(inputPath),
      tokenCount: stats.totalTokens,
      avgLength: Number(stats.avgLength.toFixed(3)),
      longRatio: Number(stats.longRatio.toFixed(4)),
      shortRatio: Number(stats.shortRatio.toFixed(4)),
      identifierRatio: Number(stats.identifierRatio.toFixed(4)),
      mixedCaseRatio: Number(stats.mixedCaseRatio.toFixed(4)),
      digitRatio: Number(stats.digitRatio.toFixed(4)),
      noisyRatio: Number(stats.noisyRatio.toFixed(4))
    },
    profile
  };

  const modelBuffer = buildModelBinary(meta);
  fs.writeFileSync(modelPath, modelBuffer);
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  const modelSha = sha256Hex(fs.readFileSync(modelPath));
  const metaSha = sha256Hex(fs.readFileSync(metaPath));

  let manifestUpdated = false;
  let manifestPath;
  if (options['add-to-manifest']) {
    manifestPath = path.resolve(String(options.manifest ?? 'Coral-tpu/MacOs/runtime-manifest.json'));
    if (!fs.existsSync(manifestPath)) {
      fail(`manifest not found: ${manifestPath}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const modelRel = relativeFromManifest(manifestPath, modelPath);
    const metaRel = relativeFromManifest(manifestPath, metaPath);

    upsertManifestFile(manifest, {
      path: modelRel,
      url: modelRel,
      sha256: modelSha
    });
    upsertManifestFile(manifest, {
      path: metaRel,
      url: metaRel,
      sha256: metaSha
    });

    upsertManifestModel(
      manifest,
      {
        id: modelId,
        displayName,
        path: modelRel,
        format: 'edgetpu-tflite',
        description
      },
      Boolean(options['set-default'])
    );

    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    manifestUpdated = true;
  }

  console.log('Model generated successfully.');
  console.log(`- model: ${modelPath}`);
  console.log(`- meta: ${metaPath}`);
  console.log(`- preset: ${preset}`);
  console.log(`- tokens: ${stats.totalTokens}`);
  console.log(`- sha256 model: ${modelSha}`);
  console.log(`- sha256 meta: ${metaSha}`);
  if (manifestUpdated && manifestPath) {
    console.log(`- manifest updated: ${manifestPath}`);
  }

  console.log('\nIMPORTANT: This tool creates a KoSpellCheck profile-backed .tflite package.');
  console.log('For true EdgeTPU-compiled model binaries, use a dedicated external training/compilation pipeline.');
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!command || command === '--help' || command === 'help') {
    printUsage();
    process.exit(0);
  }

  if (command !== 'build') {
    fail(`unknown command: ${command}`);
  }

  runBuild(options);
}

main();
