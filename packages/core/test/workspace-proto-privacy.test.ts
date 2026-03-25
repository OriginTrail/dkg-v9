import { describe, it, expect } from 'vitest';
import {
  encodeWorkspacePublishRequest,
  decodeWorkspacePublishRequest,
} from '../src/index.js';

describe('Protobuf: WorkspacePublishRequest accessPolicy/allowedPeers (fields 9/10)', () => {
  const BASE_MSG = {
    paranetId: 'test-privacy',
    nquads: new TextEncoder().encode('<urn:e> <http://schema.org/name> "Test" .'),
    manifest: [{ rootEntity: 'urn:e', privateTripleCount: 0 }],
    publisherPeerId: '12D3KooWTest',
    workspaceOperationId: 'ws-priv-001',
    timestampMs: Date.now(),
  };

  it('round-trips accessPolicy and allowedPeers', () => {
    const original = {
      ...BASE_MSG,
      accessPolicy: 'allowList',
      allowedPeers: ['peerA', 'peerB', 'peerC'],
    };
    const decoded = decodeWorkspacePublishRequest(encodeWorkspacePublishRequest(original));
    expect(decoded.accessPolicy).toBe('allowList');
    expect(decoded.allowedPeers).toEqual(['peerA', 'peerB', 'peerC']);
  });

  it('round-trips accessPolicy: "ownerOnly" with no allowedPeers', () => {
    const original = {
      ...BASE_MSG,
      accessPolicy: 'ownerOnly',
    };
    const decoded = decodeWorkspacePublishRequest(encodeWorkspacePublishRequest(original));
    expect(decoded.accessPolicy).toBe('ownerOnly');
    expect(decoded.allowedPeers ?? []).toEqual([]);
  });

  it('round-trips accessPolicy: "public" with no allowedPeers', () => {
    const original = {
      ...BASE_MSG,
      accessPolicy: 'public',
    };
    const decoded = decodeWorkspacePublishRequest(encodeWorkspacePublishRequest(original));
    expect(decoded.accessPolicy).toBe('public');
    expect(decoded.allowedPeers ?? []).toEqual([]);
  });

  it('encodes without accessPolicy — decode returns empty/undefined (backward compat)', () => {
    const original = { ...BASE_MSG };
    const decoded = decodeWorkspacePublishRequest(encodeWorkspacePublishRequest(original));
    // Protobuf default for string is empty string, for repeated is empty array
    expect(decoded.accessPolicy || undefined).toBeUndefined();
    expect(decoded.allowedPeers ?? []).toEqual([]);
  });

  it('decodes old message format (no fields 9/10) without error', () => {
    // Simulate a message from a pre-privacy-model node by encoding without the new fields
    const oldFormatMsg = {
      paranetId: 'legacy-paranet',
      nquads: new TextEncoder().encode('<urn:old> <http://schema.org/name> "Legacy" .'),
      manifest: [{ rootEntity: 'urn:old', privateTripleCount: 0 }],
      publisherPeerId: '12D3KooWOld',
      workspaceOperationId: 'ws-old-001',
      timestampMs: 1700000000000,
    };
    const encoded = encodeWorkspacePublishRequest(oldFormatMsg);
    const decoded = decodeWorkspacePublishRequest(encoded);

    // The message should decode fine with defaults
    expect(decoded.paranetId).toBe('legacy-paranet');
    expect(decoded.publisherPeerId).toBe('12D3KooWOld');
    expect(decoded.accessPolicy || undefined).toBeUndefined();
    expect(decoded.allowedPeers ?? []).toEqual([]);
  });

  it('preserves other fields alongside accessPolicy/allowedPeers', () => {
    const original = {
      ...BASE_MSG,
      operationId: 'op-uuid-123',
      casConditions: [
        { subject: 'urn:e', predicate: 'http://ex.org/status', expectedValue: '"active"', expectAbsent: false },
      ],
      accessPolicy: 'allowList',
      allowedPeers: ['peerX'],
    };
    const decoded = decodeWorkspacePublishRequest(encodeWorkspacePublishRequest(original));
    expect(decoded.operationId).toBe('op-uuid-123');
    expect(decoded.casConditions).toHaveLength(1);
    expect(decoded.accessPolicy).toBe('allowList');
    expect(decoded.allowedPeers).toEqual(['peerX']);
  });

  it('handles single allowedPeer', () => {
    const original = {
      ...BASE_MSG,
      accessPolicy: 'allowList',
      allowedPeers: ['soloePeer'],
    };
    const decoded = decodeWorkspacePublishRequest(encodeWorkspacePublishRequest(original));
    expect(decoded.allowedPeers).toEqual(['soloePeer']);
  });

  it('handles many allowedPeers', () => {
    const peers = Array.from({ length: 50 }, (_, i) => `peer-${i}`);
    const original = {
      ...BASE_MSG,
      accessPolicy: 'allowList',
      allowedPeers: peers,
    };
    const decoded = decodeWorkspacePublishRequest(encodeWorkspacePublishRequest(original));
    expect(decoded.allowedPeers).toEqual(peers);
  });
});
