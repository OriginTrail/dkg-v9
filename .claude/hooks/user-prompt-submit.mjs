#!/usr/bin/env node
// Claude Code UserPromptSubmit hook. Fires BEFORE the agent processes the
// user's message. This is the primary onboarding trigger in Claude Code
// because — unlike Cursor's beforeSubmitPrompt — Claude Code lets us
// inject additional_context here, so we get reliable transparent
// onboarding even for purely conversational messages ("hi") in any chat,
// new or existing.
//
// One-shot: consumeOnboardingMarker is atomic, so the trigger fires for
// exactly one user message after `pnpm task start`.
//
// We ALSO surface the bootstrap warning here so the user/agent never
// forget bootstrap is on between turns.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const scopeUrl   = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/scope.mjs')).href;
const onboardUrl = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/onboarding.mjs')).href;

const {
  resolveRepoRoot, resolveActiveTaskId, checkNodeVersion, isBootstrapActive,
} = await import(scopeUrl);
const { consumeOnboardingMarker } = await import(onboardUrl);

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
  const bootstrap = isBootstrapActive(root);

  // Active task → silent. The session-start hook already injected the
  // active-task block; we don't want to re-inject it on every prompt.
  if (taskId) return emit({});

  // No active task → check for onboarding marker.
  const onboarding = consumeOnboardingMarker(root);

  if (!onboarding && !bootstrap) return emit({});

  const blocks = [];
  if (onboarding) blocks.push(onboarding);
  if (bootstrap) {
    blocks.push([
      '# agent-scope: BOOTSTRAP MODE ACTIVE',
      '',
      'Hardcoded path protection is currently DISABLED. Writes to system files',
      'are permitted. If you are not improving agent-scope itself, ask the user',
      'to run: rm agent-scope/.bootstrap-token',
    ].join('\n'));
  }

  emit({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: blocks.join('\n\n'),
    },
  });
}

main().catch(err => {
  process.stderr.write(`user-prompt-submit hook error: ${err?.message || err}\n`);
  emit({});
});
