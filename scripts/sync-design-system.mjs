#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const cleanShare = args.has('--clean-share');
const sourceRoot = path.resolve(
  process.env.PTO_DESIGN_SYSTEM_SOURCE || path.join(repoRoot, 'vendor/pto-design-system'),
);

const shareTargets = [
  'README.md',
  'SKILL.md',
  'DESIGN.md',
  'design-system-preview.html',
  'assets',
  'css',
  'graphviz',
  'patterns',
  'references',
  'scripts',
  'swimlane',
  'tokens',
];

const runtimeTargets = [
  'assets',
  'css',
  'patterns',
  'tokens',
];

const runtimeScriptTargets = [
  'scripts/audit-theme.mjs',
  'scripts/liquid-glass.js',
];

const excludedNames = new Set([
  '.git',
  '.github',
  '.learnings',
  '.DS_Store',
]);

function rel(filePath) {
  return path.relative(repoRoot, filePath) || '.';
}

function assertSource() {
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Missing design-system source: ${sourceRoot}`);
  }
  const required = ['README.md', 'SKILL.md', 'DESIGN.md', 'tokens', 'css', 'patterns'];
  required.forEach((item) => {
    const target = path.join(sourceRoot, item);
    if (!fs.existsSync(target)) {
      throw new Error(`Design-system source is missing ${item}: ${target}`);
    }
  });
}

function shouldCopy(src) {
  return !excludedNames.has(path.basename(src));
}

function copyEntry(src, dest, options = {}) {
  if (!fs.existsSync(src)) return;
  const action = `${options.clean ? 'mirror' : 'copy'} ${rel(src)} -> ${rel(dest)}`;
  if (!write) {
    console.log(`[dry-run] ${action}`);
    return;
  }
  if (options.clean && fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    filter: shouldCopy,
  });
  console.log(`[write] ${action}`);
}

function syncShare() {
  const shareRoot = path.join(repoRoot, 'design-system-share');
  shareTargets.forEach((item) => {
    copyEntry(
      path.join(sourceRoot, item),
      path.join(shareRoot, item),
      { clean: cleanShare },
    );
  });
}

function syncRuntimeMirrors() {
  runtimeTargets.forEach((item) => {
    copyEntry(path.join(sourceRoot, item), path.join(repoRoot, item));
  });
  runtimeScriptTargets.forEach((item) => {
    copyEntry(path.join(sourceRoot, item), path.join(repoRoot, item));
  });
}

assertSource();
console.log(`source: ${sourceRoot}`);
console.log(write ? 'mode: write' : 'mode: dry-run');
if (cleanShare) console.log('share mirror: clean enabled');

syncShare();
syncRuntimeMirrors();

if (!write) {
  console.log('No files changed. Re-run with --write to copy files.');
}
