import type { StreamHandler as DKGStreamHandler } from './types.js';
import type { DKGNode } from './node.js';

export class ProtocolRouter {
  private readonly node: DKGNode;
  private handlers = new Map<string, DKGStreamHandler>();

  constructor(node: DKGNode) {
    this.node = node;
  }

  register(protocolId: string, handler: DKGStreamHandler): void {
    this.handlers.set(protocolId, handler);
    this.node.handleProtocol(protocolId, async (requestData, remotePeerId) => {
      try {
        const peerId = {
          toString: () => remotePeerId,
          toBytes: () => new TextEncoder().encode(remotePeerId),
        };
        return await handler(requestData, peerId);
      } catch (err) {
        console.error(`[ProtocolRouter] handler error on ${protocolId} from ${remotePeerId.slice(-8)}:`, err instanceof Error ? err.message : err);
        throw err;
      }
    });
  }

  unregister(protocolId: string): void {
    this.handlers.delete(protocolId);
    this.node.unhandleProtocol(protocolId);
  }

  async send(
    peerIdStr: string,
    protocolId: string,
    data: Uint8Array,
    timeoutMs = 10_000,
  ): Promise<Uint8Array> {
    // libp2p internally upgrades relay connections to direct during
    // dialProtocol/newStream (peerStore.merge triggers the connection manager
    // to dial the peer directly, closing the relay and any in-flight streams).
    // We retry up to 3 times with back-off so the direct connection can
    // stabilise before the next attempt.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.node.sendProtocol(peerIdStr, protocolId, data, timeoutMs);
      } catch (err: unknown) {
        lastErr = err;
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        const recoverable = msg.includes('closed') || msg.includes('reset')
          || msg.includes('stream returned in closed state')
          || msg.includes('econnreset') || msg.includes('etimedout')
          || msg.includes('econnrefused') || msg.includes('epipe')
          || msg.includes('aborted') || msg.includes('no valid addresses');
        if (!recoverable || attempt >= 2) throw err;
        const backoff = (attempt + 1) * 500;
        await new Promise(r => setTimeout(r, backoff));
      }
    }
    throw lastErr;
  }
}
