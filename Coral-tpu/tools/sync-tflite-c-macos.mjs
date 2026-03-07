#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

const DEFAULT_URL =
  'https://github.com/tphakala/tflite_c/releases/download/v2.17.1/tflite_c_v2.17.1_darwin_arm64.tar.gz';

function parseArgs(argv) {
  const args = { url: DEFAULT_URL };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url' && i + 1 < argv.length) {
      args.url = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function httpsGetBuffer(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) {
      reject(new Error(`too many redirects: ${url}`));
      return;
    }

    const target = new URL(url);
    const req = https.get(
      target,
      {
        headers: {
          'User-Agent': 'KoSpellCheck-Sync/0.1'
        }
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          const redirected = new URL(res.headers.location, target).toString();
          res.resume();
          httpsGetBuffer(redirected, depth + 1).then(resolve, reject);
          return;
        }

        if (status !== 200) {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            reject(new Error(`download failed status=${status} body=${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`));
          });
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );

    req.setTimeout(30000, () => req.destroy(new Error(`timeout: ${url}`)));
    req.on('error', reject);
  });
}

function findTfLiteDylib(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = findTfLiteDylib(fullPath);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (entry.isFile() && /^libtensorflowlite_c(\.[0-9.]+)?\.dylib$/u.test(entry.name)) {
      return fullPath;
    }
  }

  return undefined;
}

function upsertManifestFile(manifest, fileEntry) {
  if (!Array.isArray(manifest.files)) {
    manifest.files = [];
  }

  const index = manifest.files.findIndex((item) => item.path === fileEntry.path);
  if (index >= 0) {
    manifest.files[index] = fileEntry;
  } else {
    manifest.files.push(fileEntry);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const macRoot = path.join(repoRoot, 'Coral-tpu', 'MacOs');
  const libTarget = path.join(macRoot, 'lib', 'libtensorflowlite_c.dylib');
  const manifestPath = path.join(macRoot, 'runtime-manifest.json');

  console.log(`Downloading TensorFlow Lite C runtime from: ${args.url}`);
  const archiveBuffer = await httpsGetBuffer(args.url);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kospell-tflite-c-'));
  const archivePath = path.join(tempDir, 'tflite-c-macos.tar.gz');
  fs.writeFileSync(archivePath, archiveBuffer);
  execFileSync('tar', ['-xzf', archivePath, '-C', tempDir], { stdio: 'inherit' });

  const dylibSource = findTfLiteDylib(tempDir);
  if (!dylibSource) {
    throw new Error('libtensorflowlite_c*.dylib not found in downloaded archive');
  }

  fs.mkdirSync(path.dirname(libTarget), { recursive: true });
  if (fs.existsSync(libTarget)) {
    fs.chmodSync(libTarget, 0o755);
  }
  fs.copyFileSync(dylibSource, libTarget);
  fs.chmodSync(libTarget, 0o755);

  const dylibBuffer = fs.readFileSync(libTarget);
  const dylibSha = sha256Hex(dylibBuffer);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  upsertManifestFile(manifest, {
    path: 'lib/libtensorflowlite_c.dylib',
    url: 'lib/libtensorflowlite_c.dylib',
    sha256: dylibSha
  });

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log('Updated:');
  console.log(`- ${libTarget}`);
  console.log(`- sha256: ${dylibSha}`);
  console.log(`- ${manifestPath}`);
}

main().catch((error) => {
  console.error(`sync-tflite-c-macos failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
