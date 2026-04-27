#!/usr/bin/env node
// Claude Code UserPromptSubmit hook. Fires BEFORE the agent processes the
// user's message. We use it to surface the bootstrap warning so the
// user/agent never forget bootstrap is on between turns. Onboarding is
// gone (the local task-manifest flow has been replaced by DKG-driven
// scope), so this hook now exists purely for the bootstrap reminder.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const scopeUrl = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/scope.mjs')).href;
const { resolveRepoRoot, checkNodeVersion, isBootstrapActive } = await import(scopeUrl);

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
  if (!isBootstrapActive(root)) return emit({});

  emit({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: [
        '# agent-scope: BOOTSTRAP MODE ACTIVE',
        '',
        'Hardcoded path protection is currently DISABLED. Writes to system files',
        'are permitted. If you are not improving agent-scope itself, ask the user',
        'to run: rm agent-scope/.bootstrap-token',
      ].join('\n'),
    },
  });
}

main().catch((err) => {
  process.stderr.write(`user-prompt-submit hook error: ${err?.message || err}\n`);
  emit({});
});
