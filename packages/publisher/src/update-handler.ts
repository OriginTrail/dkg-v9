import type { TripleStore, Quad } from '@dkg/storage';
import { GraphManager } from '@dkg/storage';
import type { EventBus } from '@dkg/core';
import type { ChainAdapter } from '@dkg/chain';
import { Logger, createOperationContext, DKGEvent } from '@dkg/core';
import { decodeKAUpdateRequest } from '@dkg/core';
import { parseSimpleNQuads } from './publish-handler.js';
import { autoPartition } from './auto-partition.js';
import { computePublicRoot, computeKARoot, computeKCRoot } from './merkle.js';

const SKOLEM_INFIX = '/.well-known/genid/';

/**
 * Handles incoming KA update gossip messages.
 * Verifies the on-chain transaction and merkle root integrity,
 * then replaces local triples so the receiving node's data graph
 * stays in sync with the publisher's update.
 */
export class UpdateHandler {
  private readonly store: TripleStore;
  private readonly graphManager: GraphManager;
  private readonly chain: ChainAdapter;
  private readonly eventBus: EventBus;
  private readonly log = new Logger('UpdateHandler');
  /** Track (batchId, txHash) to prevent replay of stale updates. */
  private readonly appliedUpdates = new Map<string, string>();

  constructor(store: TripleStore, chain: ChainAdapter, eventBus: EventBus) {
    this.store = store;
    this.graphManager = new GraphManager(store);
    this.chain = chain;
    this.eventBus = eventBus;
  }

  async handle(data: Uint8Array, fromPeerId: string): Promise<void> {
    const ctx = createOperationContext('ka-update');
    try {
      const request = decodeKAUpdateRequest(data);
      const {
        paranetId,
        batchId,
        nquads,
        manifest,
        publisherAddress,
        txHash,
        newMerkleRoot,
      } = request;

      this.log.info(
        ctx,
        `KA update from ${fromPeerId} for paranet ${paranetId} batchId=${batchId} tx=${txHash}`,
      );

      // Replay protection: reject if we already applied an update for this batchId with a newer/same tx
      const replayKey = `${paranetId}:${batchId}`;
      if (this.appliedUpdates.get(replayKey) === txHash) {
        this.log.info(ctx, `KA update skipped: already applied tx=${txHash} for batchId=${batchId}`);
        return;
      }

      // Fail-closed: require chain verification when the adapter supports it.
      // On chainId === 'none' (local/dev), verifyKAUpdate won't exist — allow that.
      if (!this.chain.verifyKAUpdate) {
        if (this.chain.chainId !== 'none') {
          this.log.warn(ctx, `KA update rejected: chain adapter does not implement verifyKAUpdate (chainId=${this.chain.chainId})`);
          return;
        }
      } else {
        const verified = await this.chain.verifyKAUpdate(txHash, BigInt(batchId), publisherAddress);
        if (!verified) {
          this.log.warn(ctx, `KA update rejected: tx ${txHash} not verified for batchId=${batchId} publisher=${publisherAddress}`);
          return;
        }
      }

      // Merkle root integrity: recompute from the received payload and compare
      await this.graphManager.ensureParanet(paranetId);
      const dataGraph = this.graphManager.dataGraphUri(paranetId);
      const nquadsStr = new TextDecoder().decode(nquads);
      const quads = parseSimpleNQuads(nquadsStr);
      const partitioned = autoPartition(quads);

      const kaRoots: Uint8Array[] = [];
      for (const m of manifest) {
        const entityQuads = partitioned.get(m.rootEntity) ?? [];
        const pubRoot = computePublicRoot(entityQuads);
        const privRoot = m.privateMerkleRoot?.length ? new Uint8Array(m.privateMerkleRoot) : undefined;
        kaRoots.push(computeKARoot(pubRoot, privRoot));
      }
      const computedRoot = computeKCRoot(kaRoots);

      if (newMerkleRoot?.length > 0 && !buffersEqual(computedRoot, new Uint8Array(newMerkleRoot))) {
        this.log.warn(ctx, `KA update rejected: merkle root mismatch for batchId=${batchId} (tampered payload)`);
        return;
      }

      // Apply: delete exact root + skolemized children, then insert
      for (const m of manifest) {
        await this.deleteEntityTriples(dataGraph, m.rootEntity);
      }

      const normalized: Quad[] = quads.map((q) => ({ ...q, graph: dataGraph }));
      await this.store.insert(normalized);

      this.appliedUpdates.set(replayKey, txHash);

      this.log.info(ctx, `Applied KA update: ${quads.length} triples for batchId=${batchId}`);

      this.eventBus.emit(DKGEvent.KA_UPDATED, {
        paranetId,
        batchId: BigInt(batchId),
        rootEntities: manifest.map((m) => m.rootEntity),
        txHash,
        fromPeerId,
      });
    } catch (err) {
      this.log.error(
        ctx,
        `KA update handle failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Delete exact root entity triples + its skolemized descendants only.
   * Avoids prefix collision (e.g. "urn:x:foo" must not delete "urn:x:foobar").
   */
  private async deleteEntityTriples(graph: string, rootEntity: string): Promise<void> {
    await this.store.deleteByPattern({ graph, subject: rootEntity });
    const skolemPrefix = rootEntity + SKOLEM_INFIX;
    await this.store.deleteBySubjectPrefix(graph, skolemPrefix);
  }
}

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
