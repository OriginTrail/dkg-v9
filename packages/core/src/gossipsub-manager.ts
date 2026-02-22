import type { DKGNode } from './node.js';
import type { EventBus } from './types.js';
import { DKGEvent } from './event-bus.js';

export type GossipMessageHandler = (
  topic: string,
  data: Uint8Array,
  from: string,
) => void;

export class GossipSubManager {
  private readonly node: DKGNode;
  private readonly eventBus: EventBus;
  private topicHandlers = new Map<string, Set<GossipMessageHandler>>();

  constructor(node: DKGNode, eventBus: EventBus) {
    this.node = node;
    this.eventBus = eventBus;
    this.setupListener();
  }

  private setupListener(): void {
    const pubsub = this.node.libp2p.services.pubsub;
    pubsub.addEventListener('message', (evt) => {
      const msg = evt.detail;
      const topic = msg.topic;
      const data =
        msg.data instanceof Uint8Array ? msg.data : new Uint8Array(0);
      const from = 'from' in msg ? String(msg.from) : 'unknown';

      this.eventBus.emit(DKGEvent.GOSSIP_MESSAGE, { topic, data, from });

      const handlers = this.topicHandlers.get(topic);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(topic, data, from);
          } catch {
            // don't let one handler crash the loop
          }
        }
      }
    });
  }

  subscribe(topic: string): void {
    this.node.libp2p.services.pubsub.subscribe(topic);
  }

  unsubscribe(topic: string): void {
    this.node.libp2p.services.pubsub.unsubscribe(topic);
    this.topicHandlers.delete(topic);
  }

  async publish(topic: string, data: Uint8Array): Promise<void> {
    await this.node.libp2p.services.pubsub.publish(topic, data);
  }

  onMessage(topic: string, handler: GossipMessageHandler): void {
    let handlers = this.topicHandlers.get(topic);
    if (!handlers) {
      handlers = new Set();
      this.topicHandlers.set(topic, handlers);
    }
    handlers.add(handler);
  }

  offMessage(topic: string, handler: GossipMessageHandler): void {
    const handlers = this.topicHandlers.get(topic);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) this.topicHandlers.delete(topic);
  }

  get subscribedTopics(): string[] {
    return this.node.libp2p.services.pubsub.getTopics();
  }
}
