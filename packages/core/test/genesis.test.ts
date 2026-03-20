import { describe, it, expect } from 'vitest';
import {
  getGenesisQuads,
  computeNetworkId,
  getGenesisRaw,
  SYSTEM_PARANETS,
  DKG_ONTOLOGY,
} from '../src/genesis.js';

describe('getGenesisQuads', () => {
  it('returns a non-empty array', () => {
    const quads = getGenesisQuads();
    expect(quads.length).toBeGreaterThan(0);
  });

  it('every quad has subject, predicate, object, and graph fields', () => {
    for (const q of getGenesisQuads()) {
      expect(typeof q.subject).toBe('string');
      expect(typeof q.predicate).toBe('string');
      expect(typeof q.object).toBe('string');
      expect(typeof q.graph).toBe('string');
      expect(q.subject.length).toBeGreaterThan(0);
      expect(q.predicate.length).toBeGreaterThan(0);
      expect(q.object.length).toBeGreaterThan(0);
    }
  });

  it('includes the network definition quad', () => {
    const quads = getGenesisQuads();
    const networkQuad = quads.find(
      q => q.subject === 'did:dkg:network:v9-testnet' &&
           q.predicate.endsWith('type') &&
           q.object.includes('Network'),
    );
    expect(networkQuad).toBeDefined();
  });

  it('includes system paranets (agents and ontology)', () => {
    const quads = getGenesisQuads();
    const subjects = new Set(quads.map(q => q.subject));
    expect(subjects.has('did:dkg:paranet:agents')).toBe(true);
    expect(subjects.has('did:dkg:paranet:ontology')).toBe(true);
  });

  it('includes ontology class definitions', () => {
    const quads = getGenesisQuads();
    const classQuads = quads.filter(
      q => q.predicate === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' &&
           q.object === 'http://www.w3.org/2000/01/rdf-schema#Class',
    );
    expect(classQuads.length).toBeGreaterThan(5);
  });

  it('is deterministic — same result on repeated calls', () => {
    const a = getGenesisQuads();
    const b = getGenesisQuads();
    expect(a).toEqual(b);
  });
});

describe('computeNetworkId', () => {
  it('returns a 64-character hex string (SHA-256)', async () => {
    const id = await computeNetworkId();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same hash on repeated calls', async () => {
    const a = await computeNetworkId();
    const b = await computeNetworkId();
    expect(a).toBe(b);
  });
});

describe('getGenesisRaw', () => {
  it('returns a non-empty TriG string', () => {
    const raw = getGenesisRaw();
    expect(raw.length).toBeGreaterThan(0);
    expect(raw).toContain('@prefix');
    expect(raw).toContain('dkg:Network');
  });
});

describe('SYSTEM_PARANETS', () => {
  it('has AGENTS and ONTOLOGY keys', () => {
    expect(SYSTEM_PARANETS.AGENTS).toBe('agents');
    expect(SYSTEM_PARANETS.ONTOLOGY).toBe('ontology');
  });
});

describe('DKG_ONTOLOGY', () => {
  it('has all expected keys with valid URI values', () => {
    const keys = [
      'RDF_TYPE', 'SCHEMA_NAME', 'SCHEMA_DESCRIPTION',
      'DKG_AGENT', 'DKG_CORE_NODE', 'DKG_EDGE_NODE',
      'DKG_PEER_ID', 'DKG_PUBLIC_KEY', 'DKG_NODE_ROLE',
      'DKG_RELAY_ADDRESS', 'DKG_PARANET', 'DKG_SYSTEM_PARANET',
      'DKG_NETWORK', 'DKG_NETWORK_ID', 'DKG_GENESIS_VERSION',
      'DKG_CCL_POLICY', 'DKG_POLICY_BINDING', 'DKG_POLICY_APPLIES_TO_PARANET',
      'DKG_POLICY_VERSION', 'DKG_POLICY_LANGUAGE', 'DKG_POLICY_FORMAT',
      'DKG_POLICY_HASH', 'DKG_POLICY_BODY', 'DKG_POLICY_STATUS',
      'DKG_POLICY_CONTEXT_TYPE', 'DKG_ACTIVE_POLICY', 'DKG_APPROVED_BY',
      'DKG_APPROVED_AT', 'DKG_CCL_EVALUATION', 'DKG_CCL_RESULT_ENTRY',
      'DKG_EVALUATED_POLICY', 'DKG_FACT_SET_HASH', 'DKG_SCOPE_UAL',
      'DKG_VIEW', 'DKG_SNAPSHOT_ID', 'DKG_RESULT_KIND', 'DKG_RESULT_NAME',
      'DKG_HAS_RESULT', 'DKG_CCL_RESULT_ARG',
      'DKG_HAS_RESULT_ARG', 'DKG_RESULT_ARG_INDEX', 'DKG_RESULT_ARG_VALUE',
    ] as const;

    for (const key of keys) {
      const val = (DKG_ONTOLOGY as Record<string, string>)[key];
      expect(typeof val).toBe('string');
      expect(val.startsWith('http')).toBe(true);
    }
  });
});
