/**
 * Integration test for Merkle inventory-based sync reconciliation.
 *
 * Scenario:
 * - Node A publishes to a paranet.
 * - Node B stays divergent.
 * - Node B verifies divergence via inventory comparison.
 * - Node B repairs from Node A and converges.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { DKGAgent } from '../src/index.js';
import { MockChainAdapter } from '@dkg/chain';

const PARANET = `sync-reconcile-${Date.now()}`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Sync reconciliation E2E (2 nodes)', () => {
  let nodeA: DKGAgent;
  let nodeB: DKGAgent;

  afterAll(async () => {
    try {
      await nodeA?.stop();
      await nodeB?.stop();
    } catch {}
  });

  it('detects divergence and converges after targeted repair', async () => {
    nodeA = await DKGAgent.create({
      name: 'SyncReconA',
      listenPort: 0,
      chainAdapter: new MockChainAdapter('mock:31337'),
    });

    nodeB = await DKGAgent.create({
      name: 'SyncReconB',
      listenPort: 0,
      chainAdapter: new MockChainAdapter('mock:31337'),
    });

    await nodeA.start();
    await nodeB.start();
    await sleep(400);

    await nodeA.createParanet({
      id: PARANET,
      name: 'Sync Reconciliation E2E',
      description: 'Inventory verify + repair flow',
    });

    await nodeA.publish(PARANET, [
      { subject: 'urn:sync:recon:1', predicate: 'http://schema.org/name', object: '"One"', graph: '' },
      { subject: 'urn:sync:recon:2', predicate: 'http://schema.org/name', object: '"Two"', graph: '' },
    ]);

    const addrA = nodeA.multiaddrs.find((a) => a.includes('/tcp/') && !a.includes('/p2p-circuit'));
    expect(addrA).toBeDefined();
    await nodeB.connectTo(addrA!);
    await sleep(500);

    // B is not subscribed to the paranet topic, so it should be missing A's KC.
    const localBefore = await nodeB.getParanetInventorySummary(PARANET);
    const verifyBefore = await nodeB.verifyParanetSyncWithPeer(nodeA.peerId, PARANET);
    const inspectBefore = await nodeB.inspectParanetMerkleComparison(nodeA.peerId, PARANET, {
      maxItems: 100,
      maxTreeDepth: 16,
    });

    expect(localBefore.kcCount).toBe(0);
    expect(verifyBefore.inventoryProtocolAvailable).toBe(true);
    expect(verifyBefore.inSync).toBe(false);
    expect(verifyBefore.counts.missingLocal).toBeGreaterThan(0);
    expect(inspectBefore.inventoryProtocolAvailable).toBe(true);
    expect(inspectBefore.tree.comparedPrefixes.length).toBeGreaterThan(0);
    expect(inspectBefore.reconciliation.counts.missingLocal).toBeGreaterThan(0);
    expect(inspectBefore.reconciliation.missingLocal.length).toBeGreaterThan(0);

    const repair = await nodeB.syncParanetFromPeer(nodeA.peerId, PARANET, {
      includeWorkspace: false,
    });
    expect(repair.dataSynced).toBeGreaterThan(0);

    const localAfter = await nodeB.getParanetInventorySummary(PARANET);
    const verifyAfter = await nodeB.verifyParanetSyncWithPeer(nodeA.peerId, PARANET);
    const inspectAfter = await nodeB.inspectParanetMerkleComparison(nodeA.peerId, PARANET, {
      maxItems: 100,
      maxTreeDepth: 16,
    });

    expect(localAfter.kcCount).toBeGreaterThan(0);
    expect(verifyAfter.inventoryProtocolAvailable).toBe(true);
    expect(verifyAfter.inSync).toBe(true);
    expect(verifyAfter.counts.missingLocal).toBe(0);
    expect(verifyAfter.counts.mismatched).toBe(0);
    expect(verifyAfter.counts.extraLocal).toBe(0);
    expect(inspectAfter.inventoryProtocolAvailable).toBe(true);
    expect(inspectAfter.local.rootHash).toBe(inspectAfter.remote?.rootHash);
    expect(inspectAfter.reconciliation.counts.missingLocal).toBe(0);
    expect(inspectAfter.reconciliation.counts.mismatched).toBe(0);
    expect(inspectAfter.reconciliation.counts.extraLocal).toBe(0);

    const queryOnB = await nodeB.query(
      'SELECT ?name WHERE { ?s <http://schema.org/name> ?name } ORDER BY ?name',
      PARANET,
    );
    expect(queryOnB.bindings.length).toBe(2);
  }, 30000);
});
