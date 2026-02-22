import canonize from 'rdf-canonize';
import { sha256 } from './hashing.js';

const textEncoder = new TextEncoder();

/**
 * Canonicalize an N-Quads string using the RDFC-1.0 algorithm (successor to URDNA2015).
 * Input and output are both N-Quads strings.
 */
export async function canonicalize(nquads: string): Promise<string> {
  return canonize.canonize(nquads, {
    algorithm: 'RDFC-1.0',
    inputFormat: 'application/n-quads',
    format: 'application/n-quads',
  });
}

/**
 * Compute a deterministic hash for a single triple (s, p, o).
 * The graph component is excluded per spec — only subject, predicate, object participate.
 * The triple is formatted as a canonical N-Triple line before hashing.
 */
export function hashTriple(
  subject: string,
  predicate: string,
  object: string,
): Uint8Array {
  const ntriple = formatNTriple(subject, predicate, object);
  return sha256(textEncoder.encode(ntriple));
}

/**
 * Format a single triple as an N-Triple line (without graph, without trailing newline).
 * URIs are wrapped in angle brackets, literals and blank nodes are passed through.
 */
function formatNTriple(
  subject: string,
  predicate: string,
  object: string,
): string {
  const s = formatTerm(subject);
  const p = formatTerm(predicate);
  const o = formatTerm(object);
  return `${s} ${p} ${o} .`;
}

function formatTerm(term: string): string {
  if (term.startsWith('"')) return term; // literal (already N-Triples formatted)
  if (term.startsWith('_:')) return term; // blank node
  if (term.startsWith('<')) return term; // already wrapped
  return `<${term}>`; // bare URI -> wrap
}
