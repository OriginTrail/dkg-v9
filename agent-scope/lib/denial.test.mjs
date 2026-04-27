// Unit tests for denial.mjs. Verifies the prose+JSON shape every hook
// emits so the agent's plan-mode denial protocol stays stable.
//
//   node --test agent-scope/lib/denial.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DENIAL_FENCE_START, DENIAL_FENCE_END,
  buildPreToolUseDenial, buildShellPrecheckDenial, buildAfterShellContext,
  buildResolutionErrorDenial, buildLoadErrorDenial,
  buildOutOfScopeOptions, buildProtectedOptions, buildResolutionErrorOptions,
  classifyProtected, suggestGlob, suggestTightGlob,
} from './denial.mjs';

function extractJSON(message) {
  const start = message.indexOf(DENIAL_FENCE_START);
  const end   = message.indexOf(DENIAL_FENCE_END);
  assert.ok(start >= 0 && end > start, `no fence found in: ${message.slice(0, 200)}`);
  const body = message.slice(start + DENIAL_FENCE_START.length, end).trim();
  return JSON.parse(body);
}

function inProgressTask(allowed = [], exemptions = [], uris = ['urn:dkg:task:demo']) {
  return {
    id: uris[0]?.split(':').pop() || 'demo',
    dkgTaskUris: uris,
    description: 'demo task',
    allowed,
    exemptions,
    reason: 'ok',
    tasks: uris.map((u) => ({ uri: u, title: 'demo' })),
  };
}

// --- suggestGlob / suggestTightGlob --------------------------------------

test('suggestGlob: directory glob for nested file', () => {
  assert.equal(suggestGlob('packages/foo/src/bar.ts'), 'packages/foo/src/**');
});

test('suggestGlob: top-level file', () => {
  assert.equal(suggestGlob('README.md'), 'README.md');
});

test('suggestGlob: invalid input', () => {
  assert.equal(suggestGlob(null), null);
  assert.equal(suggestGlob(''), null);
});

test('suggestTightGlob: stem* in same dir', () => {
  assert.equal(suggestTightGlob('packages/foo/src/bar.ts'), 'packages/foo/src/bar*');
});

// --- classifyProtected ----------------------------------------------------

test('classifyProtected: known categories', () => {
  assert.equal(classifyProtected('.cursor/hooks/scope-guard.mjs').kind, 'cursor-hook');
  assert.equal(classifyProtected('.cursor/rules/agent-scope.mdc').kind, 'cursor-rule');
  assert.equal(classifyProtected('.claude/hooks/scope-guard.mjs').kind, 'claude-hook');
  assert.equal(classifyProtected('agent-scope/lib/scope.mjs').kind, 'scope-library');
  assert.equal(classifyProtected('agent-scope/.bootstrap-token').kind, 'bootstrap-token');
  assert.equal(classifyProtected('AGENTS.md').kind, 'agent-instructions');
  assert.equal(classifyProtected('.cursorrules').kind, 'agent-instructions');
});

test('classifyProtected: unknown path → unknown kind', () => {
  assert.equal(classifyProtected('something/random').kind, 'unknown');
});

// --- option menus ---------------------------------------------------------

test('buildOutOfScopeOptions: contains new_task_glob + new_task_file + skip + cancel + custom', () => {
  const opts = buildOutOfScopeOptions({
    deniedPath: 'packages/foo/bar.ts',
    activeTaskUris: ['urn:dkg:task:other'],
  });
  const ids = opts.map((o) => o.id);
  assert.deepEqual(ids, ['new_task_glob', 'new_task_file', 'skip', 'cancel', 'custom_instruction']);
  const tg = opts.find((o) => o.id === 'new_task_glob');
  assert.equal(tg.action.kind, 'new_in_progress_task');
  assert.deepEqual(tg.action.suggestedScopedToPath, ['packages/foo/**']);
  const tf = opts.find((o) => o.id === 'new_task_file');
  assert.deepEqual(tf.action.suggestedScopedToPath, ['packages/foo/bar.ts']);
});

test('buildProtectedOptions: bootstrap is the recommendation; no add_to_manifest', () => {
  const opts = buildProtectedOptions({ deniedPath: '.cursor/hooks.json' });
  const ids = opts.map((o) => o.id);
  assert.deepEqual(ids, ['bootstrap', 'cancel', 'skip', 'custom_instruction']);
  assert.equal(opts[0].action.kind, 'bootstrap');
  assert.match(opts[0].action.instruction, /agent-scope\/\.bootstrap-token/);
});

test('buildResolutionErrorOptions: daemon-unreachable surfaces restart_daemon', () => {
  const opts = buildResolutionErrorOptions({ reason: 'daemon-unreachable' });
  const ids = opts.map((o) => o.id);
  assert.ok(ids.includes('restart_daemon'));
  assert.match(opts[0].action.instruction, /dkg start/);
});

test('buildResolutionErrorOptions: configuration-error surfaces configure_dkg', () => {
  const opts = buildResolutionErrorOptions({ reason: 'configuration-error' });
  const ids = opts.map((o) => o.id);
  assert.ok(ids.includes('configure_dkg'));
});

// --- preToolUse: out-of-scope --------------------------------------------

