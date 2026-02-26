import { describe, it, expect, afterEach } from 'vitest';
import { DKGNode } from '../src/node.js';
import { ProtocolRouter } from '../src/protocol-router.js';
import { PeerDiscoveryManager } from '../src/discovery.js';
import { TypedEventBus } from '../src/event-bus.js';

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

  it('two nodes communicate through a direct connection via relay peer', async () => {
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

    await new Promise(r => setTimeout(r, 1000));

    const relayPeers = relay.libp2p.getPeers().map(p => p.toString());
    expect(relayPeers).toContain(nodeA.peerId);
    expect(relayPeers).toContain(nodeB.peerId);

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

  it('protocol stream through circuit relay upgrades to direct via retry', async () => {
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
    await new Promise(r => setTimeout(r, 2000));

    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const routerA = new ProtocolRouter(nodeA);
    routerA.register('/test/relay-echo/1.0.0', async (data) => {
      return enc.encode(`echo:${dec.decode(data)}`);
    });

    const routerB = new ProtocolRouter(nodeB);

    // Dial through the circuit relay — ProtocolRouter.send will retry after
    // the connection manager upgrades from relay to direct mid-stream.
    const { multiaddr } = await import('@multiformats/multiaddr');
    await nodeB.libp2p.dial(multiaddr(`${relayAddr}/p2p-circuit/p2p/${nodeA.peerId}`));
    await new Promise(r => setTimeout(r, 2000));

    const response = await routerB.send(
      nodeA.peerId,
      '/test/relay-echo/1.0.0',
      enc.encode('via-circuit'),
      15000,
    );
    expect(dec.decode(response)).toBe('echo:via-circuit');
    routerA.unregister('/test/relay-echo/1.0.0');
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

  it('getConnections reports transport type for relay connections', async () => {
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
    await new Promise(r => setTimeout(r, 1000));

    const bus = new TypedEventBus();
    const discovery = new PeerDiscoveryManager(node, bus);
    const conns = await discovery.getConnections();

    expect(conns.length).toBeGreaterThan(0);

    const toRelay = conns.find(c => c.peerId === relay.peerId);
    expect(toRelay).toBeDefined();
    expect(toRelay!.transport).toBe('direct');
    expect(toRelay!.direction).toBeDefined();
    expect(toRelay!.openedAt).toBeGreaterThan(0);
  }, 15000);

  it('getConnectionSummary returns correct totals', async () => {
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
    nodes.push(nodeA);
    await nodeA.start();
    await new Promise(r => setTimeout(r, 1000));

    const bus = new TypedEventBus();
    const discovery = new PeerDiscoveryManager(nodeA, bus);
    const summary = await discovery.getConnectionSummary();

    expect(summary.total).toBeGreaterThan(0);
    expect(summary.direct + summary.relayed).toBe(summary.total);
    expect(summary.peers.length).toBe(summary.total);
  }, 15000);
});
