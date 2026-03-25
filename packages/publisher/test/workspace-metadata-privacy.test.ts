import { describe, it, expect } from 'vitest';
import {
  generateWorkspaceMetadata,
  generateKCMetadata,
  type WorkspaceMetadata,
  type KCMetadata,
} from '../src/metadata.js';

const DKG = 'http://dkg.io/ontology/';
const PARANET = 'privacy-test';
const WS_META_GRAPH = `did:dkg:paranet:${PARANET}/_workspace_meta`;
const META_GRAPH = `did:dkg:paranet:${PARANET}/_meta`;

function makeWsMeta(overrides?: Partial<WorkspaceMetadata>): WorkspaceMetadata {
  return {
    workspaceOperationId: 'ws-priv-001',
    paranetId: PARANET,
    rootEntities: ['urn:entity:1'],
    publisherPeerId: '12D3KooWTest',
    timestamp: new Date('2026-03-01T00:00:00Z'),
    ...overrides,
  };
}

describe('generateWorkspaceMetadata — access policy triples', () => {
  it('accessPolicy: "ownerOnly" → emits dkg:accessPolicy quad', () => {
    const quads = generateWorkspaceMetadata(makeWsMeta({ accessPolicy: 'ownerOnly' }), WS_META_GRAPH);
    const policyQuad = quads.find(q => q.predicate === `${DKG}accessPolicy`);
    expect(policyQuad).toBeDefined();
    expect(policyQuad!.object).toBe('"ownerOnly"');
    expect(policyQuad!.graph).toBe(WS_META_GRAPH);
  });

  it('accessPolicy: "allowList" → emits dkg:accessPolicy quad', () => {
    const quads = generateWorkspaceMetadata(makeWsMeta({ accessPolicy: 'allowList' }), WS_META_GRAPH);
    const policyQuad = quads.find(q => q.predicate === `${DKG}accessPolicy`);
    expect(policyQuad).toBeDefined();
    expect(policyQuad!.object).toBe('"allowList"');
  });

  it('accessPolicy: "allowList" + allowedPeers → emits dkg:allowedPeer quads', () => {
    const quads = generateWorkspaceMetadata(
      makeWsMeta({ accessPolicy: 'allowList', allowedPeers: ['peerA', 'peerB'] }),
      WS_META_GRAPH,
    );
    const peerQuads = quads.filter(q => q.predicate === `${DKG}allowedPeer`);
    expect(peerQuads).toHaveLength(2);
    const peerValues = peerQuads.map(q => q.object);
    expect(peerValues).toContain('"peerA"');
    expect(peerValues).toContain('"peerB"');
  });

  it('accessPolicy: "public" → does NOT emit dkg:accessPolicy quad (backward compat)', () => {
    const quads = generateWorkspaceMetadata(makeWsMeta({ accessPolicy: 'public' }), WS_META_GRAPH);
    const policyQuad = quads.find(q => q.predicate === `${DKG}accessPolicy`);
    expect(policyQuad).toBeUndefined();
  });

  it('no accessPolicy → does NOT emit dkg:accessPolicy quad (backward compat)', () => {
    const quads = generateWorkspaceMetadata(makeWsMeta(), WS_META_GRAPH);
    const policyQuad = quads.find(q => q.predicate === `${DKG}accessPolicy`);
    expect(policyQuad).toBeUndefined();
  });

  it('no accessPolicy, no allowedPeers → no access-related quads', () => {
    const quads = generateWorkspaceMetadata(makeWsMeta(), WS_META_GRAPH);
    const accessQuads = quads.filter(
      q => q.predicate === `${DKG}accessPolicy` || q.predicate === `${DKG}allowedPeer`,
    );
    expect(accessQuads).toHaveLength(0);
  });

  it('allowedPeers with empty array → no dkg:allowedPeer quads', () => {
    const quads = generateWorkspaceMetadata(
      makeWsMeta({ accessPolicy: 'allowList', allowedPeers: [] }),
      WS_META_GRAPH,
    );
    const peerQuads = quads.filter(q => q.predicate === `${DKG}allowedPeer`);
    expect(peerQuads).toHaveLength(0);
  });

  it('ownerOnly with allowedPeers → emits both policy and peer quads', () => {
    // This is technically inconsistent but the metadata layer shouldn't block it
    const quads = generateWorkspaceMetadata(
      makeWsMeta({ accessPolicy: 'ownerOnly', allowedPeers: ['peer1'] }),
      WS_META_GRAPH,
    );
    const policyQuad = quads.find(q => q.predicate === `${DKG}accessPolicy`);
    expect(policyQuad).toBeDefined();
    expect(policyQuad!.object).toBe('"ownerOnly"');
    const peerQuads = quads.filter(q => q.predicate === `${DKG}allowedPeer`);
    expect(peerQuads).toHaveLength(1);
  });
});

describe('generateKCMetadata — access policy triples', () => {
  function makeKCMeta(overrides?: Partial<KCMetadata>): KCMetadata {
    return {
      ual: 'did:dkg:kc:priv-001',
      paranetId: PARANET,
      merkleRoot: new Uint8Array([0xab, 0xcd]),
      kaCount: 1,
      publisherPeerId: '12D3KooWTest',
      timestamp: new Date('2026-03-01T00:00:00Z'),
      ...overrides,
    };
  }

  it('always emits dkg:accessPolicy (defaults to "public")', () => {
    const quads = generateKCMetadata(makeKCMeta(), []);
    const policyQuad = quads.find(q => q.predicate === `${DKG}accessPolicy`);
    expect(policyQuad).toBeDefined();
    expect(policyQuad!.object).toBe('"public"');
  });

  it('accessPolicy: "ownerOnly" emits correct value', () => {
    const quads = generateKCMetadata(makeKCMeta({ accessPolicy: 'ownerOnly' }), []);
    const policyQuad = quads.find(q => q.predicate === `${DKG}accessPolicy`);
    expect(policyQuad).toBeDefined();
    expect(policyQuad!.object).toBe('"ownerOnly"');
  });

  it('accessPolicy: "allowList" + allowedPeers emits both', () => {
    const quads = generateKCMetadata(
      makeKCMeta({ accessPolicy: 'allowList', allowedPeers: ['p1', 'p2'] }),
      [],
    );
    const policyQuad = quads.find(q => q.predicate === `${DKG}accessPolicy`);
    expect(policyQuad!.object).toBe('"allowList"');
    const peerQuads = quads.filter(q => q.predicate === `${DKG}allowedPeer`);
    expect(peerQuads).toHaveLength(2);
  });
});
