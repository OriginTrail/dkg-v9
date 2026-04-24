/**
 * PR #229 bot review round 17 (r17-2): the fail-closed branches in
 * `DKGAgent.query()` (WM cross-agent auth denial, private-CG leak
 * guard, unreadable context graph) must emit a `QueryResult` whose
 * SHAPE matches the form the caller asked for — otherwise a
 * `CONSTRUCT`/`DESCRIBE` caller that branches on
 * `result.quads !== undefined` misreads a deny as a bindings-only
 * SELECT success.
 *
 * These tests pin the two exports that make the shape contract
 * explicit: `detectSparqlQueryForm` and `emptyResultForForm`.
 */
import { describe, it, expect } from 'vitest';
import {
  detectSparqlQueryForm,
  emptyResultForForm,
  type SparqlQueryForm,
} from '../src/index.js';

describe('detectSparqlQueryForm', () => {
  it('classifies SELECT', () => {
    expect(detectSparqlQueryForm('SELECT ?s WHERE { ?s ?p ?o }')).toBe('SELECT');
    expect(detectSparqlQueryForm('select ?s where { ?s ?p ?o }')).toBe('SELECT');
  });

  it('classifies CONSTRUCT', () => {
    expect(detectSparqlQueryForm('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')).toBe('CONSTRUCT');
    expect(detectSparqlQueryForm('construct { ?s ?p ?o } where { ?s ?p ?o }')).toBe('CONSTRUCT');
  });

  it('classifies ASK', () => {
    expect(detectSparqlQueryForm('ASK { ?s ?p ?o }')).toBe('ASK');
    expect(detectSparqlQueryForm('ask { ?s ?p ?o }')).toBe('ASK');
  });

  it('classifies DESCRIBE', () => {
    expect(detectSparqlQueryForm('DESCRIBE <urn:x>')).toBe('DESCRIBE');
    expect(detectSparqlQueryForm('describe <urn:x>')).toBe('DESCRIBE');
  });

  it('looks through PREFIX / BASE preamble', () => {
    const q = [
      'PREFIX ex: <urn:example:>',
      'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>',
      'CONSTRUCT { ?s a ex:Thing } WHERE { ?s ?p ?o }',
    ].join('\n');
    expect(detectSparqlQueryForm(q)).toBe('CONSTRUCT');
  });

  it('returns UNKNOWN for mutating / garbage input so callers can fall back safely', () => {
    expect(detectSparqlQueryForm('INSERT DATA { <urn:x> <urn:p> "y" }')).toBe('UNKNOWN');
    expect(detectSparqlQueryForm('DROP GRAPH <urn:g>')).toBe('UNKNOWN');
    expect(detectSparqlQueryForm('')).toBe('UNKNOWN');
    expect(detectSparqlQueryForm('not-a-query')).toBe('UNKNOWN');
  });
});

describe('emptyResultForForm — shape contract', () => {
  it('SELECT → bindings only, quads absent', () => {
    const r = emptyResultForForm('SELECT');
    expect(r.bindings).toEqual([]);
    expect(r.quads).toBeUndefined();
    // `quads` missing is the distinguishing trait — readers that
    // branch on `result.quads !== undefined` must treat this as a
    // bindings-only result.
    expect(Object.prototype.hasOwnProperty.call(r, 'quads')).toBe(false);
  });

  it('CONSTRUCT → bindings:[] AND quads:[] (both present)', () => {
    const r = emptyResultForForm('CONSTRUCT');
    expect(r.bindings).toEqual([]);
    expect(r.quads).toBeDefined();
    expect(r.quads).toEqual([]);
  });

  it('DESCRIBE → bindings:[] AND quads:[] (same as CONSTRUCT — both yield triples)', () => {
    const r = emptyResultForForm('DESCRIBE');
    expect(r.bindings).toEqual([]);
    expect(r.quads).toBeDefined();
    expect(r.quads).toEqual([]);
  });

  it('ASK → synthetic bindings [{ result: "false" }] matching dkg-query-engine normalization', () => {
    const r = emptyResultForForm('ASK');
    // dkg-query-engine surfaces ASK results via bindings; a false
    // ASK is the safest deny shape (as if the assertion failed).
    expect(r.bindings).toEqual([{ result: 'false' }]);
    expect(r.quads).toBeUndefined();
  });

  it('UNKNOWN → empty bindings (safe default, unreachable from DKGAgent.query)', () => {
    const r = emptyResultForForm('UNKNOWN');
    expect(r.bindings).toEqual([]);
    expect(r.quads).toBeUndefined();
  });

  it('returns a FRESH object per call — two calls cannot alias each other', () => {
    // Structural pin: the helper is documented to return a fresh
    // object on every call so callers that mutate it (appending
    // bindings before returning, downstream deep-freeze, etc.)
    // cannot poison a later deny path.
    const a = emptyResultForForm('CONSTRUCT');
    const b = emptyResultForForm('CONSTRUCT');
    expect(a).not.toBe(b);
    expect(a.bindings).not.toBe(b.bindings);
    expect(a.quads).not.toBe(b.quads);

    // Mutating one must not affect the other.
    a.bindings.push({ forged: 'v' });
    expect(b.bindings).toEqual([]);
  });
});

describe('round-trip: form → empty result preserves the `quads` presence distinction', () => {
  const cases: Array<[string, SparqlQueryForm, boolean]> = [
    ['SELECT ?s WHERE { ?s ?p ?o }',     'SELECT',    false],
    ['CONSTRUCT { ?s ?p ?o } WHERE {}',  'CONSTRUCT', true],
    ['DESCRIBE <urn:x>',                 'DESCRIBE',  true],
    ['ASK { ?s ?p ?o }',                 'ASK',       false],
  ];
  for (const [q, expectedForm, hasQuads] of cases) {
    it(`${expectedForm}: ${q}`, () => {
      const form = detectSparqlQueryForm(q);
      expect(form).toBe(expectedForm);
      const r = emptyResultForForm(form);
      expect(Object.prototype.hasOwnProperty.call(r, 'quads')).toBe(hasQuads);
    });
  }
});