test('buildPreToolUseDenial: out-of-scope payload is well-formed', () => {
  const t = inProgressTask(['src/**']);
  const { message, structured } = buildPreToolUseDenial({
    tool: 'Write', deniedPath: 'packages/foo/bar.ts', decision: 'deny',
    task: t, taskId: t.id,
  });
  assert.match(message, /^agent-scope:/);
  const j = extractJSON(message);
  assert.deepEqual(j, structured);  // message embeds the same payload
  assert.equal(j.hook, 'preToolUse');
  assert.equal(j.reason, 'out-of-scope');
  assert.equal(j.tool, 'Write');
  assert.equal(j.deniedPath, 'packages/foo/bar.ts');
  assert.deepEqual(j.activeTaskUris, ['urn:dkg:task:demo']);
  // simpleOptions = recommended + custom_instruction
  assert.equal(j.simpleOptions.length, 2);
  assert.equal(j.simpleOptions[0].id, j.recommendedOptionId);
  assert.equal(j.simpleOptions[1].id, 'custom_instruction');
  assert.equal(j.recommendedOptionId, 'new_task_glob');
});

test('buildPreToolUseDenial: humanSummary mentions the path and that no task covers it', () => {
  const t = inProgressTask(['src/**']);
  const { message } = buildPreToolUseDenial({
    tool: 'Write', deniedPath: 'packages/foo/bar.ts', decision: 'deny',
    task: t, taskId: t.id,
  });
  const j = extractJSON(message);
  assert.match(j.humanSummary, /packages\/foo\/bar\.ts/);
  assert.match(j.humanSummary, /doesn't cover/);
});

// --- preToolUse: protected ------------------------------------------------

test('buildPreToolUseDenial: protected payload is well-formed', () => {
  const { message, structured } = buildPreToolUseDenial({
    tool: 'Write', deniedPath: '.cursor/hooks.json', decision: 'protected',
    task: null, taskId: null,
  });
  const j = extractJSON(message);
  assert.deepEqual(j, structured);
  assert.equal(j.reason, 'protected');
  assert.equal(j.protectedKind, 'cursor-hook');
  assert.equal(j.simpleOptions[0].id, 'cancel'); // recommend safety
  assert.equal(j.simpleOptions[1].id, 'custom_instruction');
  // Verbose options always include bootstrap as an explicit choice.
  assert.ok(j.options.find((o) => o.id === 'bootstrap'));
});

// --- resolution-error denial ---------------------------------------------

test('buildResolutionErrorDenial: daemon-unreachable', () => {
  const { message } = buildResolutionErrorDenial({
    reason: 'daemon-unreachable', diagnostic: 'connection refused',
  });
  const j = extractJSON(message);
  assert.equal(j.reason, 'daemon-unreachable');
  assert.equal(j.simpleOptions[0].id, 'restart_daemon');
  assert.match(j.humanSummary, /daemon/i);
});

test('buildLoadErrorDenial: legacy alias maps to configuration-error', () => {
  const { message } = buildLoadErrorDenial({ taskId: 'demo', error: 'boom' });
  const j = extractJSON(message);
  assert.equal(j.reason, 'configuration-error');
});

// --- shell-precheck -------------------------------------------------------

test('buildShellPrecheckDenial: protected violation', () => {
  const { message } = buildShellPrecheckDenial({
    command: 'rm -rf .cursor/hooks',
    violations: [{ cmd: 'rm', path: '.cursor/hooks', decision: 'protected (covers)' }],
    task: null, taskId: null,
  });
  const j = extractJSON(message);
  assert.equal(j.reason, 'protected');
  assert.equal(j.simpleOptions[0].id, 'cancel');
  assert.match(j.humanSummary, /Blocked/);
});

test('buildShellPrecheckDenial: out-of-scope violation', () => {
  const t = inProgressTask(['src/**']);
  const { message } = buildShellPrecheckDenial({
    command: 'rm packages/foo/bar.ts',
    violations: [{ cmd: 'rm', path: 'packages/foo/bar.ts', decision: 'deny' }],
    task: t, taskId: t.id,
  });
  const j = extractJSON(message);
  assert.equal(j.reason, 'out-of-scope');
  assert.equal(j.simpleOptions[0].id, 'new_task_glob');
});

// --- afterShell -----------------------------------------------------------

test('buildAfterShellContext: reverted + deleted summary', () => {
  const t = inProgressTask(['src/**']);
  const { message } = buildAfterShellContext({
    command: 'noop',
    task: t, taskId: t.id,
    reverted: ['packages/foo/bar.ts'],
    deleted: ['packages/foo/junk.ts'],
    unreverted: [],
  });
  const j = extractJSON(message);
  assert.equal(j.hook, 'afterShellExecution');
  assert.equal(j.reason, 'out-of-scope');
  assert.deepEqual(j.reverted, ['packages/foo/bar.ts']);
  assert.deepEqual(j.deleted, ['packages/foo/junk.ts']);
  assert.match(j.humanSummary, /reverted 1 file/);
  assert.match(j.humanSummary, /deleted 1 new file/);
});

test('buildAfterShellContext: nothing touched → benign summary', () => {
  const { message } = buildAfterShellContext({
    command: 'noop', task: null, taskId: null,
    reverted: [], deleted: [], unreverted: [],
  });
  const j = extractJSON(message);
  assert.equal(j.reason, 'unknown');
  assert.match(j.humanSummary, /finished cleanly/);
});

test('buildAfterShellContext: protected file touched → protected reason', () => {
  const { message } = buildAfterShellContext({
    command: 'echo hi', task: null, taskId: null,
    reverted: [], deleted: ['.cursor/hooks/scope-guard.mjs'],
    unreverted: [],
  });
  const j = extractJSON(message);
  assert.equal(j.reason, 'protected');
  assert.equal(j.simpleOptions[0].id, 'cancel');
});
