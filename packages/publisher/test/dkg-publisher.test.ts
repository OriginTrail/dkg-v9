import { describe, it, expect, beforeEach } from 'vitest';
import { OxigraphStore } from '@dkg/storage';
import { MockChainAdapter } from '@dkg/chain';
import { TypedEventBus, generateEd25519Keypair } from '@dkg/core';
import { DKGPublisher } from '../src/dkg-publisher.js';
import type { Quad } from '@dkg/storage';

const PARANET = 'agent-registry';
const GRAPH = `did:dkg:paranet:${PARANET}`;
const ENTITY = 'did:dkg:agent:QmImageBot';
const ENTITY2 = 'did:dkg:agent:QmTextBot';

function q(s: string, p: string, o: string, g = GRAPH): Quad {
  return { subject: s, predicate: p, object: o, graph: g };
}

describe('DKGPublisher', () => {
  let publisher: DKGPublisher;
  let store: OxigraphStore;
  let chain: MockChainAdapter;
  let eventBus: TypedEventBus;

  beforeEach(async () => {
    store = new OxigraphStore();
    chain = new MockChainAdapter();
    eventBus = new TypedEventBus();
    const keypair = await generateEd25519Keypair();
    publisher = new DKGPublisher({ store, chain, eventBus, keypair });
  });

  it('publishes a single KA', async () => {
    const result = await publisher.publish({
      paranetId: PARANET,
      quads: [
        q(ENTITY, 'http://schema.org/name', '"ImageBot"'),
        q(ENTITY, 'http://schema.org/description', '"Analyzes images"'),
      ],
    });

    expect(result.merkleRoot).toHaveLength(32);
    expect(result.kaManifest).toHaveLength(1);
    expect(result.kaManifest[0].rootEntity).toBe(ENTITY);

    // Verify data was stored
    const count = await store.countQuads(GRAPH);
    expect(count).toBe(2);

    // Verify metadata was stored
    const metaGraph = `did:dkg:paranet:${PARANET}/_meta`;
    const metaCount = await store.countQuads(metaGraph);
    expect(metaCount).toBeGreaterThan(0);
  });

  it('publishes multiple KAs in one KC', async () => {
    const result = await publisher.publish({
      paranetId: PARANET,
      quads: [
        q(ENTITY, 'http://schema.org/name', '"ImageBot"'),
        q(ENTITY2, 'http://schema.org/name', '"TextBot"'),
      ],
    });

    expect(result.kaManifest).toHaveLength(2);
    expect(result.kaManifest.map((m) => m.rootEntity).sort()).toEqual(
      [ENTITY, ENTITY2].sort(),
    );
  });

  it('publishes with blank nodes (auto-skolemized)', async () => {
    const result = await publisher.publish({
      paranetId: PARANET,
      quads: [
        q(ENTITY, 'http://schema.org/name', '"ImageBot"'),
        q(ENTITY, 'http://ex.org/offers', '_:o1'),
        q('_:o1', 'http://ex.org/type', '"ImageAnalysis"'),
      ],
    });

    expect(result.kaManifest).toHaveLength(1);

    // Verify skolemized triples were stored
    const queryResult = await store.query(
      `SELECT ?s WHERE { GRAPH <${GRAPH}> { ?s ?p ?o } }`,
    );
    if (queryResult.type === 'bindings') {
      const subjects = queryResult.bindings.map((b) => b['s']);
      const hasSkolemized = subjects.some((s) =>
        s.includes('/.well-known/genid/'),
      );
      expect(hasSkolemized).toBe(true);
    }
  });

  it('publishes with private triples', async () => {
    const result = await publisher.publish({
      paranetId: PARANET,
      quads: [q(ENTITY, 'http://schema.org/name', '"ImageBot"')],
      privateQuads: [q(ENTITY, 'http://ex.org/apiKey', '"secret-key-123"')],
    });

    expect(result.kaManifest[0].privateTripleCount).toBe(1);
    expect(result.kaManifest[0].privateMerkleRoot).toBeDefined();
    expect(result.kaManifest[0].privateMerkleRoot!).toHaveLength(32);
  });

  it('rejects duplicate entity (exclusivity)', async () => {
    await publisher.publish({
      paranetId: PARANET,
      quads: [q(ENTITY, 'http://schema.org/name', '"ImageBot"')],
    });

    await expect(
      publisher.publish({
        paranetId: PARANET,
        quads: [q(ENTITY, 'http://schema.org/name', '"Duplicate"')],
      }),
    ).rejects.toThrow('Validation failed');
  });

  it('updates an existing KC', async () => {
    const initial = await publisher.publish({
      paranetId: PARANET,
      quads: [q(ENTITY, 'http://schema.org/name', '"OldName"')],
    });

    const updated = await publisher.update(initial.kcId, {
      paranetId: PARANET,
      quads: [q(ENTITY, 'http://schema.org/name', '"NewName"')],
    });

    expect(updated.merkleRoot).not.toEqual(initial.merkleRoot);

    // Verify old triples were replaced
    const result = await store.query(
      `SELECT ?name WHERE { GRAPH <${GRAPH}> { <${ENTITY}> <http://schema.org/name> ?name } }`,
    );
    if (result.type === 'bindings') {
      expect(result.bindings).toHaveLength(1);
      expect(result.bindings[0]['name']).toContain('NewName');
    }
  });

  it('emits KC_PUBLISHED event', async () => {
    let emitted = false;
    eventBus.on('kc:published', () => {
      emitted = true;
    });

    await publisher.publish({
      paranetId: PARANET,
      quads: [q(ENTITY, 'http://schema.org/name', '"Bot"')],
    });

    expect(emitted).toBe(true);
  });
});
