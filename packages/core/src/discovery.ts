import type { DKGNode } from './node.js';
import type { EventBus } from './types.js';
import { DKGEvent } from './event-bus.js';

/**
 * Thin wrapper that connects libp2p peer discovery events to the DKG EventBus.
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
  }

  async getPeers(): Promise<string[]> {
    return this.node.libp2p.getPeers().map((p) => p.toString());
  }

  async getConnections(): Promise<
    Array<{ peerId: string; remoteAddr: string }>
  > {
    return this.node.libp2p.getConnections().map((c) => ({
      peerId: c.remotePeer.toString(),
      remoteAddr: c.remoteAddr.toString(),
    }));
  }
}
