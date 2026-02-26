import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DashboardDB } from '../src/db.js';
import { OperationTracker } from '../src/operation-tracker.js';
import type { OperationContext } from '@dkg/core';

let db: DashboardDB;
let dir: string;
let tracker: OperationTracker;

function ctx(name: string, id: string): OperationContext {
  return { operationName: name as any, operationId: id };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dkg-tracker-test-'));
  db = new DashboardDB({ dataDir: dir });
  tracker = new OperationTracker(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('OperationTracker', () => {
  it('tracks start → complete lifecycle', () => {
    const c = ctx('publish', 'op-1');
    tracker.start(c, { peerId: 'peer-abc', paranetId: 'testing' });

    let op = db.getOperation('op-1').operation;
    expect(op).toBeDefined();
    expect(op!.status).toBe('in_progress');
    expect(op!.peer_id).toBe('peer-abc');
    expect(op!.paranet_id).toBe('testing');

    tracker.complete(c, { tripleCount: 50 });

    op = db.getOperation('op-1').operation;
    expect(op!.status).toBe('success');
    expect(op!.triple_count).toBe(50);
    expect(op!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('tracks start → fail lifecycle', () => {
    const c = ctx('sync', 'op-2');
    tracker.start(c);
    tracker.fail(c, new Error('timeout'));

    const op = db.getOperation('op-2').operation;
    expect(op!.status).toBe('error');
    expect(op!.error_message).toBe('timeout');
  });

  it('handles fail with non-Error objects', () => {
    const c = ctx('query', 'op-3');
    tracker.start(c);
    tracker.fail(c, 'string error');

    const op = db.getOperation('op-3').operation;
    expect(op!.error_message).toBe('string error');
  });

  it('stores details as JSON', () => {
    const c = ctx('publish', 'op-4');
    tracker.start(c, { details: { quads: 100, paranet: 'testing' } });

    const op = db.getOperation('op-4').operation;
    const details = JSON.parse(op!.details!);
    expect(details.quads).toBe(100);
  });

  it('is a no-op when db is null', () => {
    const nullTracker = new OperationTracker(null);
    const c = ctx('publish', 'op-5');

    // These should not throw
    nullTracker.start(c);
    nullTracker.complete(c);
    nullTracker.fail(c, new Error('test'));
  });

  it('never throws even if DB is broken', () => {
    const c = ctx('publish', 'op-6');
    tracker.start(c);
    db.close();

    // Should silently catch the error, not throw
    expect(() => tracker.complete(c)).not.toThrow();
  });
});
