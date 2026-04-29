// Builds structured denial payloads for every agent-scope enforcement layer.
// Each denial carries a short human-readable summary AND a machine-readable
// JSON block delimited by the `agent-scope-menu` fence.
//
// Agents are instructed (via CLAUDE.md + .cursor/rules/agent-scope.mdc +
// AGENTS.md) to:
//   1. Quote `humanSummary` in their AskQuestion prompt (keep it short and
//      natural — like a chat message to a coworker).
//   2. Offer only the two entries in `simpleOptions` — the LLM-recommended
//      action plus a free-text fallback. Never surface the full `options`
//      list to the user; it exists for audit / back-compat / tests.
//
// Source-of-truth model: scope is now derived from the local DKG daemon
// (in-progress `tasks:Task` entities attributed to this agent — see
// `agent-scope/lib/dkg-source.mjs`). There are no local task manifests
// anymore, so the only legitimate way to extend scope is for the agent
// to file a NEW in-progress task via `dkg_add_task` covering the path
// they need. The denial menus reflect that.
//
// Zero IO, zero deps. Pure functions; unit-testable.

import { PROTECTED_PATTERNS } from './scope.mjs';

export const DENIAL_FENCE_START = '<!-- agent-scope-menu:begin -->';
export const DENIAL_FENCE_END   = '<!-- agent-scope-menu:end -->';

// ---------------------------------------------------------------------------
// Suggestion heuristics
// ---------------------------------------------------------------------------

export function suggestGlob(relPath) {
  if (typeof relPath !== 'string' || !relPath) return null;
  const clean = relPath.replace(/\/+$/, '');
  const slash = clean.lastIndexOf('/');
  if (slash < 0) return clean;
  const dir = clean.slice(0, slash);
  return `${dir}/**`;
}

export function suggestTightGlob(relPath) {
  if (typeof relPath !== 'string' || !relPath) return null;
  const clean = relPath.replace(/\/+$/, '');
  const slash = clean.lastIndexOf('/');
  const base = slash >= 0 ? clean.slice(slash + 1) : clean;
  const dot = base.indexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  if (!stem) return null;
  const dir = slash >= 0 ? clean.slice(0, slash) : '';
  return dir ? `${dir}/${stem}*` : `${stem}*`;
}

// ---------------------------------------------------------------------------
// Option menus
// ---------------------------------------------------------------------------

const CUSTOM_OPTION = {
  id: 'custom_instruction',
  label: 'Let me type my own instruction',
  action: { kind: 'custom' },
};

const CUSTOM_OPTION_SIMPLE = {
  id: 'custom_instruction',
  label: 'Type what you want instead',
  action: { kind: 'custom' },
};

function simpleLabelFor(optionId) {
  if (optionId === 'new_task_glob')    return 'File a new in-progress task covering this folder and continue';
  if (optionId === 'new_task_file')    return 'File a new in-progress task covering this file and continue';
  if (optionId === 'bootstrap')        return 'Yes, unlock it so I can do this edit';
  if (optionId === 'cancel')           return 'Skip it';
  if (optionId === 'skip')             return 'Skip and keep working on other things';
  if (optionId === 'restart_daemon')   return 'Tell me how to restart the DKG daemon';
  if (optionId === 'configure_dkg')    return 'Tell me how to set up the DKG project / agent';
  if (optionId === 'acknowledge')      return 'OK, keep going';
  return null;
}

function buildSimpleOptions(fullOptions, recommendedId) {
  const rec = fullOptions.find((o) => o.id === recommendedId) || fullOptions[0];
  if (!rec) return [CUSTOM_OPTION_SIMPLE];
  const label = simpleLabelFor(rec.id) || rec.label;
  return [
    { id: rec.id, label, action: rec.action },
    CUSTOM_OPTION_SIMPLE,
  ];
}

