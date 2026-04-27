// Unit tests for check-agent.
//   node --test agent-scope/lib/check-agent.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectAgents, summary, statusGlyph } from './check-agent.mjs';

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'agent-scope-checkagent-'));
  mkdirSync(join(root, 'agent-scope/lib'), { recursive: true });
  return root;
}

function touchHook(root, agentDir, name) {
  const dir = join(root, agentDir, 'hooks');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, '#!/usr/bin/env node\n');
  chmodSync(p, 0o755);
}

test('detectAgents: empty repo → all missing', () => {
  const root = makeRepo();
  try {
    const r = detectAgents(root);
    const byName = Object.fromEntries(r.map(x => [x.name, x.status]));
    assert.equal(byName['Cursor'], 'missing');
    assert.equal(byName['Claude Code'], 'missing');
    assert.equal(byName['Codex CLI'], 'missing');
    assert.equal(byName['Gemini CLI'], 'missing');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const CURSOR_HOOKS = [
  'session-start.mjs', 'scope-guard.mjs',
  'shell-precheck.mjs', 'shell-diff-check.mjs',
];
const CLAUDE_HOOKS = [
  'session-start.mjs', 'scope-guard.mjs',
  'shell-precheck.mjs', 'shell-diff-check.mjs',
  'user-prompt-submit.mjs',
];

test('detectAgents: full Cursor wiring → ok', () => {
  const root = makeRepo();
  try {
    mkdirSync(join(root, '.cursor/rules'), { recursive: true });
    writeFileSync(join(root, '.cursor/hooks.json'), '{}');
    writeFileSync(join(root, '.cursor/rules/agent-scope.mdc'), '');
    for (const f of CURSOR_HOOKS) touchHook(root, '.cursor', f);
    const cursor = detectAgents(root).find(a => a.name === 'Cursor');
    assert.equal(cursor.status, 'ok', JSON.stringify(cursor, null, 2));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('detectAgents: Cursor hook not executable → warn', () => {
  const root = makeRepo();
  try {
    mkdirSync(join(root, '.cursor/rules'), { recursive: true });
    writeFileSync(join(root, '.cursor/hooks.json'), '{}');
    writeFileSync(join(root, '.cursor/rules/agent-scope.mdc'), '');
    for (const f of CURSOR_HOOKS) touchHook(root, '.cursor', f);
    chmodSync(join(root, '.cursor/hooks/scope-guard.mjs'), 0o644);
    const cursor = detectAgents(root).find(a => a.name === 'Cursor');
    assert.equal(cursor.status, 'warn');
    assert.ok(cursor.details.some(d => /not executable/.test(d)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('detectAgents: full Claude Code wiring → ok', () => {
  const root = makeRepo();
  try {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/settings.json'), '{}');
    writeFileSync(join(root, 'CLAUDE.md'), '');
    for (const f of CLAUDE_HOOKS) touchHook(root, '.claude', f);
    const cc = detectAgents(root).find(a => a.name === 'Claude Code');
    assert.equal(cc.status, 'ok', JSON.stringify(cc, null, 2));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('detectAgents: Codex agent with AGENTS.md → partial (soft only)', () => {
  const root = makeRepo();
  try {
    writeFileSync(join(root, 'AGENTS.md'), '');
    const codex = detectAgents(root).find(a => a.name === 'Codex CLI');
    assert.equal(codex.status, 'partial');
    assert.match(codex.enforcement, /soft/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('detectAgents: Gemini agent with GEMINI.md → partial', () => {
  const root = makeRepo();
  try {
    writeFileSync(join(root, 'GEMINI.md'), '');
    const g = detectAgents(root).find(a => a.name === 'Gemini CLI');
    assert.equal(g.status, 'partial');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('detectAgents: legacy with .cursorrules → partial', () => {
  const root = makeRepo();
  try {
    writeFileSync(join(root, '.cursorrules'), '');
    const l = detectAgents(root).find(a => a.name.startsWith('Continue'));
    assert.equal(l.status, 'partial');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('summary: counts by status', () => {
  const r = [
    { status: 'ok' },
    { status: 'partial' },
    { status: 'partial' },
    { status: 'missing' },
  ];
  assert.deepEqual(summary(r), { ok: 1, partial: 2, warn: 0, missing: 1 });
});

test('statusGlyph: every status returns a string', () => {
  for (const s of ['ok', 'partial', 'warn', 'missing', 'wat']) {
    assert.equal(typeof statusGlyph(s), 'string');
  }
});
