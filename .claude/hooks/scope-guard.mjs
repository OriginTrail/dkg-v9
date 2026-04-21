#!/usr/bin/env node
// Claude Code PreToolUse hook for write-class tools (Write/Edit/MultiEdit/
// NotebookEdit). Blocks writes to:
//   1. Hardcoded protected paths (always, unless bootstrap mode is on)
//   2. Paths outside the active task's allowed/exemption globs
//
// Same policy as the Cursor preToolUse hook — only the I/O envelope
// differs. All decisions go through agent-scope/lib so Cursor and Claude
// Code stay byte-for-byte identical on rule semantics.
//
// Claude Code I/O contract:
//   stdin:  JSON { session_id, hook_event_name, tool_name, tool_input, ... }
//   stdout: JSON { hookSpecificOutput: {
//             hookEventName: "PreToolUse",
//             permissionDecision: "deny" | "allow" | "ask",
//             permissionDecisionReason: "..." } }
//   exit 0 always for clean handling (non-zero would error out the agent).

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

  const toolName  = payload.tool_name || payload.toolName || payload.tool || '';
  const toolInput = payload.tool_input || payload.toolInput || payload.input || {};
  const sessionId = payload.session_id || payload.sessionId || null;

  const GUARDED = /^(Write|Edit|MultiEdit|NotebookEdit|StrReplace|Delete|EditNotebook)$/;
  if (!GUARDED.test(toolName)) return allow();

  const targetPath = extractTargetPath(toolInput);
  if (!targetPath) return allow();

  const root = resolveRepoRoot();
  const rel = normalizeToRepoPath(root, targetPath);

  if (checkProtected(rel, root) === 'deny') {
    const { id: tid } = resolveActiveTaskId(root);
    logDenial(root, {
      event: 'preToolUse.protected',
      tool: toolName,
      path: rel,
      task: tid,
      sessionId,
      agent: 'claude-code',
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
    agent: 'claude-code',
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
    agent: 'claude-code',
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
