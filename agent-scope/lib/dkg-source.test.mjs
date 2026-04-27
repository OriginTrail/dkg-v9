// Unit tests for dkg-source.mjs. Pure-function tests + a couple of
// no-network end-to-end checks (config loader, soft-mode fallthroughs).
// Run with:
//   node --test agent-scope/lib/dkg-source.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseDotDkgConfig, loadDkgWorkspaceConfig, describeScope, resolveDkgScope,
} from './dkg-source.mjs';

function makeWorkspace({ projectId, agentUri, api, token, tokenFile } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dkg-source-test-'));
  mkdirSync(join(root, '.dkg'), { recursive: true });
  const lines = [];
  if (api) lines.push(`node:`, `  api: "${api}"`);
  if (token) {
    if (!api) lines.push('node:');
    lines.push(`  token: "${token}"`);
  }
  if (tokenFile) {
    if (!api && !token) lines.push('node:');
    lines.push(`  tokenFile: "${tokenFile}"`);
  }
  if (projectId) lines.push(`contextGraph: "${projectId}"`);
  if (agentUri) lines.push(`agent:`, `  uri: "${agentUri}"`);
  writeFileSync(join(root, '.dkg', 'config.yaml'), lines.join('\n') + '\n');
  return root;
}

// --- parseDotDkgConfig ----------------------------------------------------

test('parseDotDkgConfig: simple top-level scalars', () => {
  const c = parseDotDkgConfig('contextGraph: "urn:proj:demo"\nproject: ignored\n');
  assert.equal(c.contextGraph, 'urn:proj:demo');
  assert.equal(c.project, 'ignored');
});

test('parseDotDkgConfig: nested two-space mapping', () => {
  const c = parseDotDkgConfig([
    'node:',
    '  api: "http://localhost:9200"',
    '  token: "abc"',
    'agent:',
    '  uri: "urn:agent:demo"',
  ].join('\n'));
  assert.equal(c.node.api, 'http://localhost:9200');
  assert.equal(c.node.token, 'abc');
  assert.equal(c.agent.uri, 'urn:agent:demo');
});

test('parseDotDkgConfig: comments and blank lines ignored', () => {
  const c = parseDotDkgConfig([
    '# top comment',
    'contextGraph: "p"  # trailing comment',
    '',
    'agent:',
    '  uri: "u"',
  ].join('\n'));
  assert.equal(c.contextGraph, 'p');
  assert.equal(c.agent.uri, 'u');
});

test('parseDotDkgConfig: integer + boolean coercion', () => {
  const c = parseDotDkgConfig('node:\n  port: 9200\n  tls: true\n');
  assert.equal(c.node.port, 9200);
  assert.equal(c.node.tls, true);
});

test('parseDotDkgConfig: malformed input returns shape with empty groups', () => {
  const c = parseDotDkgConfig('not yaml at all');
  assert.deepEqual(c, { node: {}, agent: {}, capture: {} });
});

// --- loadDkgWorkspaceConfig -----------------------------------------------

