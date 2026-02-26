import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DashboardDB } from '../src/db.js';

let db: DashboardDB;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dkg-db-test-'));
  db = new DashboardDB({ dataDir: dir });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('DashboardDB — metric snapshots', () => {
  it('inserts and retrieves the latest snapshot', () => {
    db.insertSnapshot({ ts: 1000, cpu_percent: 42.5, mem_used_bytes: 100, mem_total_bytes: 200, disk_used_bytes: null, disk_total_bytes: null, heap_used_bytes: 50, uptime_seconds: 60, peer_count: 3, direct_peers: 2, relayed_peers: 1, mesh_peers: 3, paranet_count: 1, total_triples: 500, total_kcs: 10, total_kas: 20, store_bytes: 1024, confirmed_kcs: 8, tentative_kcs: 2, rpc_latency_ms: 15, rpc_healthy: 1 });
    db.insertSnapshot({ ts: 2000, cpu_percent: 55.0, mem_used_bytes: 120, mem_total_bytes: 200, disk_used_bytes: null, disk_total_bytes: null, heap_used_bytes: 60, uptime_seconds: 120, peer_count: 5, direct_peers: 3, relayed_peers: 2, mesh_peers: 4, paranet_count: 2, total_triples: 600, total_kcs: 12, total_kas: 24, store_bytes: 2048, confirmed_kcs: 10, tentative_kcs: 2, rpc_latency_ms: 20, rpc_healthy: 1 });

    const latest = db.getLatestSnapshot();
    expect(latest).toBeDefined();
    expect(latest!.ts).toBe(2000);
    expect(latest!.cpu_percent).toBe(55.0);
    expect(latest!.peer_count).toBe(5);
  });

  it('returns undefined when no snapshots exist', () => {
    expect(db.getLatestSnapshot()).toBeUndefined();
  });

  it('retrieves snapshot history within a time range', () => {
    for (let i = 1; i <= 10; i++) {
      db.insertSnapshot({ ts: i * 1000, cpu_percent: i, mem_used_bytes: null, mem_total_bytes: null, disk_used_bytes: null, disk_total_bytes: null, heap_used_bytes: null, uptime_seconds: null, peer_count: null, direct_peers: null, relayed_peers: null, mesh_peers: null, paranet_count: null, total_triples: null, total_kcs: null, total_kas: null, store_bytes: null, confirmed_kcs: null, tentative_kcs: null, rpc_latency_ms: null, rpc_healthy: null });
    }

    const history = db.getSnapshotHistory(3000, 7000);
    expect(history.length).toBe(5);
    expect(history[0].ts).toBe(3000);
    expect(history[4].ts).toBe(7000);
  });

  it('downsamples when exceeding maxPoints', () => {
    for (let i = 1; i <= 100; i++) {
      db.insertSnapshot({ ts: i * 1000, cpu_percent: i, mem_used_bytes: null, mem_total_bytes: null, disk_used_bytes: null, disk_total_bytes: null, heap_used_bytes: null, uptime_seconds: null, peer_count: null, direct_peers: null, relayed_peers: null, mesh_peers: null, paranet_count: null, total_triples: null, total_kcs: null, total_kas: null, store_bytes: null, confirmed_kcs: null, tentative_kcs: null, rpc_latency_ms: null, rpc_healthy: null });
    }

    const sampled = db.getSnapshotHistory(1000, 100000, 10);
    expect(sampled.length).toBeLessThanOrEqual(10);
  });
});

