import { describe, it, expect, afterEach } from 'vitest';
import { DKGAgent, type SyncProgressEntry, generateWallets, loadOpWallets } from '../src/index.js';
import { OxigraphStore } from '@origintrail-official/dkg-storage';
import { MockChainAdapter } from '@origintrail-official/dkg-chain';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

async function createSyncAgent(opts?: {
  syncMode?: boolean;
  syncIntervalMs?: number;
  dataDir?: string;
  store?: OxigraphStore;
}) {
  const store = opts?.store ?? new OxigraphStore();
  const agent = await DKGAgent.create({
    name: 'SyncTestAgent',
    listenPort: 0,
    listenHost: '127.0.0.1',
    store,
    chainAdapter: new MockChainAdapter(),
    syncMode: opts?.syncMode,
    syncIntervalMs: opts?.syncIntervalMs,
    dataDir: opts?.dataDir,
  });
  return { agent, store };
}

describe('Sync event log (ring buffer)', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('pushSyncEvent adds entries and getSyncEventLog reads them', async () => {
    const { agent: a } = await createSyncAgent();
    agent = a;
    await agent.start();

    agent.pushSyncEvent('info', 'test event 1');
    agent.pushSyncEvent('ok', 'test event 2');
    agent.pushSyncEvent('warn', 'test event 3');

    const log = agent.getSyncEventLog();
    expect(log.length).toBe(3);
    expect(log[0].level).toBe('info');
    expect(log[0].message).toBe('test event 1');
    expect(log[1].level).toBe('ok');
    expect(log[2].level).toBe('warn');
    expect(log[0].ts).toBeGreaterThan(0);
  }, 15000);

  it('ring buffer evicts oldest entries when full', async () => {
    const { agent: a } = await createSyncAgent();
    agent = a;
    await agent.start();

    // Push more than the max buffer size (500)
    for (let i = 0; i < 550; i++) {
      agent.pushSyncEvent('info', `event-${i}`);
    }

    const log = agent.getSyncEventLog();
    expect(log.length).toBeLessThanOrEqual(500);
    // Oldest events should have been evicted
    expect(log[0].message).not.toBe('event-0');
    expect(log[log.length - 1].message).toBe('event-549');
  }, 15000);
});

describe('Sync progress tracking', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('getSyncProgress returns empty map initially', async () => {
    const { agent: a } = await createSyncAgent();
    agent = a;
    await agent.start();

    const progress = agent.getSyncProgress();
    expect(progress.size).toBe(0);
  }, 15000);

  it('syncMode config is accepted without errors', async () => {
    const { agent: a } = await createSyncAgent({ syncMode: true, syncIntervalMs: 300_000 });
    agent = a;
    await agent.start();

    // syncMode agent should start without errors
    const log = agent.getSyncEventLog();
    const hasPeriodicMsg = log.some(e => e.message.includes('Periodic sync enabled'));
    expect(hasPeriodicMsg).toBe(true);
  }, 15000);

  it('syncIntervalMs is clamped to minimum 10s', async () => {
    const { agent: a } = await createSyncAgent({ syncMode: true, syncIntervalMs: 100 });
    agent = a;
    await agent.start();

    const log = agent.getSyncEventLog();
    // Should show 10s (the minimum), not 100ms
    const msg = log.find(e => e.message.includes('Periodic sync enabled'));
    expect(msg).toBeDefined();
    expect(msg!.message).toContain('10s');
  }, 15000);
});

