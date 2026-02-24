import { Parser, type Quad } from 'n3';
import type { RdfTriple } from '../core/types.js';

/**
 * Parse N-Triples or N-Quads string into RdfTriple array.
 * Uses the n3 library for spec-compliant parsing.
 */
export function parseNTriples(input: string): RdfTriple[] {
  const parser = new Parser({ format: 'N-Triples' });
  const quads: Quad[] = parser.parse(input);
  return quads.map(quadToTriple);
}

/**
 * Parse N-Quads string into RdfTriple array.
 */
export function parseNQuads(input: string): RdfTriple[] {
  const parser = new Parser({ format: 'N-Quads' });
  const quads: Quad[] = parser.parse(input);
  return quads.map(quadToTriple);
}

/** Convert an n3 Quad to our RdfTriple format */
function quadToTriple(quad: Quad): RdfTriple {
  const triple: RdfTriple = {
    subject: quad.subject.value,
    predicate: quad.predicate.value,
    object: quad.object.value,
  };

  if (quad.object.termType === 'Literal') {
    const lit = quad.object;
    if (lit.datatype) {
      triple.datatype = lit.datatype.value;
    }
    if (lit.language) {
      triple.language = lit.language;
    }
  }

  if (quad.graph && quad.graph.value) {
    triple.graph = quad.graph.value;
  }

  return triple;
}
