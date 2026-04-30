/**
 * Tests for the zero-touch chain-reset auto-wipe hook.
 *
 * The hook (packages/cli/src/daemon/chain-reset-wipe.ts) runs on daemon
 * boot before the agent opens its store. It compares the bundled
 * `network.chainResetMarker` against the one persisted under
 * `<dataDir>/.network-state.json` and wipes oxigraph store + publish
 * journal + random-sampling WAL when the two don't match.
 *
 * What we lock in:
 *   1. No marker in network config → hook is a no-op (no state file
 *      written, networks that haven't opted in stay untouched).
 *   2. Persisted == current → no wipe, idempotent.
 *   3. Marker changed → wipe ALL of: store.nq, store.nq.tmp,
 *      random-sampling.wal, every publish-journal.* file. Save new marker.
 *   4. First boot WITH marker present (no persisted state) → wipe.
 *      Documented design: only way to reach here on an existing install
 *      is "auto-update brought a release with a fresh marker", which by
 *      construction happens in the chain-reset window.
 *   5. Preserved files — wallets.json, auth.token, config.json, node-ui.db,
 *      files/ directory, auto-update markers — must survive every code path.
 *   6. Corrupt / unreadable state file → treated as null persisted marker.
 *   7. Idempotent across repeated calls with the same input.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chainResetWipe } from '../src/daemon/chain-reset-wipe.js';

const STATE_FILE = '.network-state.json';
const NEW_MARKER = 'v10-rs-staking-consolidation-2026-04-30';
const OLD_MARKER = 'v9-mainnet-launch-2025-12-01';

let dataDir: string;

function seedAllFiles(dataDir: string) {
  // Files that MUST be wiped on marker change.
  writeFileSync(join(dataDir, 'store.nq'), '<s> <p> <o> .');
  writeFileSync(join(dataDir, 'store.nq.tmp'), '<s> <p> <o> .');
  writeFileSync(join(dataDir, 'random-sampling.wal'), 'WAL\n');
  writeFileSync(join(dataDir, 'publish-journal.0'), 'journal-0');
  writeFileSync(join(dataDir, 'publish-journal.1'), 'journal-1');
  writeFileSync(join(dataDir, 'publish-journal.staging'), 'journal-staging');
  // Files that MUST be preserved across the wipe.
  writeFileSync(join(dataDir, 'wallets.json'), '[{"address":"0x..."}]');
  writeFileSync(join(dataDir, 'auth.token'), 'secret-token');
  writeFileSync(join(dataDir, 'config.json'), '{"name":"test"}');
  writeFileSync(join(dataDir, 'node-ui.db'), 'sqlite-bytes');
  writeFileSync(join(dataDir, '.update-pending.json'), '{}');
  writeFileSync(join(dataDir, '.current-version'), '10.0.0-rc.1');
  mkdirSync(join(dataDir, 'files'), { recursive: true });
  writeFileSync(join(dataDir, 'files', 'doc1.md'), '# uploaded');
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'dkg-wipe-test-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('chainResetWipe — opt-in protocol', () => {
  it('is a no-op when network config has no marker (back-compat)', () => {
    seedAllFiles(dataDir);
    const result = chainResetWipe({ dataDir, currentMarker: undefined });

    expect(result.wiped).toBe(false);
    expect(result.prevMarker).toBeNull();
    expect(result.removedFiles).toEqual([]);
    // No state file is created when the protocol isn't active.
    expect(existsSync(join(dataDir, STATE_FILE))).toBe(false);
    // All files preserved.
    expect(existsSync(join(dataDir, 'store.nq'))).toBe(true);
    expect(existsSync(join(dataDir, 'random-sampling.wal'))).toBe(true);
  });
});

describe('chainResetWipe — first boot with marker present', () => {
  it('wipes and saves marker (the chain-reset rollout case)', () => {
    seedAllFiles(dataDir);
    const logs: string[] = [];

    const result = chainResetWipe({
      dataDir,
      currentMarker: NEW_MARKER,
      log: (msg) => logs.push(msg),
    });

    expect(result.wiped).toBe(true);
    expect(result.prevMarker).toBeNull();
    expect(result.removedFiles).toEqual(
      expect.arrayContaining([
        'store.nq',
        'store.nq.tmp',
        'random-sampling.wal',
        'publish-journal.0',
        'publish-journal.1',
        'publish-journal.staging',
      ]),
    );

    expect(existsSync(join(dataDir, 'store.nq'))).toBe(false);
    expect(existsSync(join(dataDir, 'wallets.json'))).toBe(true);
    expect(existsSync(join(dataDir, STATE_FILE))).toBe(true);
    const persisted = JSON.parse(readFileSync(join(dataDir, STATE_FILE), 'utf8'));
    expect(persisted.chainResetMarker).toBe(NEW_MARKER);

    expect(logs.some((l) => l.includes('first detected'))).toBe(true);
  });

  it('still records the marker on a fresh install with no chain-state files yet', () => {
    const result = chainResetWipe({ dataDir, currentMarker: NEW_MARKER });

    expect(result.wiped).toBe(true);
    expect(result.removedFiles).toEqual([]);
    expect(existsSync(join(dataDir, STATE_FILE))).toBe(true);
  });
});

describe('chainResetWipe — same marker (steady state)', () => {
  it('does nothing when persisted marker equals current', () => {
    writeFileSync(
      join(dataDir, STATE_FILE),
      JSON.stringify({ chainResetMarker: NEW_MARKER, savedAt: Date.now() }),
    );
    seedAllFiles(dataDir);

    const result = chainResetWipe({ dataDir, currentMarker: NEW_MARKER });

    expect(result.wiped).toBe(false);
    expect(result.prevMarker).toBe(NEW_MARKER);
    expect(result.removedFiles).toEqual([]);
    expect(existsSync(join(dataDir, 'store.nq'))).toBe(true);
    expect(existsSync(join(dataDir, 'random-sampling.wal'))).toBe(true);
  });
});

describe('chainResetWipe — marker changed (chain reset)', () => {
  it('wipes chain-state files and preserves operator state when marker differs', () => {
    writeFileSync(
      join(dataDir, STATE_FILE),
      JSON.stringify({ chainResetMarker: OLD_MARKER, savedAt: Date.now() - 86_400_000 }),
    );
    seedAllFiles(dataDir);

    const logs: string[] = [];
    const result = chainResetWipe({
      dataDir,
      currentMarker: NEW_MARKER,
      log: (msg) => logs.push(msg),
    });

    expect(result.wiped).toBe(true);
    expect(result.prevMarker).toBe(OLD_MARKER);

    // Wiped:
    expect(existsSync(join(dataDir, 'store.nq'))).toBe(false);
    expect(existsSync(join(dataDir, 'store.nq.tmp'))).toBe(false);
    expect(existsSync(join(dataDir, 'random-sampling.wal'))).toBe(false);
    expect(existsSync(join(dataDir, 'publish-journal.0'))).toBe(false);
    expect(existsSync(join(dataDir, 'publish-journal.1'))).toBe(false);
    expect(existsSync(join(dataDir, 'publish-journal.staging'))).toBe(false);

    // Preserved (the contract that makes auto-wipe safe):
    expect(existsSync(join(dataDir, 'wallets.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'auth.token'))).toBe(true);
    expect(existsSync(join(dataDir, 'config.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'node-ui.db'))).toBe(true);
    expect(existsSync(join(dataDir, 'files', 'doc1.md'))).toBe(true);
    expect(existsSync(join(dataDir, '.update-pending.json'))).toBe(true);
    expect(existsSync(join(dataDir, '.current-version'))).toBe(true);

    // State file rewritten with new marker.
    const persisted = JSON.parse(readFileSync(join(dataDir, STATE_FILE), 'utf8'));
    expect(persisted.chainResetMarker).toBe(NEW_MARKER);

    // Loud-log invariant: operators should see in journalctl that the
    // reset happened and what was removed (else they'll think the wipe
    // never ran and try to do it manually anyway, defeating the purpose).
    expect(logs.some((l) => l.includes('Chain reset detected'))).toBe(true);
    expect(logs.some((l) => l.includes('Wiping'))).toBe(true);
  });

  it('handles missing chain-state files gracefully (subset wipe)', () => {
    writeFileSync(
      join(dataDir, STATE_FILE),
      JSON.stringify({ chainResetMarker: OLD_MARKER, savedAt: Date.now() }),
    );
    // Only seed store.nq; the others don't exist on this node yet.
    writeFileSync(join(dataDir, 'store.nq'), '...');

    const result = chainResetWipe({ dataDir, currentMarker: NEW_MARKER });

    expect(result.wiped).toBe(true);
    expect(result.removedFiles).toEqual(['store.nq']);
    expect(existsSync(join(dataDir, 'store.nq'))).toBe(false);
  });

  it('is idempotent: a second call with the same input is a no-op', () => {
    writeFileSync(
      join(dataDir, STATE_FILE),
      JSON.stringify({ chainResetMarker: OLD_MARKER, savedAt: Date.now() }),
    );
    seedAllFiles(dataDir);

    const first = chainResetWipe({ dataDir, currentMarker: NEW_MARKER });
    expect(first.wiped).toBe(true);

    // Re-seed the chain-state files to simulate "boot, work, boot again".
    writeFileSync(join(dataDir, 'store.nq'), '<s> <p> <o> .');

    const second = chainResetWipe({ dataDir, currentMarker: NEW_MARKER });
    expect(second.wiped).toBe(false);
    expect(second.prevMarker).toBe(NEW_MARKER);
    expect(existsSync(join(dataDir, 'store.nq'))).toBe(true);
  });
});

describe('chainResetWipe — corrupt state file', () => {
  it('treats unparseable state as missing (first-boot semantics)', () => {
    writeFileSync(join(dataDir, STATE_FILE), '{ this is not valid JSON');
    seedAllFiles(dataDir);

    const result = chainResetWipe({ dataDir, currentMarker: NEW_MARKER });

    expect(result.wiped).toBe(true);
    expect(result.prevMarker).toBeNull();
    // State file gets rewritten with the current marker.
    const persisted = JSON.parse(readFileSync(join(dataDir, STATE_FILE), 'utf8'));
    expect(persisted.chainResetMarker).toBe(NEW_MARKER);
  });
});