export function buildOutOfScopeOptions({ deniedPath, activeTaskUris }) {
  const folderGlob = suggestGlob(deniedPath);
  const uris = Array.isArray(activeTaskUris) ? activeTaskUris : [];
  const taskList = uris.length ? uris.join(', ') : 'none';
  const opts = [
    {
      id: 'new_task_glob',
      label: `File a new in-progress task covering "${folderGlob}"`,
      action: {
        kind: 'new_in_progress_task',
        suggestedScopedToPath: [folderGlob],
        suggestedTitle: `Extend scope to ${folderGlob}`,
        rationale: `Existing in-progress task${uris.length === 1 ? '' : 's'} (${taskList}) doesn't cover ${deniedPath}.`,
      },
    },
    {
      id: 'new_task_file',
      label: `File a new in-progress task covering exactly "${deniedPath}"`,
      action: {
        kind: 'new_in_progress_task',
        suggestedScopedToPath: [deniedPath],
        suggestedTitle: `Extend scope to ${deniedPath}`,
        rationale: `Existing in-progress task${uris.length === 1 ? '' : 's'} (${taskList}) doesn't cover ${deniedPath}.`,
      },
    },
    {
      id: 'skip',
      label: 'Skip this edit, keep working on in-scope files',
      action: { kind: 'skip' },
    },
    {
      id: 'cancel',
      label: 'Cancel this turn — the edit should not happen',
      action: { kind: 'cancel' },
    },
    CUSTOM_OPTION,
  ];
  return opts;
}

export function classifyProtected(relPath) {
  if (!relPath || typeof relPath !== 'string') return { kind: 'unknown', role: 'protected file' };
  if (relPath.startsWith('.cursor/hooks/') || relPath === '.cursor/hooks.json') {
    return { kind: 'cursor-hook', role: 'a Cursor hook that enforces agent-scope in every session' };
  }
  if (relPath === '.cursor/rules/agent-scope.mdc') {
    return { kind: 'cursor-rule', role: 'the rule that tells the agent to surface denial menus via AskQuestion' };
  }
  if (relPath.startsWith('.claude/hooks/') || relPath === '.claude/settings.json') {
    return { kind: 'claude-hook', role: 'a Claude Code hook that enforces agent-scope in every session' };
  }
  if (relPath.startsWith('agent-scope/lib/')) {
    return { kind: 'scope-library', role: 'the shared enforcement library used by every hook' };
  }
  if (relPath === 'agent-scope/.bootstrap-token') {
    return { kind: 'bootstrap-token', role: 'the bootstrap token itself — writing it would self-grant full access' };
  }
  if (relPath === 'AGENTS.md' || relPath === 'GEMINI.md' || relPath === '.cursorrules') {
    return { kind: 'agent-instructions', role: 'the agent-instruction file the AI reads to learn how to behave in this repo' };
  }
  return { kind: 'unknown', role: 'a file on the hardcoded protected list' };
}

export function buildProtectedOptions({ deniedPath }) {
  return [
    {
      id: 'bootstrap',
      label: `Yes — let the agent edit "${deniedPath}" (enable bootstrap, then re-lock after)`,
      action: {
        kind: 'bootstrap',
        instruction: 'In your own terminal run:\n    touch agent-scope/.bootstrap-token\nThen reply "go". When I\'m done, run:\n    rm agent-scope/.bootstrap-token\nto re-lock the system.',
      },
    },
    {
      id: 'cancel',
      label: 'No — do not edit this file; cancel the operation',
      action: { kind: 'cancel' },
    },
    {
      id: 'skip',
      label: 'No — skip this edit, but keep working on other things',
      action: { kind: 'skip' },
    },
    CUSTOM_OPTION,
  ];
}

