import { describe, it, expect } from 'vitest';
import type { DKGNode } from '../src/node.js';
import type { ConnectionInfo } from '../src/types.js';
import { DKGEvent, TypedEventBus } from '../src/event-bus.js';
import { ProtocolRouter } from '../src/protocol-router.js';
import { GossipSubManager } from '../src/gossipsub-manager.js';
import { PeerDiscoveryManager } from '../src/discovery.js';

type ProtocolHandler = (data: Uint8Array, remotePeerId: string) => Promise<Uint8Array>;
type PubsubHandler = (topic: string, data: Uint8Array, from: string) => void;

class MockProtocolNode {
  handlers = new Map<string, ProtocolHandler>();
  unhandled: string[] = [];
  sendCalls: Array<{ peerId: string; protocolId: string; timeoutMs: number }> = [];

  handleProtocol(protocolId: string, handler: ProtocolHandler): void {
    this.handlers.set(protocolId, handler);
  }

  unhandleProtocol(protocolId: string): void {
    this.unhandled.push(protocolId);
    this.handlers.delete(protocolId);
  }

  async sendProtocol(
    peerId: string,
    protocolId: string,
    _data: Uint8Array,
    timeoutMs = 10_000,
  ): Promise<Uint8Array> {
    this.sendCalls.push({ peerId, protocolId, timeoutMs });
    return new TextEncoder().encode('send-ok');
  }
}

class MockPubsubNode {
  private handlers = new Set<PubsubHandler>();
  private topics = new Set<string>();
  published: Array<{ topic: string; body: string }> = [];

  onPubsubMessage(handler: PubsubHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  subscribeTopic(topic: string): void {
    this.topics.add(topic);
  }

  unsubscribeTopic(topic: string): void {
    this.topics.delete(topic);
  }

  async publishTopic(topic: string, data: Uint8Array): Promise<void> {
    this.published.push({ topic, body: new TextDecoder().decode(data) });
  }

  getSubscribedTopics(): string[] {
    return [...this.topics];
  }

  emitMessage(topic: string, body: string, from = 'peer-x'): void {
    const payload = new TextEncoder().encode(body);
    for (const handler of this.handlers) {
      handler(topic, payload, from);
    }
  }
}

class MockDiscoveryNode {
  peers: string[] = [];
  connections: ConnectionInfo[] = [];

  private readonly onConnectHandlers = new Set<(peerId: string) => void>();
  private readonly onDisconnectHandlers = new Set<(peerId: string) => void>();
  private readonly onConnectionOpenHandlers = new Set<(info: ConnectionInfo) => void>();
  private readonly onConnectionCloseHandlers = new Set<(info: ConnectionInfo) => void>();

  onPeerConnect(handler: (peerId: string) => void): () => void {
    this.onConnectHandlers.add(handler);
    return () => this.onConnectHandlers.delete(handler);
  }

  onPeerDisconnect(handler: (peerId: string) => void): () => void {
    this.onDisconnectHandlers.add(handler);
    return () => this.onDisconnectHandlers.delete(handler);
  }

  onConnectionOpen(handler: (info: ConnectionInfo) => void): () => void {
    this.onConnectionOpenHandlers.add(handler);
    return () => this.onConnectionOpenHandlers.delete(handler);
  }

  onConnectionClose(handler: (info: ConnectionInfo) => void): () => void {
    this.onConnectionCloseHandlers.add(handler);
    return () => this.onConnectionCloseHandlers.delete(handler);
  }

  getPeers(): string[] {
    return [...this.peers];
  }

  getConnections(): ConnectionInfo[] {
    return [...this.connections];
  }

  emitPeerConnect(peerId: string): void {
    for (const handler of this.onConnectHandlers) {
      handler(peerId);
    }
  }

  emitPeerDisconnect(peerId: string): void {
    for (const handler of this.onDisconnectHandlers) {
      handler(peerId);
    }
  }

  emitConnectionOpen(info: ConnectionInfo): void {
    for (const handler of this.onConnectionOpenHandlers) {
      handler(info);
    }
  }

