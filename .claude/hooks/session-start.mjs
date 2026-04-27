#!/usr/bin/env node
// Claude Code SessionStart hook. Mirrors the Cursor sessionStart hook:
// injects the active scope (or a bootstrap warning) into the agent's
// initial context. Source of truth is the local DKG daemon — the union
// of `tasks:scopedToPath` across every `tasks:Task` whose status is
// `in_progress` and which is `prov:wasAttributedTo` this agent.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const scopeUrl = pathToFileURL(resolve(__dirname, '../../agent-scope/lib/scope.mjs')).href;
const {
  resolveRepoRoot, resolveActiveScope, checkNodeVersion, isBootstrapActive,
} = await import(scopeUrl);

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
  const scope = await resolveActiveScope({ root, force: true });
  const bootstrap = isBootstrapActive(root);

  const header = [];
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

  if (scope.reason !== 'ok') {
    if (!bootstrap) {
      if (scope.reason === 'daemon-unreachable' || scope.reason === 'configuration-error') {
        return emit([
          '# agent-scope: scope source unavailable',
          '',
          `Scope can't be resolved right now (${scope.reason}). Only the hardcoded`,
          'protected path list is enforced; everything else is writable.',
          scope.diagnostic ? '' : null,
          scope.diagnostic ? `Diagnostic: ${scope.diagnostic}` : null,
        ].filter((l) => l !== null).join('\n'));
      }
      return emit(null);
    }
    return emit(header.concat([
      '# agent-scope: no in-progress task',
      '',
      'Bootstrap is active but no `tasks:Task` is currently in_progress for this',
      'agent. System files are writable. When the protected work is done, run:',
      '    rm agent-scope/.bootstrap-token',
    ]).join('\n'));
  }

  const tasks = Array.isArray(scope.tasks) ? scope.tasks : [];
  const allowedPositive   = (scope.allowed || []).filter((p) => !p.startsWith('!'));
  const allowedNegative   = (scope.allowed || []).filter((p) => p.startsWith('!'));
  const exemptionsPositive = (scope.exemptions || []).filter((p) => !p.startsWith('!'));
  const exemptionsNegative = (scope.exemptions || []).filter((p) => p.startsWith('!'));

  const heading = tasks.length === 1
    ? `# agent-scope: active task — ${tasks[0].uri}`
    : `# agent-scope: ${tasks.length} active in-progress tasks`;

  const lines = header.concat([heading, '']);
  if (tasks.length === 1) {
    const t = tasks[0];
    lines.push(`**Task:** ${t.title || '(untitled)'}`);
    if (t.assignee) lines.push(`**Assignee:** ${t.assignee}`);
  } else {
    lines.push('## In-progress tasks');
    for (const t of tasks) {
      lines.push(`- \`${t.uri}\` — ${t.title || '(untitled)'}`);
    }
  }
  if (scope.agentUri) lines.push(`**Agent:** ${scope.agentUri}`);
  if (scope.projectId) lines.push(`**Project:** ${scope.projectId}`);
  lines.push('');

  lines.push(
    '## You may modify files matching the union of these globs:',
    ...(allowedPositive.length ? allowedPositive.map((p) => `- \`${p}\``) : ['- (nothing — every in-progress task has empty `tasks:scopedToPath`)']),
  );
  if (exemptionsPositive.length) {
    lines.push('', '## Always allowed (build artefacts, lockfiles):');
    for (const p of exemptionsPositive) lines.push(`- \`${p}\``);
  }
  if (allowedNegative.length || exemptionsNegative.length) {
    lines.push('', '## Explicitly denied (even if they look in-scope):');
    for (const p of [...allowedNegative, ...exemptionsNegative]) lines.push(`- \`${p}\``);
  }

  lines.push(
    '',
    '## Rules',
    '- You may **read** any file in the repo.',
    '- You may **write** only files matching the patterns above.',
    '- System files (`.cursor/hooks/**`, `.claude/hooks/**`, `agent-scope/lib/**`, etc.) are hardcode-protected regardless of task.' + (bootstrap ? ' (currently bypassed by bootstrap mode)' : ''),
    '- The allow-list is computed live from the local DKG daemon. To extend scope:',
    '  call `dkg_add_task` with `status: "in_progress"` and a `scopedToPath` glob covering',
    '  the new path; the cache will pick it up within ~5s.',
    '- When a task is done, call `dkg_update_task_status({ taskUri, status: "done" })`.',
    '  The next scope read will drop its globs from the union automatically.',
    '- A Claude Code hook enforces this on every Write/Edit/Delete; pre-Bash blocks',
    '  destructive shell commands on denied paths; post-Bash reverts anything that',
    '  slipped through.',
  );

  emit(lines.filter((l) => l !== null).join('\n'));
}

main().catch((err) => {
  process.stderr.write(`session-start hook error: ${err?.message || err}\n`);
  emit(null);
});
