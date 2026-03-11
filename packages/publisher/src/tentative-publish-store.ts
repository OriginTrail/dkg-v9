import { ethers } from 'ethers';
import type { Quad, TripleStore } from '@dkg/storage';
import { Logger, createOperationContext, type OperationContext } from '@dkg/core';
import type { OnChainProvenance, KAMetadata } from './metadata.js';
import { generateConfirmedFullMetadata } from './metadata.js';
import type { PublishJournal } from './publish-journal.js';
import { autoPartition } from './auto-partition.js';

const DKG = 'http://dkg.io/ontology/';
const SKOLEM_INFIX = '/.well-known/genid/';

function toHex(bytes: Uint8Array): string {
  return ethers.hexlify(bytes);
}

function fromHex(hex: string): Uint8Array {
  return ethers.getBytes(hex);
}

export interface TentativeKARecord {
  ordinal: number;
  rootEntity: string;
  privateTripleCount: number;
  privateMerkleRoot?: Uint8Array;
}

export interface TentativePublishRecord {
  operationId: string;
  tentativeUal: string;
  paranetId: string;
  publisherAddress: string;
  merkleRoot: Uint8Array;
  publicByteSize: bigint;
  createdAt: number;
  dataGraph: string;
  metaGraph: string;
  kaRecords: TentativeKARecord[];
  publisherPeerId?: string;
  submittedTxHash?: string;
  submittedStartKAId?: bigint;
  submittedEndKAId?: bigint;
}

export interface TentativePublishJournalEntry {
  operationId: string;
  tentativeUal: string;
  paranetId: string;
  publisherAddress: string;
  merkleRoot: string;
  publicByteSize: string;
  createdAt: number;
  dataGraph: string;
  metaGraph: string;
  kaRecords: Array<{
    ordinal: number;
    rootEntity: string;
    privateTripleCount: number;
    privateMerkleRoot?: string;
  }>;
  publisherPeerId?: string;
  submittedTxHash?: string;
  submittedStartKAId?: string;
  submittedEndKAId?: string;
}

interface StoredTentativePublish {
  record: TentativePublishRecord;
  timeout: ReturnType<typeof setTimeout>;
}

export interface TentativePublishStoreOptions {
  journal?: PublishJournal;
  ttlMs?: number;
}

/**
 * Shared in-memory + journal-backed registry for tentative publishes, used by
 * the publisher, gossip receiver, attestation handler, and chain event poller.
 */
export class TentativePublishStore {
  private readonly store: TripleStore;
  private readonly journal?: PublishJournal;
  private readonly ttlMs: number;
  private readonly entries = new Map<string, StoredTentativePublish>();
  private readonly log = new Logger('TentativePublishStore');
  private journalWriteQueue: Promise<void> = Promise.resolve();

  static readonly DEFAULT_TTL_MS = 60 * 60 * 1000;

  constructor(store: TripleStore, options?: TentativePublishStoreOptions) {
    this.store = store;
    this.journal = options?.journal;
    this.ttlMs = options?.ttlMs ?? TentativePublishStore.DEFAULT_TTL_MS;
  }

  hasTentatives(): boolean {
    return this.entries.size > 0;
  }

  getByOperationId(operationId: string): TentativePublishRecord | undefined {
    return this.entries.get(operationId)?.record;
  }

  findForAttestation(params: {
    operationId?: string;
    merkleRoot: Uint8Array;
    publisherAddress: string;
    publicByteSize: bigint;
  }): TentativePublishRecord | undefined {
    if (params.operationId) {
      const direct = this.getByOperationId(params.operationId);
      if (direct) return direct;
    }

    const merkleRootHex = toHex(params.merkleRoot);
    const publisherAddress = params.publisherAddress.toLowerCase();

    for (const { record } of this.entries.values()) {
      if (
        toHex(record.merkleRoot) === merkleRootHex &&
        record.publisherAddress.toLowerCase() === publisherAddress &&
        record.publicByteSize === params.publicByteSize
      ) {
        return record;
      }
    }

    return undefined;
  }

  async register(record: TentativePublishRecord): Promise<void> {
    const existing = this.entries.get(record.operationId);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    const timeout = this.createExpiryTimeout(record);
    this.entries.set(record.operationId, { record, timeout });
    this.persistJournal();
  }

  remove(operationId: string): void {
    const existing = this.entries.get(operationId);
    if (!existing) return;
    clearTimeout(existing.timeout);
    this.entries.delete(operationId);
    this.persistJournal();
  }

  async markSubmitted(operationId: string, params: {
    txHash: string;
    startKAId: bigint;
    endKAId: bigint;
  }): Promise<void> {
    const existing = this.entries.get(operationId);
    if (!existing) return;

    existing.record.submittedTxHash = params.txHash;
    existing.record.submittedStartKAId = params.startKAId;
    existing.record.submittedEndKAId = params.endKAId;
    this.persistJournal();
  }

