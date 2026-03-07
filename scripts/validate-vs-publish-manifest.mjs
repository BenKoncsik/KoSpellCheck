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

const allowedInternalNamePattern = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
if (!allowedInternalNamePattern.test(normalized)) {
  fail(
    `identity.internalName '${normalized}' is invalid. Allowed: A-Z, a-z, 0-9, '-' and it must start with alphanumeric.`
  );
}

const publisher = manifest?.publisher;
if (typeof publisher !== 'string' || publisher.trim().length === 0) {
  fail(`publisher is missing in ${resolvedPath}`);
}

const publisherNormalized = publisher.trim();
const allowedPublisherPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
if (!allowedPublisherPattern.test(publisherNormalized)) {
  fail(
    `publisher '${publisherNormalized}' is invalid. Allowed: A-Z, a-z, 0-9, '-', '_' and it must start with alphanumeric.`
  );
}

const repoRoot = path.resolve(path.dirname(resolvedPath), '..', '..');
const vscodePackagePath = path.join(repoRoot, 'src', 'KoSpellCheck.VSCode', 'package.json');
const vsixManifestPath = path.join(path.dirname(resolvedPath), 'source.extension.vsixmanifest');
if (fs.existsSync(vscodePackagePath)) {
  try {
    const vscodePackage = JSON.parse(fs.readFileSync(vscodePackagePath, 'utf8'));
    const vscodePublisher = typeof vscodePackage?.publisher === 'string'
      ? vscodePackage.publisher.trim()
      : '';

    if (vscodePublisher.length > 0 && vscodePublisher !== publisherNormalized) {
      console.warn(
        `[validate-vs-publish-manifest] warning: VS2022 publish manifest uses '${publisherNormalized}', VS Code package uses '${vscodePublisher}'.`
      );
    }
  } catch (error) {
    fail(`invalid VS Code package.json (${vscodePackagePath}): ${String(error)}`);
  }
}

if (!fs.existsSync(vsixManifestPath)) {
  fail(`VSIX manifest not found: ${vsixManifestPath}`);
}

const vsixManifestContent = fs.readFileSync(vsixManifestPath, 'utf8');
const identityTagMatch = vsixManifestContent.match(/<Identity\b[^>]*>/i);
if (!identityTagMatch) {
  fail(`missing <Identity ...> element in ${vsixManifestPath}`);
}

const identityTag = identityTagMatch[0];
const idMatch = identityTag.match(/\bId="([^"]+)"/i);
const publisherMatch = identityTag.match(/\bPublisher="([^"]+)"/i);

if (!idMatch || idMatch[1].trim().length === 0) {
  fail(`missing Identity@Id in ${vsixManifestPath}`);
}

if (!publisherMatch || publisherMatch[1].trim().length === 0) {
  fail(`missing Identity@Publisher in ${vsixManifestPath}`);
}

const vsixId = idMatch[1].trim();
const vsixPublisher = publisherMatch[1].trim();
if (vsixPublisher !== publisherNormalized) {
  fail(
    `publisher mismatch: VSIX manifest uses '${vsixPublisher}', publish manifest uses '${publisherNormalized}'.`
  );
}

const expectedInternalName = vsixId.replace(/\./g, '-');
if (normalized !== expectedInternalName) {
  fail(
    `internalName mismatch: publish manifest uses '${normalized}', expected '${expectedInternalName}' derived from VSIX Identity@Id '${vsixId}'.`
  );
}

console.log(
  `[validate-vs-publish-manifest] VSIX Identity: id='${vsixId}', publisher='${vsixPublisher}', internalName='${normalized}'`
);
console.log(`[validate-vs-publish-manifest] OK: ${resolvedPath}`);