describe('DashboardDB — operations', () => {
  it('inserts, completes, and retrieves an operation', () => {
    db.insertOperation({
      operation_id: 'op-1',
      operation_name: 'publish',
      started_at: 1000,
      peer_id: 'peer-abc',
      paranet_id: 'testing',
    });

    const { operations } = db.getOperations();
    expect(operations).toHaveLength(1);
    expect(operations[0].operation_id).toBe('op-1');
    expect(operations[0].status).toBe('in_progress');

    db.completeOperation({ operation_id: 'op-1', duration_ms: 250, triple_count: 42 });

    const { operation } = db.getOperation('op-1');
    expect(operation).toBeDefined();
    expect(operation!.status).toBe('success');
    expect(operation!.duration_ms).toBe(250);
    expect(operation!.triple_count).toBe(42);
  });

  it('fails an operation with error message', () => {
    db.insertOperation({
      operation_id: 'op-fail',
      operation_name: 'sync',
      started_at: 2000,
    });

    db.failOperation({ operation_id: 'op-fail', duration_ms: 100, error_message: 'connection refused' });

    const { operation } = db.getOperation('op-fail');
    expect(operation!.status).toBe('error');
    expect(operation!.error_message).toBe('connection refused');
  });

  it('filters operations by name and status', () => {
    db.insertOperation({ operation_id: 'a', operation_name: 'publish', started_at: 1000 });
    db.insertOperation({ operation_id: 'b', operation_name: 'query', started_at: 2000 });
    db.insertOperation({ operation_id: 'c', operation_name: 'publish', started_at: 3000 });
    db.completeOperation({ operation_id: 'a', duration_ms: 10 });

    const publishOnly = db.getOperations({ name: 'publish' });
    expect(publishOnly.operations).toHaveLength(2);
    expect(publishOnly.total).toBe(2);

    const successOnly = db.getOperations({ status: 'success' });
    expect(successOnly.operations).toHaveLength(1);
    expect(successOnly.operations[0].operation_id).toBe('a');
  });

  it('returns null/undefined for nonexistent operation', () => {
    const { operation, logs } = db.getOperation('nonexistent');
    expect(operation).toBeFalsy();
    expect(logs).toHaveLength(0);
  });

  it('retrieves associated logs for an operation', () => {
    db.insertOperation({ operation_id: 'op-x', operation_name: 'sync', started_at: 1000 });
    db.insertLog({ ts: 1001, level: 'info', operation_name: 'sync', operation_id: 'op-x', module: 'Agent', message: 'syncing page 1' });
    db.insertLog({ ts: 1002, level: 'info', operation_name: 'sync', operation_id: 'op-x', module: 'Agent', message: 'syncing page 2' });
    db.insertLog({ ts: 1003, level: 'info', operation_name: 'query', operation_id: 'other-op', module: 'Query', message: 'unrelated' });

    const { operation, logs } = db.getOperation('op-x');
    expect(operation).toBeDefined();
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe('syncing page 1');
  });
});

describe('DashboardDB — logs', () => {
  it('inserts and searches logs by level', () => {
    db.insertLog({ ts: 1000, level: 'info', module: 'Agent', message: 'started' });
    db.insertLog({ ts: 2000, level: 'error', module: 'Agent', message: 'something broke' });
    db.insertLog({ ts: 3000, level: 'info', module: 'Publisher', message: 'published' });

    const errors = db.searchLogs({ level: 'error' });
    expect(errors.logs).toHaveLength(1);
    expect(errors.logs[0].message).toBe('something broke');

    const all = db.searchLogs({});
    expect(all.total).toBe(3);
  });

  it('searches logs by operationId', () => {
    db.insertLog({ ts: 1000, level: 'info', operation_id: 'op-1', module: 'A', message: 'hello' });
    db.insertLog({ ts: 2000, level: 'info', operation_id: 'op-2', module: 'A', message: 'world' });

    const result = db.searchLogs({ operationId: 'op-1' });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].message).toBe('hello');
  });

  it('supports full-text search', () => {
    db.insertLog({ ts: 1000, level: 'info', module: 'A', message: 'merkle root verified successfully' });
    db.insertLog({ ts: 2000, level: 'info', module: 'A', message: 'connection established' });
    db.insertLog({ ts: 3000, level: 'error', module: 'A', message: 'merkle root mismatch detected' });

    const result = db.searchLogs({ q: 'merkle' });
    expect(result.total).toBe(2);
    expect(result.logs.every((l: any) => l.message.includes('merkle'))).toBe(true);
  });

  it('filters by time range', () => {
    db.insertLog({ ts: 1000, level: 'info', module: 'A', message: 'early' });
    db.insertLog({ ts: 5000, level: 'info', module: 'A', message: 'middle' });
    db.insertLog({ ts: 9000, level: 'info', module: 'A', message: 'late' });

    const result = db.searchLogs({ from: 4000, to: 6000 });
    expect(result.total).toBe(1);
    expect(result.logs[0].message).toBe('middle');
  });

  it('paginates with limit and offset', () => {
    for (let i = 0; i < 20; i++) {
      db.insertLog({ ts: i * 1000, level: 'info', module: 'A', message: `log-${i}` });
    }

    const page1 = db.searchLogs({ limit: 5, offset: 0 });
    expect(page1.logs).toHaveLength(5);
    expect(page1.total).toBe(20);

    const page2 = db.searchLogs({ limit: 5, offset: 5 });
    expect(page2.logs).toHaveLength(5);
    expect(page2.logs[0].id).not.toBe(page1.logs[0].id);
  });
});

