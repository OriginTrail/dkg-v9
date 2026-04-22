#!/usr/bin/env node
// Cursor postToolUse hook. Fires after every tool the agent calls.
//
// Purpose: if a pending `agent-scope/.pending-onboarding` marker exists
// (written by `pnpm task start`), inject its content as
// `additional_context`. READ-ONLY — does NOT delete the marker.
//
// Why peek and not consume?
// Earlier versions did read-and-delete here. That created a nasty race in
// existing Cursor chats: the first tool call the agent made (for any
// reason) deleted the marker, but Cursor's `additional_context` from
// postToolUse did not reliably land in the current turn's visible
// context. Net result: marker gone, agent never saw the payload, agent
// reports "something was here but I can't see it".
//
// New lifecycle — the marker persists until one of these authoritative
// consumers runs:
//   - `sessionStart` hook          (new chat: delete + inject once)
//   - `stop` hook                  (end-of-turn in existing Cursor chat:
//                                   delete + re-submit as next user
//                                   message via followup_message, which
//                                   IS Cursor-guaranteed)
//   - `pnpm task create --activate` (success = "I processed it")
//   - `pnpm task clear`             (user abandons)
//
// This hook stays as the fast-path best-effort injection: if Cursor DOES
// stitch additional_context into the current turn, the agent reacts
// immediately. If it doesn't, `stop` is the safety net. Either way the
// marker survives until an authoritative deleter runs.
//
// Re-injection noise (same payload on every tool call) is harmless —
// additional_context is internal, never shown to the user, and the
// onboarding protocol is idempotent.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const scopeUrl    = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/scope.mjs')).href;
const onboardUrl  = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/onboarding.mjs')).href;

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

  return emit({ additional_context: payload });
}

main().catch(err => {
  process.stderr.write(`post-tool-use hook error: ${err?.message || err}\n`);
  emit({});
});
