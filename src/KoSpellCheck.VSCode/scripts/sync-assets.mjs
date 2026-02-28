import fs from 'node:fs';
import path from 'node:path';

const extensionRoot = process.cwd();
const repoRoot = path.resolve(extensionRoot, '..', '..');
const sourceDictionaries = path.join(repoRoot, 'tools', 'dictionaries');
const sourceLicenses = path.join(repoRoot, 'tools', 'licenses');
const targetDictionaries = path.join(extensionRoot, 'resources', 'dictionaries');
const targetLicenses = path.join(extensionRoot, 'resources', 'licenses');

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

ensureDir(path.join(extensionRoot, 'resources'));
ensureDir(targetDictionaries);
ensureDir(targetLicenses);
clearDir(targetDictionaries);
clearDir(targetLicenses);
copyRecursive(sourceDictionaries, targetDictionaries);
copyRecursive(sourceLicenses, targetLicenses);
