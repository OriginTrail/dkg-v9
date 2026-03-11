import type { Quad } from '@dkg/storage';
import type { OnChainPublishResult } from '@dkg/chain';
import type { OperationContext } from '@dkg/core';

export interface KAManifestEntry {
  tokenId: bigint;
  rootEntity: string;
  privateMerkleRoot?: Uint8Array;
  privateTripleCount?: number;
}

export type PhaseCallback = (phase: string, status: 'start' | 'end') => void;

export type ReceiverSignature = { identityId: bigint; r: Uint8Array; vs: Uint8Array };

export interface PreparedPublish {
  operationId: string;
  paranetId: string;
  tentativeUal: string;
  publisherAddress: string;
  merkleRoot: Uint8Array;
  publicByteSize: bigint;
  encodedPublishRequest: Uint8Array;
  publicQuads: Quad[];
  manifest: KAManifestEntry[];
}

/**
 * Callback that collects receiver signatures from peers.
 * Called AFTER data preparation, BEFORE on-chain tx.
 */
export type ReceiverSignatureProvider = (
  preparedPublish: PreparedPublish,
) => Promise<ReceiverSignature[]>;

/**
 * Callback that collects participant signatures for context graph governance.
 */
export type ParticipantSignatureProvider = (
  contextGraphId: bigint,
  merkleRoot: string,
) => Promise<ReceiverSignature[]>;

export interface PublishOptions {
  paranetId: string;
  quads: Quad[];
  privateQuads?: Quad[];
  manifest?: KAManifestEntry[];
  operationCtx?: OperationContext;
  /** Optional callback invoked at each phase boundary for instrumentation. */
  onPhase?: PhaseCallback;
  /** Override the data graph URI (used for context graph enshrinement). */
  targetGraphUri?: string;
  /** Override the meta graph URI (used for context graph enshrinement). */
  targetMetaGraphUri?: string;
  /** Broadcast the pre-chain gossip replication message before chain submission. */
  preBroadcast?: (preparedPublish: PreparedPublish) => Promise<void>;
  /**
   * If provided, publisher calls this to collect receiver signatures
   * from peers AFTER pre-broadcast and BEFORE the on-chain tx.
   */
  receiverSignatureProvider?: ReceiverSignatureProvider;
}

export interface PublishResult {
  kcId: bigint;
  /** The UAL assigned to this KC (tentative or confirmed). */
  ual: string;
  merkleRoot: Uint8Array;
  kaManifest: KAManifestEntry[];
  preparedPublish?: PreparedPublish;
  status: 'tentative' | 'confirmed' | 'failed';
  onChainResult?: OnChainPublishResult;
  /** Public quads that were stored (used for broadcast — never includes private triples). */
  publicQuads?: Quad[];
}

export interface Publisher {
  publish(options: PublishOptions): Promise<PublishResult>;
  update(kcId: bigint, options: PublishOptions): Promise<PublishResult>;
  autoPartition(quads: Quad[]): KAManifestEntry[];
  skolemize(rootEntity: string, quads: Quad[]): Quad[];
}
