import { sha256, MerkleTree, hashTriple } from '@dkg/core';
import type { Quad } from '@dkg/storage';

const DKG_PRIVATE_COMMITMENT_PREDICATE = 'http://dkg.io/ontology/privateMerkleRootCommitment';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute SHA-256 hash of a single triple (s, p, o).
 * Graph component is excluded per spec.
 */
export function computeTripleHash(q: Quad): Uint8Array {
  return hashTriple(q.subject, q.predicate, q.object);
}

export function computePublicRoot(publicQuads: Quad[]): Uint8Array | undefined {
  if (publicQuads.length === 0) return undefined;
  const hashes = publicQuads.map(computeTripleHash);
  return new MerkleTree(hashes).root;
}

export function computePrivateRoot(
  privateQuads: Quad[],
): Uint8Array | undefined {
  if (privateQuads.length === 0) return undefined;
  const hashes = privateQuads.map(computeTripleHash);
  return new MerkleTree(hashes).root;
}

export function computeKARoot(
  publicRoot?: Uint8Array,
  privateRoot?: Uint8Array,
): Uint8Array {
  return MerkleTree.computeKARoot(publicRoot, privateRoot);
}

export function computeKCRoot(kaRoots: Uint8Array[]): Uint8Array {
  return MerkleTree.computeKCRoot(kaRoots);
}

export function computeSyntheticPrivateCommitmentHash(
  rootEntity: string,
  privateMerkleRoot: Uint8Array,
): Uint8Array {
  return computeTripleHash({
    subject: rootEntity,
    predicate: DKG_PRIVATE_COMMITMENT_PREDICATE,
    object: `"0x${toHex(privateMerkleRoot)}"`,
    graph: '',
  });
}

export function computeFlatCollectionRoot(
  publicQuads: Quad[],
  manifest: Array<{ rootEntity: string; privateMerkleRoot?: Uint8Array }>,
): Uint8Array {
  const leaves = publicQuads.map(computeTripleHash);

  for (const entry of manifest) {
    if (!entry.privateMerkleRoot || entry.privateMerkleRoot.length === 0) {
      continue;
    }
    leaves.push(
      computeSyntheticPrivateCommitmentHash(
        entry.rootEntity,
        entry.privateMerkleRoot,
      ),
    );
  }

  return new MerkleTree(leaves).root;
}
