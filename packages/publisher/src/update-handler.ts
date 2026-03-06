import type { TripleStore, Quad } from '@dkg/storage';
import { GraphManager } from '@dkg/storage';
import type { EventBus } from '@dkg/core';
import type { ChainAdapter, KAUpdateVerification } from '@dkg/chain';
import { Logger, createOperationContext, DKGEvent } from '@dkg/core';
import { decodeKAUpdateRequest } from '@dkg/core';
import { parseSimpleNQuads } from './publish-handler.js';
import { autoPartition } from './auto-partition.js';
import { computePublicRoot, computeKARoot, computeKCRoot } from './merkle.js';

const SKOLEM_INFIX = '/.well-known/genid/';
const EXPECTED_MERKLE_ROOT_LEN = 32;

interface AppliedUpdate {
  blockNumber: number;
  txHashes: Set<string>;
}

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
   * Track the highest applied (blockNumber, txHashes) per (paranetId:batchId).
   * Accepts if block is strictly higher, or same block with a new txHash
   * (two updates can land in the same block with different tx indices).
   */
  private readonly appliedUpdates = new Map<string, AppliedUpdate>();

  /** Batch-to-paranet binding: once a batch is seen on a paranet, reject cross-paranet replays. */
  private readonly batchParanet = new Map<string, string>();

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
      } = request;

      this.log.info(
        ctx,
        `KA update from ${fromPeerId} for paranet ${paranetId} batchId=${batchId} tx=${txHash}`,
      );

      // Paranet binding: once a batch is associated with a paranet, reject cross-paranet replays.
      const batchKey = String(batchId);
      const knownParanet = this.batchParanet.get(batchKey);
      if (knownParanet && knownParanet !== paranetId) {
        this.log.warn(ctx, `KA update rejected: batchId=${batchId} is bound to paranet "${knownParanet}", not "${paranetId}"`);
        return;
      }

      // --- Chain verification (returns chain-sourced merkle root + block number) ---
      let verifiedMerkleRoot: Uint8Array | undefined;
      let verifiedBlockNumber: number | undefined;
      let verifiedTxHash: string | undefined;

      if (!this.chain.verifyKAUpdate) {
        if (this.chain.chainId !== 'none') {
          this.log.warn(ctx, `KA update rejected: chain adapter does not implement verifyKAUpdate (chainId=${this.chain.chainId})`);
          return;
        }
      } else {
        const verification: KAUpdateVerification = await this.chain.verifyKAUpdate(txHash, BigInt(batchId), publisherAddress);
        if (!verification.verified) {
          this.log.warn(ctx, `KA update rejected: tx ${txHash} not verified for batchId=${batchId} publisher=${publisherAddress}`);
          return;
        }
        verifiedMerkleRoot = verification.onChainMerkleRoot;
        verifiedBlockNumber = verification.blockNumber;
        verifiedTxHash = txHash;
      }

      // Ordering: reject if already applied at a higher block, or same block with same txHash
      if (verifiedBlockNumber !== undefined && verifiedTxHash !== undefined) {
        const orderKey = `${paranetId}:${batchId}`;
        const last = this.appliedUpdates.get(orderKey);
        if (last) {
          if (verifiedBlockNumber < last.blockNumber) {
            this.log.info(ctx, `KA update skipped: chain block ${verifiedBlockNumber} < last applied ${last.blockNumber} for batchId=${batchId}`);
            return;
          }
          if (verifiedBlockNumber === last.blockNumber && last.txHashes.has(verifiedTxHash)) {
            this.log.info(ctx, `KA update skipped: tx ${verifiedTxHash} already applied at block ${verifiedBlockNumber} for batchId=${batchId}`);
            return;
          }
        }
      }

      // Merkle root integrity: recompute from the received payload
      await this.graphManager.ensureParanet(paranetId);
      const dataGraph = this.graphManager.dataGraphUri(paranetId);
      const nquadsStr = new TextDecoder().decode(nquads);
      const quads = parseSimpleNQuads(nquadsStr);
      const partitioned = autoPartition(quads);

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

      const referenceRoot = verifiedMerkleRoot ?? request.newMerkleRoot;
      if (!referenceRoot || referenceRoot.length !== EXPECTED_MERKLE_ROOT_LEN) {
        this.log.warn(ctx, `KA update rejected: merkle root missing or wrong length (got ${referenceRoot?.length ?? 0}, expected ${EXPECTED_MERKLE_ROOT_LEN})`);
        return;
      }

      if (!buffersEqual(computedRoot, new Uint8Array(referenceRoot))) {
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

      // Record applied update for ordering + paranet binding
      if (verifiedBlockNumber !== undefined && verifiedTxHash !== undefined) {
        const orderKey = `${paranetId}:${batchId}`;
        const last = this.appliedUpdates.get(orderKey);
        if (!last || verifiedBlockNumber > last.blockNumber) {
          this.appliedUpdates.set(orderKey, { blockNumber: verifiedBlockNumber, txHashes: new Set([verifiedTxHash]) });
        } else if (verifiedBlockNumber === last.blockNumber) {
          last.txHashes.add(verifiedTxHash);
        }
      }
      this.batchParanet.set(batchKey, paranetId);

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
