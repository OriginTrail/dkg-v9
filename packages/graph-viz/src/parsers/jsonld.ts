import type { RdfTriple } from '../core/types.js';

/**
 * Parse a JSON-LD document into RdfTriple array.
 *
 * Uses the 'jsonld' library (optional dependency) to expand and convert
 * the document to N-Quads, then parses those into triples.
 *
 * Falls back to a simple extraction if jsonld is not available.
 */
export async function parseJsonLd(input: Record<string, unknown> | string): Promise<RdfTriple[]> {
  const doc = typeof input === 'string' ? JSON.parse(input) : input;

  // Try to use the jsonld library for proper expansion
  try {
    const jsonld = await import('jsonld');
    const nquads = await jsonld.default.toRDF(doc, { format: 'application/n-quads' }) as string;

    // Parse the N-Quads output
    const { parseNQuads } = await import('./ntriples.js');
    return parseNQuads(nquads);
  } catch {
    // Fallback: simple flat JSON-LD extraction (no expansion)
    return extractSimpleJsonLd(doc);
  }
}

/**
 * Simple fallback JSON-LD extractor for flat documents.
 * Handles basic @id, @type, and property patterns without full JSON-LD processing.
 */
function extractSimpleJsonLd(doc: Record<string, unknown>): RdfTriple[] {
  const triples: RdfTriple[] = [];
  const graph = Array.isArray(doc['@graph']) ? doc['@graph'] : [doc];

  for (const item of graph) {
    if (!item || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    const subject = (node['@id'] as string) || `_:b${Math.random().toString(36).slice(2, 10)}`;

    // @type
    const types = Array.isArray(node['@type']) ? node['@type'] : node['@type'] ? [node['@type']] : [];
    for (const type of types) {
      triples.push({
        subject,
        predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
        object: type as string,
      });
    }

    // Other properties
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('@')) continue;

      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (v && typeof v === 'object' && '@id' in (v as Record<string, unknown>)) {
          triples.push({
            subject,
            predicate: key,
            object: (v as Record<string, unknown>)['@id'] as string,
          });
        } else if (v && typeof v === 'object' && '@value' in (v as Record<string, unknown>)) {
          const valObj = v as Record<string, unknown>;
          triples.push({
            subject,
            predicate: key,
            object: valObj['@value'] as string,
            datatype: valObj['@type'] as string | undefined,
            language: valObj['@language'] as string | undefined,
          });
        } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          triples.push({
            subject,
            predicate: key,
            object: String(v),
          });
        }
      }
    }
  }

  return triples;
}
