#!/usr/bin/env node
// Check one or more paths against the active task scope AND the hardcoded
// protected-path list. Used by git hooks and CI.
// Exits non-zero if any path is denied or protected (without bootstrap).

import { readFileSync } from 'node:fs';
import {
  resolveRepoRoot,
  getActiveTaskId,
  loadTask,
  checkPath,
  normalizeToRepoPath,
  checkNodeVersion,
} from '../lib/scope.mjs';

try { checkNodeVersion(); }
catch (e) { console.error(e.message); process.exit(3); }

const args = process.argv.slice(2);
let taskOverride = null;
let stdinMode = false;
const paths = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--task') { taskOverride = args[++i]; continue; }
  if (a === '--stdin') { stdinMode = true; continue; }
  if (a === '-h' || a === '--help') {
    console.log('usage: scope-check [--task <id>] [--stdin] [<path> ...]');
    process.exit(0);
  }
  paths.push(a);
}

if (stdinMode) {
  const data = readFileSync(0, 'utf8');
  for (const line of data.split(/\r?\n/)) {
    const p = line.trim();
    if (p) paths.push(p);
  }
}

if (paths.length === 0) {
  console.error('scope-check: no paths provided');
  process.exit(2);
}

const root = resolveRepoRoot();
const taskId = taskOverride || getActiveTaskId(root);
const task = taskId ? loadTask(root, taskId) : null;

let anyBad = false;
for (const p of paths) {
  const rel = normalizeToRepoPath(root, p);
  const decision = checkPath(task, rel, root);
  console.log(`${decision.padEnd(9)} ${rel}`);
  if (decision === 'deny' || decision === 'protected') anyBad = true;
}

if (!task) {
  console.error('(no active task — only protected paths enforced)');
}

process.exit(anyBad ? 1 : 0);
