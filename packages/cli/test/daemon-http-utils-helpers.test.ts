/**
 * Unit tests for daemon HTTP-utils security helpers.
 *
 * Both helpers under test were flagged on PR #229 review:
 *
 *   - r3146360283 / `isValidContextGraphId` —
 *       The original CLI-16 fix used a blanket `id.includes('..')` to
 *       reject path traversal. That over-rejected valid URI/DID-shaped
 *       context-graph IDs (e.g. `https://example.com/a..b`,
 *       `urn:cg:v1..2`) which never resolve to a parent-directory
 *       segment.  The segment-aware check below is the only check the
 *       OS / URL resolver actually treats as a traversal vector.
 *
 *   - r3146360288 / `sanitizeRevertMessage` —
 *       The original sanitiser only redacted `data="0x…"`. Providers
 *       (ethers, viem, hardhat) also serialise revert blobs as
 *       `data=0x…`, `errorData="0x…"`, `errorData=0x…`, and JSON
 *       `"data":"0x…"`. Any of those slipping through the sanitiser
 *       leaks a custom-error selector to operators (PR #229 CLI-9
 *       leak class).
 *
 * These tests pin the contract at the HELPER level so we don't depend
 * on a full daemon spin-up to detect a regression. The integration-level
 * sibling assertions live in `daemon-http-behavior-extra.test.ts`
 * (CLI-9, CLI-16 blocks) and continue to exercise the wired-up daemon.
 */
import { describe, it, expect } from 'vitest';
import { isValidContextGraphId, sanitizeRevertMessage } from '../src/daemon.js';

describe('isValidContextGraphId — segment-aware path-traversal rejection', () => {
  // Real traversal patterns: every segment that EQUALS `.` or `..`
  // must still be rejected. These are what the OS / URL resolver
  // collapses into a parent-dir reference.
  for (const bad of [
    '..',
    '.',
    '../etc/passwd',
    '../../root',
    './../_private',
    'legit-cg/../../other-cg',
    'a/./b',
    'a/../b',
    '/..',
    '../',
    'cg/.',
    'cg/..',
    './cg',
  ]) {
    it(`rejects "${bad}" as a traversal segment`, () => {
      expect(isValidContextGraphId(bad)).toBe(false);
    });
  }

  // Bot review r3146360283: these URI / DID shaped IDs contain `..`
  // INSIDE a single segment but never resolve to a parent dir. The
  // pre-fix sanitiser broke them. They must validate as legitimate
  // context-graph IDs.
  for (const good of [
    'urn:cg:v1..2',
    'urn:dkg:context-graph:semver..rc',
    'did:dkg:context-graph:project..staging',
    'cg-with..dots-in-segment',
    'a..b',
    'company..product',
  ]) {
    it(`accepts URI/DID-shaped id "${good}" (\`..\` inside single segment)`, () => {
      expect(isValidContextGraphId(good)).toBe(true);
    });
  }

  // Length / charset rules still hold.
  it('rejects empty string', () => {
    expect(isValidContextGraphId('')).toBe(false);
  });
  it('rejects > 256 chars', () => {
    expect(isValidContextGraphId('a'.repeat(257))).toBe(false);
  });
  it('rejects characters outside the whitelist', () => {
    expect(isValidContextGraphId('cg with space')).toBe(false);
    expect(isValidContextGraphId('cg<script>')).toBe(false);
    expect(isValidContextGraphId('cg;DROP TABLE')).toBe(false);
  });
  it('accepts standard slug, URN, DID, https forms', () => {
    expect(isValidContextGraphId('my-context-graph')).toBe(true);
    expect(isValidContextGraphId('urn:dkg:cg:my-cg')).toBe(true);
    expect(isValidContextGraphId('did:dkg:cg:my-cg')).toBe(true);
    expect(isValidContextGraphId('https://example.com/cg')).toBe(true);
    expect(isValidContextGraphId('cg-1.0.0')).toBe(true);
  });
});

describe('sanitizeRevertMessage — redacts every revert-blob shape recognised by enrichEvmError', () => {
  // Pre-fix only this variant got redacted.
  it('redacts `data="0x…"` (quoted, `=`)', () => {
    const out = sanitizeRevertMessage('error: data="0xdeadbeef" (call failed)');
    expect(out).toContain('data="<redacted>"');
    expect(out).not.toContain('0xdeadbeef');
  });

  // PR #229 r3146360288 — these ALL leaked pre-fix.
  it('redacts `data=0x…` (unquoted, `=`)', () => {
    const out = sanitizeRevertMessage('CALL_EXCEPTION: data=0xabcdef0123');
    expect(out).toContain('data=<redacted>');
    expect(out).not.toContain('0xabcdef0123');
  });
  it('redacts `errorData="0x…"` (quoted, `=`)', () => {
    const out = sanitizeRevertMessage('reverted (errorData="0xcafebabe", code=4)');
    expect(out).toContain('errorData="<redacted>"');
    expect(out).not.toContain('0xcafebabe');
  });
  it('redacts `errorData=0x…` (unquoted, `=`)', () => {
    const out = sanitizeRevertMessage('reverted errorData=0xfeedface');
    expect(out).toContain('errorData=<redacted>');
    expect(out).not.toContain('0xfeedface');
  });
  it('redacts JSON `"data":"0x…"`', () => {
    const out = sanitizeRevertMessage(
      'rpc body: {"code":3,"message":"execution reverted","data":"0x12345678abcdef"}',
    );
    expect(out).toContain('"data":"<redacted>"');
    expect(out).not.toContain('0x12345678abcdef');
  });
  it('redacts the `unknown custom error` marker', () => {
    const out = sanitizeRevertMessage(
      'execution reverted: unknown custom error 0xab12cd34. Please retry.',
    );
    expect(out).toContain('request rejected by chain');
    // The marker text is gone.
    expect(out).not.toMatch(/unknown custom error/i);
  });
  it('redacts MULTIPLE blobs in the same message', () => {
    const out = sanitizeRevertMessage(
      'execution reverted: data="0xaaaa" wrapped; errorData=0xbbbb; rpc body {"data":"0xcccc"}',
    );
    expect(out).not.toMatch(/0xaaaa|0xbbbb|0xcccc/);
    expect(out).toContain('<redacted>');
  });
  it('leaves a non-revert message untouched (modulo whitespace squashing)', () => {
    const msg = 'config validation failed: missing rpcUrl in chain section';
    expect(sanitizeRevertMessage(msg)).toBe(msg);
  });

  // Defence-in-depth: the helper must NOT introduce its own ReDoS.
  // Pathological input (millions of hex chars) should sanitize in a
  // bounded time, not lock the event loop.
  it('runs in linear time on a pathological 10kB hex blob', () => {
    const huge = '0x' + 'a'.repeat(10_000);
    const msg = `data="${huge}" wrapped`;
    const t0 = Date.now();
    const out = sanitizeRevertMessage(msg);
    const dt = Date.now() - t0;
    expect(out).toContain('data="<redacted>"');
    expect(dt).toBeLessThan(100);
  });
});
