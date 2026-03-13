const SAFE_RDF_LITERAL = /^"(?:[^"\\]|\\.)*"(?:@[A-Za-z-]+|\^\^<[^>]+>)?$/;
const SAFE_RDF_IRI = /^<[^<>"{}|\\^`\x00-\x20]+>$/;

export function assertSafeRdfTerm(value: string): void {
  if (SAFE_RDF_LITERAL.test(value)) return;
  if (SAFE_RDF_IRI.test(value)) return;
  throw new Error(`Unsafe RDF term for CAS condition: ${value.slice(0, 80)}`);
}