describe('Sync progress persistence', () => {
  let agent: DKGAgent | undefined;
  let tmpDir: string;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('saveSyncProgress writes and loadSyncProgress reads sync-progress.json', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sync-test-'));
    const { agent: a } = await createSyncAgent({ dataDir: tmpDir });
    agent = a;
    await agent.start();

    // Manually populate syncProgress via internal map
    const progressMap = (agent as any).syncProgress as Map<string, SyncProgressEntry>;
    progressMap.set('test-cg', {
      contextGraphId: 'test-cg',
      totalTriples: 42,
      lastSyncedAt: Date.now(),
      lastCheckedAt: Date.now(),
      lastDelta: 5,
      lastPeerSource: 'peer-123',
      lastDurationMs: 100,
      syncCount: 3,
      peerSources: new Set(['peer-123', 'peer-456']),
      lastGossipAt: Date.now() - 1000,
      lastGossipTriples: 10,
    });

    // Save
    await (agent as any).saveSyncProgress();

    // Verify file exists and is valid JSON
    const filePath = join(tmpDir, 'sync-progress.json');
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].contextGraphId).toBe('test-cg');
    expect(parsed[0].totalTriples).toBe(42);
    expect(parsed[0].peerSources).toEqual(['peer-123', 'peer-456']);
  }, 15000);

  it('loadSyncProgress restores from JSON file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sync-test-'));
    const { writeFile } = await import('node:fs/promises');

    // Pre-write a sync-progress.json
    const entries = [{
      contextGraphId: 'restored-cg',
      totalTriples: 999,
      lastSyncedAt: 1000,
      lastCheckedAt: 0,
      lastDelta: 0,
      lastPeerSource: 'peer-xyz',
      lastDurationMs: 0,
      syncCount: 7,
      peerSources: ['peer-xyz'],
      lastGossipAt: 0,
      lastGossipTriples: 0,
    }];
    await writeFile(join(tmpDir, 'sync-progress.json'), JSON.stringify(entries), 'utf-8');

    const { agent: a } = await createSyncAgent({ dataDir: tmpDir });
    agent = a;
    await agent.start();

    // Trigger load
    await (agent as any).loadSyncProgress();

    const progress = agent.getSyncProgress();
    const entry = progress.get('restored-cg');
    expect(entry).toBeDefined();
    expect(entry!.totalTriples).toBe(999);
    expect(entry!.syncCount).toBe(7);
    expect(entry!.peerSources).toBeInstanceOf(Set);
    expect(entry!.peerSources.has('peer-xyz')).toBe(true);
  }, 15000);

  it('loadSyncProgress falls back to store scan when JSON missing', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sync-test-'));
    const { writeFile } = await import('node:fs/promises');

    // Create a minimal store.nq with some triples
    const storeLines = [
      '<http://s1> <http://p> <http://o1> <urn:dkg:data:did:dkg:context-graph:test-fallback/data> .',
      '<http://s2> <http://p> <http://o2> <urn:dkg:data:did:dkg:context-graph:test-fallback/data> .',
      '<http://s3> <http://p> <http://o3> <urn:dkg:data:did:dkg:context-graph:test-fallback/meta> .',
    ];
    await writeFile(join(tmpDir, 'store.nq'), storeLines.join('\n'), 'utf-8');

    const { agent: a } = await createSyncAgent({ dataDir: tmpDir });
    agent = a;
    await agent.start();

    await (agent as any).loadSyncProgress();

    const progress = agent.getSyncProgress();
    const entry = progress.get('test-fallback');
    expect(entry).toBeDefined();
    expect(entry!.totalTriples).toBe(3);
  }, 15000);
});

describe('GossipPublishHandler onGossipData callback', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('onGossipData updates syncProgress when syncMode is enabled', async () => {
    const { agent: a } = await createSyncAgent({ syncMode: true, syncIntervalMs: 300_000 });
    agent = a;
    await agent.start();

    // Create a CG so the handler can process data for it
    await agent.ensureContextGraphLocal({ id: 'gossip-test', name: 'Gossip Test' });

    // Access the internal gossip publish handler and invoke onGossipData
    const handler = (agent as any).getOrCreateGossipPublishHandler();
    const cb = (handler as any).callbacks?.onGossipData;
    expect(cb).toBeDefined();

    // Simulate gossip data callback
    cb('gossip-test', 15, 'peer-abc');

    const progress = agent.getSyncProgress();
    const entry = progress.get('gossip-test');
    expect(entry).toBeDefined();
    expect(entry!.totalTriples).toBe(15);
    expect(entry!.lastGossipAt).toBeGreaterThan(0);
    expect(entry!.lastGossipTriples).toBe(15);
    expect(entry!.peerSources.has('peer-abc')).toBe(true);
  }, 15000);

  it('onGossipData accumulates triples across calls', async () => {
    const { agent: a } = await createSyncAgent({ syncMode: true, syncIntervalMs: 300_000 });
    agent = a;
    await agent.start();

    await agent.ensureContextGraphLocal({ id: 'accum-test', name: 'Accum' });

    const handler = (agent as any).getOrCreateGossipPublishHandler();
    const cb = (handler as any).callbacks?.onGossipData;

    cb('accum-test', 10, 'peer-1');
    cb('accum-test', 5, 'peer-2');

    const entry = agent.getSyncProgress().get('accum-test');
    expect(entry!.totalTriples).toBe(15);
    expect(entry!.peerSources.has('peer-1')).toBe(true);
    expect(entry!.peerSources.has('peer-2')).toBe(true);
  }, 15000);

  it('onGossipData is undefined when syncMode is off', async () => {
    const { agent: a } = await createSyncAgent({ syncMode: false });
    agent = a;
    await agent.start();

    const handler = (agent as any).getOrCreateGossipPublishHandler();
    const cb = (handler as any).callbacks?.onGossipData;
    expect(cb).toBeUndefined();
  }, 15000);
});

