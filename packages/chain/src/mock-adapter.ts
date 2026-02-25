import type {
  ChainAdapter,
  IdentityProof,
  ReservedRange,
  BatchMintParams,
  BatchMintResult,
  UpdateKAParams,
  ExtendStorageParams,
  CreateKCParams,
  UpdateKCParams,
  TxResult,
  ChainEvent,
  EventFilter,
  CreateParanetParams,
} from './chain-adapter.js';

/**
 * In-memory mock chain adapter for off-chain development.
 * Implements both V9 (UAL-based) and V8 (legacy KC) interfaces.
 */
export class MockChainAdapter implements ChainAdapter {
  readonly chainType = 'evm' as const;
  readonly chainId: string;

  private nextIdentityId = 1n;
  private nextBatchId = 1n;
  private nextBlock = 1;
  private identities = new Map<string, bigint>();
  private publisherNextId = new Map<bigint, bigint>(); // publisherId -> next KA ID
  private batches = new Map<bigint, { merkleRoot: Uint8Array; kaCount: number }>();
  private collections = new Map<bigint, { merkleRoot: Uint8Array; kaCount: number }>();
  private paranets = new Map<string, Record<string, string>>();
  private events: ChainEvent[] = [];

  constructor(chainId = 'mock:31337') {
    this.chainId = chainId;
  }

  async registerIdentity(proof: IdentityProof): Promise<bigint> {
    const key = toHex(proof.publicKey);
    const existing = this.identities.get(key);
    if (existing) return existing;

    const id = this.nextIdentityId++;
    this.identities.set(key, id);
    this.pushEvent('IdentityRegistered', { identityId: id.toString() });
    return id;
  }

  // --- V9 UAL-based methods ---

  async reserveUALRange(publisherIdentityId: bigint, count: number): Promise<ReservedRange> {
    let nextId = this.publisherNextId.get(publisherIdentityId) ?? 1n;
    const startId = nextId;
    const endId = nextId + BigInt(count) - 1n;
    this.publisherNextId.set(publisherIdentityId, endId + 1n);

    this.pushEvent('UALRangeReserved', {
      publisherIdentityId: publisherIdentityId.toString(),
      startId: startId.toString(),
      endId: endId.toString(),
    });

    return { startId, endId };
  }

  async batchMintKnowledgeAssets(params: BatchMintParams): Promise<BatchMintResult> {
    const batchId = this.nextBatchId++;
    const kaCount = Number(params.endKAId - params.startKAId) + 1;

    this.batches.set(batchId, {
      merkleRoot: params.merkleRoot,
      kaCount,
    });

    this.pushEvent('KnowledgeBatchCreated', {
      batchId: batchId.toString(),
      publisherIdentityId: params.publisherIdentityId.toString(),
      merkleRoot: toHex(params.merkleRoot),
      startKAId: params.startKAId.toString(),
      endKAId: params.endKAId.toString(),
      kaCount,
    });

    return {
      ...this.txResult(true),
      batchId,
    };
  }

  async updateKnowledgeAssets(params: UpdateKAParams): Promise<TxResult> {
    const existing = this.batches.get(params.batchId);
    if (!existing) {
      return this.txResult(false);
    }

    existing.merkleRoot = params.newMerkleRoot;
    this.pushEvent('KnowledgeBatchUpdated', {
      batchId: params.batchId.toString(),
      newMerkleRoot: toHex(params.newMerkleRoot),
    });

    return this.txResult(true);
  }

  async extendStorage(params: ExtendStorageParams): Promise<TxResult> {
    const existing = this.batches.get(params.batchId);
    if (!existing) {
      return this.txResult(false);
    }

    this.pushEvent('StorageExtended', {
      batchId: params.batchId.toString(),
      additionalEpochs: params.additionalEpochs,
    });

    return this.txResult(true);
  }

  // --- V8 backward compatibility ---

  async createKnowledgeCollection(params: CreateKCParams): Promise<TxResult> {
    const kcId = this.nextBatchId++;
    this.collections.set(kcId, {
      merkleRoot: params.merkleRoot,
      kaCount: params.knowledgeAssetsCount,
    });

    this.pushEvent('KCCreated', {
      kcId: kcId.toString(),
      merkleRoot: toHex(params.merkleRoot),
      kaCount: params.knowledgeAssetsCount,
    });

    return this.txResult(true);
  }

  async updateKnowledgeCollection(params: UpdateKCParams): Promise<TxResult> {
    const existing = this.collections.get(params.kcId);
    if (!existing) {
      return this.txResult(false);
    }

    existing.merkleRoot = params.newMerkleRoot;
    this.pushEvent('KCUpdated', {
      kcId: params.kcId.toString(),
      newMerkleRoot: toHex(params.newMerkleRoot),
    });

    return this.txResult(true);
  }

  // --- Events ---

  async *listenForEvents(filter: EventFilter): AsyncIterable<ChainEvent> {
    const from = filter.fromBlock ?? 0;
    for (const evt of this.events) {
      if (
        evt.blockNumber >= from &&
        filter.eventTypes.includes(evt.type)
      ) {
        yield evt;
      }
    }
  }

  // --- Paranets ---

  async createParanet(params: CreateParanetParams): Promise<TxResult> {
    this.paranets.set(params.paranetId, params.metadata);
    this.pushEvent('ParanetCreated', { paranetId: params.paranetId });
    return this.txResult(true);
  }

  async submitToParanet(kcId: string, paranetId: string): Promise<TxResult> {
    this.pushEvent('KCSubmittedToParanet', { kcId, paranetId });
    return this.txResult(true);
  }

  // --- Test helpers ---

  getBatch(batchId: bigint) {
    return this.batches.get(batchId);
  }

  getCollection(kcId: bigint) {
    return this.collections.get(kcId);
  }

  getIdentityId(publicKey: Uint8Array): bigint | undefined {
    return this.identities.get(toHex(publicKey));
  }

  private pushEvent(type: string, data: Record<string, unknown>): void {
    this.events.push({ type, blockNumber: this.nextBlock++, data });
  }

  private txResult(success: boolean): TxResult {
    return {
      hash: `0x${(this.nextBlock - 1).toString(16).padStart(64, '0')}`,
      blockNumber: this.nextBlock - 1,
      success,
    };
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
