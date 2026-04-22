#!/usr/bin/env node
// Cursor `stop` hook. Fires when the agent finishes an assistant turn.
//
// Purpose: the onboarding last-ditch trigger for existing chats. Cursor's
// hook API has no equivalent of Claude Code's `UserPromptSubmit`, so when
// the user sends a purely conversational message ("hi", "start working")
// in an existing chat AND the agent replies without calling a tool,
// neither `sessionStart` nor `postToolUse` fires — the pending-onboarding
// marker sits there untouched and the agent never learns about it.
//
// This hook closes that gap. When the agent's reply finishes and a
// marker is still pending (and no task is active yet), we auto-submit
// the onboarding trigger as the next user message via `followup_message`.
// Cursor then feeds that as the next user turn, so the agent pivots to
// the Task onboarding protocol on its very next reply.
//
// Cost: one generic agent reply before onboarding kicks in.
// Benefit: no silent-failure case anymore, regardless of whether the
// user starts a new chat or reuses an existing one.
//
// One-shot: consumeOnboardingMarker reads + deletes atomically, so the
// followup fires exactly once per `pnpm task start`. The `loop_limit: 1`
// setting in hooks.json is a belt-and-suspenders cap.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const scopeUrl   = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/scope.mjs')).href;
const onboardUrl = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/onboarding.mjs')).href;

const { resolveRepoRoot, resolveActiveTaskId, checkNodeVersion } = await import(scopeUrl);
const { consumeOnboardingMarker }                                = await import(onboardUrl);

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
  // The stop hook receives {status, loop_count, ...}. We don't care about
  // it — we only act when a pending-onboarding marker is still there.
  readStdin();

  const root = resolveRepoRoot();
  const { id: taskId } = resolveActiveTaskId(root);

  // Active task → onboarding already happened (or irrelevant). Nothing to do.
  if (taskId) return emit({});

  const payload = consumeOnboardingMarker(root);
  if (!payload) return emit({});

  // Cursor will auto-submit `followup_message` as the next user message.
  // The payload already contains the full onboarding protocol + the user's
  // task description, so the agent's next turn has everything it needs.
  return emit({ followup_message: payload });
}

main().catch(err => {
  process.stderr.write(`stop hook error: ${err?.message || err}\n`);
  emit({});
});