export function buildResolutionErrorOptions({ reason }) {
  if (reason === 'daemon-unreachable') {
    return [
      {
        id: 'restart_daemon',
        label: 'Tell me how to restart the local DKG daemon',
        action: {
          kind: 'restart_daemon',
          instruction: 'In your own terminal run:\n    dkg start\n(or `pnpm -F @origintrail-official/dkg-cli start`).\nThen reply "go" and I\'ll re-check.',
        },
      },
      {
        id: 'skip',
        label: 'Keep going in soft mode (only protected paths blocked)',
        action: { kind: 'skip' },
      },
      { id: 'cancel', label: 'Cancel this turn', action: { kind: 'cancel' } },
      CUSTOM_OPTION,
    ];
  }
  return [
    {
      id: 'configure_dkg',
      label: 'Tell me how to wire up the DKG project + agent for this workspace',
      action: {
        kind: 'configure_dkg',
        instruction: 'Edit `.dkg/config.yaml` so it has both `contextGraph: <your project id>` and `agent.uri: <your agent URI>` populated, then reply "go". (Alternatively, export `DKG_PROJECT` and `DKG_AGENT_URI` for one-off runs.)',
      },
    },
    {
      id: 'skip',
      label: 'Keep going in soft mode (only protected paths blocked)',
      action: { kind: 'skip' },
    },
    { id: 'cancel', label: 'Cancel this turn', action: { kind: 'cancel' } },
    CUSTOM_OPTION,
  ];
}

function recommendFor(reason, options) {
  const ids = new Set(options.map((o) => o.id));
  if (reason === 'out-of-scope') {
    if (ids.has('new_task_glob')) return 'new_task_glob';
    if (ids.has('new_task_file')) return 'new_task_file';
  }
  if (reason === 'protected') return 'cancel';
  if (reason === 'daemon-unreachable') return 'restart_daemon';
  if (reason === 'configuration-error') return 'configure_dkg';
  return options[0]?.id || null;
}

// ---------------------------------------------------------------------------
// Full denial message builders
// ---------------------------------------------------------------------------

function wrapStructured(payload) {
  return [
    DENIAL_FENCE_START,
    JSON.stringify(payload, null, 2),
    DENIAL_FENCE_END,
  ].join('\n');
}

function render(summary, structured) {
  return [
    `agent-scope: ${summary}`,
    '',
    wrapStructured(structured),
  ].join('\n');
}

export function buildPreToolUseDenial({
  tool, deniedPath, decision, task, taskId, root,
}) {
  if (decision === 'protected') {
    const classification = classifyProtected(deniedPath);
    const options = buildProtectedOptions({ deniedPath });
    const recommendedOptionId = recommendFor('protected', options);
    const humanSummary =
      `I'd like to edit \`${deniedPath}\`, but it's ${classification.role}. ` +
      `It's locked on purpose so an agent can't silently reshape its own guardrails — ` +
      `unlocking needs your OK.`;
    const structured = {
      version: 1,
      hook: 'preToolUse',
      reason: 'protected',
      tool,
      deniedPath,
      protectedKind: classification.kind,
      protectedRole: classification.role,
      activeTask: taskId || null,
      activeTaskUris: (task && task.dkgTaskUris) || [],
      protectedPatterns: [...PROTECTED_PATTERNS],
      humanSummary,
      options,
      simpleOptions: buildSimpleOptions(options, recommendedOptionId),
      recommendedOptionId,
      agentReasoning: null,
    };
    return { message: render(humanSummary, structured), structured };
  }

  const activeTaskUris = (task && task.dkgTaskUris) || [];
  const options = buildOutOfScopeOptions({ deniedPath, activeTaskUris });
  const recommendedOptionId = recommendFor('out-of-scope', options);
  const positives  = ((task && task.allowed)    || []).filter((p) => !p.startsWith('!'));
  const exemptions = ((task && task.exemptions) || []).filter((p) => !p.startsWith('!'));
  const taskListLabel = activeTaskUris.length === 1
    ? `\`${activeTaskUris[0]}\``
    : activeTaskUris.length
    ? `${activeTaskUris.length} in-progress tasks`
    : 'no in-progress task';
  const humanSummary =
    `I'd like to edit \`${deniedPath}\`, but ${taskListLabel}` +
    `${task && task.description ? ` (${task.description})` : ''}` +
    ` doesn't cover that file.`;
  const structured = {
    version: 1,
    hook: 'preToolUse',
    reason: 'out-of-scope',
    tool,
    deniedPath,
    activeTask: taskId || null,
    activeTaskUris,
    activeTaskDescription: (task && task.description) || null,
    allowed: positives,
    exemptions,
    suggestedGlob: suggestGlob(deniedPath),
    suggestedTightGlob: suggestTightGlob(deniedPath),
    humanSummary,
    options,
    simpleOptions: buildSimpleOptions(options, recommendedOptionId),
    recommendedOptionId,
    agentReasoning: null,
  };
  return { message: render(humanSummary, structured), structured };
}

