#!/usr/bin/env node
// Cursor beforeShellExecution hook. Scans shell commands for destructive
// operations targeting out-of-scope paths and blocks them BEFORE they run.
//
// Parsing logic lives in agent-scope/lib/shell-parse.mjs (pure + testable).
//
// Directly-detected destructive verbs:
//   rm / unlink / rmdir / mv / cp / chmod / chown / truncate / install / ln / sed -i
//   redirections  > / >> / &> / tee
//   find ... -delete / -exec rm ...
//   xargs <destructive>
//
// Nested shells (bash -c "...", sh -c, zsh -c, dash -c, ksh -c):
//   Recursively parse the -c body and apply the same rules.
//
// Opaque evaluators (node -e, python -c, perl -e, ruby -e, php -r, lua -e,
// deno eval): string-scan the body. Deny iff it contains BOTH a write-intent
// hint (writeFileSync, os.remove, open(...,"w"), rm, etc.) AND references a
// protected path literal. This is conservative to avoid false positives; the
// afterShell hook is the backstop for anything that slips through (it
// deletes untracked files in denied paths and reverts tracked edits).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const scopeUrl  = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/scope.mjs')).href;
const logUrl    = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/log.mjs')).href;
const parseUrl  = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/shell-parse.mjs')).href;
const denialUrl = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/denial.mjs')).href;
const {
  resolveRepoRoot, resolveActiveTaskId, loadTask, checkPath,
  normalizeToRepoPath, checkNodeVersion, PROTECTED_PATTERNS, coversProtected,
} = await import(scopeUrl);
const { logDenial } = await import(logUrl);
const {
  splitCommands, tokenize, extractRedirections, extractDestructiveTargets,
  extractFindTargets, extractXargsTarget, extractNestedShellBody,
  extractOpaqueBody, bodyHasWriteIntent, bodyTouchesProtected,
} = await import(parseUrl);
const { buildShellPrecheckDenial } = await import(denialUrl);

try { checkNodeVersion(); } catch (e) {
  process.stderr.write(e.message + '\n');
  process.stdout.write('{}');
  process.exit(0);
}

function emit(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0); }
function allow() { emit({}); }
function deny(msg) {
  emit({
    permission: 'deny',
    agent_message: msg,
    user_message: 'agent-scope pre-shell guard blocked a destructive command — see agent_message for the plan-mode menu.',
  });
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

// Scan one sub-command string. Recurses into bash -c "<inner>".
function scanSubCommand(sub, { task, root, violations, depth = 0 }) {
  if (depth > 4) return;
  const tokens = tokenize(sub);
  if (!tokens.length) return;

  const nested = extractNestedShellBody(tokens);
  if (nested) {
    for (const s of splitCommands(nested.body)) {
      scanSubCommand(s, { task, root, violations, depth: depth + 1 });
    }
    return;
  }

  const opaque = extractOpaqueBody(tokens);
  if (opaque) {
    const { evaluator, body } = opaque;
    if (bodyHasWriteIntent(body) && bodyTouchesProtected(body, PROTECTED_PATTERNS)) {
      violations.push({
        sub, cmd: `${evaluator} ${opaque.flag}`,
        path: '(opaque body writes to protected path)',
        decision: 'protected',
      });
    }
    return;
  }

  const direct = extractDestructiveTargets(tokens);
  const redirects = extractRedirections(tokens).map(t => ({ kind: 'redirect', path: t }));
  const findTargets = extractFindTargets(tokens);
  const xargsTarget = extractXargsTarget(tokens);

  const candidates = [
    ...direct.targets.map(t => ({ kind: direct.cmd, path: t })),
    ...redirects,
    ...(findTargets ? findTargets.targets.map(t => ({ kind: 'find', path: t })) : []),
  ];

  if (xargsTarget && bodyTouchesProtected(sub, PROTECTED_PATTERNS)) {
    violations.push({
      sub, cmd: xargsTarget.cmd,
      path: '(stdin-driven; command text mentions protected path)',
      decision: 'protected',
    });
  }

  for (const { kind, path } of candidates) {
    if (!path) continue;
    if (path.startsWith('/dev/') || path === '/dev/null') continue;
    if (path.includes('://')) continue;
    const rel = normalizeToRepoPath(root, path);
    if (rel.startsWith('../') || rel === '..') continue;

    const decision = checkPath(task, rel, root);
    if (decision === 'deny' || decision === 'protected') {
      violations.push({ sub, cmd: kind, path: rel, decision });
      continue;
    }
    // For recursive/tree-destructive ops (rm -rf <dir>, find <dir> -delete),
    // also check whether the target directory CONTAINS any protected path.
    const isRecursive = kind === 'find' || (kind === 'rm' && /\brm\b.*\s-\w*r/.test(sub));
    if (isRecursive && coversProtected(rel, root)) {
      violations.push({ sub, cmd: kind, path: rel, decision: 'protected (covers)' });
    }
  }
}

async function main() {
  if (process.env.AGENT_SCOPE_BOOTSTRAP === '1') return allow();

  const raw = readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { return allow(); }

  const command = payload.command || payload.shell_command || '';
  const sessionId = payload.session_id || null;
  if (!command || typeof command !== 'string') return allow();

  const root = resolveRepoRoot();
  const { id: taskId } = resolveActiveTaskId(root);

  let task = null;
  if (taskId) {
    try { task = loadTask(root, taskId); }
    catch { return allow(); }
  }

  const violations = [];
  for (const sub of splitCommands(command)) {
    scanSubCommand(sub, { task, root, violations });
  }

  if (violations.length === 0) return allow();

  for (const v of violations) {
    logDenial(root, {
      event: 'beforeShell.deny',
      tool: 'Shell',
      cmd: v.cmd,
      path: v.path,
      decision: v.decision,
      task: taskId,
      command,
      sessionId,
    });
  }

  const { message } = buildShellPrecheckDenial({
    command, violations, task, taskId, root,
  });
  deny(message);
}

main().catch(err => {
  process.stderr.write(`shell-precheck error: ${err?.message || err}\n`);
  allow();
});
