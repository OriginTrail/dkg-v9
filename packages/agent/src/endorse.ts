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
 * digest (A-7).
 *
 * Two emission modes:
 *
 *  - **{@link buildEndorsementQuadsAsync} with `signer`** — the object is
 *    the EIP-191 personal-sign signature returned by the caller's wallet
 *    over `eip191Hash(canonicalDigest)`. Verifiers can recover the
 *    endorsing address from this value and reject endorsements whose
 *    recovered signer is not a member of the context graph.
 *
 *  - **{@link buildEndorsementQuads} (sync) or async without a signer** —
 *    the object falls back to the canonical digest hex ("unsigned proof").
 *    This still binds the quad to (agent, ual, cg, ts, nonce) so tampering
 *    with any field breaks the digest, but it is NOT a cryptographic
 *    signature: any peer that knows the public tuple can recompute it.
 *    Flows that need non-repudiation MUST use the async variant with a
 *    real signer.
 */
export const DKG_ENDORSEMENT_SIGNATURE = 'https://dkg.network/ontology#endorsementSignature';

/**
 * Options common to both sync and async endorsement builders.
 *
 * NOTE: the `signer` option lives ONLY on {@link BuildEndorsementQuadsAsyncOptions}
 * — it is deliberately absent from the sync variant's option type. An
 * earlier revision exposed `signer` on the sync builder as well, but the
 * sync path cannot call it (signing is async), so callers who passed one
 * still got the raw digest hex in `endorsementSignature` and believed
 * they had produced a verifiable endorsement (bot review D1). Removing
 * the option from the sync surface makes the contract honest.
 */
export interface BuildEndorsementQuadsOptions {
  /** Injectable timestamp for deterministic tests. */
  now?: Date;
  /** Injectable nonce for deterministic tests. Must be ≥ 16 bytes of entropy. */
  nonce?: string;
}

export interface BuildEndorsementQuadsAsyncOptions extends BuildEndorsementQuadsOptions {
  /**
   * EIP-191 signer — typically `(digest) => wallet.signMessage(digest)`.
   * Invoked exactly once with the canonical keccak256 digest bytes; the
   * returned signature is persisted into the endorsement signature quad.
   * If omitted, the quad falls back to the unsigned digest hex.
   */
  signer?: (digest: Uint8Array) => Promise<string> | string;
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

interface EndorsementCore {
  agentUri: string;
  graph: string;
  now: string;
  nonce: string;
  digest: Uint8Array;
}

function prepareEndorsementCore(
  agentAddress: string,
  knowledgeAssetUal: string,
  contextGraphId: string,
  options: BuildEndorsementQuadsOptions,
): EndorsementCore {
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
  return { agentUri, graph, now, nonce, digest };
}

function buildQuadsFromCore(core: EndorsementCore, proofValue: string): Quad[] {
  return [
    { subject: core.agentUri, predicate: DKG_ENDORSES, object: '', graph: core.graph }, // placeholder, replaced below
    { subject: core.agentUri, predicate: DKG_ENDORSED_AT, object: `"${core.now}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`, graph: core.graph },
    { subject: core.agentUri, predicate: DKG_ENDORSEMENT_NONCE, object: `"${core.nonce}"`, graph: core.graph },
    { subject: core.agentUri, predicate: DKG_ENDORSEMENT_SIGNATURE, object: `"${proofValue}"`, graph: core.graph },
  ];
}

/**
 * Build endorsement triples (sync variant, no cryptographic signature).
 *
 * Emits the A-7 replay-protection nonce and a tamper-detection digest.
 * The signature quad here carries the **unsigned** canonical digest hex
 * and is NOT verifiable — use {@link buildEndorsementQuadsAsync} with a
 * real `signer` for non-repudiation.
 */
export function buildEndorsementQuads(
  agentAddress: string,
  knowledgeAssetUal: string,
  contextGraphId: string,
  options: BuildEndorsementQuadsOptions = {},
): Quad[] {
  const core = prepareEndorsementCore(agentAddress, knowledgeAssetUal, contextGraphId, options);
  const quads = buildQuadsFromCore(core, toHex(core.digest));
  quads[0].object = knowledgeAssetUal;
  return quads;
}

/**
 * Async endorsement builder. If `options.signer` is supplied, it is
 * invoked with the canonical digest bytes and its return value (expected
 * to be a 0x-prefixed EIP-191 personal-sign signature) is stored in the
 * endorsement signature quad. Otherwise, falls back to the canonical
 * digest hex identical to {@link buildEndorsementQuads}.
 */
export async function buildEndorsementQuadsAsync(
  agentAddress: string,
  knowledgeAssetUal: string,
  contextGraphId: string,
  options: BuildEndorsementQuadsAsyncOptions = {},
): Promise<Quad[]> {
  const core = prepareEndorsementCore(agentAddress, knowledgeAssetUal, contextGraphId, options);
  let proofValue: string;
  if (options.signer) {
    const sig = await Promise.resolve(options.signer(core.digest));
    if (typeof sig !== 'string' || sig.length === 0) {
      throw new Error('endorsement signer returned an empty/invalid signature');
    }
    proofValue = sig;
  } else {
    proofValue = toHex(core.digest);
  }
  const quads = buildQuadsFromCore(core, proofValue);
  quads[0].object = knowledgeAssetUal;
  return quads;
}