test('loadDkgWorkspaceConfig: reads YAML when present', () => {
  const root = makeWorkspace({
    projectId: 'urn:proj:demo',
    agentUri: 'urn:agent:demo',
    api: 'http://localhost:9999',
    token: 'tok',
  });
  try {
    const cfg = loadDkgWorkspaceConfig(root);
    assert.equal(cfg.api, 'http://localhost:9999');
    assert.equal(cfg.token, 'tok');
    assert.equal(cfg.projectId, 'urn:proj:demo');
    assert.equal(cfg.agentUri, 'urn:agent:demo');
    assert.match(cfg.sourcePath || '', /config\.yaml$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('loadDkgWorkspaceConfig: env fallback when no YAML', () => {
  const root = mkdtempSync(join(tmpdir(), 'dkg-source-test-'));
  const prev = {
    p: process.env.DKG_PROJECT, a: process.env.DKG_AGENT_URI,
    api: process.env.DKG_API, tok: process.env.DKG_TOKEN,
  };
  try {
    process.env.DKG_PROJECT = 'urn:env:p';
    process.env.DKG_AGENT_URI = 'urn:env:a';
    process.env.DKG_API = 'http://localhost:1234';
    process.env.DKG_TOKEN = 'env-token';
    const cfg = loadDkgWorkspaceConfig(root);
    assert.equal(cfg.projectId, 'urn:env:p');
    assert.equal(cfg.agentUri, 'urn:env:a');
    assert.equal(cfg.api, 'http://localhost:1234');
    assert.equal(cfg.token, 'env-token');
    assert.equal(cfg.sourcePath, null);
  } finally {
    Object.entries(prev).forEach(([k, v]) => {
      const envKey = { p: 'DKG_PROJECT', a: 'DKG_AGENT_URI', api: 'DKG_API', tok: 'DKG_TOKEN' }[k];
      if (v === undefined) delete process.env[envKey]; else process.env[envKey] = v;
    });
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadDkgWorkspaceConfig: tokenFile is read when token is empty', () => {
  const root = makeWorkspace({
    projectId: 'p', agentUri: 'a', tokenFile: './secret.txt',
  });
  try {
    writeFileSync(join(root, '.dkg', 'secret.txt'), 'file-token\n# comment\n');
    const cfg = loadDkgWorkspaceConfig(root);
    assert.equal(cfg.token, 'file-token');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- resolveDkgScope (no network paths only) ------------------------------

test('resolveDkgScope: no config, no env → no-config soft fallthrough', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dkg-source-test-'));
  const prev = {
    p: process.env.DKG_PROJECT, a: process.env.DKG_AGENT_URI,
  };
  delete process.env.DKG_PROJECT;
  delete process.env.DKG_AGENT_URI;
  try {
    const r = await resolveDkgScope({ root, force: true });
    assert.equal(r.reason, 'no-config');
    assert.equal(r.allowed.length, 0);
    assert.equal(r.exemptions.length, 0);
  } finally {
    if (prev.p !== undefined) process.env.DKG_PROJECT = prev.p;
    if (prev.a !== undefined) process.env.DKG_AGENT_URI = prev.a;
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDkgScope: project but no agent → no-agent', async () => {
  const root = makeWorkspace({ projectId: 'p' });
  try {
    const r = await resolveDkgScope({ root, force: true });
    assert.equal(r.reason, 'no-agent');
    assert.match(r.diagnostic, /agent\.uri/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolveDkgScope: agent but no project → no-project', async () => {
  const root = makeWorkspace({ agentUri: 'urn:agent:x' });
  try {
    const r = await resolveDkgScope({ root, force: true });
    assert.equal(r.reason, 'no-project');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolveDkgScope: bad daemon URL → daemon-unreachable, no throw', async () => {
  // Pin to a port that nothing is listening on; verifies the timeout +
  // catch path that turns network errors into a soft scope.
  const root = makeWorkspace({
    projectId: 'p', agentUri: 'urn:agent:x', api: 'http://127.0.0.1:1',
  });
  try {
    const r = await resolveDkgScope({ root, force: true });
    assert.equal(r.reason, 'daemon-unreachable');
    assert.equal(r.allowed.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- describeScope --------------------------------------------------------

test('describeScope: ok scope mentions task title', () => {
  const s = {
    reason: 'ok',
    tasks: [{ uri: 'urn:dkg:task:demo', title: 'Demo' }],
    allowed: ['src/**'],
    exemptions: [],
  };
  const out = describeScope(s);
  assert.match(out, /Demo/);
  assert.match(out, /1 active task/);
});

test('describeScope: error scope surfaces reason', () => {
  const s = { reason: 'no-active-task', diagnostic: 'no in_progress task', tasks: [], allowed: [], exemptions: [] };
  const out = describeScope(s);
  assert.match(out, /no-active-task/);
});
