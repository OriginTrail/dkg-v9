import type { GraphEventType, GraphEventMap, GraphEventHandler } from './types.js';

/**
 * Typed event emitter for graph visualization events.
 */
export class GraphEventEmitter {
  private _handlers = new Map<GraphEventType, Set<GraphEventHandler<GraphEventType>>>();

  /** Subscribe to an event */
  on<T extends GraphEventType>(event: T, handler: GraphEventHandler<T>): () => void {
    let set = this._handlers.get(event);
    if (!set) {
      set = new Set();
      this._handlers.set(event, set);
    }
    set.add(handler as GraphEventHandler<GraphEventType>);

    // Return unsubscribe function
    return () => {
      set!.delete(handler as GraphEventHandler<GraphEventType>);
    };
  }

  /** Unsubscribe from an event */
  off<T extends GraphEventType>(event: T, handler: GraphEventHandler<T>): void {
    const set = this._handlers.get(event);
    if (set) {
      set.delete(handler as GraphEventHandler<GraphEventType>);
    }
  }

  /** Emit an event to all registered handlers */
  emit<T extends GraphEventType>(event: T, data: GraphEventMap[T]): void {
    const set = this._handlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          (handler as GraphEventHandler<T>)(data);
        } catch (err) {
          console.error(`[dkg-graph-viz] Error in ${event} handler:`, err);
        }
      }
    }
  }

  /** Remove all handlers for an event, or all handlers if no event specified */
  removeAll(event?: GraphEventType): void {
    if (event) {
      this._handlers.delete(event);
    } else {
      this._handlers.clear();
    }
  }
}
