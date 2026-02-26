import type { DKGNode } from './node.js';
import type { ConnectionInfo, ConnectionTransport, EventBus } from './types.js';
import { DKGEvent } from './event-bus.js';

/**
 * Thin wrapper that connects libp2p peer discovery events to the DKG EventBus
 * and exposes typed connection metadata including transport type.
 */
export class PeerDiscoveryManager {
  private readonly node: DKGNode;
  private readonly eventBus: EventBus;

  constructor(node: DKGNode, eventBus: EventBus) {
    this.node = node;
    this.eventBus = eventBus;
    this.setupListeners();
  }

  private setupListeners(): void {
    const libp2p = this.node.libp2p;

    libp2p.addEventListener('peer:connect', (evt) => {
      const peerId = evt.detail.toString();
      this.eventBus.emit(DKGEvent.PEER_CONNECTED, { peerId });
    });

    libp2p.addEventListener('peer:disconnect', (evt) => {
      const peerId = evt.detail.toString();
      this.eventBus.emit(DKGEvent.PEER_DISCONNECTED, { peerId });
    });

    libp2p.addEventListener('connection:open', (evt) => {
      const conn = evt.detail;
      const info = this.connectionToInfo(conn);
      this.eventBus.emit(DKGEvent.CONNECTION_OPEN, info);
    });

    libp2p.addEventListener('connection:close', (evt) => {
      const conn = evt.detail;
      const info = this.connectionToInfo(conn);
      this.eventBus.emit(DKGEvent.CONNECTION_CLOSE, info);
    });
  }

  async getPeers(): Promise<string[]> {
    return this.node.libp2p.getPeers().map((p) => p.toString());
  }

  async getConnections(): Promise<ConnectionInfo[]> {
    return this.node.libp2p.getConnections().map((c) => this.connectionToInfo(c));
  }

  /** Convenience: group connections by transport type. */
  async getConnectionSummary(): Promise<{
    total: number;
    direct: number;
    relayed: number;
    peers: Array<ConnectionInfo>;
  }> {
    const peers = await this.getConnections();
    const direct = peers.filter((p) => p.transport === 'direct').length;
    return { total: peers.length, direct, relayed: peers.length - direct, peers };
  }

  private connectionToInfo(conn: any): ConnectionInfo {
    const addr = conn.remoteAddr?.toString() ?? 'unknown';
    const transport: ConnectionTransport = addr.includes('/p2p-circuit')
      ? 'relayed'
      : 'direct';
    return {
      peerId: conn.remotePeer.toString(),
      remoteAddr: addr,
      transport,
      direction: conn.direction,
      openedAt: conn.timeline?.open ?? Date.now(),
    };
  }
}
