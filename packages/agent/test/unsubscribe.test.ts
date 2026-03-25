import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { DKGAgent, type ParanetSub } from '../src/index.js';
import { OxigraphStore } from '@origintrail-official/dkg-storage';
import { SYSTEM_PARANETS, DKG_ONTOLOGY, paranetDataGraphUri } from '@origintrail-official/dkg-core';
import { MockChainAdapter, type ParanetOnChain } from '@origintrail-official/dkg-chain';
import { GossipPublishHandler } from '../src/gossip-publish-handler.js';

class MockChainWithParanets extends MockChainAdapter {
  private readonly onChainList: ParanetOnChain[];

  constructor(list: ParanetOnChain[] = []) {
    super();
    this.onChainList = list;
  }

  override async listParanetsFromChain(): Promise<ParanetOnChain[]> {
    return this.onChainList;
  }
}

async function createTestAgent(opts?: {
  chainAdapter?: MockChainAdapter | MockChainWithParanets;
  store?: OxigraphStore;
  unsubscribedParanets?: string[];
  syncParanets?: string[];
}) {
  const store = opts?.store ?? new OxigraphStore();
  const agent = await DKGAgent.create({
    name: 'UnsubscribeTestAgent',
    listenPort: 0,
    listenHost: '127.0.0.1',
    store,
    chainAdapter: opts?.chainAdapter ?? new MockChainAdapter(),
    unsubscribedParanets: opts?.unsubscribedParanets,
    syncParanets: opts?.syncParanets,
  });
  return { agent, store };
}

describe('unsubscribeFromParanet', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('subscribe then unsubscribe sets subscribed=false and adds to deny list', async () => {
    const result = await createTestAgent();
    agent = result.agent;
    await agent.start();

    agent.subscribeToParanet('my-paranet');
    expect(agent.getSubscribedParanets().get('my-paranet')?.subscribed).toBe(true);
    expect(agent.isUnsubscribed('my-paranet')).toBe(false);

    agent.unsubscribeFromParanet('my-paranet');

    expect(agent.getSubscribedParanets().get('my-paranet')?.subscribed).toBe(false);
    expect(agent.isUnsubscribed('my-paranet')).toBe(true);
  }, 15000);

  it('removes paranet from syncParanets', async () => {
    const result = await createTestAgent({ syncParanets: ['my-paranet'] });
    agent = result.agent;
    await agent.start();

    agent.subscribeToParanet('my-paranet');
    // syncParanets should include it
    expect((agent as any).config.syncParanets).toContain('my-paranet');

    agent.unsubscribeFromParanet('my-paranet');
    expect((agent as any).config.syncParanets).not.toContain('my-paranet');
  }, 15000);

  it('throws when trying to unsubscribe from system paranet', async () => {
    const result = await createTestAgent();
    agent = result.agent;
    await agent.start();

    expect(() => agent!.unsubscribeFromParanet(SYSTEM_PARANETS.AGENTS))
      .toThrow('Cannot unsubscribe from system paranet');
    expect(() => agent!.unsubscribeFromParanet(SYSTEM_PARANETS.ONTOLOGY))
      .toThrow('Cannot unsubscribe from system paranet');
  }, 15000);

  it('unsubscribe on not-currently-subscribed paranet still sets deny list', async () => {
    const result = await createTestAgent();
    agent = result.agent;
    await agent.start();

    // Paranet is known but not subscribed — unsubscribe should still work
    agent.unsubscribeFromParanet('unknown-paranet');

    expect(agent.isUnsubscribed('unknown-paranet')).toBe(true);
    expect(agent.getSubscribedParanets().get('unknown-paranet')?.subscribed).toBe(false);
  }, 15000);
});

describe('re-subscribe after unsubscribe', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('clearUnsubscribed then subscribeToParanet works', async () => {
    const result = await createTestAgent();
    agent = result.agent;
    await agent.start();

    agent.subscribeToParanet('cycle-paranet');
    agent.unsubscribeFromParanet('cycle-paranet');
    expect(agent.isUnsubscribed('cycle-paranet')).toBe(true);
    expect(agent.getSubscribedParanets().get('cycle-paranet')?.subscribed).toBe(false);

    // Clear deny list first, then re-subscribe
    agent.clearUnsubscribed('cycle-paranet');
    expect(agent.isUnsubscribed('cycle-paranet')).toBe(false);

    agent.subscribeToParanet('cycle-paranet');
    expect(agent.getSubscribedParanets().get('cycle-paranet')?.subscribed).toBe(true);
    // trackSyncParanet should work now that deny list is cleared
    expect((agent as any).config.syncParanets).toContain('cycle-paranet');
  }, 15000);
});

