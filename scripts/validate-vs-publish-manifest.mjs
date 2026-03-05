#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const manifestPath = process.argv[2] ?? 'src/KoSpellCheck.VS2022/publishManifest.json';
const resolvedPath = path.resolve(manifestPath);

function fail(message) {
  console.error(`[validate-vs-publish-manifest] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(resolvedPath)) {
  fail(`file not found: ${resolvedPath}`);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
} catch (error) {
  fail(`invalid JSON in ${resolvedPath}: ${String(error)}`);
}

const internalName = manifest?.identity?.internalName;
if (typeof internalName !== 'string' || internalName.trim().length === 0) {
  fail(`identity.internalName is missing in ${resolvedPath}`);
}

const normalized = internalName.trim();
if (normalized.length > 63) {
  fail(`identity.internalName must be <= 63 chars, got ${normalized.length}: '${normalized}'`);
}

const allowedPattern = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
if (!allowedPattern.test(normalized)) {
  fail(
    `identity.internalName '${normalized}' is invalid. Allowed: A-Z, a-z, 0-9, '-' and it must start with alphanumeric.`
  );
}

console.log(`[validate-vs-publish-manifest] OK: ${resolvedPath}`);