export function buildResolutionErrorDenial({ reason, diagnostic }) {
  const options = buildResolutionErrorOptions({ reason });
  const recommendedOptionId = recommendFor(reason, options);
  const humanSummary = reason === 'daemon-unreachable'
    ? `I can't reach the local DKG daemon, so I can't check whether this edit is in scope. ${diagnostic || ''}`.trim()
    : `The DKG project / agent isn't fully configured for this workspace, so I can't resolve scope. ${diagnostic || ''}`.trim();
  const structured = {
    version: 1,
    hook: 'preToolUse',
    reason,
    diagnostic: diagnostic || null,
    humanSummary,
    options,
    simpleOptions: buildSimpleOptions(options, recommendedOptionId),
    recommendedOptionId,
    agentReasoning: null,
  };
  return { message: render(humanSummary, structured), structured };
}

// Back-compat alias retained so older hook bindings keep loading. Maps to
// the new resolution-error builder; pre-existing callers that pass
// `{ taskId, error }` get a sensible default.
export function buildLoadErrorDenial({ taskId, error } = {}) {
  return buildResolutionErrorDenial({
    reason: 'configuration-error',
    diagnostic: `Couldn't load active scope${taskId ? ` for task ${taskId}` : ''}: ${error || 'unknown error'}.`,
  });
}

export function buildShellPrecheckDenial({
  command, violations, task, taskId, root,
}) {
  const anyProtected = violations.some((v) => String(v.decision).startsWith('protected'));
  let reason, options, suggestedFix;
  const firstScopePath = violations.find((v) => v.decision === 'deny')?.path || null;
  const firstProtPath  = violations.find((v) => String(v.decision).startsWith('protected'))?.path || null;

  if (anyProtected) {
    reason = 'protected';
    options = buildProtectedOptions({ deniedPath: firstProtPath || '(protected target)' });
    suggestedFix = 'enable bootstrap — see options';
  } else if (firstScopePath) {
    reason = 'out-of-scope';
    options = buildOutOfScopeOptions({
      deniedPath: firstScopePath,
      activeTaskUris: (task && task.dkgTaskUris) || [],
    });
    suggestedFix = `file a new in-progress task covering "${suggestGlob(firstScopePath)}"`;
  } else {
    reason = 'unknown';
    options = [
      { id: 'skip',   label: 'Skip this command',     action: { kind: 'skip' } },
      { id: 'cancel', label: 'Cancel this turn',      action: { kind: 'cancel' } },
      CUSTOM_OPTION,
    ];
    suggestedFix = null;
  }

  const recommendedOptionId = recommendFor(reason, options);
  const firstPath = firstProtPath || firstScopePath || '(target)';
  const firstCmd = violations[0]?.cmd || 'command';
  const taskListLabel = (task?.dkgTaskUris?.length || 0) === 1
    ? `\`${task.dkgTaskUris[0]}\``
    : (task?.dkgTaskUris?.length || 0) > 1
    ? `${task.dkgTaskUris.length} in-progress tasks`
    : 'no in-progress task';
  const humanSummary =
    reason === 'protected'
      ? `The shell command I was about to run (\`${firstCmd}\` on \`${firstPath}\`) ` +
        `would touch a protected system file. Blocked before it ran.`
      : reason === 'out-of-scope'
      ? `The shell command I was about to run (\`${firstCmd}\` on \`${firstPath}\`) ` +
        `would write outside ${taskListLabel}. Blocked before it ran.`
      : `That shell command was blocked before it ran.`;

  const structured = {
    version: 1,
    hook: 'beforeShellExecution',
    reason,
    command,
    activeTask: taskId || null,
    activeTaskUris: (task && task.dkgTaskUris) || [],
    violations: violations.map((v) => ({
      cmd: v.cmd, path: v.path, decision: v.decision,
    })),
    suggestedFix,
    humanSummary,
    options,
    simpleOptions: buildSimpleOptions(options, recommendedOptionId),
    recommendedOptionId,
    agentReasoning: null,
  };

  return { message: render(humanSummary, structured), structured };
}

