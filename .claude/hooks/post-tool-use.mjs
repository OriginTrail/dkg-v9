#!/usr/bin/env node
// Claude Code PostToolUse hook (any tool except Bash, which has its own
// shell-diff-check). Purpose: if a pending onboarding marker exists
// (written by `pnpm task start`), inject the trigger as additional
// context. READ-ONLY — does NOT delete the marker.
//
// In Claude Code, `UserPromptSubmit` (see user-prompt-submit.mjs) is the
// authoritative consumer — it fires BEFORE the agent sees a prompt, so
// there is no race. This hook is kept as a best-effort mid-turn
// injection for Claude Code flows where a tool call happens before
// UserPromptSubmit delivered anything (edge case).
//
// Peek semantics mirror the Cursor hook. See its header for the full
// rationale and the list of authoritative deleters.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const scopeUrl   = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/scope.mjs')).href;
const onboardUrl = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/onboarding.mjs')).href;

const { resolveRepoRoot, resolveActiveTaskId, checkNodeVersion } = await import(scopeUrl);
const { readOnboardingMarker }                                   = await import(onboardUrl);

try { checkNodeVersion(); } catch (e) {
  process.stderr.write(e.message + '\n');
  process.stdout.write('{}');
  process.exit(0);
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj || {}));
  process.exit(0);
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

async function main() {
  readStdin();

  const root = resolveRepoRoot();
  const { id: taskId } = resolveActiveTaskId(root);

  if (taskId) return emit({});

  const payload = readOnboardingMarker(root);
  if (!payload) return emit({});

  return emit({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: payload,
    },
  });
}

main().catch(err => {
  process.stderr.write(`post-tool-use hook error: ${err?.message || err}\n`);
  emit({});
});
