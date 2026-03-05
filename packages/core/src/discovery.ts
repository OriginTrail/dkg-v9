import type { DKGNode } from './node.js';
import type { ConnectionInfo, EventBus } from './types.js';
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
    this.node.onPeerConnect((peerId) => {
      this.eventBus.emit(DKGEvent.PEER_CONNECTED, { peerId });
    });

    this.node.onPeerDisconnect((peerId) => {
      this.eventBus.emit(DKGEvent.PEER_DISCONNECTED, { peerId });
    });

    this.node.onConnectionOpen((info) => {
      this.eventBus.emit(DKGEvent.CONNECTION_OPEN, info);
    });

    this.node.onConnectionClose((info) => {
      this.eventBus.emit(DKGEvent.CONNECTION_CLOSE, info);
    });
  }

  async getPeers(): Promise<string[]> {
    return this.node.getPeers();
  }

  async getConnections(): Promise<ConnectionInfo[]> {
    return this.node.getConnections();
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

}