export function buildAfterShellContext({
  command, task, taskId, root,
  reverted, deleted, unreverted,
}) {
  reverted = Array.isArray(reverted) ? reverted : [];
  deleted  = Array.isArray(deleted)  ? deleted  : [];
  unreverted = Array.isArray(unreverted) ? unreverted : [];

  const touched = [...reverted, ...deleted];
  const firstProtected = touched.find((p) => {
    for (const pat of PROTECTED_PATTERNS) {
      const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
      if (re.test(p)) return true;
    }
    return false;
  });

  let options, reason;
  if (firstProtected) {
    reason = 'protected';
    options = buildProtectedOptions({ deniedPath: firstProtected });
  } else if (touched.length) {
    reason = 'out-of-scope';
    options = buildOutOfScopeOptions({
      deniedPath: touched[0],
      activeTaskUris: (task && task.dkgTaskUris) || [],
    });
  } else {
    reason = 'unknown';
    options = [
      { id: 'acknowledge', label: 'Acknowledged — continue with other work', action: { kind: 'skip' } },
      { id: 'cancel',      label: 'Cancel this turn',                        action: { kind: 'cancel' } },
      CUSTOM_OPTION,
    ];
  }

  const recommendedOptionId = recommendFor(reason, options);
  const touchedCount = reverted.length + deleted.length;
  const taskListLabel = (task?.dkgTaskUris?.length || 0) === 1
    ? `\`${task.dkgTaskUris[0]}\``
    : (task?.dkgTaskUris?.length || 0) > 1
    ? `${task.dkgTaskUris.length} in-progress tasks`
    : 'no in-progress task';
  const humanSummary = (() => {
    if (touchedCount === 0) {
      return `A shell command ran and finished cleanly — nothing needed to be reverted.`;
    }
    const bits = [];
    if (reverted.length) bits.push(`reverted ${reverted.length} file${reverted.length === 1 ? '' : 's'}`);
    if (deleted.length)  bits.push(`deleted ${deleted.length} new file${deleted.length === 1 ? '' : 's'}`);
    const fix = bits.join(' and ');
    if (reason === 'protected') {
      return `A shell command touched a protected system file, so I ${fix} to put things back.`;
    }
    if (reason === 'out-of-scope') {
      return `A shell command touched files outside ${taskListLabel}, so I ${fix} to put things back.`;
    }
    return `A shell command touched files it shouldn't have, so I ${fix}.`;
  })();

  const structured = {
    version: 1,
    hook: 'afterShellExecution',
    reason,
    command,
    activeTask: taskId || null,
    activeTaskUris: (task && task.dkgTaskUris) || [],
    reverted,
    deleted,
    unreverted: unreverted.map((u) => ({ path: u.path, status: u.status, reason: u.reason })),
    humanSummary,
    options,
    simpleOptions: buildSimpleOptions(options, recommendedOptionId),
    recommendedOptionId,
    agentReasoning: null,
  };

  const lines = [humanSummary];
  if (reverted.length) {
    lines.push('', 'Reverted:');
    for (const p of reverted) lines.push(`  - ${p}`);
  }
  if (deleted.length) {
    lines.push('', 'Deleted:');
    for (const p of deleted) lines.push(`  - ${p}`);
  }
  if (unreverted.length) {
    lines.push('', 'Could not revert (please review):');
    for (const u of unreverted) lines.push(`  - ${u.path}  [${u.status}] ${u.reason}`);
  }

  return { message: render(lines.join('\n'), structured), structured };
}