describe('DashboardDB — query history', () => {
  it('records and retrieves query history', () => {
    db.insertQueryHistory({ sparql: 'SELECT ?s WHERE { ?s ?p ?o }', duration_ms: 15, result_count: 42 });
    db.insertQueryHistory({ sparql: 'SELECT * WHERE { ?a ?b ?c }', duration_ms: 8, result_count: 0 });

    const history = db.getQueryHistory();
    expect(history).toHaveLength(2);
    expect(history[0].sparql).toBe('SELECT * WHERE { ?a ?b ?c }');
    expect(history[1].result_count).toBe(42);
  });

  it('records queries that errored', () => {
    db.insertQueryHistory({ sparql: 'INVALID', duration_ms: 1, error: 'parse error' });

    const history = db.getQueryHistory();
    expect(history[0].error).toBe('parse error');
  });
});

describe('DashboardDB — saved queries', () => {
  it('creates, lists, updates, and deletes saved queries', () => {
    const id = db.insertSavedQuery({ name: 'All triples', sparql: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }' });
    expect(id).toBeGreaterThan(0);

    let saved = db.getSavedQueries();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('All triples');

    db.updateSavedQuery(id, { name: 'Everything', description: 'Gets all triples' });
    saved = db.getSavedQueries();
    expect(saved[0].name).toBe('Everything');
    expect(saved[0].description).toBe('Gets all triples');

    db.deleteSavedQuery(id);
    expect(db.getSavedQueries()).toHaveLength(0);
  });
});

describe('DashboardDB — retention', () => {
  it('prunes data older than retention period', () => {
    const db2 = new DashboardDB({ dataDir: dir, retentionDays: 0 });

    db2.insertSnapshot({ ts: Date.now() - 100_000, cpu_percent: 10, mem_used_bytes: null, mem_total_bytes: null, disk_used_bytes: null, disk_total_bytes: null, heap_used_bytes: null, uptime_seconds: null, peer_count: null, direct_peers: null, relayed_peers: null, mesh_peers: null, paranet_count: null, total_triples: null, total_kcs: null, total_kas: null, store_bytes: null, confirmed_kcs: null, tentative_kcs: null, rpc_latency_ms: null, rpc_healthy: null });
    db2.insertLog({ ts: Date.now() - 100_000, level: 'info', module: 'A', message: 'old' });
    db2.insertOperation({ operation_id: 'old-op', operation_name: 'query', started_at: Date.now() - 100_000 });

    db2.prune();

    expect(db2.getLatestSnapshot()).toBeUndefined();
    expect(db2.searchLogs({}).total).toBe(0);
    expect(db2.getOperations().total).toBe(0);

    db2.close();
  });
});

describe('DashboardDB — schema idempotency', () => {
  it('can be opened twice on the same directory without error', () => {
    db.close();
    const db2 = new DashboardDB({ dataDir: dir });
    db2.insertLog({ ts: 1, level: 'info', module: 'Test', message: 'ok' });
    expect(db2.searchLogs({}).total).toBe(1);
    db2.close();
    db = new DashboardDB({ dataDir: dir });
  });
});
