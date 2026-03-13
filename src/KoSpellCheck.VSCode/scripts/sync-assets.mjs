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
const cliHostRuntimeIdentifiers = [
  'win-x64',
  'win-arm64',
  'win-x86',
  'linux-x64',
  'linux-arm64',
  'linux-x86',
  'osx-x64',
  'osx-arm64'
];

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
      try {
        fs.rmdirSync(entryPath);
      } catch (error) {
        if (isPermissionError(error) || isNotEmptyDirectoryError(error)) {
          logWarn(`cannot remove directory '${entryPath}': ${error.message}`);
          continue;
        }

        throw error;
      }
    } else {
      try {
        fs.unlinkSync(entryPath);
      } catch (error) {
        if (isPermissionError(error)) {
          logWarn(`cannot remove file '${entryPath}': ${error.message}`);
          continue;
        }

        throw error;
      }
    }
  }
}

function isPermissionError(error) {
  return (
    !!error &&
    typeof error === 'object' &&
    ('code' in error) &&
    (error.code === 'EACCES' || error.code === 'EPERM')
  );
}

function isNotEmptyDirectoryError(error) {
  return !!error && typeof error === 'object' && ('code' in error) && error.code === 'ENOTEMPTY';
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
    '-p:UseAppHost=false',
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

function runDotnetPublishCli(targetFramework, runtimeIdentifier) {
  const args = [
    'publish',
    cliProjectPath,
    '-c',
    'Release',
    '-f',
    targetFramework,
    '-r',
    runtimeIdentifier,
    '--self-contained',
    'false',
    '--nologo'
  ];
  const result = spawnSync('dotnet', args, {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0) {
    const missingAppHost =
      combinedOutput.includes('NETSDK1084') &&
      combinedOutput.includes(`RuntimeIdentifier '${runtimeIdentifier}'`) &&
      combinedOutput.includes('There is no application host available');

    if (missingAppHost) {
      logWarn(
        `no RID apphost available for ${runtimeIdentifier} (${targetFramework}); using framework-dependent fallback`
      );
      return {
        ok: false,
        missingAppHost: true
      };
    }

    logWarn(
      `failed to publish ProjectConventions CLI for ${runtimeIdentifier} (${targetFramework}) (exit=${String(result.status)}): ${result.stderr || result.stdout || 'unknown error'}`
    );
    return {
      ok: false,
      missingAppHost: false
    };
  }

  if (result.stderr?.trim()) {
    logInfo(`dotnet publish stderr (${runtimeIdentifier}, ${targetFramework}): ${result.stderr.trim()}`);
  }

  return {
    ok: true,
    missingAppHost: false
  };
}

function syncProjectConventionsCliHosts() {
  const hostsRoot = path.join(targetCliRoot, 'hosts');
  ensureDir(hostsRoot);

  let copiedHostCount = 0;
  let missingAppHostFallbackCount = 0;
  let failedHostCount = 0;
  for (const runtimeIdentifier of cliHostRuntimeIdentifiers) {
    for (const framework of cliTargetFrameworks) {
      const published = runDotnetPublishCli(framework, runtimeIdentifier);
      let sourceDir = path.join(
        repoRoot,
        'src',
        'KoSpellCheck.ProjectConventions.Cli',
        'bin',
        'Release',
        framework,
        runtimeIdentifier,
        'publish'
      );

      if (!published.ok) {
        if (!published.missingAppHost) {
          failedHostCount += 1;
          continue;
        }

        sourceDir = path.join(
          repoRoot,
          'src',
          'KoSpellCheck.ProjectConventions.Cli',
          'bin',
          'Release',
          framework
        );
        missingAppHostFallbackCount += 1;
      }

      if (!fs.existsSync(sourceDir)) {
        logWarn(`CLI host source directory missing: ${sourceDir}`);
        failedHostCount += 1;
        continue;
      }

      const targetDir = path.join(hostsRoot, runtimeIdentifier, framework);
      ensureDir(targetDir);
      clearDir(targetDir);
      copyRecursive(sourceDir, targetDir);
      copiedHostCount += 1;
      logInfo(`packaged core CLI host copied: ${targetDir}`);
    }
  }

  if (missingAppHostFallbackCount > 0) {
    logWarn(
      `${String(missingAppHostFallbackCount)} RID host bundles were packaged without apphost; extension will launch them via dotnet <dll>`
    );
  }

  if (failedHostCount > 0) {
    throw new Error(`failed to package ${String(failedHostCount)} RID-specific CLI host bundles`);
  }

  if (copiedHostCount === 0) {
    logWarn('no RID-specific CLI hosts were copied; extension will fall back to dotnet <dll> launch');
  }
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

  syncProjectConventionsCliHosts();
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
