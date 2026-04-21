#!/usr/bin/env node
// Claude Code SessionStart hook. Mirrors the Cursor sessionStart hook:
// injects the active task's scope (or the onboarding trigger, or a
// bootstrap warning) into the agent's initial context.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const scopeUrl = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/scope.mjs')).href;
const onboardUrl = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/onboarding.mjs')).href;
const {
  resolveRepoRoot, resolveActiveTaskId, loadTask, checkNodeVersion, isBootstrapActive,
} = await import(scopeUrl);
const { consumeOnboardingMarker } = await import(onboardUrl);

try { checkNodeVersion(); } catch (e) {
  process.stderr.write(e.message + '\n');
  process.stdout.write('{}');
  process.exit(0);
}

function emit(context) {
  if (!context) { process.stdout.write('{}'); process.exit(0); }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  }));
  process.exit(0);
}

function readStdin() {
  try { readFileSync(0, 'utf8'); } catch { /* ignore */ }
}

async function main() {
  readStdin();
  const root = resolveRepoRoot();
  const { id: taskId, source } = resolveActiveTaskId(root);
  const bootstrap = isBootstrapActive(root);

  const onboarding = !taskId ? consumeOnboardingMarker(root) : null;

  const header = [];
  if (onboarding) {
    header.push(onboarding, '');
  }
  if (bootstrap) {
    header.push(
      '# agent-scope: BOOTSTRAP MODE ACTIVE',
      '',
      'Hardcoded path protection is currently DISABLED because a human has enabled',
      'bootstrap mode (token file or env var). Writes to system files are permitted.',
      '',
      'If you are not explicitly working on improving agent-scope itself, ask the',
      'user to disable bootstrap mode before proceeding:',
      '    rm agent-scope/.bootstrap-token',
      '',
    );
  }

  if (!taskId) {
    if (!bootstrap && !onboarding) return emit(null);
    if (onboarding && !bootstrap) return emit(header.join('\n').trim());
    return emit(header.concat([
      '# agent-scope: no active task',
      '',
      'Bootstrap is active but no task is set. System files are currently',
      'writable. When you finish the protected work, remove the token:',
      '    rm agent-scope/.bootstrap-token',
    ]).join('\n'));
  }

  let task;
  try { task = loadTask(root, taskId); }
  catch (e) {
    return emit(header.concat([
      `# agent-scope: ACTIVE TASK MANIFEST BROKEN (${taskId})`,
      '',
      `The manifest at agent-scope/tasks/${taskId}.json failed to load:`,
      `    ${e.message}`,
      '',
      'All writes will be denied until this is fixed. STOP and report this to the user.',
    ]).join('\n'));
  }

  const allowedPositive   = (task.allowed || []).filter(p => !p.startsWith('!'));
  const allowedNegative   = (task.allowed || []).filter(p => p.startsWith('!'));
  const exemptionsPositive = (task.exemptions || []).filter(p => !p.startsWith('!'));
  const exemptionsNegative = (task.exemptions || []).filter(p => p.startsWith('!'));

  const lines = header.concat([
    `# agent-scope: active task — ${task.id}`,
    '',
    `**Description:** ${task.description || '(none)'}`,
    task.owner ? `**Owner:** ${task.owner}` : null,
    `**Resolved from:** ${source}`,
    task.__inheritedFrom && task.__inheritedFrom.length ? `**Inherits from:** ${task.__inheritedFrom.join(', ')}` : null,
    '',
    '## You may modify files matching:',
    ...(allowedPositive.length ? allowedPositive.map(p => `- \`${p}\``) : ['- (nothing)']),
  ]);
  if (exemptionsPositive.length) {
    lines.push('', '## Always allowed (build artifacts, lockfiles):');
    for (const p of exemptionsPositive) lines.push(`- \`${p}\``);
  }
  if (allowedNegative.length || exemptionsNegative.length) {
    lines.push('', '## Explicitly denied (even if they look in-scope):');
    for (const p of [...allowedNegative, ...exemptionsNegative]) lines.push(`- \`${p}\``);
  }
  if (task.notes) {
    lines.push('', '## Task notes', task.notes);
  }
  lines.push(
    '',
    '## Rules',
    '- You may **read** any file in the repo.',
    '- You may **write** only files matching the patterns above.',
    '- System files (`.cursor/hooks/**`, `.claude/hooks/**`, `agent-scope/lib/**`, etc.) are hardcode-protected regardless of task.' + (bootstrap ? ' (currently bypassed by bootstrap mode)' : ''),
    '- If you believe an out-of-scope file must be changed for this task, STOP and ask the user for explicit approval. The user will grant approval by editing the manifest.',
    '- A Claude Code hook enforces this on every Write/Edit/Delete. A pre-Bash hook blocks destructive shell commands on denied paths. A post-Bash hook reverts anything that slipped through.',
    '- To clear or switch tasks, ask the user — do not edit `agent-scope/active` yourself.',
  );

  emit(lines.filter(l => l !== null).join('\n'));
}

main().catch(err => {
  process.stderr.write(`session-start hook error: ${err?.message || err}\n`);
  emit(null);
});
