import { describe, it, expect } from 'vitest';
import {
  loadNetworkConfig,
  removePid,
  removeApiPort,
  writePid,
  writeApiPort,
  readPid,
  readApiPort,
  ensureDkgDir,
} from '../src/config.js';

describe('removePid / removeApiPort (catch path)', () => {
  it('removePid does not throw when pid file does not exist (ENOENT)', async () => {
    await expect(removePid()).resolves.toBeUndefined();
  });

  it('removeApiPort does not throw when api.port file does not exist (ENOENT)', async () => {
    await expect(removeApiPort()).resolves.toBeUndefined();
  });

  it('removePid removes existing pid file', async () => {
    await ensureDkgDir();
    await writePid(12345);
    await expect(removePid()).resolves.toBeUndefined();
    expect(await readPid()).toBeNull();
  });

  it('removeApiPort removes existing api.port file', async () => {
    await ensureDkgDir();
    await writeApiPort(9200);
    await expect(removeApiPort()).resolves.toBeUndefined();
    expect(await readApiPort()).toBeNull();
  });
});

describe('loadNetworkConfig', () => {
  it('loads network/testnet.json with shape expected by join flow when run from repo', async () => {
    const config = await loadNetworkConfig();
    // When run from monorepo (turbo test), CLI is built and dist/config.js resolves repo root
    if (!config) {
      // Not in repo or testnet.json missing — skip shape assertions
      return;
    }
    expect(config.networkName).toBeDefined();
    expect(Array.isArray(config.relays)).toBe(true);
    expect(config.relays.length).toBeGreaterThan(0);
    expect(config.relays[0]).toMatch(/^\/ip4\/\d+\.\d+\.\d+\.\d+\/tcp\/\d+\/p2p\/12D3KooW/);
    expect(config.defaultNodeRole).toMatch(/^edge|core$/);
    if (config.chain) {
      expect(config.chain.type).toBe('evm');
      expect(config.chain.rpcUrl).toBeDefined();
      expect(config.chain.hubAddress).toBeDefined();
      expect(config.chain.chainId).toBeDefined();
    }
  });
});
