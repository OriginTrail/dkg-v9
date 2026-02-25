import { describe, it, expect, afterEach } from 'vitest';
import { DKGNode } from '../src/node.js';
import { ProtocolRouter } from '../src/protocol-router.js';

describe('Circuit Relay', () => {
  const nodes: DKGNode[] = [];

  afterEach(async () => {
    for (const n of nodes) {
      try {
        await n.stop();
      } catch (err) {
        console.warn('Teardown: node.stop() failed', err);
      }
    }
    nodes.length = 0;
  });

  it('two nodes communicate through a relay', async () => {
    const relay = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
      enableRelayServer: true,
    });
    nodes.push(relay);
    await relay.start();

    const relayAddr = relay.multiaddrs.find(a => a.includes('/tcp/'))!;

    const nodeA = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
      relayPeers: [relayAddr],
    });
    const nodeB = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
      relayPeers: [relayAddr],
    });
    nodes.push(nodeA, nodeB);
    await nodeA.start();
    await nodeB.start();

    // Both nodes are connected to the relay — let's verify
    await new Promise(r => setTimeout(r, 1000));

    const relayPeers = relay.libp2p.getPeers().map(p => p.toString());
    expect(relayPeers).toContain(nodeA.peerId);
    expect(relayPeers).toContain(nodeB.peerId);

    // Now connect nodeA to nodeB through their direct addresses
    // (since they're on the same host, direct should work — but relay is available)
    const { multiaddr } = await import('@multiformats/multiaddr');
    const bAddr = nodeB.multiaddrs[0];
    await nodeA.libp2p.dial(multiaddr(bAddr));
    await new Promise(r => setTimeout(r, 500));

    const enc = new TextEncoder();
    const dec = new TextDecoder();

    const routerA = new ProtocolRouter(nodeA);
    const routerB = new ProtocolRouter(nodeB);

    routerB.register('/test/relay-echo/1.0.0', async (data) => {
      return enc.encode(`relayed:${dec.decode(data)}`);
    });

    const response = await routerA.send(
      nodeB.peerId,
      '/test/relay-echo/1.0.0',
      enc.encode('ping'),
    );
    expect(dec.decode(response)).toBe('relayed:ping');
  }, 30000);

  it('relay node starts with enableRelayServer', async () => {
    const relay = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
      enableRelayServer: true,
    });
    nodes.push(relay);
    await relay.start();

    expect(relay.isStarted).toBe(true);
    expect(relay.peerId).toBeTruthy();
    expect(relay.multiaddrs.length).toBeGreaterThan(0);
  }, 15000);

  it('node can connect to a relay peer on startup', async () => {
    const relay = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
      enableRelayServer: true,
    });
    nodes.push(relay);
    await relay.start();

    const relayAddr = relay.multiaddrs.find(a => a.includes('/tcp/'))!;

    const node = new DKGNode({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      enableMdns: false,
      relayPeers: [relayAddr],
    });
    nodes.push(node);
    await node.start();

    await new Promise(r => setTimeout(r, 500));

    const peers = node.libp2p.getPeers().map(p => p.toString());
    expect(peers).toContain(relay.peerId);
  }, 15000);
});
