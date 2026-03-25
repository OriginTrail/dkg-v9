/**
 * Tests for the PROTOCOL_SYNC handler's access filtering logic.
 *
 * When a peer requests workspace data via sync, the handler queries
 * workspace_meta for per-operation access policies and filters data
 * by what the requesting peer is authorized to see.
 *
 * These are E2E tests with two real nodes to exercise the full sync path.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { DKGAgent } from '../src/index.js';
import { MockChainAdapter } from '@origintrail-official/dkg-chain';

const PARANET = 'sync-access-filter-e2e';
const PUBLIC_ENTITY = 'urn:sync-access:public:1';
const PRIVATE_ENTITY = 'urn:sync-access:private:1';
const ALLOW_ENTITY = 'urn:sync-access:allow:1';
const LEGACY_ENTITY = 'urn:sync-access:legacy:1';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('PROTOCOL_SYNC access filtering (2 nodes)', () => {
  let nodeA: DKGAgent;
  let nodeB: DKGAgent;

  afterAll(async () => {
    try {
      await nodeA?.stop();
      await nodeB?.stop();
    } catch (err) {
      console.warn('Teardown:', err);
    }
  });

  it('bootstraps two nodes, creates paranet, and writes mixed-visibility data', async () => {
    nodeA = await DKGAgent.create({
      name: 'SyncFilterA',
      listenPort: 0,
      chainAdapter: new MockChainAdapter('mock:31337'),
      syncParanets: [PARANET],
    });
    nodeB = await DKGAgent.create({
      name: 'SyncFilterB',
      listenPort: 0,
      chainAdapter: new MockChainAdapter('mock:31337'),
      syncParanets: [PARANET],
    });

    await nodeA.start();
    await nodeB.start();
    await sleep(800);

    await nodeA.createParanet({
      id: PARANET,
      name: 'Sync Access Filter Test',
      description: 'Mixed visibility workspace',
    });

    // Write public data
    await nodeA.writeToWorkspace(PARANET, [
      { subject: PUBLIC_ENTITY, predicate: 'http://schema.org/name', object: '"Public Data"', graph: '' },
    ], { visibility: 'public' });

    // Write owner-only data (should NOT be visible to nodeB via sync)
    await nodeA.writeToWorkspace(PARANET, [
      { subject: PRIVATE_ENTITY, predicate: 'http://schema.org/name', object: '"Owner Secret"', graph: '' },
    ], { visibility: 'private' });

    // Write allow-list data (nodeB is on the list)
    await nodeA.writeToWorkspace(PARANET, [
      { subject: ALLOW_ENTITY, predicate: 'http://schema.org/name', object: '"Allow Listed"', graph: '' },
    ], { visibility: { peers: [nodeB.peerId] } });

    // Write legacy data (no access policy — should be treated as public)
    // Use localOnly: false to trigger broadcast (legacy behavior)
    await nodeA.writeToWorkspace(PARANET, [
      { subject: LEGACY_ENTITY, predicate: 'http://schema.org/name', object: '"Legacy Pre-Migration"', graph: '' },
    ], { localOnly: false });

    // Verify all data exists on node A
    const allOnA = await nodeA.query(
      'SELECT ?s ?name WHERE { ?s <http://schema.org/name> ?name }',
      { paranetId: PARANET, graphSuffix: '_workspace' },
    );
    expect(allOnA.bindings.length).toBe(4);
  }, 15000);

  it('nodeB syncs and gets only authorized data', async () => {
    // Connect nodeB to nodeA so sync can occur
    const addrA = nodeA.multiaddrs.find((a) => a.includes('/tcp/') && !a.includes('/p2p-circuit'))!;
    await nodeB.connectTo(addrA);
    await sleep(500);

    // Subscribe nodeB to the paranet
    nodeB.subscribeToParanet(PARANET);
    await sleep(2000);

    // Trigger sync by subscribing (the agent auto-syncs on connect)
    // Wait for sync to complete
    await sleep(5000);

    // nodeB should have public data
    const publicResult = await nodeB.query(
      `SELECT ?name WHERE { <${PUBLIC_ENTITY}> <http://schema.org/name> ?name }`,
      { paranetId: PARANET, graphSuffix: '_workspace' },
    );
    expect(publicResult.bindings.length).toBe(1);
    expect(publicResult.bindings[0]['name']).toBe('"Public Data"');

    // nodeB should NOT have owner-only data
    const privateResult = await nodeB.query(
      `SELECT ?name WHERE { <${PRIVATE_ENTITY}> <http://schema.org/name> ?name }`,
      { paranetId: PARANET, graphSuffix: '_workspace' },
    );
    expect(privateResult.bindings.length).toBe(0);

    // nodeB SHOULD have allow-listed data (nodeB's peerId is on the list)
    const allowResult = await nodeB.query(
      `SELECT ?name WHERE { <${ALLOW_ENTITY}> <http://schema.org/name> ?name }`,
      { paranetId: PARANET, graphSuffix: '_workspace' },
    );
    expect(allowResult.bindings.length).toBe(1);
    expect(allowResult.bindings[0]['name']).toBe('"Allow Listed"');

    // nodeB should have legacy data (no access policy = public)
    const legacyResult = await nodeB.query(
      `SELECT ?name WHERE { <${LEGACY_ENTITY}> <http://schema.org/name> ?name }`,
      { paranetId: PARANET, graphSuffix: '_workspace' },
    );
    expect(legacyResult.bindings.length).toBe(1);
    expect(legacyResult.bindings[0]['name']).toBe('"Legacy Pre-Migration"');
  }, 25000);

  it('owner can sync their own ownerOnly data', async () => {
    // nodeA should still see all its own data including private
    const privateOnA = await nodeA.query(
      `SELECT ?name WHERE { <${PRIVATE_ENTITY}> <http://schema.org/name> ?name }`,
      { paranetId: PARANET, graphSuffix: '_workspace' },
    );
    expect(privateOnA.bindings.length).toBe(1);
    expect(privateOnA.bindings[0]['name']).toBe('"Owner Secret"');
  }, 5000);

  it('nodeB does NOT see private data even with includeWorkspace broad query', async () => {
    const broadResult = await nodeB.query(
      `SELECT ?s ?p ?o WHERE { ?s ?p ?o . FILTER(CONTAINS(STR(?o), "Owner Secret")) }`,
      { paranetId: PARANET, includeWorkspace: true },
    );
    expect(broadResult.bindings.length).toBe(0);
  }, 5000);
});
