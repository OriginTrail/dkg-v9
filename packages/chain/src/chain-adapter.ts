export interface IdentityProof {
  publicKey: Uint8Array;
  signature: Uint8Array;
}

export interface ReservedRange {
  startId: bigint;
  endId: bigint;
  expiresAtEpoch: number;
}

export interface CreateKCParams {
  merkleRoot: Uint8Array;
  knowledgeAssetsCount: number;
  signatures: Array<{ identityId: bigint; r: Uint8Array; vs: Uint8Array }>;
}

export interface UpdateKCParams {
  kcId: bigint;
  newMerkleRoot: Uint8Array;
  signatures: Array<{ identityId: bigint; r: Uint8Array; vs: Uint8Array }>;
}

export interface TxResult {
  hash: string;
  blockNumber: number;
  success: boolean;
}

export interface ChainEvent {
  type: string;
  blockNumber: number;
  data: Record<string, unknown>;
}

export interface EventFilter {
  eventTypes: string[];
  fromBlock?: number;
}

export interface CreateParanetParams {
  paranetId: string;
  metadata: Record<string, string>;
}

export interface ChainAdapter {
  chainType: 'evm' | 'solana';
  chainId: string;
  registerIdentity(proof: IdentityProof): Promise<bigint>;
  reserveKnowledgeCollectionIds(count: number): Promise<ReservedRange>;
  createKnowledgeCollection(params: CreateKCParams): Promise<TxResult>;
  updateKnowledgeCollection(params: UpdateKCParams): Promise<TxResult>;
  listenForEvents(filter: EventFilter): AsyncIterable<ChainEvent>;
  createParanet(params: CreateParanetParams): Promise<TxResult>;
  submitToParanet(kcId: string, paranetId: string): Promise<TxResult>;
}
