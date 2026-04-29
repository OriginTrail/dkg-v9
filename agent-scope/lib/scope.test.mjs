// Unit tests for the scope-check library. Run with:
//   node --test agent-scope/lib/scope.test.mjs
//
// Focused on the pieces that are pure and don't talk to the DKG daemon:
// glob matching (`checkPath`), protected-path defaults (`checkProtected`,
// `coversProtected`), bootstrap detection, and the back-compat shims
// that hooks call on the cache. End-to-end DKG resolution is covered in
// `dkg-source.test.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkPath, checkProtected, coversProtected, normalizeToRepoPath,
  PROTECTED_PATTERNS, isBootstrapActive, explainDeny, checkNodeVersion,
  resolveActiveTaskId, loadTask,
} from './scope.mjs';

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'agent-scope-test-'));
  mkdirSync(join(root, 'agent-scope'), { recursive: true });
  return root;
}

function inProgressTask(allowed = [], exemptions = []) {
  return {
    id: 'urn:dkg:task:test',
    dkgTaskUris: ['urn:dkg:task:test'],
    description: 'test',
    allowed,
    exemptions,
    reason: 'ok',
  };
}

// --- core decision --------------------------------------------------------

test('checkPath: no active scope → allow for non-protected path', () => {
  assert.equal(checkPath(null, 'any/file.ts'), 'allow');
  assert.equal(checkPath({ reason: 'no-active-task' }, 'any/file.ts'), 'allow');
});

test('checkPath: basic allow', () => {
  assert.equal(checkPath(inProgressTask(['src/**/*.ts']), 'src/foo/bar.ts'), 'allow');
});

test('checkPath: deny when not matched', () => {
  assert.equal(checkPath(inProgressTask(['src/**/*.ts']), 'lib/other.ts'), 'deny');
});

test('checkPath: exemption', () => {
  const t = inProgressTask(['src/**/*.ts'], ['**/dist/**']);
  assert.equal(checkPath(t, 'anything/dist/bundle.js'), 'exempt');
});

test('checkPath: explicit ! deny in allowed overrides allow', () => {
  const t = inProgressTask(['src/**', '!src/**/secrets.*']);
  assert.equal(checkPath(t, 'src/config/secrets.ts'), 'deny');
  assert.equal(checkPath(t, 'src/config/public.ts'), 'allow');
});

test('checkPath: explicit ! deny in exemptions overrides exemption', () => {
  const t = inProgressTask(['src/**'], ['**/dist/**', '!**/dist/secret.js']);
  assert.equal(checkPath(t, 'foo/dist/secret.js'), 'deny');
  assert.equal(checkPath(t, 'foo/dist/bundle.js'), 'exempt');
});

test('checkPath: empty / weird inputs', () => {
  const t = inProgressTask(['**']);
  assert.equal(checkPath(t, ''), 'deny');
  assert.equal(checkPath(t, '../etc/passwd'), 'deny');
});

test('checkPath: protected always wins over scope', () => {
  const isolated = makeRepo();
  try {
    const t = inProgressTask(['**']);
    // Even with a wide-open scope, protected paths still deny.
    assert.equal(checkPath(t, '.cursor/hooks/scope-guard.mjs', isolated), 'protected');
    assert.equal(checkPath(t, 'agent-scope/lib/scope.mjs', isolated), 'protected');
  } finally { rmSync(isolated, { recursive: true, force: true }); }
});

// --- protected paths ------------------------------------------------------

test('checkProtected: matches every protected pattern', () => {
  const isolated = makeRepo();
  try {
    assert.equal(checkProtected('.cursor/hooks.json', isolated), 'deny');
    assert.equal(checkProtected('.cursor/hooks/scope-guard.mjs', isolated), 'deny');
    assert.equal(checkProtected('.cursor/rules/agent-scope.mdc', isolated), 'deny');
    assert.equal(checkProtected('.claude/hooks/scope-guard.mjs', isolated), 'deny');
    assert.equal(checkProtected('.claude/settings.json', isolated), 'deny');
    assert.equal(checkProtected('agent-scope/lib/scope.mjs', isolated), 'deny');
    assert.equal(checkProtected('agent-scope/.bootstrap-token', isolated), 'deny');
    assert.equal(checkProtected('AGENTS.md', isolated), 'deny');
    assert.equal(checkProtected('GEMINI.md', isolated), 'deny');
    assert.equal(checkProtected('.cursorrules', isolated), 'deny');
  } finally { rmSync(isolated, { recursive: true, force: true }); }
});