describe('deny list guards — trackSyncParanet', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('trackSyncParanet does not add deny-listed paranet', async () => {
    const result = await createTestAgent();
    agent = result.agent;
    await agent.start();

    agent.subscribeToParanet('guarded');
    agent.unsubscribeFromParanet('guarded');

    // Try to track it again — should be blocked by deny list
    (agent as any).trackSyncParanet('guarded');
    expect((agent as any).config.syncParanets).not.toContain('guarded');
  }, 15000);
});

describe('deny list guards — discoverParanetsFromStore', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('skips deny-listed paranets during store discovery', async () => {
    const store = new OxigraphStore();
    const result = await createTestAgent({ store });
    agent = result.agent;
    await agent.start();

    // Subscribe then unsubscribe
    agent.subscribeToParanet('deny-store');
    agent.unsubscribeFromParanet('deny-store');

    // Insert paranet definition into ontology graph (simulating sync)
    const ontologyGraph = paranetDataGraphUri(SYSTEM_PARANETS.ONTOLOGY);
    const paranetUri = paranetDataGraphUri('deny-store');
    await store.insert([
      { subject: paranetUri, predicate: DKG_ONTOLOGY.RDF_TYPE, object: DKG_ONTOLOGY.DKG_PARANET, graph: ontologyGraph },
      { subject: paranetUri, predicate: DKG_ONTOLOGY.SCHEMA_NAME, object: '"Deny Store"', graph: ontologyGraph },
    ]);

    const discovered = await agent.discoverParanetsFromStore();
    expect(discovered).toBe(0);

    // Should remain unsubscribed
    expect(agent.getSubscribedParanets().get('deny-store')?.subscribed).toBe(false);
  }, 15000);
});

describe('deny list guards — discoverParanetsFromChain', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('skips deny-listed paranets during chain discovery', async () => {
    const chain = new MockChainWithParanets([
      {
        paranetId: '0xdeadbeef00000000000000000000000000000000000000000000000000000099',
        name: 'deny-chain',
        creator: '0x1234',
        accessPolicy: 0,
        blockNumber: 100,
        metadataRevealed: true,
      },
    ]);

    const result = await createTestAgent({ chainAdapter: chain });
    agent = result.agent;
    await agent.start();

    // Pre-unsubscribe from the paranet
    agent.unsubscribeFromParanet('deny-chain');

    const discovered = await agent.discoverParanetsFromChain();
    expect(discovered).toBe(0);
  }, 15000);
});

describe('deny list guards — syncParanetFromConnectedPeers', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('returns zeros for deny-listed paranet', async () => {
    const result = await createTestAgent();
    agent = result.agent;
    await agent.start();

    agent.unsubscribeFromParanet('deny-sync');

    const syncResult = await agent.syncParanetFromConnectedPeers('deny-sync');
    expect(syncResult.connectedPeers).toBe(0);
    expect(syncResult.dataSynced).toBe(0);
  }, 15000);
});

describe('deny list guards — syncFromPeer', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('filters deny-listed paranets from sync list', async () => {
    const result = await createTestAgent({ syncParanets: ['allowed', 'denied'] });
    agent = result.agent;
    await agent.start();

    agent.unsubscribeFromParanet('denied');

    // syncFromPeer will filter out 'denied' before iterating
    // We can't easily call syncFromPeer without a real peer, but we can
    // verify the config.syncParanets was cleaned
    expect((agent as any).config.syncParanets).not.toContain('denied');
  }, 15000);
});

describe('deny list guards — ensureParanetLocal', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('"already exists" branch: deny-listed paranet not re-subscribed', async () => {
    const result = await createTestAgent();
    agent = result.agent;
    await agent.start();

    // Create the paranet first
    await agent.ensureParanetLocal({ id: 'ensure-deny', name: 'Ensure Deny' });
    expect(agent.getSubscribedParanets().get('ensure-deny')?.subscribed).toBe(true);

    // Now unsubscribe
    agent.unsubscribeFromParanet('ensure-deny');
    expect(agent.getSubscribedParanets().get('ensure-deny')?.subscribed).toBe(false);

    // Call ensureParanetLocal again — should NOT re-subscribe
    await agent.ensureParanetLocal({ id: 'ensure-deny', name: 'Ensure Deny' });
    expect(agent.getSubscribedParanets().get('ensure-deny')?.subscribed).toBe(false);
    expect(agent.isUnsubscribed('ensure-deny')).toBe(true);
  }, 15000);

  it('"create" branch: deny-listed paranet not subscribed', async () => {
    const result = await createTestAgent();
    agent = result.agent;
    await agent.start();

    // Pre-add to deny list
    agent.unsubscribeFromParanet('ensure-create-deny');

    // ensureParanetLocal should insert triples but not subscribe
    await agent.ensureParanetLocal({ id: 'ensure-create-deny', name: 'Create Deny' });

    const sub = agent.getSubscribedParanets().get('ensure-create-deny');
    expect(sub?.subscribed).toBe(false);
    expect(sub?.synced).toBe(true);
    expect(agent.isUnsubscribed('ensure-create-deny')).toBe(true);
  }, 15000);
});