  async confirmFromChain(params: {
    merkleRoot: Uint8Array;
    publisherAddress: string;
    publicByteSize: bigint;
    startKAId: bigint;
    endKAId: bigint;
    txHash?: string;
    blockNumber: number;
    blockTimestamp?: number;
    batchId: bigint;
    chainId: string;
  }, ctx?: OperationContext): Promise<boolean> {
    const opCtx = ctx ?? createOperationContext('publish');
    const match = this.findForConfirmation(params);
    if (!match) {
      return false;
    }

    clearTimeout(match.timeout);

    const finalUal = `did:dkg:${params.chainId}/${params.publisherAddress}/${params.startKAId}`;
    const publicQuads = await this.loadPublicQuads(match.record);
    const partitioned = autoPartition(publicQuads);

    const kaMetadata: KAMetadata[] = match.record.kaRecords
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((kaRecord) => ({
        rootEntity: kaRecord.rootEntity,
        kcUal: finalUal,
        tokenId: params.startKAId + BigInt(kaRecord.ordinal - 1),
        publicTripleCount: (partitioned.get(kaRecord.rootEntity) ?? []).length,
        privateTripleCount: kaRecord.privateTripleCount,
        privateMerkleRoot: kaRecord.privateMerkleRoot,
      }));

    const provenance: OnChainProvenance = {
      txHash: params.txHash ?? match.record.submittedTxHash ?? '',
      blockNumber: params.blockNumber,
      blockTimestamp: params.blockTimestamp ?? Math.floor(Date.now() / 1000),
      publisherAddress: params.publisherAddress,
      batchId: params.batchId,
      chainId: params.chainId,
    };

    await this.store.deleteBySubjectPrefix(match.record.metaGraph, match.record.tentativeUal);
    await this.store.insert(generateConfirmedFullMetadata(
      {
        ual: finalUal,
        paranetId: match.record.paranetId,
        merkleRoot: match.record.merkleRoot,
        kaCount: kaMetadata.length,
        publisherPeerId: match.record.publisherPeerId ?? '',
        timestamp: new Date(match.record.createdAt),
      },
      kaMetadata,
      provenance,
    ).map((quad) => (
      quad.graph === `did:dkg:paranet:${match.record.paranetId}/_meta`
        ? { ...quad, graph: match.record.metaGraph }
        : quad
    )));

    this.entries.delete(match.record.operationId);
    this.persistJournal();

    this.log.info(
      opCtx,
      `Confirmed tentative publish ${match.record.tentativeUal} as ${finalUal}`,
    );
    return true;
  }

