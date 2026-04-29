import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { dkgHomeDir, isProcessAlive, readDaemonPid, readDkgApiPort, loadAuthToken, loadAuthTokenSync, loadAgentEthAddressSync, loadAgentEthAddress, MultipleAgentsError, toEip55Checksum } from '../src/dkg-home.js';

describe('dkgHomeDir', () => {
  const originalEnv = process.env.DKG_HOME;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DKG_HOME;
    else process.env.DKG_HOME = originalEnv;
  });

  it('returns $DKG_HOME when set', () => {
    process.env.DKG_HOME = '/custom/path';
    expect(dkgHomeDir()).toBe('/custom/path');
  });

  it('defaults to ~/.dkg', () => {
    delete process.env.DKG_HOME;
    expect(dkgHomeDir()).toBe(join(homedir(), '.dkg'));
  });
});

describe('isProcessAlive', () => {
  it('returns true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for a non-existent PID', () => {
    expect(isProcessAlive(999999999)).toBe(false);
  });
});

describe('readDaemonPid', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `dkg-test-pid-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('reads a valid PID from file', async () => {
    await writeFile(join(tempDir, 'daemon.pid'), '12345');
    expect(await readDaemonPid(tempDir)).toBe(12345);
  });

  it('returns null for non-numeric content', async () => {
    await writeFile(join(tempDir, 'daemon.pid'), 'abc');
    expect(await readDaemonPid(tempDir)).toBeNull();
  });

  it('returns null for partial numeric content like "123abc"', async () => {
    await writeFile(join(tempDir, 'daemon.pid'), '123abc');
    expect(await readDaemonPid(tempDir)).toBeNull();
  });

  it('returns null when file does not exist', async () => {
    expect(await readDaemonPid(tempDir)).toBeNull();
  });

  it('returns null for empty file', async () => {
    await writeFile(join(tempDir, 'daemon.pid'), '');
    expect(await readDaemonPid(tempDir)).toBeNull();
  });

  it('returns null for hex notation like "0x1234"', async () => {
    await writeFile(join(tempDir, 'daemon.pid'), '0x1234');
    expect(await readDaemonPid(tempDir)).toBeNull();
  });

  it('returns null for scientific notation like "1e3"', async () => {
    await writeFile(join(tempDir, 'daemon.pid'), '1e3');
    expect(await readDaemonPid(tempDir)).toBeNull();
  });

  it('returns null for "0"', async () => {
    await writeFile(join(tempDir, 'daemon.pid'), '0');
    expect(await readDaemonPid(tempDir)).toBeNull();
  });
});

describe('readDkgApiPort', () => {
  let tempDir: string;
  const originalEnv = process.env.DKG_API_PORT;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `dkg-test-port-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    delete process.env.DKG_API_PORT;
  });

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.DKG_API_PORT;
    else process.env.DKG_API_PORT = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prefers $DKG_API_PORT over file', async () => {
    process.env.DKG_API_PORT = '8888';
    await writeFile(join(tempDir, 'api.port'), '9200');
    expect(await readDkgApiPort(tempDir)).toBe(8888);
  });

  it('reads port from file when env is not set', async () => {
    await writeFile(join(tempDir, 'api.port'), '9200');
    expect(await readDkgApiPort(tempDir)).toBe(9200);
  });

  it('returns null for invalid env value', async () => {
    process.env.DKG_API_PORT = 'notanumber';
    expect(await readDkgApiPort(tempDir)).toBeNull();
  });

  it('returns null for out-of-range port', async () => {
    process.env.DKG_API_PORT = '99999';
    expect(await readDkgApiPort(tempDir)).toBeNull();
  });

  it('returns null for port 0', async () => {
    process.env.DKG_API_PORT = '0';
    expect(await readDkgApiPort(tempDir)).toBeNull();
  });

  it('does NOT fall through to file when env is set but invalid', async () => {
    process.env.DKG_API_PORT = 'invalid';
    await writeFile(join(tempDir, 'api.port'), '9200');
    expect(await readDkgApiPort(tempDir)).toBeNull();
  });

  it('does NOT fall through to file when env is whitespace-only', async () => {
    process.env.DKG_API_PORT = '   ';
    await writeFile(join(tempDir, 'api.port'), '9200');
    expect(await readDkgApiPort(tempDir)).toBeNull();
  });

  it('does NOT fall through to file when env is empty string', async () => {
    process.env.DKG_API_PORT = '';
    await writeFile(join(tempDir, 'api.port'), '9200');
    expect(await readDkgApiPort(tempDir)).toBeNull();
  });

  it('rejects hex port like "0x2390"', async () => {
    process.env.DKG_API_PORT = '0x2390';
    expect(await readDkgApiPort(tempDir)).toBeNull();
  });

  it('rejects scientific notation like "1e3"', async () => {
    process.env.DKG_API_PORT = '1e3';
    expect(await readDkgApiPort(tempDir)).toBeNull();
  });

  it('returns null when neither env nor file exist', async () => {
    expect(await readDkgApiPort(tempDir)).toBeNull();
  });
});

