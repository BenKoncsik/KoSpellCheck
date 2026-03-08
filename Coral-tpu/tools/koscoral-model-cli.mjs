#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(scriptDir, '..', '..');
const trainScript = path.join(scriptDir, 'train_huen_typo_model.py');
const requirementsPath = path.join(scriptDir, 'requirements-coral-train.txt');
const defaultVenvDir = path.join(repoRoot, '.venv-kospellcheck-coral-train');
const preferredExistingVenvs = [
  path.join(repoRoot, '.venv-kospellcheck-coral-train'),
  path.join(repoRoot, '.venv-coral-train215'),
  path.join(repoRoot, '.venv-coral-train')
];

function printUsage() {
  console.log(`KoSpellCheck Coral model builder

Usage:
  node Coral-tpu/tools/koscoral-model-cli.mjs build \
    [--input training.txt] \
    --model-id typo_classifier_huen \
    [--display-name "Typo Classifier"] \
    [--description "..."] \
    [--preset balanced|precision|recall] \
    [--outdir Coral-tpu/MacOs/Models] \
    [--add-to-manifest] \
    [--set-default]

Notes:
- This command trains and exports a real int8 TensorFlow Lite FlatBuffer model.
- The architecture is EdgeTPU-friendly; if edgetpu_compiler is available and you pass --compile-edgetpu, the tool will try to compile it.
- By default it learns from the bundled Hungarian and English dictionaries, optionally biased by your input text.
`);
}

function venvPythonPath(venvDir) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: options.stdio ?? 'pipe',
    encoding: 'utf8'
  });
}

function ensureSuccess(result, action) {
  if (result.error) {
    throw new Error(`${action}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const detail = stderr || stdout || `exit=${result.status}`;
    throw new Error(`${action}: ${detail}`);
  }
}

function pythonHasTrainingDeps(pythonPath) {
  if (!pythonPath || !fs.existsSync(pythonPath)) {
    return false;
  }
  const result = run(pythonPath, ['-c', 'import tensorflow, numpy']);
  return result.status === 0;
}

function discoverBasePython() {
  if (process.env.KOSPELLCHECK_CORAL_MODEL_BASE_PYTHON) {
    return {
      command: process.env.KOSPELLCHECK_CORAL_MODEL_BASE_PYTHON,
      args: []
    };
  }

  const candidates = process.platform === 'win32'
    ? [
        { command: 'py', args: ['-3'] },
        { command: 'python', args: [] }
      ]
    : [
        { command: 'python3', args: [] },
        { command: 'python', args: [] }
      ];

  for (const candidate of candidates) {
    const result = run(candidate.command, [...candidate.args, '--version']);
    if (result.status === 0) {
      return candidate;
    }
  }

  throw new Error('No suitable base Python interpreter found');
}

function bootstrapTrainingVenv(venvDir) {
  const basePython = discoverBasePython();
  if (!fs.existsSync(venvPythonPath(venvDir))) {
    const create = run(basePython.command, [...basePython.args, '-m', 'venv', venvDir], {
      stdio: 'inherit'
    });
    ensureSuccess(create, 'Creating training virtualenv failed');
  }

  const pythonPath = venvPythonPath(venvDir);
  const pipUpgrade = run(pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
    stdio: 'inherit'
  });
  ensureSuccess(pipUpgrade, 'Upgrading pip failed');

  const install = run(pythonPath, ['-m', 'pip', 'install', '-r', requirementsPath], {
    stdio: 'inherit'
  });
  ensureSuccess(install, 'Installing training dependencies failed');
  return pythonPath;
}

function resolvePythonInterpreter() {
  if (process.env.KOSPELLCHECK_CORAL_MODEL_PYTHON) {
    return process.env.KOSPELLCHECK_CORAL_MODEL_PYTHON;
  }

  for (const venvDir of preferredExistingVenvs) {
    const pythonPath = venvPythonPath(venvDir);
    if (pythonHasTrainingDeps(pythonPath)) {
      return pythonPath;
    }
  }

  if (process.env.KOSPELLCHECK_SKIP_BOOTSTRAP === '1') {
    throw new Error('No TensorFlow training environment found and bootstrap is disabled');
  }

  return bootstrapTrainingVenv(defaultVenvDir);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
    printUsage();
    process.exit(0);
  }

  if (!fs.existsSync(trainScript)) {
    console.error(`Missing training script: ${trainScript}`);
    process.exit(1);
  }

  try {
    const pythonPath = resolvePythonInterpreter();
    const result = spawnSync(pythonPath, [trainScript, ...args], {
      cwd: repoRoot,
      stdio: 'inherit'
    });
    if (result.error) {
      throw result.error;
    }
    process.exit(result.status ?? 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
