import { describe, it, expect, beforeEach } from 'vitest';
import { OxigraphStore, type Quad } from '@dkg/storage';
import { DKGQueryEngine } from '../src/dkg-query-engine.js';

const PARANET = 'agent-registry';
const GRAPH = `did:dkg:paranet:${PARANET}`;
const META = `${GRAPH}/_meta`;
const ENTITY = 'did:dkg:agent:QmImageBot';

function q(s: string, p: string, o: string, g = GRAPH): Quad {
  return { subject: s, predicate: p, object: o, graph: g };
}

describe('DKGQueryEngine', () => {
  let store: OxigraphStore;
  let engine: DKGQueryEngine;

  beforeEach(async () => {
    store = new OxigraphStore();
    engine = new DKGQueryEngine(store);

    // Seed data
    await store.insert([
      q(ENTITY, 'http://schema.org/name', '"ImageBot"'),
      q(ENTITY, 'http://schema.org/description', '"Analyzes images"'),
      q(
        `${ENTITY}/.well-known/genid/o1`,
        'http://ex.org/type',
        '"ImageAnalysis"',
      ),
    ]);
  });

  it('queries paranet-scoped data', async () => {
    const result = await engine.query(
      'SELECT ?name WHERE { ?s <http://schema.org/name> ?name }',
      { paranetId: PARANET },
    );
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0]['name']).toContain('ImageBot');
  });

  it('returns all triples for entity', async () => {
    const result = await engine.query(
      `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
      { paranetId: PARANET },
    );
    expect(result.bindings).toHaveLength(3);
  });

  it('resolveKA returns entity data', async () => {
    const ual = 'did:dkg:mock:31337/1';
    // Need metadata in meta graph
    await store.insert([
      {
        subject: `${ual}/1`,
        predicate: 'http://dkg.io/ontology/rootEntity',
        object: ENTITY,
        graph: META,
      },
      {
        subject: `${ual}/1`,
        predicate: 'http://dkg.io/ontology/partOf',
        object: ual,
        graph: META,
      },
      {
        subject: ual,
        predicate: 'http://dkg.io/ontology/paranet',
        object: `did:dkg:paranet:${PARANET}`,
        graph: META,
      },
    ]);

    const result = await engine.resolveKA(ual);
    expect(result.rootEntity).toBe(ENTITY);
    expect(result.paranetId).toBe(PARANET);
    expect(result.quads.length).toBeGreaterThanOrEqual(2);
  });

  it('throws on unknown UAL', async () => {
    await expect(engine.resolveKA('did:dkg:mock:9999/99')).rejects.toThrow(
      'KA not found',
    );
  });

  it('queries across all paranets', async () => {
    // Add data to another paranet
    await store.insert([
      q('did:dkg:agent:QmTextBot', 'http://schema.org/name', '"TextBot"', 'did:dkg:paranet:text-tools'),
    ]);

    const result = await engine.queryAllParanets(
      'SELECT ?name WHERE { ?s <http://schema.org/name> ?name }',
    );
    expect(result.bindings.length).toBe(2);
  });
});