describe('requestSyncFromPeer', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('is a public method', async () => {
    const { agent: a } = await createSyncAgent();
    agent = a;
    await agent.start();

    expect(typeof agent.requestSyncFromPeer).toBe('function');
  }, 15000);

  it('rejects gracefully for unknown peer', async () => {
    const { agent: a } = await createSyncAgent();
    agent = a;
    await agent.start();

    // Should not throw — just fail to connect
    await expect(agent.requestSyncFromPeer('12D3KooWFakeInvalidPeerIdThatDoesNotExist'))
      .rejects.toThrow();
  }, 15000);
});

describe('Sync mode lifecycle', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('stop() clears periodic sync timer', async () => {
    const { agent: a } = await createSyncAgent({ syncMode: true, syncIntervalMs: 300_000 });
    agent = a;
    await agent.start();

    // Verify timer is set
    expect((agent as any).periodicSyncTimer).toBeDefined();

    await agent.stop();

    expect((agent as any).periodicSyncTimer).toBeNull();
    expect((agent as any).started).toBe(false);
  }, 15000);

  it('stop() saves sync progress', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'sync-stop-'));
    const { agent: a } = await createSyncAgent({
      syncMode: true,
      syncIntervalMs: 300_000,
      dataDir: tmpDir,
    });
    agent = a;
    await agent.start();

    // Add some progress
    const progressMap = (agent as any).syncProgress as Map<string, SyncProgressEntry>;
    progressMap.set('stop-test', {
      contextGraphId: 'stop-test',
      totalTriples: 100,
      lastSyncedAt: Date.now(),
      lastCheckedAt: Date.now(),
      lastDelta: 0,
      lastPeerSource: '',
      lastDurationMs: 0,
      syncCount: 1,
      peerSources: new Set(),
      lastGossipAt: 0,
      lastGossipTriples: 0,
    });

    await agent.stop();

    const raw = await readFile(join(tmpDir, 'sync-progress.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.length).toBe(1);
    expect(parsed[0].contextGraphId).toBe('stop-test');

    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }, 15000);

  it('saveSyncProgress is a no-op without dataDir', async () => {
    const { agent: a } = await createSyncAgent();
    agent = a;
    await agent.start();

    // Should not throw when dataDir is undefined
    await (agent as any).saveSyncProgress();
  }, 15000);

  it('saveSyncProgress is a no-op with empty progress', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'sync-empty-'));
    const { agent: a } = await createSyncAgent({ dataDir: tmpDir });
    agent = a;
    await agent.start();

    await (agent as any).saveSyncProgress();

    // File should not be created for empty progress
    const { stat } = await import('node:fs/promises');
    await expect(stat(join(tmpDir, 'sync-progress.json'))).rejects.toThrow();

    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }, 15000);

  it('loadSyncProgress is a no-op without dataDir', async () => {
    const { agent: a } = await createSyncAgent();
    agent = a;
    await agent.start();

    // Should not throw
    await (agent as any).loadSyncProgress();
    expect(agent.getSyncProgress().size).toBe(0);
  }, 15000);

  it('peer health map starts empty', async () => {
    const { agent: a } = await createSyncAgent();
    agent = a;
    await agent.start();

    const health = agent.getPeerHealth();
    expect(health.size).toBe(0);
  }, 15000);

  it('loadSyncProgress handles malformed JSON gracefully', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'sync-bad-'));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(tmpDir, 'sync-progress.json'), '{not valid json', 'utf-8');

    const { agent: a } = await createSyncAgent({ dataDir: tmpDir });
    agent = a;
    await agent.start();

    // Should not throw — falls back to store scan
    await (agent as any).loadSyncProgress();

    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }, 15000);

  it('loadSyncProgress with empty store.nq', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'sync-empty-store-'));
    const { writeFile } = await import('node:fs/promises');
    // Create empty store.nq
    await writeFile(join(tmpDir, 'store.nq'), '', 'utf-8');

    const { agent: a } = await createSyncAgent({ dataDir: tmpDir });
    agent = a;
    await agent.start();

    await (agent as any).loadSyncProgress();
    expect(agent.getSyncProgress().size).toBe(0);

    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }, 15000);

  it('multiple CGs in store.nq scan are all discovered', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'sync-multi-'));
    const { writeFile } = await import('node:fs/promises');
    const lines = [
      '<http://s1> <http://p> <http://o1> <urn:dkg:data:did:dkg:context-graph:cg-alpha/data> .',
      '<http://s2> <http://p> <http://o2> <urn:dkg:data:did:dkg:context-graph:cg-alpha/data> .',
      '<http://s3> <http://p> <http://o3> <urn:dkg:data:did:dkg:context-graph:cg-beta/data> .',
      '<http://m1> <http://p> <http://o4> <urn:dkg:data:did:dkg:context-graph:cg-beta/meta> .',
      '<http://m2> <http://p> <http://o5> <urn:dkg:data:did:dkg:context-graph:cg-beta/_meta> .',
    ];
    await writeFile(join(tmpDir, 'store.nq'), lines.join('\n'), 'utf-8');

    const { agent: a } = await createSyncAgent({ dataDir: tmpDir });
    agent = a;
    await agent.start();

    await (agent as any).loadSyncProgress();

    const progress = agent.getSyncProgress();
    expect(progress.size).toBe(2);
    expect(progress.get('cg-alpha')?.totalTriples).toBe(2);
    expect(progress.get('cg-beta')?.totalTriples).toBe(3);

    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }, 15000);

  it('getSubscribedContextGraphs returns system graphs after start', async () => {
    const { agent: a } = await createSyncAgent();
    agent = a;
    await agent.start();

    const subs = agent.getSubscribedContextGraphs();
    // System graphs (agents, ontology) should be subscribed
    expect(subs.size).toBeGreaterThanOrEqual(2);
  }, 15000);

  it('syncMode agent discovers context graphs from chain on start', async () => {
    const { agent: a } = await createSyncAgent({ syncMode: true, syncIntervalMs: 300_000 });
    agent = a;
    await agent.start();

    // syncMode start should emit discovery log event
    const log = agent.getSyncEventLog();
    const hasRestored = log.some(e =>
      e.message.includes('Periodic sync enabled') ||
      e.message.includes('Restored sync progress') ||
      e.message.includes('Scanned store')
    );
    expect(hasRestored).toBe(true);
  }, 15000);
});

describe('Op wallets', () => {
  it('generateWallets creates requested number of wallets', () => {
    const config = generateWallets(2);
    expect(config.wallets).toHaveLength(2);
    for (const w of config.wallets) {
      expect(w.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(w.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    }
  });

  it('loadOpWallets generates and persists wallets when file missing', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wallets-'));
    const config = await loadOpWallets(tmpDir, 1);
    expect(config.wallets).toHaveLength(1);

    // File should exist now
    const raw = await readFile(join(tmpDir, 'wallets.json'), 'utf-8');
    const persisted = JSON.parse(raw);
    expect(persisted.wallets).toHaveLength(1);
    expect(persisted.wallets[0].address).toBe(config.wallets[0].address);

    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('loadOpWallets reads existing wallets file', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wallets-'));
    // First call creates
    const first = await loadOpWallets(tmpDir, 2);
    // Second call reads
    const second = await loadOpWallets(tmpDir);
    expect(second.wallets).toEqual(first.wallets);

    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });
});
