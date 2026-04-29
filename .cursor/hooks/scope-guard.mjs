#!/usr/bin/env node
// Cursor preToolUse hook. Blocks writes to paths outside the active task's scope,
// and always-deny to hardcoded protected system files.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const scopeUrl  = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/scope.mjs')).href;
const logUrl    = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/log.mjs')).href;
const denialUrl = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/denial.mjs')).href;
const {
  resolveRepoRoot, resolveActiveTaskId, loadTask, checkPath,
  normalizeToRepoPath, checkNodeVersion, checkProtected,
} = await import(scopeUrl);
const { logDenial, logDecision } = await import(logUrl);
const {
  buildPreToolUseDenial, buildLoadErrorDenial,
} = await import(denialUrl);

try { checkNodeVersion(); } catch (e) {
  process.stderr.write(e.message + '\n');
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}

function allow() {
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}

function deny(msg) {
  process.stdout.write(JSON.stringify({
    permission: 'deny',
    agent_message: msg,
    user_message: 'agent-scope blocked an out-of-task write — see agent_message for the plan-mode menu.',
  }));
  process.exit(0);
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function extractTargetPath(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  return (
    toolInput.path ||
    toolInput.target_file ||
    toolInput.file_path ||
    toolInput.filepath ||
    toolInput.notebook_path ||
    toolInput.target_notebook ||
    null
  );
}

async function main() {
  const raw = readStdin();
  if (!raw) return allow();

  let payload;
  try { payload = JSON.parse(raw); } catch { return allow(); }

  const toolName = payload.tool_name || payload.toolName || payload.tool || '';
  const toolInput = payload.tool_input || payload.toolInput || payload.input || {};
  const sessionId = payload.session_id || payload.sessionId || null;

  const GUARDED = /^(Write|StrReplace|Delete|EditNotebook|MultiEdit|Edit)$/;
  if (!GUARDED.test(toolName)) return allow();

  const targetPath = extractTargetPath(toolInput);
  if (!targetPath) return allow();

  const root = resolveRepoRoot();
  const rel = normalizeToRepoPath(root, targetPath);

  // Protected-path check runs even without an active task.
  if (checkProtected(rel, root) === 'deny') {
    const { id: tid } = resolveActiveTaskId(root);
    logDenial(root, {
      event: 'preToolUse.protected',
      tool: toolName,
      path: rel,
      task: tid,
      sessionId,
    });
    const { message } = buildPreToolUseDenial({
      tool: toolName, deniedPath: rel, decision: 'protected',
      task: null, taskId: tid, root,
    });
    return deny(message);
  }

  const { id: taskId, source: taskSource } = resolveActiveTaskId(root);
  if (!taskId) return allow();

  let task;
  try { task = loadTask(root, taskId); }
  catch (e) {
    const { message } = buildLoadErrorDenial({ taskId, error: e.message });
    return deny(message);
  }

  const decision = checkPath(task, rel, root);

  logDecision(root, {
    event: 'preToolUse',
    tool: toolName,
    decision,
    path: rel,
    task: taskId,
    taskSource,
    sessionId,
  });

  if (decision === 'allow' || decision === 'exempt') return allow();

  logDenial(root, {
    event: 'preToolUse.deny',
    tool: toolName,
    path: rel,
    decision,
    task: taskId,
    taskSource,
    sessionId,
  });

  const { message } = buildPreToolUseDenial({
    tool: toolName, deniedPath: rel, decision,
    task, taskId, root,
  });
  return deny(message);
}

main().catch(err => {
  process.stderr.write(`scope-guard hook error: ${err?.message || err}\n`);
  allow();
});
