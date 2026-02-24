import { Parser, type Quad } from 'n3';
import type { RdfTriple, PrefixMap } from '../core/types.js';

/**
 * Parse a Turtle string into RdfTriple array.
 * Also extracts declared prefixes.
 */
export function parseTurtle(input: string): { triples: RdfTriple[]; prefixes: PrefixMap } {
  const extractedPrefixes: PrefixMap = {};
  const parser = new Parser({
    format: 'Turtle',
  });

  // n3 Parser.parse is synchronous for Turtle
  // The prefix callback is passed as the third argument
  const quads: Quad[] = parser.parse(input, undefined, (prefix: string, namespace: { value: string }) => {
    if (prefix && namespace) {
      extractedPrefixes[prefix] = namespace.value;
    }
  });

  const triples: RdfTriple[] = quads.map((quad) => {
    const triple: RdfTriple = {
      subject: quad.subject.value,
      predicate: quad.predicate.value,
      object: quad.object.value,
    };

    if (quad.object.termType === 'Literal') {
      const lit = quad.object;
      if (lit.datatype) triple.datatype = lit.datatype.value;
      if (lit.language) triple.language = lit.language;
    }

    return triple;
  });

  return { triples, prefixes: extractedPrefixes };
}