  emitConnectionClose(info: ConnectionInfo): void {
    for (const handler of this.onConnectionCloseHandlers) {
      handler(info);
    }
  }
}

describe('ProtocolRouter with mock provider node', () => {
  it('registers handlers and sends via provider-neutral methods', async () => {
    const mock = new MockProtocolNode();
    const router = new ProtocolRouter(mock as unknown as DKGNode);
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    router.register('/mock/echo/1.0.0', async (data, peer) => {
      return enc.encode(`${peer.toString()}:${dec.decode(data)}`);
    });

    const registered = mock.handlers.get('/mock/echo/1.0.0');
    expect(registered).toBeDefined();

    const response = await registered!(enc.encode('hello'), 'peer-123');
    expect(dec.decode(response)).toBe('peer-123:hello');

    const outbound = await router.send('peer-xyz', '/mock/echo/1.0.0', enc.encode('ping'), 4321);
    expect(dec.decode(outbound)).toBe('send-ok');
    expect(mock.sendCalls).toHaveLength(1);
    expect(mock.sendCalls[0]).toEqual({
      peerId: 'peer-xyz',
      protocolId: '/mock/echo/1.0.0',
      timeoutMs: 4321,
    });

    router.unregister('/mock/echo/1.0.0');
    expect(mock.unhandled).toContain('/mock/echo/1.0.0');
  });
});

describe('GossipSubManager with mock provider node', () => {
  it('routes subscribe, publish, and inbound messages through abstraction', async () => {
    const mock = new MockPubsubNode();
    const bus = new TypedEventBus();
    const gossip = new GossipSubManager(mock as unknown as DKGNode, bus);

    const busEvents: Array<{ topic: string; from: string }> = [];
    bus.on(DKGEvent.GOSSIP_MESSAGE, (data) => {
      const msg = data as { topic: string; from: string };
      busEvents.push({ topic: msg.topic, from: msg.from });
    });

    const handled: Array<{ topic: string; body: string; from: string }> = [];
    gossip.onMessage('dkg/mock/topic', (topic, data, from) => {
      handled.push({ topic, body: new TextDecoder().decode(data), from });
    });

    gossip.subscribe('dkg/mock/topic');
    expect(gossip.subscribedTopics).toContain('dkg/mock/topic');

    await gossip.publish('dkg/mock/topic', new TextEncoder().encode('outbound'));
    expect(mock.published).toEqual([{ topic: 'dkg/mock/topic', body: 'outbound' }]);

    mock.emitMessage('dkg/mock/topic', 'inbound', 'peer-a');
    expect(handled).toEqual([
      { topic: 'dkg/mock/topic', body: 'inbound', from: 'peer-a' },
    ]);
    expect(busEvents).toEqual([
      { topic: 'dkg/mock/topic', from: 'peer-a' },
    ]);

    gossip.unsubscribe('dkg/mock/topic');
    expect(gossip.subscribedTopics).not.toContain('dkg/mock/topic');
  });
});

describe('PeerDiscoveryManager with mock provider node', () => {
  it('emits peer and connection events and computes connection summary', async () => {
    const mock = new MockDiscoveryNode();
    mock.peers = ['peer-a', 'peer-b'];
    mock.connections = [
      {
        peerId: 'peer-a',
        remoteAddr: '/ip4/127.0.0.1/tcp/1000/p2p/peer-a',
        transport: 'direct',
        direction: 'outbound',
        openedAt: Date.now() - 1000,
      },
      {
        peerId: 'peer-b',
        remoteAddr: '/ip4/127.0.0.1/tcp/1001/p2p-circuit/p2p/peer-b',
        transport: 'relayed',
        direction: 'inbound',
        openedAt: Date.now() - 500,
      },
    ];

    const bus = new TypedEventBus();
    const discovery = new PeerDiscoveryManager(mock as unknown as DKGNode, bus);

    const seen: string[] = [];
    bus.on(DKGEvent.PEER_CONNECTED, (data) => {
      seen.push(`connect:${(data as { peerId: string }).peerId}`);
    });
    bus.on(DKGEvent.PEER_DISCONNECTED, (data) => {
      seen.push(`disconnect:${(data as { peerId: string }).peerId}`);
    });
    bus.on(DKGEvent.CONNECTION_OPEN, (data) => {
      seen.push(`open:${(data as ConnectionInfo).peerId}`);
    });
    bus.on(DKGEvent.CONNECTION_CLOSE, (data) => {
      seen.push(`close:${(data as ConnectionInfo).peerId}`);
    });

    mock.emitPeerConnect('peer-c');
    mock.emitPeerDisconnect('peer-d');
    mock.emitConnectionOpen(mock.connections[0]);
    mock.emitConnectionClose(mock.connections[1]);

    expect(seen).toEqual([
      'connect:peer-c',
      'disconnect:peer-d',
      'open:peer-a',
      'close:peer-b',
    ]);

    const peers = await discovery.getPeers();
    expect(peers).toEqual(['peer-a', 'peer-b']);

    const conns = await discovery.getConnections();
    expect(conns).toHaveLength(2);

    const summary = await discovery.getConnectionSummary();
    expect(summary.total).toBe(2);
    expect(summary.direct).toBe(1);
    expect(summary.relayed).toBe(1);
  });
});
