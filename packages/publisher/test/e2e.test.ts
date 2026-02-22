import { describe, it, expect, afterEach } from 'vitest';
import {
  DKGNode,
  ProtocolRouter,
  TypedEventBus,
  generateEd25519Keypair,
  PROTOCOL_PUBLISH,
  PROTOCOL_ACCESS,
  encodePublishRequest,
  decodePublishAck,
} from '@dkg/core';
import { OxigraphStore, type Quad } from '@dkg/storage';
import { MockChainAdapter } from '@dkg/chain';
import { DKGPublisher } from '../src/dkg-publisher.js';
import { PublishHandler } from '../src/publish-handler.js';
import { AccessHandler } from '../src/access-handler.js';
import { AccessClient } from '../src/access-client.js';
import { DKGQueryEngine } from '@dkg/query';
import { multiaddr } from '@multiformats/multiaddr';

const PARANET = 'agent-skills';
const GRAPH = `did:dkg:paranet:${PARANET}`;
const ENTITY = 'did:dkg:agent:QmImageBot';

function q(s: string, p: string, o: string, g = GRAPH): Quad {
  return { subject: s, predicate: p, object: o, graph: g };
}

describe('End-to-end: Publish → Replicate → Query', () => {
  const nodes: DKGNode[] = [];

  afterEach(async () => {
    for (const n of nodes) {
      await n.stop();
    }
    nodes.length = 0;
  });

  it('publishes on node A, replicates to node B, queries on B', async () => {
    // === Setup Node A (publisher) ===
    const nodeA = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    const nodeB = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    nodes.push(nodeA, nodeB);
    await nodeA.start();
    await nodeB.start();

    // Connect
    await nodeA.libp2p.dial(multiaddr(nodeB.multiaddrs[0]));
    await new Promise((r) => setTimeout(r, 500));

    // Stores
    const storeA = new OxigraphStore();
    const storeB = new OxigraphStore();
    const chainA = new MockChainAdapter();
    const busA = new TypedEventBus();
    const busB = new TypedEventBus();
    const keypairA = await generateEd25519Keypair();
    const keypairB = await generateEd25519Keypair();

    // Publisher on A
    const publisherA = new DKGPublisher({
      store: storeA,
      chain: chainA,
      eventBus: busA,
      keypair: keypairA,
    });

    // Register PublishHandler on B
    const publishHandlerB = new PublishHandler(storeB, busB);
    const routerB = new ProtocolRouter(nodeB);
    routerB.register(PROTOCOL_PUBLISH, publishHandlerB.handler);

    // Router on A for sending
    const routerA = new ProtocolRouter(nodeA);

    // === Step 1: Publish on Node A ===
    const publishResult = await publisherA.publish({
      paranetId: PARANET,
      quads: [
        q(ENTITY, 'http://schema.org/name', '"ImageBot"'),
        q(ENTITY, 'http://schema.org/description', '"AI image analysis agent"'),
        q(ENTITY, 'http://ex.org/offers', `${ENTITY}/.well-known/genid/o1`),
        q(`${ENTITY}/.well-known/genid/o1`, 'http://ex.org/skill', '"ImageAnalysis"'),
      ],
    });

    expect(publishResult.merkleRoot).toHaveLength(32);
    expect(publishResult.kaManifest).toHaveLength(1);

    // === Step 2: Replicate to Node B via protocol ===
    const nquads = [
      `<${ENTITY}> <http://schema.org/name> "ImageBot" <${GRAPH}> .`,
      `<${ENTITY}> <http://schema.org/description> "AI image analysis agent" <${GRAPH}> .`,
      `<${ENTITY}> <http://ex.org/offers> <${ENTITY}/.well-known/genid/o1> <${GRAPH}> .`,
      `<${ENTITY}/.well-known/genid/o1> <http://ex.org/skill> "ImageAnalysis" <${GRAPH}> .`,
    ].join('\n');

    const publishRequest = encodePublishRequest({
      ual: `did:dkg:mock:31337/${publishResult.kcId}`,
      nquads: new TextEncoder().encode(nquads),
      paranetId: PARANET,
      kas: publishResult.kaManifest.map((m) => ({
        tokenId: Number(m.tokenId),
        rootEntity: m.rootEntity,
        privateMerkleRoot: m.privateMerkleRoot ?? new Uint8Array(0),
        privateTripleCount: m.privateTripleCount ?? 0,
      })),
      publisherIdentity: keypairA.publicKey,
    });

    const ackData = await routerA.send(
      nodeB.peerId,
      PROTOCOL_PUBLISH,
      publishRequest,
    );
    const ack = decodePublishAck(ackData);
    expect(ack.accepted).toBe(true);

    // === Step 3: Query on Node B ===
    const engineB = new DKGQueryEngine(storeB);
    const queryResult = await engineB.query(
      'SELECT ?name WHERE { ?s <http://schema.org/name> ?name }',
      { paranetId: PARANET },
    );

    expect(queryResult.bindings).toHaveLength(1);
    expect(queryResult.bindings[0]['name']).toContain('ImageBot');

    // Query for skills
    const skillResult = await engineB.query(
      'SELECT ?skill WHERE { ?s <http://ex.org/skill> ?skill }',
      { paranetId: PARANET },
    );
    expect(skillResult.bindings).toHaveLength(1);
    expect(skillResult.bindings[0]['skill']).toContain('ImageAnalysis');
  }, 20000);

  it('publishes with private triples and accesses them', async () => {
    const nodeA = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    const nodeB = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    nodes.push(nodeA, nodeB);
    await nodeA.start();
    await nodeB.start();

    await nodeB.libp2p.dial(multiaddr(nodeA.multiaddrs[0]));
    await new Promise((r) => setTimeout(r, 500));

    const storeA = new OxigraphStore();
    const chainA = new MockChainAdapter();
    const busA = new TypedEventBus();
    const keypairA = await generateEd25519Keypair();
    const keypairB = await generateEd25519Keypair();

    // Publisher on A (holds private triples)
    const publisherA = new DKGPublisher({
      store: storeA,
      chain: chainA,
      eventBus: busA,
      keypair: keypairA,
    });

    // Publish with mixed public/private triples
    const result = await publisherA.publish({
      paranetId: PARANET,
      quads: [q(ENTITY, 'http://schema.org/name', '"ImageBot"')],
      privateQuads: [
        q(ENTITY, 'http://ex.org/apiKey', '"secret-key-xyz"'),
        q(ENTITY, 'http://ex.org/modelWeights', '"s3://bucket/weights.bin"'),
      ],
    });

    expect(result.kaManifest[0].privateTripleCount).toBe(2);

    // Register access handler on A
    const accessHandler = new AccessHandler(storeA, busA);
    const routerA = new ProtocolRouter(nodeA);
    routerA.register(PROTOCOL_ACCESS, accessHandler.handler);

    // AccessClient on B requests private triples from A
    const routerB = new ProtocolRouter(nodeB);
    const accessClient = new AccessClient(routerB, keypairB, nodeB.peerId);

    const accessResult = await accessClient.requestAccess(
      nodeA.peerId,
      `did:dkg:mock:31337/${result.kcId}/1`,
    );

    expect(accessResult.granted).toBe(true);
    expect(accessResult.quads.length).toBeGreaterThanOrEqual(2);

    const apiKeyTriple = accessResult.quads.find(
      (q) => q.predicate === 'http://ex.org/apiKey',
    );
    expect(apiKeyTriple).toBeDefined();
  }, 20000);
});
