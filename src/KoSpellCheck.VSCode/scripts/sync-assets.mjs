import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const extensionRoot = process.cwd();
const repoRoot = path.resolve(extensionRoot, '..', '..');
const sourceDictionaries = path.join(repoRoot, 'tools', 'dictionaries');
const sourceLicenses = path.join(repoRoot, 'tools', 'licenses');
const sourceSharedUiStrings = path.join(
  repoRoot,
  'src',
  'KoSpellCheck.Core',
  'Localization',
  'SharedUiStrings.json'
);
const targetDictionaries = path.join(extensionRoot, 'resources', 'dictionaries');
const targetLicenses = path.join(extensionRoot, 'resources', 'licenses');
const targetI18nDir = path.join(extensionRoot, 'resources', 'i18n');
const targetSharedUiStrings = path.join(targetI18nDir, 'shared-ui-strings.json');
const targetPackageNls = path.join(extensionRoot, 'package.nls.json');
const targetPackageNlsHu = path.join(extensionRoot, 'package.nls.hu.json');
const cliProjectPath = path.join(
  repoRoot,
  'src',
  'KoSpellCheck.ProjectConventions.Cli',
  'KoSpellCheck.ProjectConventions.Cli.csproj'
);
const targetCliRoot = path.join(extensionRoot, 'resources', 'projectConventions', 'core-cli');
const cliTargetFrameworks = ['net9.0', 'net8.0'];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clearDir(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      clearDir(entryPath);
      fs.rmdirSync(entryPath);
    } else {
      fs.unlinkSync(entryPath);
    }
  }
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }

  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(destPath));
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function logInfo(message) {
  process.stdout.write(`[prepare-assets] ${message}\n`);
}

function logWarn(message) {
  process.stderr.write(`[prepare-assets] WARN: ${message}\n`);
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    logWarn(`failed to read JSON file '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function syncPackageLocalization(sharedUiPath) {
  const shared = readJson(sharedUiPath);
  if (!shared || typeof shared !== 'object') {
    return;
  }

  const languages = shared.languages ?? {};
  const english = languages.en ?? {};
  const hungarian = languages.hu ?? {};
  const keys = Object.keys(english).filter((key) => key.startsWith('kospellcheck.'));

  if (keys.length === 0) {
    logWarn('no package.nls keys found in shared UI catalog (expected prefix: kospellcheck.)');
    return;
  }

  const packageNls = {};
  const packageNlsHu = {};

  for (const key of keys.sort()) {
    const enValue = english[key];
    if (typeof enValue !== 'string' || enValue.trim().length === 0) {
      continue;
    }

    packageNls[key] = enValue;
    const huValue = hungarian[key];
    packageNlsHu[key] =
      typeof huValue === 'string' && huValue.trim().length > 0 ? huValue : enValue;
  }

  writeJson(targetPackageNls, packageNls);
  writeJson(targetPackageNlsHu, packageNlsHu);
  logInfo(`package localization synced: ${targetPackageNls}, ${targetPackageNlsHu}`);
}

function runDotnetBuildCli(targetFramework) {
  const args = [
    'build',
    cliProjectPath,
    '-c',
    'Release',
    '-f',
    targetFramework,
    '--nologo'
  ];
  const result = spawnSync('dotnet', args, {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    logWarn(
      `failed to build ProjectConventions CLI for ${targetFramework} (exit=${String(result.status)}): ${result.stderr || result.stdout || 'unknown error'}`
    );
    return false;
  }

  if (result.stderr?.trim()) {
    logInfo(`dotnet build stderr (${targetFramework}): ${result.stderr.trim()}`);
  }

  return true;
}

function syncProjectConventionsCli() {
  ensureDir(targetCliRoot);
  clearDir(targetCliRoot);

  if (!fs.existsSync(cliProjectPath)) {
    logWarn(`CLI project not found; skipping packaged CLI sync: ${cliProjectPath}`);
    return;
  }

  let copiedFrameworkCount = 0;
  for (const framework of cliTargetFrameworks) {
    const built = runDotnetBuildCli(framework);
    if (!built) {
      continue;
    }

    const outputDir = path.join(
      repoRoot,
      'src',
      'KoSpellCheck.ProjectConventions.Cli',
      'bin',
      'Release',
      framework
    );
    if (!fs.existsSync(outputDir)) {
      logWarn(`CLI output directory missing after build: ${outputDir}`);
      continue;
    }

    const targetDir = path.join(targetCliRoot, framework);
    ensureDir(targetDir);
    clearDir(targetDir);
    copyRecursive(outputDir, targetDir);
    copiedFrameworkCount += 1;
    logInfo(`packaged core CLI artifacts copied: ${targetDir}`);
  }

  if (copiedFrameworkCount === 0) {
    logWarn('no CLI artifacts were copied; project convention map will be unavailable without coreCliPath override');
  }
}

ensureDir(path.join(extensionRoot, 'resources'));
ensureDir(targetDictionaries);
ensureDir(targetLicenses);
ensureDir(targetI18nDir);
clearDir(targetDictionaries);
clearDir(targetLicenses);
copyRecursive(sourceDictionaries, targetDictionaries);
copyRecursive(sourceLicenses, targetLicenses);
if (fs.existsSync(sourceSharedUiStrings)) {
  fs.copyFileSync(sourceSharedUiStrings, targetSharedUiStrings);
  logInfo(`shared UI strings synced: ${targetSharedUiStrings}`);
  syncPackageLocalization(sourceSharedUiStrings);
} else {
  logWarn(`shared UI strings source file missing: ${sourceSharedUiStrings}`);
}
syncProjectConventionsCli();
