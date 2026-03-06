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
const EXPECTED_MERKLE_ROOT_LEN = 32;

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
  /**
   * Track the highest applied block number per (paranetId:batchId).
   * Only updates from a strictly higher block are accepted, preventing
   * both duplicate and rollback replays.
   */
  private readonly appliedBlockHeight = new Map<string, bigint>();

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
        blockNumber,
        newMerkleRoot,
      } = request;

      this.log.info(
        ctx,
        `KA update from ${fromPeerId} for paranet ${paranetId} batchId=${batchId} tx=${txHash}`,
      );

      // Monotonic ordering: reject if we already applied a same-or-newer block for this batch
      const orderKey = `${paranetId}:${batchId}`;
      const blockBig = BigInt(blockNumber);
      const lastApplied = this.appliedBlockHeight.get(orderKey);
      if (lastApplied !== undefined && blockBig <= lastApplied) {
        this.log.info(ctx, `KA update skipped: block ${blockNumber} <= last applied ${lastApplied} for batchId=${batchId}`);
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

      // Require newMerkleRoot to be present (expected 32 bytes)
      if (!newMerkleRoot || newMerkleRoot.length !== EXPECTED_MERKLE_ROOT_LEN) {
        this.log.warn(ctx, `KA update rejected: newMerkleRoot missing or wrong length (got ${newMerkleRoot?.length ?? 0}, expected ${EXPECTED_MERKLE_ROOT_LEN})`);
        return;
      }

      // Merkle root integrity: recompute from the received payload and compare
      await this.graphManager.ensureParanet(paranetId);
      const dataGraph = this.graphManager.dataGraphUri(paranetId);
      const nquadsStr = new TextDecoder().decode(nquads);
      const quads = parseSimpleNQuads(nquadsStr);
      const partitioned = autoPartition(quads);

      // Reject if payload contains roots not declared in the manifest
      const manifestRoots = new Set(manifest.map((m) => m.rootEntity));
      for (const payloadRoot of partitioned.keys()) {
        if (!manifestRoots.has(payloadRoot)) {
          this.log.warn(ctx, `KA update rejected: payload contains unauthenticated root "${payloadRoot}" not in manifest`);
          return;
        }
      }

      const kaRoots: Uint8Array[] = [];
      for (const m of manifest) {
        const entityQuads = partitioned.get(m.rootEntity) ?? [];
        const pubRoot = computePublicRoot(entityQuads);
        const privRoot = m.privateMerkleRoot?.length ? new Uint8Array(m.privateMerkleRoot) : undefined;
        kaRoots.push(computeKARoot(pubRoot, privRoot));
      }
      const computedRoot = computeKCRoot(kaRoots);

      if (!buffersEqual(computedRoot, new Uint8Array(newMerkleRoot))) {
        this.log.warn(ctx, `KA update rejected: merkle root mismatch for batchId=${batchId} (tampered payload)`);
        return;
      }

      // Apply: delete exact root + skolemized children, then insert only manifest roots' quads
      for (const m of manifest) {
        await this.deleteEntityTriples(dataGraph, m.rootEntity);
      }

      const authenticatedQuads: Quad[] = [];
      for (const root of manifestRoots) {
        for (const q of partitioned.get(root) ?? []) {
          authenticatedQuads.push({ ...q, graph: dataGraph });
        }
      }
      await this.store.insert(authenticatedQuads);

      this.appliedBlockHeight.set(orderKey, blockBig);

      this.log.info(ctx, `Applied KA update: ${authenticatedQuads.length} triples for batchId=${batchId}`);

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