test('checkProtected: normal paths pass through', () => {
  const isolated = makeRepo();
  try {
    assert.equal(checkProtected('packages/core/src/index.ts', isolated), 'allow');
    assert.equal(checkProtected('README.md', isolated), 'allow');
    assert.equal(checkProtected('agent-scope/README.md', isolated), 'allow');
    assert.equal(checkProtected('agent-scope/logs/audit.jsonl', isolated), 'allow');
  } finally { rmSync(isolated, { recursive: true, force: true }); }
});

test('checkProtected: bootstrap token bypasses all', () => {
  const isolated = makeRepo();
  try {
    writeFileSync(join(isolated, 'agent-scope/.bootstrap-token'), '');
    assert.ok(isBootstrapActive(isolated));
    assert.equal(checkProtected('.cursor/hooks.json', isolated), 'allow');
    assert.equal(checkProtected('agent-scope/lib/scope.mjs', isolated), 'allow');
  } finally { rmSync(isolated, { recursive: true, force: true }); }
});

test('checkProtected: AGENT_SCOPE_BOOTSTRAP=1 also bypasses', () => {
  const isolated = makeRepo();
  const prev = process.env.AGENT_SCOPE_BOOTSTRAP;
  try {
    process.env.AGENT_SCOPE_BOOTSTRAP = '1';
    assert.ok(isBootstrapActive(isolated));
    assert.equal(checkProtected('.cursor/hooks.json', isolated), 'allow');
  } finally {
    if (prev === undefined) delete process.env.AGENT_SCOPE_BOOTSTRAP;
    else process.env.AGENT_SCOPE_BOOTSTRAP = prev;
    rmSync(isolated, { recursive: true, force: true });
  }
});

test('coversProtected: detects a tree containing protected files', () => {
  const isolated = makeRepo();
  try {
    assert.ok(coversProtected('.cursor', isolated));
    assert.ok(coversProtected('.cursor/hooks', isolated));
    assert.ok(coversProtected('agent-scope/lib', isolated));
    assert.ok(!coversProtected('agent-scope/logs', isolated));
    assert.ok(!coversProtected('packages/core', isolated));
  } finally { rmSync(isolated, { recursive: true, force: true }); }
});

// --- normalisation --------------------------------------------------------

test('normalizeToRepoPath: handles absolute and relative inputs', () => {
  const root = '/tmp/repo';
  assert.equal(normalizeToRepoPath(root, '/tmp/repo/a/b/c.ts'), 'a/b/c.ts');
  assert.equal(normalizeToRepoPath(root, 'a/b/c.ts'), 'a/b/c.ts');
  assert.equal(normalizeToRepoPath(root, '/tmp/repo/'), '');
});

// --- back-compat shims ----------------------------------------------------

test('resolveActiveTaskId: with no DKG / no cache returns null id', () => {
  const isolated = makeRepo();
  try {
    process.env.AGENT_SCOPE_ROOT = isolated;
    const r = resolveActiveTaskId(isolated);
    assert.equal(r.id, null);
    assert.ok(r.scope);
    assert.notEqual(r.scope.reason, 'ok');
  } finally {
    delete process.env.AGENT_SCOPE_ROOT;
    rmSync(isolated, { recursive: true, force: true });
  }
});

test('loadTask: returns the synthetic scope passed in', () => {
  const synth = inProgressTask(['src/**']);
  assert.equal(loadTask('/x', null, synth), synth);
});

// --- explainDeny ----------------------------------------------------------

test('explainDeny: protected message references PROTECTED_PATTERNS + bootstrap', () => {
  const msg = explainDeny(null, '.cursor/hooks.json', 'protected');
  assert.match(msg, /PROTECTED PATH/);
  assert.match(msg, /bootstrap/i);
  for (const p of PROTECTED_PATTERNS) {
    assert.ok(msg.includes(p), `expected ${p} in message`);
  }
});

test('explainDeny: out-of-scope message references DKG workflow', () => {
  const t = {
    ...inProgressTask(['src/**']),
    id: 'urn:dkg:task:demo',
    dkgTaskUris: ['urn:dkg:task:demo'],
    description: 'demo task',
    tasks: [{ uri: 'urn:dkg:task:demo', title: 'demo' }],
  };
  const msg = explainDeny(t, 'lib/other.ts', 'deny');
  assert.match(msg, /OUT OF TASK SCOPE/);
  assert.match(msg, /dkg_add_task/);
  assert.match(msg, /urn:dkg:task:demo/);
});

// --- node version ---------------------------------------------------------

test('checkNodeVersion: passes on current process node', () => {
  assert.doesNotThrow(() => checkNodeVersion());
});

test('checkNodeVersion: fails when minMajor > current', () => {
  assert.throws(() => checkNodeVersion(999), /Node 999\+/);
});
