#!/usr/bin/env node
// Claude Code PreToolUse hook for the Bash tool. Mirrors the Cursor
// beforeShellExecution hook: scans the command for destructive operations
// targeting out-of-scope or protected paths and blocks before execution.
//
// All parsing logic lives in agent-scope/lib/shell-parse.mjs.

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
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  }));
  process.exit(0);
}

function emit(decision, reason) {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
    },
  };
  if (reason) out.hookSpecificOutput.permissionDecisionReason = reason;
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
const allow = () => emit('allow');
const deny  = (msg) => emit('deny', msg);

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

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

  const toolName = payload.tool_name || payload.toolName || '';
  if (toolName && toolName !== 'Bash') return allow();

  const toolInput = payload.tool_input || payload.toolInput || payload.input || {};
  const command   = toolInput.command || payload.command || payload.shell_command || '';
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
      tool: 'Bash',
      cmd: v.cmd,
      path: v.path,
      decision: v.decision,
      task: taskId,
      command,
      sessionId,
      agent: 'claude-code',
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
