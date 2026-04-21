import { contextGraphDataUri, keccak256 } from '@origintrail-official/dkg-core';
import { randomBytes } from 'node:crypto';
import type { Quad } from '@origintrail-official/dkg-storage';

/** Ontology predicate: agent endorses a Knowledge Asset */
export const DKG_ENDORSES = 'https://dkg.network/ontology#endorses';

/** Ontology predicate: timestamp of endorsement */
export const DKG_ENDORSED_AT = 'https://dkg.network/ontology#endorsedAt';

/** Ontology predicate: 128-bit random nonce bound to this endorsement (A-7 replay defence). */
export const DKG_ENDORSEMENT_NONCE = 'https://dkg.network/ontology#endorsementNonce';

/**
 * Ontology predicate: signature / proof over the canonical endorsement
 * digest (A-7). When a `signer` callback is provided, this holds an
 * EIP-191 personal-sign signature over `eip191Hash(canonicalDigest)`.
 * When no signer is supplied, it falls back to the canonical digest hex
 * ("unsigned proof"): this still binds the quad to (agent, ual, cg, ts,
 * nonce), making tampering detectable, but DOES NOT replace a real
 * signature for cross-node trust. Callers that need non-repudiation
 * MUST pass a signer.
 */
export const DKG_ENDORSEMENT_SIGNATURE = 'https://dkg.network/ontology#endorsementSignature';

export interface BuildEndorsementQuadsOptions {
  /** Optional EIP-191 signer — e.g. `(msg) => wallet.signMessage(msg)`. */
  signer?: (digest: Uint8Array) => Promise<string> | string;
  /** Injectable timestamp for deterministic tests. */
  now?: Date;
  /** Injectable nonce for deterministic tests. Must be ≥ 16 bytes of entropy. */
  nonce?: string;
}

/**
 * Canonical endorsement preimage (A-7). Stable across implementations so
 * any verifier can reproduce it: pipe-separated tuple of lower-cased
 * address, UAL, context graph id, ISO-8601 timestamp, and nonce.
 */
export function canonicalEndorseDigest(
  agentAddress: string,
  knowledgeAssetUal: string,
  contextGraphId: string,
  endorsedAt: string,
  nonce: string,
): Uint8Array {
  const preimage = [
    agentAddress.toLowerCase(),
    knowledgeAssetUal,
    contextGraphId,
    endorsedAt,
    nonce,
  ].join('|');
  return keccak256(new TextEncoder().encode(preimage));
}

function toHex(bytes: Uint8Array): string {
  return '0x' + Buffer.from(bytes).toString('hex');
}

/**
 * Build endorsement triples for a Knowledge Asset. Always emits the
 * A-7 replay-protection nonce and proof quads alongside the canonical
 * (endorses, endorsedAt) pair.
 */
export function buildEndorsementQuads(
  agentAddress: string,
  knowledgeAssetUal: string,
  contextGraphId: string,
  options: BuildEndorsementQuadsOptions = {},
): Quad[] {
  const agentUri = `did:dkg:agent:${agentAddress}`;
  const graph = contextGraphDataUri(contextGraphId);
  const now = (options.now ?? new Date()).toISOString();
  const nonce = options.nonce ?? toHex(randomBytes(16));

  const digest = canonicalEndorseDigest(
    agentAddress,
    knowledgeAssetUal,
    contextGraphId,
    now,
    nonce,
  );
  const proofHex = toHex(digest);

  return [
    {
      subject: agentUri,
      predicate: DKG_ENDORSES,
      object: knowledgeAssetUal,
      graph,
    },
    {
      subject: agentUri,
      predicate: DKG_ENDORSED_AT,
      object: `"${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`,
      graph,
    },
    {
      subject: agentUri,
      predicate: DKG_ENDORSEMENT_NONCE,
      object: `"${nonce}"`,
      graph,
    },
    {
      subject: agentUri,
      predicate: DKG_ENDORSEMENT_SIGNATURE,
      object: `"${proofHex}"`,
      graph,
    },
  ];
}
