import type { RdfTriple } from '../core/types.js';

/**
 * Normalize a raw triple array input into the standard RdfTriple format.
 *
 * Accepts various common shapes:
 * - { subject, predicate, object } (our format)
 * - { s, p, o } (shorthand)
 * - [subject, predicate, object] (tuple)
 */
export function parseTripleArray(
  input: Array<RdfTriple | { s: string; p: string; o: string } | [string, string, string]>
): RdfTriple[] {
  return input.map((item) => {
    if (Array.isArray(item)) {
      return { subject: item[0], predicate: item[1], object: item[2] };
    }
    if ('s' in item && 'p' in item && 'o' in item) {
      return { subject: item.s, predicate: item.p, object: item.o };
    }
    return item as RdfTriple;
  });
}
