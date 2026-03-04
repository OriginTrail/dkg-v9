import { describe, it, expect } from 'vitest';
import { MockChainAdapter } from '../src/mock-adapter.js';

describe('Permanent Publishing (MockChainAdapter)', () => {
  it('publishes knowledge assets permanently', async () => {
    const adapter = new MockChainAdapter();
    const merkleRoot = new Uint8Array(32);
    merkleRoot[0] = 0xab;

    const result = await adapter.publishKnowledgeAssetsPermanent({
      kaCount: 3,
      publisherNodeIdentityId: 1n,
      merkleRoot,
      publicByteSize: 1024n,
      tokenAmount: 100_000n,
      publisherSignature: { r: new Uint8Array(32), vs: new Uint8Array(32) },
      receiverSignatures: [
        { identityId: 1n, r: new Uint8Array(32), vs: new Uint8Array(32) },
      ],
    });

    expect(result.batchId).toBe(1n);
    expect(result.startKAId).toBe(1n);
    expect(result.endKAId).toBe(3n);
    expect(result.publisherAddress).toBeDefined();
  });

  it('creates events with isPermanent flag', async () => {
    const adapter = new MockChainAdapter();

    await adapter.publishKnowledgeAssetsPermanent({
      kaCount: 1,
      publisherNodeIdentityId: 1n,
      merkleRoot: new Uint8Array(32),
      publicByteSize: 512n,
      tokenAmount: 50_000n,
      publisherSignature: { r: new Uint8Array(32), vs: new Uint8Array(32) },
      receiverSignatures: [
        { identityId: 1n, r: new Uint8Array(32), vs: new Uint8Array(32) },
      ],
    });

    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    for await (const e of adapter.listenForEvents({
      eventTypes: ['KnowledgeBatchCreated'],
    })) {
      events.push(e);
    }

    const batchEvent = events.find((e) => e.data.isPermanent === true);
    expect(batchEvent).toBeDefined();
    expect(batchEvent!.data.kaCount).toBe(1);
  });

  it('permanent and regular publishes coexist', async () => {
    const adapter = new MockChainAdapter();

    // Regular publish
    const regular = await adapter.publishKnowledgeAssets({
      kaCount: 2,
      publisherNodeIdentityId: 1n,
      merkleRoot: new Uint8Array(32),
      publicByteSize: 256n,
      epochs: 1,
      tokenAmount: 1n,
      publisherSignature: { r: new Uint8Array(32), vs: new Uint8Array(32) },
      receiverSignatures: [
        { identityId: 1n, r: new Uint8Array(32), vs: new Uint8Array(32) },
      ],
    });

    // Permanent publish
    const permanent = await adapter.publishKnowledgeAssetsPermanent({
      kaCount: 2,
      publisherNodeIdentityId: 1n,
      merkleRoot: new Uint8Array(32),
      publicByteSize: 256n,
      tokenAmount: 1n,
      publisherSignature: { r: new Uint8Array(32), vs: new Uint8Array(32) },
      receiverSignatures: [
        { identityId: 1n, r: new Uint8Array(32), vs: new Uint8Array(32) },
      ],
    });

    expect(regular.batchId).not.toBe(permanent.batchId);
    expect(regular.startKAId).toBe(1n);
    expect(permanent.startKAId).toBe(3n); // next range after regular
  });
});
