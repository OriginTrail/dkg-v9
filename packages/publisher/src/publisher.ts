import type { Quad } from '@dkg/storage';

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
}

export interface PublishResult {
  kcId: bigint;
  merkleRoot: Uint8Array;
  kaManifest: KAManifestEntry[];
}

export interface Publisher {
  publish(options: PublishOptions): Promise<PublishResult>;
  update(kcId: bigint, options: PublishOptions): Promise<PublishResult>;
  autoPartition(quads: Quad[]): KAManifestEntry[];
  skolemize(rootEntity: string, quads: Quad[]): Quad[];
}