  async restore(): Promise<number> {
    if (!this.journal) return 0;
    const ctx = createOperationContext('publish');

    let entries: TentativePublishJournalEntry[];
    try {
      entries = await this.journal.load<TentativePublishJournalEntry>();
    } catch (err) {
      this.log.warn(ctx, `Failed to load tentative journal: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }

    let restored = 0;
    let expired = 0;
    let skipped = 0;
    for (const entry of entries) {
      // Guard against old-format or partial journal entries that don't match
      // the TentativePublishJournalEntry schema (e.g. legacy pending-publishes.json
      // entries or entries from an interrupted write).
      let record: TentativePublishRecord;
      try {
        if (!entry.operationId || !entry.tentativeUal || !entry.merkleRoot) {
          skipped++;
          continue;
        }
        record = this.fromJournalEntry(entry);
      } catch (err) {
        this.log.warn(ctx, `Skipping incompatible journal entry: ${err instanceof Error ? err.message : String(err)}`);
        skipped++;
        continue;
      }

      const elapsed = Date.now() - entry.createdAt;
      const remaining = this.ttlMs - elapsed;
      if (remaining <= 0) {
        await this.expireEntry(record, ctx);
        expired++;
        continue;
      }

      const timeout = this.createExpiryTimeout(record, remaining);
      this.entries.set(record.operationId, { record, timeout });
      restored++;
    }

    if (expired > 0 || skipped > 0) {
      this.persistJournal();
    }

    if (skipped > 0) {
      this.log.warn(ctx, `Skipped ${skipped} incompatible journal entry/entries during restore`);
    }
    if (restored > 0) {
      this.log.info(ctx, `Restored ${restored} tentative publish(es) from journal`);
    }
    return restored;
  }

  private findForConfirmation(params: {
    merkleRoot: Uint8Array;
    publisherAddress: string;
    publicByteSize: bigint;
    txHash?: string;
    startKAId: bigint;
    endKAId: bigint;
  }): StoredTentativePublish | undefined {
    const merkleRootHex = toHex(params.merkleRoot);
    const txHash = params.txHash?.toLowerCase();
    const publisherAddress = params.publisherAddress.toLowerCase();

    if (txHash) {
      for (const stored of this.entries.values()) {
        const submittedTxHash = stored.record.submittedTxHash?.toLowerCase();
        if (submittedTxHash && submittedTxHash === txHash) {
          return stored;
        }
      }
    }

    for (const stored of this.entries.values()) {
      const record = stored.record;
      if (
        toHex(record.merkleRoot) === merkleRootHex &&
        record.publisherAddress.toLowerCase() === publisherAddress &&
        record.publicByteSize === params.publicByteSize
      ) {
        return stored;
      }
    }

    return undefined;
  }

  private createExpiryTimeout(
    record: TentativePublishRecord,
    delayMs = this.ttlMs,
  ): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      void this.expireEntry(record, createOperationContext('publish'));
    }, delayMs);
  }

  private async expireEntry(record: TentativePublishRecord, ctx: OperationContext): Promise<void> {
    this.entries.delete(record.operationId);
    this.persistJournal();

    try {
      const status = await this.store.query(
        `SELECT ?status WHERE { GRAPH <${record.metaGraph}> { <${record.tentativeUal}> <${DKG}status> ?status } } LIMIT 1`,
      );
      if (status.type === 'bindings' && status.bindings.length > 0) {
        const raw = status.bindings[0]?.['status'] ?? '';
        if (raw === '"confirmed"' || raw === 'confirmed') {
          return;
        }
      }

      for (const kaRecord of record.kaRecords) {
        await this.store.deleteByPattern({ graph: record.dataGraph, subject: kaRecord.rootEntity });
        await this.store.deleteBySubjectPrefix(record.dataGraph, kaRecord.rootEntity + SKOLEM_INFIX);
      }
      await this.store.deleteBySubjectPrefix(record.metaGraph, record.tentativeUal);

      this.log.info(
        ctx,
        `Tentative publish expired and was cleaned up: ${record.tentativeUal}`,
      );
    } catch (err) {
      this.log.warn(
        ctx,
        `Failed to expire tentative publish ${record.tentativeUal}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async loadPublicQuads(record: TentativePublishRecord): Promise<Quad[]> {
    const values = record.kaRecords.map((ka) => `<${ka.rootEntity}>`).join(' ');
    const result = await this.store.query(
      `CONSTRUCT { ?s ?p ?o } WHERE {
        GRAPH <${record.dataGraph}> {
          VALUES ?root { ${values} }
          ?s ?p ?o .
          FILTER(
            ?s = ?root
            || STRSTARTS(STR(?s), CONCAT(STR(?root), "${SKOLEM_INFIX}"))
          )
        }
      }`,
    );

    return result.type === 'quads'
      ? result.quads.map((quad) => ({ ...quad, graph: '' }))
      : [];
  }

  private persistJournal(): void {
    if (!this.journal) return;

    const entries = Array.from(this.entries.values()).map(({ record }) => this.toJournalEntry(record));
    this.journalWriteQueue = this.journalWriteQueue
      .then(async () => {
        await this.journal!.save(entries);
      })
      .catch((err) => {
        this.log.warn(
          createOperationContext('publish'),
          `Failed to persist tentative journal: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  private toJournalEntry(record: TentativePublishRecord): TentativePublishJournalEntry {
    return {
      operationId: record.operationId,
      tentativeUal: record.tentativeUal,
      paranetId: record.paranetId,
      publisherAddress: record.publisherAddress,
      merkleRoot: toHex(record.merkleRoot),
      publicByteSize: record.publicByteSize.toString(),
      createdAt: record.createdAt,
      dataGraph: record.dataGraph,
      metaGraph: record.metaGraph,
      kaRecords: record.kaRecords.map((kaRecord) => ({
        ordinal: kaRecord.ordinal,
        rootEntity: kaRecord.rootEntity,
        privateTripleCount: kaRecord.privateTripleCount,
        privateMerkleRoot: kaRecord.privateMerkleRoot ? toHex(kaRecord.privateMerkleRoot) : undefined,
      })),
      publisherPeerId: record.publisherPeerId,
      submittedTxHash: record.submittedTxHash,
      submittedStartKAId: record.submittedStartKAId?.toString(),
      submittedEndKAId: record.submittedEndKAId?.toString(),
    };
  }

  private fromJournalEntry(entry: TentativePublishJournalEntry): TentativePublishRecord {
    return {
      operationId: entry.operationId,
      tentativeUal: entry.tentativeUal,
      paranetId: entry.paranetId,
      publisherAddress: entry.publisherAddress,
      merkleRoot: fromHex(entry.merkleRoot),
      publicByteSize: BigInt(entry.publicByteSize),
      createdAt: entry.createdAt,
      dataGraph: entry.dataGraph,
      metaGraph: entry.metaGraph,
      kaRecords: entry.kaRecords.map((kaRecord) => ({
        ordinal: kaRecord.ordinal,
        rootEntity: kaRecord.rootEntity,
        privateTripleCount: kaRecord.privateTripleCount,
        privateMerkleRoot: kaRecord.privateMerkleRoot ? fromHex(kaRecord.privateMerkleRoot) : undefined,
      })),
      publisherPeerId: entry.publisherPeerId,
      submittedTxHash: entry.submittedTxHash,
      submittedStartKAId: entry.submittedStartKAId ? BigInt(entry.submittedStartKAId) : undefined,
      submittedEndKAId: entry.submittedEndKAId ? BigInt(entry.submittedEndKAId) : undefined,
    };
  }
}
