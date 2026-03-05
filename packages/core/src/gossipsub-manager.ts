import type { DKGNode } from './node.js';
import type { EventBus } from './types.js';
import { DKGEvent } from './event-bus.js';
import { withRetry } from './retry.js';

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
    this.node.onPubsubMessage((topic, data, from) => {

      this.eventBus.emit(DKGEvent.GOSSIP_MESSAGE, { topic, data, from });

      const handlers = this.topicHandlers.get(topic);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(topic, data, from);
          } catch (err) {
            console.error(`[GossipSub] handler error on topic "${topic}":`, err instanceof Error ? err.message : err);
          }
        }
      }
    });
  }

  subscribe(topic: string): void {
    this.node.subscribeTopic(topic);
  }

  unsubscribe(topic: string): void {
    this.node.unsubscribeTopic(topic);
    this.topicHandlers.delete(topic);
  }

  async publish(topic: string, data: Uint8Array): Promise<void> {
    await withRetry(
      () => this.node.publishTopic(topic, data),
      {
        maxAttempts: 3,
        baseDelayMs: 500,
        onRetry: (attempt, delay) => {
          console.warn(`[GossipSub] publish retry ${attempt}/3 on topic "${topic}" (delay ${Math.round(delay)}ms)`);
        },
      },
    );
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
    return this.node.getSubscribedTopics();
  }
}