describe('createParanet clears deny list', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('createParanet clears deny list so sync/discovery is not blocked', async () => {
    const result = await createTestAgent({
      unsubscribedParanets: ['create-clear'],
    });
    agent = result.agent;
    await agent.start();

    expect(agent.isUnsubscribed('create-clear')).toBe(true);

    await agent.createParanet({ id: 'create-clear', name: 'Create Clear' });

    // Deny list should be cleared by createParanet
    expect(agent.isUnsubscribed('create-clear')).toBe(false);
    expect(agent.getSubscribedParanets().get('create-clear')?.subscribed).toBe(true);
    // Should be in syncParanets
    expect((agent as any).config.syncParanets).toContain('create-clear');
  }, 15000);
});

describe('deny list guards — GossipPublishHandler', () => {
  it('does not auto-subscribe deny-listed paranets from ontology gossip', async () => {
    const store = new OxigraphStore();
    const subscribedParanets = new Map<string, any>();
    const unsubscribedParanets = new Set(['denied-gossip']);
    const subscribeCalls: string[] = [];

    const handler = new GossipPublishHandler(
      store,
      undefined,
      subscribedParanets,
      {
        paranetExists: async () => false,
        subscribeToParanet: (id) => { subscribeCalls.push(id); },
      },
      unsubscribedParanets,
    );

    // Simulate an ontology gossip message that contains a new paranet definition
    const paranetUri = 'did:dkg:paranet:denied-gossip';
    const nquads = [
      `<${paranetUri}> <${DKG_ONTOLOGY.RDF_TYPE}> <${DKG_ONTOLOGY.DKG_PARANET}> <${paranetDataGraphUri(SYSTEM_PARANETS.ONTOLOGY)}> .`,
      `<${paranetUri}> <${DKG_ONTOLOGY.SCHEMA_NAME}> "Denied Gossip" <${paranetDataGraphUri(SYSTEM_PARANETS.ONTOLOGY)}> .`,
    ].join('\n');

    const { encodePublishRequest } = await import('@origintrail-official/dkg-core');
    const msg = encodePublishRequest({
      ual: '',
      nquads: new TextEncoder().encode(nquads),
      paranetId: SYSTEM_PARANETS.ONTOLOGY,
      kas: [],
      publisherIdentity: new Uint8Array(32),
      publisherAddress: '',
      startKAId: 0,
      endKAId: 0,
      chainId: '',
      publisherSignatureR: new Uint8Array(0),
      publisherSignatureVs: new Uint8Array(0),
    });

    await handler.handlePublishMessage(msg, SYSTEM_PARANETS.ONTOLOGY);

    // Should NOT have called subscribeToParanet for the deny-listed paranet
    expect(subscribeCalls).not.toContain('denied-gossip');
    // Should NOT be in subscribedParanets map
    expect(subscribedParanets.has('denied-gossip')).toBe(false);
  });
});

describe('config persistence', () => {
  let agent: DKGAgent | undefined;

  afterEach(async () => {
    await agent?.stop().catch(() => {});
  });

  it('unsubscribedParanets from config populates deny list on create', async () => {
    const result = await createTestAgent({
      unsubscribedParanets: ['pre-denied'],
    });
    agent = result.agent;

    // Deny list should be populated before start()
    expect(agent.isUnsubscribed('pre-denied')).toBe(true);
  }, 15000);

  it('deny list from config prevents discovery before start()', async () => {
    const store = new OxigraphStore();
    const result = await createTestAgent({
      store,
      unsubscribedParanets: ['config-denied'],
    });
    agent = result.agent;
    await agent.start();

    // Insert paranet into store
    const ontologyGraph = paranetDataGraphUri(SYSTEM_PARANETS.ONTOLOGY);
    const paranetUri = paranetDataGraphUri('config-denied');
    await store.insert([
      { subject: paranetUri, predicate: DKG_ONTOLOGY.RDF_TYPE, object: DKG_ONTOLOGY.DKG_PARANET, graph: ontologyGraph },
      { subject: paranetUri, predicate: DKG_ONTOLOGY.SCHEMA_NAME, object: '"Config Denied"', graph: ontologyGraph },
    ]);

    const discovered = await agent.discoverParanetsFromStore();
    expect(discovered).toBe(0);
  }, 15000);
});
