import type { OperationContext } from '@dkg/core';
import type { DashboardDB } from './db.js';

/**
 * Records the lifecycle of node operations (publish, query, sync, etc.)
 * in the dashboard SQLite database. If no DB is configured (e.g. in tests),
 * all methods are no-ops.
 */
export class OperationTracker {
  private readonly starts = new Map<string, number>();

  constructor(private readonly db: DashboardDB | null) {}

  start(ctx: OperationContext, meta?: {
    peerId?: string;
    paranetId?: string;
    details?: Record<string, unknown>;
  }): void {
    if (!this.db) return;
    const now = Date.now();
    this.starts.set(ctx.operationId, now);
    try {
      this.db.insertOperation({
        operation_id: ctx.operationId,
        operation_name: ctx.operationName,
        started_at: now,
        peer_id: meta?.peerId,
        paranet_id: meta?.paranetId,
        details: meta?.details ? JSON.stringify(meta.details) : null,
      });
    } catch {
      // Must never break the node
    }
  }

  complete(ctx: OperationContext, meta?: {
    tripleCount?: number;
    details?: Record<string, unknown>;
  }): void {
    if (!this.db) return;
    const startedAt = this.starts.get(ctx.operationId);
    this.starts.delete(ctx.operationId);
    try {
      this.db.completeOperation({
        operation_id: ctx.operationId,
        duration_ms: startedAt ? Date.now() - startedAt : 0,
        triple_count: meta?.tripleCount,
        details: meta?.details ? JSON.stringify(meta.details) : null,
      });
    } catch {
      // Must never break the node
    }
  }

  fail(ctx: OperationContext, err: unknown): void {
    if (!this.db) return;
    const startedAt = this.starts.get(ctx.operationId);
    this.starts.delete(ctx.operationId);
    const message = err instanceof Error ? err.message : String(err);
    try {
      this.db.failOperation({
        operation_id: ctx.operationId,
        duration_ms: startedAt ? Date.now() - startedAt : 0,
        error_message: message,
      });
    } catch {
      // Must never break the node
    }
  }
}
