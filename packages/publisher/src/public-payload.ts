import type { Quad } from '@dkg/storage';

function formatTerm(term: string): string {
  if (term.startsWith('"') || term.startsWith('_:') || term.startsWith('<')) {
    return term;
  }
  return `<${term}>`;
}

function formatGraphlessTriple(quad: Quad): string {
  return `${formatTerm(quad.subject)} <${quad.predicate}> ${formatTerm(quad.object)} .`;
}

/**
 * Canonical graphless public payload serializer used everywhere the protocol
 * needs the public bytes: publish gossip, byte-size calculation, and
 * receiver-side attestation verification.
 */
export function serializePublicPayload(quads: Quad[]): Uint8Array {
  const lines = quads
    .map(formatGraphlessTriple)
    .sort((left, right) => left.localeCompare(right));
  return new TextEncoder().encode(lines.join('\n'));
}

export function computePublicByteSize(quads: Quad[]): bigint {
  return BigInt(serializePublicPayload(quads).length);
}
