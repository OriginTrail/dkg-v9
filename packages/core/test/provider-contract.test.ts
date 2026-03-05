import { describe, it, expect, afterEach } from 'vitest';
import { DKGNode } from '../src/node.js';
import { paranetPublishTopic } from '../src/constants.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectNodes(a: DKGNode, b: DKGNode): Promise<void> {
  await a.dial(b.multiaddrs[0]);
  await sleep(600);
}

describe('Transport Provider Contract (libp2p backend)', () => {
  const nodes: DKGNode[] = [];

  afterEach(async () => {
    for (const node of nodes) {
      try {
        await node.stop();
      } catch {
        // best-effort cleanup
      }
    }
    nodes.length = 0;
  });

  it('supports protocol request/response via provider-neutral APIs', async () => {
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

    const protocolId = '/test/provider-contract/echo/1.0.0';
    nodeB.handleProtocol(protocolId, async (data) => data);

    await connectNodes(nodeA, nodeB);

    const request = new TextEncoder().encode('provider-contract');
    const response = await nodeA.sendProtocol(nodeB.peerId, protocolId, request);

    expect(new TextDecoder().decode(response)).toBe('provider-contract');
    nodeB.unhandleProtocol(protocolId);
  }, 15000);

  it('supports pubsub subscribe/publish via provider-neutral APIs', async () => {
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

    const topic = paranetPublishTopic('provider-contract');
    const received: string[] = [];
    const stopListening = nodeB.onPubsubMessage((incomingTopic, data) => {
      if (incomingTopic === topic) {
        received.push(new TextDecoder().decode(data));
      }
    });

    nodeA.subscribeTopic(topic);
    nodeB.subscribeTopic(topic);
    await connectNodes(nodeA, nodeB);

    // Allow GossipSub mesh to form.
    await sleep(2000);

    await nodeA.publishTopic(topic, new TextEncoder().encode('mesh-ok'));
    await sleep(2000);

    expect(received).toContain('mesh-ok');
    stopListening();
  }, 20000);

  it('reports provider-neutral peer and connection metadata', async () => {
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
    await connectNodes(nodeA, nodeB);

    const peers = nodeA.getPeers();
    expect(peers).toContain(nodeB.peerId);

    const connections = nodeA.getConnections();
    expect(connections.length).toBeGreaterThan(0);

    const toNodeB = connections.find((c) => c.peerId === nodeB.peerId);
    expect(toNodeB).toBeDefined();
    expect(toNodeB!.transport).toBe('direct');
    expect(toNodeB!.remoteAddr).toContain('/ip4/127.0.0.1');
    expect(['inbound', 'outbound']).toContain(toNodeB!.direction);
    expect(toNodeB!.openedAt).toBeGreaterThan(0);
  }, 15000);

  it('supports relay-routed protocol traffic using peer address hints', async () => {
    const relay = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
      enableRelayServer: true,
    });
    nodes.push(relay);
    await relay.start();

    const relayAddr = relay.multiaddrs.find((a) => a.includes('/tcp/') && !a.includes('/ws'));
    expect(relayAddr).toBeTruthy();

    const nodeA = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
      relayPeers: [relayAddr!],
    });
    const nodeB = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
      relayPeers: [relayAddr!],
    });
    nodes.push(nodeA, nodeB);

    await nodeA.start();
    await nodeB.start();
    await sleep(2000);

    const protocolId = '/test/provider-contract/relay/1.0.0';
    nodeA.handleProtocol(protocolId, async (data) => {
      return new TextEncoder().encode(`relay:${new TextDecoder().decode(data)}`);
    });

    await nodeB.addPeerAddress(
      nodeA.peerId,
      `${relayAddr}/p2p-circuit/p2p/${nodeA.peerId}`,
      { keepAlive: true },
    );

    const response = await nodeB.sendProtocol(
      nodeA.peerId,
      protocolId,
      new TextEncoder().encode('ping'),
      15000,
    );
    expect(new TextDecoder().decode(response)).toBe('relay:ping');

    const toNodeA = nodeB.getConnections(nodeA.peerId);
    expect(toNodeA.length).toBeGreaterThan(0);
    expect(toNodeA.some((c) => c.transport === 'direct' || c.transport === 'relayed')).toBe(true);

    nodeA.unhandleProtocol(protocolId);
  }, 30000);
});