describe('loadAuthToken / loadAuthTokenSync', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `dkg-test-token-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads a token from file', async () => {
    await writeFile(join(tempDir, 'auth.token'), 'my-secret-token\n');
    expect(await loadAuthToken(tempDir)).toBe('my-secret-token');
    expect(loadAuthTokenSync(tempDir)).toBe('my-secret-token');
  });

  it('skips comment lines and blank lines', async () => {
    await writeFile(join(tempDir, 'auth.token'), '# comment\n\n  \nactual-token\n');
    expect(await loadAuthToken(tempDir)).toBe('actual-token');
    expect(loadAuthTokenSync(tempDir)).toBe('actual-token');
  });

  it('returns undefined when file does not exist', async () => {
    expect(await loadAuthToken(tempDir)).toBeUndefined();
    expect(loadAuthTokenSync(tempDir)).toBeUndefined();
  });

  it('returns undefined for file with only comments', async () => {
    await writeFile(join(tempDir, 'auth.token'), '# comment only\n');
    expect(await loadAuthToken(tempDir)).toBeUndefined();
    expect(loadAuthTokenSync(tempDir)).toBeUndefined();
  });
});

describe('loadAgentEthAddress / loadAgentEthAddressSync', () => {
  let tempDir: string;
  // T62 — Test fixtures are LOWERCASE inputs (the form the keystore JSON keys
  // ship in). The helper now returns EIP-55 checksum form, so assertions
  // compare against the checksummed expected value.
  const ETH_A_LC = '0x26c9b05a30138b35e84e60a5b778d580065ffbb8';
  const ETH_B_LC = '0x949ec97ab4ed1c9fb4c9a70c2dd368065d817b0c';
  const ETH_A = toEip55Checksum(ETH_A_LC);
  const ETH_B = toEip55Checksum(ETH_B_LC);

  beforeEach(async () => {
    tempDir = join(tmpdir(), `dkg-test-keystore-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns the single eth address from a single-agent keystore (sync + async)', async () => {
    await writeFile(
      join(tempDir, 'agent-keystore.json'),
      JSON.stringify({ [ETH_A_LC]: { authToken: 'tok', privateKey: '0xpk' } }),
    );
    // T62 — return value is EIP-55 checksum form, not the lowercase keystore key.
    expect(loadAgentEthAddressSync(tempDir)).toBe(ETH_A);
    expect(await loadAgentEthAddress(tempDir)).toBe(ETH_A);
  });

  it('normalises mixed-case eth address keys to canonical EIP-55 (T62)', async () => {
    const mixed = '0x26C9b05a30138B35E84e60A5B778D580065ffbb8';
    await writeFile(
      join(tempDir, 'agent-keystore.json'),
      JSON.stringify({ [mixed]: { authToken: 'tok' } }),
    );
    // Whatever case the keystore key has, output is canonical checksum.
    expect(loadAgentEthAddressSync(tempDir)).toBe(ETH_A);
  });

  it('returns undefined when keystore file does not exist', async () => {
    expect(loadAgentEthAddressSync(tempDir)).toBeUndefined();
    expect(await loadAgentEthAddress(tempDir)).toBeUndefined();
  });

  it('returns undefined for an empty object keystore', async () => {
    await writeFile(join(tempDir, 'agent-keystore.json'), '{}');
    expect(loadAgentEthAddressSync(tempDir)).toBeUndefined();
    expect(await loadAgentEthAddress(tempDir)).toBeUndefined();
  });

  it('returns undefined for keystore with only non-eth-shaped keys', async () => {
    await writeFile(
      join(tempDir, 'agent-keystore.json'),
      JSON.stringify({ 'not-an-eth-key': { authToken: 'tok' }, '12D3KooWPeerLike': {} }),
    );
    expect(loadAgentEthAddressSync(tempDir)).toBeUndefined();
  });

  it('returns undefined for malformed JSON (treat as missing, do not throw)', async () => {
    await writeFile(join(tempDir, 'agent-keystore.json'), '{ this is not json');
    expect(loadAgentEthAddressSync(tempDir)).toBeUndefined();
    expect(await loadAgentEthAddress(tempDir)).toBeUndefined();
  });

  it('throws MultipleAgentsError when keystore has multiple eth keys', async () => {
    await writeFile(
      join(tempDir, 'agent-keystore.json'),
      JSON.stringify({ [ETH_A_LC]: { authToken: 'a' }, [ETH_B_LC]: { authToken: 'b' } }),
    );
    expect(() => loadAgentEthAddressSync(tempDir)).toThrow(MultipleAgentsError);
    await expect(loadAgentEthAddress(tempDir)).rejects.toBeInstanceOf(MultipleAgentsError);
  });

  it('MultipleAgentsError exposes the conflicting addresses (EIP-55 checksum)', async () => {
    await writeFile(
      join(tempDir, 'agent-keystore.json'),
      JSON.stringify({ [ETH_A_LC.toUpperCase()]: {}, [ETH_B_LC]: {} }),
    );
    try {
      loadAgentEthAddressSync(tempDir);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MultipleAgentsError);
      const e = err as MultipleAgentsError;
      // T62 — addresses surface in EIP-55 checksum form (canonical for graph URIs).
      expect(e.addresses).toContain(ETH_A);
      expect(e.addresses).toContain(ETH_B);
    }
  });

  it('T46 — dedupes same address recorded in checksum AND lowercase form (single-agent, not multi)', async () => {
    // Operator hand-edited the keystore (or two writer paths used
    // different normalisation), recording the same identity as both
    // mixed-case (checksum) and lowercase. Pre-fix the lowercase
    // pass left two equal entries → MultipleAgentsError fired and
    // disabled WM lookup. Post-fix the dedupe collapses them.
    const checksumA = ETH_A;
    const lowercase = ETH_A_LC;
    await writeFile(
      join(tempDir, 'agent-keystore.json'),
      JSON.stringify({ [checksumA]: { authToken: 'a' }, [lowercase]: { authToken: 'b' } }),
    );
    // T62 — return value is the canonical EIP-55 form regardless of which
    // case happened to be recorded in the keystore.
    expect(loadAgentEthAddressSync(tempDir)).toBe(ETH_A);
    expect(await loadAgentEthAddress(tempDir)).toBe(ETH_A);
  });

  it('honors explicitAddress override (skips keystore read)', async () => {
    // No keystore file at all — override still resolves.
    expect(
      loadAgentEthAddressSync(tempDir, { explicitAddress: ETH_A_LC }),
    ).toBe(ETH_A);
    expect(
      await loadAgentEthAddress(tempDir, { explicitAddress: ETH_A_LC }),
    ).toBe(ETH_A);
  });

  it('explicit override normalises mixed-case input to EIP-55 (T62)', () => {
    expect(
      loadAgentEthAddressSync(tempDir, { explicitAddress: '0x26C9B05A30138b35E84E60A5b778d580065FFBB8' }),
    ).toBe(ETH_A);
  });

  it('explicit override is ignored when not eth-shaped (falls through to keystore)', async () => {
    await writeFile(
      join(tempDir, 'agent-keystore.json'),
      JSON.stringify({ [ETH_A_LC]: { authToken: 'tok' } }),
    );
    // Garbage override → fall through to keystore → returns ETH_A (checksum).
    expect(
      loadAgentEthAddressSync(tempDir, { explicitAddress: 'not-an-address' }),
    ).toBe(ETH_A);
    // Empty / whitespace override → same.
    expect(loadAgentEthAddressSync(tempDir, { explicitAddress: '   ' })).toBe(ETH_A);
  });

  it('explicit override disambiguates a multi-agent keystore', async () => {
    await writeFile(
      join(tempDir, 'agent-keystore.json'),
      JSON.stringify({ [ETH_A_LC]: {}, [ETH_B_LC]: {} }),
    );
    expect(
      loadAgentEthAddressSync(tempDir, { explicitAddress: ETH_B_LC }),
    ).toBe(ETH_B);
    // Without override → throw.
    expect(() => loadAgentEthAddressSync(tempDir)).toThrow(MultipleAgentsError);
  });

  it('T62 — toEip55Checksum produces canonical EIP-55 form for known vectors', () => {
    // Reference vectors from EIP-55 spec.
    expect(toEip55Checksum('0x52908400098527886e0f7030069857d2e4169ee7'))
      .toBe('0x52908400098527886E0F7030069857D2E4169EE7');
    expect(toEip55Checksum('0x8617e340b3d01fa5f11f306f4090fd50e238070d'))
      .toBe('0x8617E340B3D01FA5F11F306F4090FD50E238070D');
    expect(toEip55Checksum('0xde709f2102306220921060314715629080e2fb77'))
      .toBe('0xde709f2102306220921060314715629080e2fb77');
    expect(toEip55Checksum('0x27b1fdb04752bbc536007a920d24acb045561c26'))
      .toBe('0x27b1fdb04752bbc536007a920d24acb045561c26');
    // "Normal" mixed-case vectors from the EIP-55 spec.
    expect(toEip55Checksum('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'))
      .toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
    expect(toEip55Checksum('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359'))
      .toBe('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359');
    // Round-trip: checksumming a checksum value yields the same string.
    expect(toEip55Checksum(ETH_A)).toBe(ETH_A);
    // Throws on bad input shape.
    expect(() => toEip55Checksum('not-an-address')).toThrow();
    expect(() => toEip55Checksum('0x123')).toThrow();
  });
});
