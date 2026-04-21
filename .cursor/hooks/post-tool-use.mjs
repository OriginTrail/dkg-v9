#!/usr/bin/env node
// Cursor postToolUse hook. Fires after every tool the agent calls.
//
// Sole purpose: detect a pending `agent-scope/.pending-onboarding` marker
// (written by `pnpm task start`) and inject the onboarding trigger as
// `additional_context`. One-shot: `consumeOnboardingMarker` reads-and-deletes
// atomically, so the trigger fires exactly once even across many tool calls.
//
// No deny, no permission gating. Purely additive.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const scopeUrl    = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/scope.mjs')).href;
const onboardUrl  = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/onboarding.mjs')).href;

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
  readStdin();

  const root = resolveRepoRoot();
  const { id: taskId } = resolveActiveTaskId(root);

  if (taskId) return emit({});

  const payload = consumeOnboardingMarker(root);
  if (!payload) return emit({});

  return emit({ additional_context: payload });
}

main().catch(err => {
  process.stderr.write(`post-tool-use hook error: ${err?.message || err}\n`);
  emit({});
});
