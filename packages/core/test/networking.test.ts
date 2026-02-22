import { describe, it, expect, afterEach } from 'vitest';
import { DKGNode } from '../src/node.js';
import { ProtocolRouter } from '../src/protocol-router.js';
import { GossipSubManager } from '../src/gossipsub-manager.js';
import { TypedEventBus } from '../src/event-bus.js';
import { multiaddr } from '@multiformats/multiaddr';

async function connectNodes(a: DKGNode, b: DKGNode): Promise<void> {
  const bAddr = b.multiaddrs[0];
  await a.libp2p.dial(multiaddr(bAddr));
  // Wait for identify to complete
  await new Promise((r) => setTimeout(r, 500));
}

describe('DKGNode', () => {
  const nodes: DKGNode[] = [];

  afterEach(async () => {
    for (const n of nodes) {
      await n.stop();
    }
    nodes.length = 0;
  });

  it('starts and stops cleanly', async () => {
    const node = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    nodes.push(node);
    await node.start();
    expect(node.isStarted).toBe(true);
    expect(node.peerId).toBeTruthy();
    expect(node.multiaddrs.length).toBeGreaterThan(0);
    await node.stop();
    expect(node.isStarted).toBe(false);
  });

  it('two nodes connect via explicit dial', async () => {
    const node1 = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    const node2 = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    nodes.push(node1, node2);
    await node1.start();
    await node2.start();

    await connectNodes(node1, node2);

    const peers = node1.libp2p.getPeers().map((p) => p.toString());
    expect(peers).toContain(node2.peerId);
  }, 10000);
});

describe('ProtocolRouter', () => {
  const nodes: DKGNode[] = [];

  afterEach(async () => {
    for (const n of nodes) {
      await n.stop();
    }
    nodes.length = 0;
  });

  it('request-response round trip', async () => {
    const node1 = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    const node2 = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    nodes.push(node1, node2);
    await node1.start();
    await node2.start();

    const router1 = new ProtocolRouter(node1);
    const router2 = new ProtocolRouter(node2);

    const enc = new TextEncoder();
    const dec = new TextDecoder();

    router2.register('/test/echo/1.0.0', async (data) => {
      return enc.encode(`echo:${dec.decode(data)}`);
    });

    await connectNodes(node1, node2);

    const response = await router1.send(
      node2.peerId,
      '/test/echo/1.0.0',
      enc.encode('hello'),
    );
    expect(dec.decode(response)).toBe('echo:hello');
  }, 15000);

  it('handles binary protobuf-like data', async () => {
    const node1 = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    const node2 = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    nodes.push(node1, node2);
    await node1.start();
    await node2.start();

    const router2 = new ProtocolRouter(node2);
    const router1 = new ProtocolRouter(node1);

    router2.register('/test/binary/1.0.0', async (data) => {
      const reversed = new Uint8Array(data).reverse();
      return reversed;
    });

    await connectNodes(node1, node2);

    const input = new Uint8Array([1, 2, 3, 4, 5]);
    const response = await router1.send(
      node2.peerId,
      '/test/binary/1.0.0',
      input,
    );
    expect(Array.from(response)).toEqual([5, 4, 3, 2, 1]);
  }, 15000);
});

describe('GossipSubManager', () => {
  const nodes: DKGNode[] = [];

  afterEach(async () => {
    for (const n of nodes) {
      await n.stop();
    }
    nodes.length = 0;
  });

  it('publishes and receives messages', async () => {
    const node1 = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    const node2 = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
    });
    nodes.push(node1, node2);
    await node1.start();
    await node2.start();

    const bus1 = new TypedEventBus();
    const bus2 = new TypedEventBus();
    const gossip1 = new GossipSubManager(node1, bus1);
    const gossip2 = new GossipSubManager(node2, bus2);

    const topic = 'dkg/paranet/test/publish';
    gossip1.subscribe(topic);
    gossip2.subscribe(topic);

    await connectNodes(node1, node2);

    // Wait for GossipSub mesh to form after connection
    await new Promise((r) => setTimeout(r, 2000));

    const received: Uint8Array[] = [];
    gossip2.onMessage(topic, (_t, data) => {
      received.push(data);
    });

    await gossip1.publish(topic, new TextEncoder().encode('test-msg'));

    // Wait for propagation
    await new Promise((r) => setTimeout(r, 2000));

    expect(received.length).toBe(1);
    expect(new TextDecoder().decode(received[0])).toBe('test-msg');
  }, 20000);
});
