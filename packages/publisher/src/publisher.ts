import type { Quad } from '@dkg/storage';
import type { OnChainPublishResult } from '@dkg/chain';
import type { OperationContext } from '@dkg/core';

export interface KAManifestEntry {
  tokenId: bigint;
  rootEntity: string;
  privateMerkleRoot?: Uint8Array;
  privateTripleCount?: number;
}

export interface PublishOptions {
  paranetId: string;
  quads: Quad[];
  privateQuads?: Quad[];
  manifest?: KAManifestEntry[];
  operationCtx?: OperationContext;
  /**
   * When true, triples are grouped by root entity and each group gets its
   * own `kaRoot`. The `kcMerkleRoot` is a Merkle tree over sorted `kaRoot`
   * values, enabling selective disclosure (prove one entity without
   * revealing others). Off by default — the flat hash is simpler and cheaper.
   */
  entityProofs?: boolean;
}

export interface PublishResult {
  kcId: bigint;
  merkleRoot: Uint8Array;
  kaManifest: KAManifestEntry[];
  status: 'tentative' | 'confirmed';
  onChainResult?: OnChainPublishResult;
}

export interface Publisher {
  publish(options: PublishOptions): Promise<PublishResult>;
  update(kcId: bigint, options: PublishOptions): Promise<PublishResult>;
  autoPartition(quads: Quad[]): KAManifestEntry[];
  skolemize(rootEntity: string, quads: Quad[]): Quad[];
}
