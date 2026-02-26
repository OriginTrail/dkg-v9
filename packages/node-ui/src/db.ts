import Database from 'better-sqlite3';
import { join } from 'node:path';

const SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_DAYS = 90;

export interface DashboardDBOptions {
  /** Directory to store the SQLite database file. */
  dataDir: string;
  /** Days to retain data before pruning. Default: 90 */
  retentionDays?: number;
}

export class DashboardDB {
  readonly db: Database.Database;
  private readonly retentionDays: number;

  constructor(opts: DashboardDBOptions) {
    this.retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const dbPath = join(opts.dataDir, 'node-ui.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
    this.prune();
  }

  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version >= SCHEMA_VERSION) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metric_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        cpu_percent REAL,
        mem_used_bytes INTEGER,
        mem_total_bytes INTEGER,
        disk_used_bytes INTEGER,
        disk_total_bytes INTEGER,
        heap_used_bytes INTEGER,
        uptime_seconds INTEGER,
        peer_count INTEGER,
        direct_peers INTEGER,
        relayed_peers INTEGER,
        mesh_peers INTEGER,
        paranet_count INTEGER,
        total_triples INTEGER,
        total_kcs INTEGER,
        total_kas INTEGER,
        store_bytes INTEGER,
        confirmed_kcs INTEGER,
        tentative_kcs INTEGER,
        rpc_latency_ms INTEGER,
        rpc_healthy INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON metric_snapshots(ts);

      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL,
        operation_name TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        duration_ms INTEGER,
        status TEXT DEFAULT 'in_progress',
        peer_id TEXT,
        paranet_id TEXT,
        triple_count INTEGER,
        error_message TEXT,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ops_operation_id ON operations(operation_id);
      CREATE INDEX IF NOT EXISTS idx_ops_started_at ON operations(started_at);
      CREATE INDEX IF NOT EXISTS idx_ops_name ON operations(operation_name);

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL,
        operation_name TEXT,
        operation_id TEXT,
        module TEXT,
        message TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
      CREATE INDEX IF NOT EXISTS idx_logs_operation_id ON logs(operation_id);
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);

      CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(
        message, content=logs, content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS logs_ai AFTER INSERT ON logs BEGIN
        INSERT INTO logs_fts(rowid, message) VALUES (new.id, new.message);
      END;
      CREATE TRIGGER IF NOT EXISTS logs_ad AFTER DELETE ON logs BEGIN
        INSERT INTO logs_fts(logs_fts, rowid, message) VALUES('delete', old.id, old.message);
      END;

      CREATE TABLE IF NOT EXISTS query_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        sparql TEXT NOT NULL,
        duration_ms INTEGER,
        result_count INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_qhist_ts ON query_history(ts);

      CREATE TABLE IF NOT EXISTS saved_queries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        sparql TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  prune(): void {
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    this.db.exec(`DELETE FROM metric_snapshots WHERE ts < ${cutoff}`);
    this.db.exec(`DELETE FROM operations WHERE started_at < ${cutoff}`);
    this.db.exec(`DELETE FROM logs WHERE ts < ${cutoff}`);
    this.db.exec(`DELETE FROM query_history WHERE ts < ${cutoff}`);
  }

  // --- Prepared statements (lazy-initialized) ---

  private _stmts: Record<string, Database.Statement> = {};

  private stmt(key: string, sql: string): Database.Statement {
    if (!this._stmts[key]) this._stmts[key] = this.db.prepare(sql);
    return this._stmts[key];
  }

  // --- Metric snapshots ---

  insertSnapshot(snap: MetricSnapshotRow): void {
    this.stmt('insertSnapshot', `
      INSERT INTO metric_snapshots (
        ts, cpu_percent, mem_used_bytes, mem_total_bytes,
        disk_used_bytes, disk_total_bytes, heap_used_bytes, uptime_seconds,
        peer_count, direct_peers, relayed_peers, mesh_peers, paranet_count,
        total_triples, total_kcs, total_kas, store_bytes,
        confirmed_kcs, tentative_kcs, rpc_latency_ms, rpc_healthy
      ) VALUES (
        @ts, @cpu_percent, @mem_used_bytes, @mem_total_bytes,
        @disk_used_bytes, @disk_total_bytes, @heap_used_bytes, @uptime_seconds,
        @peer_count, @direct_peers, @relayed_peers, @mesh_peers, @paranet_count,
        @total_triples, @total_kcs, @total_kas, @store_bytes,
        @confirmed_kcs, @tentative_kcs, @rpc_latency_ms, @rpc_healthy
      )
    `).run(snap);
  }

  getLatestSnapshot(): MetricSnapshotRow | undefined {
    return this.db.prepare(
      'SELECT * FROM metric_snapshots ORDER BY ts DESC LIMIT 1',
    ).get() as MetricSnapshotRow | undefined;
  }

  getSnapshotHistory(from: number, to: number, maxPoints = 500): MetricSnapshotRow[] {
    const total = this.db.prepare(
      'SELECT COUNT(*) as c FROM metric_snapshots WHERE ts >= ? AND ts <= ?',
    ).get(from, to) as { c: number };

    if (total.c <= maxPoints) {
      return this.db.prepare(
        'SELECT * FROM metric_snapshots WHERE ts >= ? AND ts <= ? ORDER BY ts',
      ).all(from, to) as MetricSnapshotRow[];
    }

    const step = Math.ceil(total.c / maxPoints);
    return this.db.prepare(`
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER (ORDER BY ts) as rn
        FROM metric_snapshots WHERE ts >= ? AND ts <= ?
      ) WHERE rn % ? = 0 ORDER BY ts
    `).all(from, to, step) as MetricSnapshotRow[];
  }

  // --- Operations ---

  insertOperation(op: {
    operation_id: string;
    operation_name: string;
    started_at: number;
    peer_id?: string | null;
    paranet_id?: string | null;
    details?: string | null;
  }): void {
    this.stmt('insertOp', `
      INSERT INTO operations (operation_id, operation_name, started_at, status, peer_id, paranet_id, details)
      VALUES (@operation_id, @operation_name, @started_at, 'in_progress', @peer_id, @paranet_id, @details)
    `).run({
      operation_id: op.operation_id,
      operation_name: op.operation_name,
      started_at: op.started_at,
      peer_id: op.peer_id ?? null,
      paranet_id: op.paranet_id ?? null,
      details: op.details ?? null,
    });
  }

  completeOperation(op: {
    operation_id: string;
    duration_ms: number;
    triple_count?: number | null;
    details?: string | null;
  }): void {
    this.stmt('completeOp', `
      UPDATE operations SET status = 'success', duration_ms = @duration_ms,
        triple_count = @triple_count, details = COALESCE(@details, details)
      WHERE operation_id = @operation_id AND status = 'in_progress'
    `).run({
      operation_id: op.operation_id,
      duration_ms: op.duration_ms,
      triple_count: op.triple_count ?? null,
      details: op.details ?? null,
    });
  }

  failOperation(op: {
    operation_id: string;
    duration_ms: number;
    error_message: string;
  }): void {
    this.stmt('failOp', `
      UPDATE operations SET status = 'error', duration_ms = @duration_ms,
        error_message = @error_message
      WHERE operation_id = @operation_id AND status = 'in_progress'
    `).run(op);
  }

  getOperations(opts: {
    name?: string;
    status?: string;
    from?: number;
    to?: number;
    limit?: number;
    offset?: number;
  } = {}): { operations: OperationRow[]; total: number } {
    const wheres: string[] = [];
    const params: unknown[] = [];

    if (opts.name) { wheres.push('operation_name = ?'); params.push(opts.name); }
    if (opts.status) { wheres.push('status = ?'); params.push(opts.status); }
    if (opts.from) { wheres.push('started_at >= ?'); params.push(opts.from); }
    if (opts.to) { wheres.push('started_at <= ?'); params.push(opts.to); }

    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    const total = (this.db.prepare(`SELECT COUNT(*) as c FROM operations ${where}`).get(...params) as { c: number }).c;
    const operations = this.db.prepare(
      `SELECT * FROM operations ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as OperationRow[];

    return { operations, total };
  }

  getOperation(operationId: string): { operation: OperationRow | null; logs: LogRow[] } {
    const operation = this.db.prepare(
      'SELECT * FROM operations WHERE operation_id = ?',
    ).get(operationId) as OperationRow | null;

    const logs = this.db.prepare(
      'SELECT * FROM logs WHERE operation_id = ? ORDER BY ts',
    ).all(operationId) as LogRow[];

    return { operation, logs };
  }

  // --- Logs ---

  insertLog(entry: {
    ts: number;
    level: string;
    operation_name?: string | null;
    operation_id?: string | null;
    module: string;
    message: string;
  }): void {
    this.stmt('insertLog', `
      INSERT INTO logs (ts, level, operation_name, operation_id, module, message)
      VALUES (@ts, @level, @operation_name, @operation_id, @module, @message)
    `).run({
      ts: entry.ts,
      level: entry.level,
      operation_name: entry.operation_name ?? null,
      operation_id: entry.operation_id ?? null,
      module: entry.module,
      message: entry.message,
    });
  }

  searchLogs(opts: {
    q?: string;
    operationId?: string;
    level?: string;
    module?: string;
    from?: number;
    to?: number;
    limit?: number;
    offset?: number;
  } = {}): { logs: LogRow[]; total: number } {
    if (opts.q) {
      return this.searchLogsFts(opts);
    }

    const wheres: string[] = [];
    const params: unknown[] = [];

    if (opts.operationId) { wheres.push('operation_id = ?'); params.push(opts.operationId); }
    if (opts.level) { wheres.push('level = ?'); params.push(opts.level); }
    if (opts.module) { wheres.push('module = ?'); params.push(opts.module); }
    if (opts.from) { wheres.push('ts >= ?'); params.push(opts.from); }
    if (opts.to) { wheres.push('ts <= ?'); params.push(opts.to); }

    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const limit = opts.limit ?? 200;
    const offset = opts.offset ?? 0;

    const total = (this.db.prepare(`SELECT COUNT(*) as c FROM logs ${where}`).get(...params) as { c: number }).c;
    const logs = this.db.prepare(
      `SELECT * FROM logs ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as LogRow[];

    return { logs, total };
  }

  private searchLogsFts(opts: {
    q?: string;
    operationId?: string;
    level?: string;
    module?: string;
    from?: number;
    to?: number;
    limit?: number;
    offset?: number;
  }): { logs: LogRow[]; total: number } {
    const wheres: string[] = ['logs_fts MATCH ?'];
    const params: unknown[] = [opts.q!];

    if (opts.operationId) { wheres.push('l.operation_id = ?'); params.push(opts.operationId); }
    if (opts.level) { wheres.push('l.level = ?'); params.push(opts.level); }
    if (opts.module) { wheres.push('l.module = ?'); params.push(opts.module); }
    if (opts.from) { wheres.push('l.ts >= ?'); params.push(opts.from); }
    if (opts.to) { wheres.push('l.ts <= ?'); params.push(opts.to); }

    const where = wheres.join(' AND ');
    const limit = opts.limit ?? 200;
    const offset = opts.offset ?? 0;

    const total = (this.db.prepare(
      `SELECT COUNT(*) as c FROM logs l JOIN logs_fts ON l.id = logs_fts.rowid WHERE ${where}`,
    ).get(...params) as { c: number }).c;

    const logs = this.db.prepare(
      `SELECT l.* FROM logs l JOIN logs_fts ON l.id = logs_fts.rowid WHERE ${where} ORDER BY l.ts DESC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as LogRow[];

    return { logs, total };
  }

  // --- Query history ---

  insertQueryHistory(entry: {
    sparql: string;
    duration_ms: number;
    result_count?: number | null;
    error?: string | null;
  }): void {
    this.stmt('insertQueryHistory', `
      INSERT INTO query_history (ts, sparql, duration_ms, result_count, error)
      VALUES (@ts, @sparql, @duration_ms, @result_count, @error)
    `).run({
      ts: Date.now(),
      sparql: entry.sparql,
      duration_ms: entry.duration_ms,
      result_count: entry.result_count ?? null,
      error: entry.error ?? null,
    });
  }

  getQueryHistory(limit = 50, offset = 0): QueryHistoryRow[] {
    return this.db.prepare(
      'SELECT * FROM query_history ORDER BY ts DESC LIMIT ? OFFSET ?',
    ).all(limit, offset) as QueryHistoryRow[];
  }

  // --- Saved queries ---

  getSavedQueries(): SavedQueryRow[] {
    return this.db.prepare('SELECT * FROM saved_queries ORDER BY updated_at DESC').all() as SavedQueryRow[];
  }

  insertSavedQuery(entry: { name: string; description?: string; sparql: string }): number {
    const now = Date.now();
    const result = this.db.prepare(
      'INSERT INTO saved_queries (name, description, sparql, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(entry.name, entry.description ?? null, entry.sparql, now, now);
    return result.lastInsertRowid as number;
  }

  updateSavedQuery(id: number, entry: { name?: string; description?: string; sparql?: string }): void {
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [Date.now()];
    if (entry.name !== undefined) { sets.push('name = ?'); params.push(entry.name); }
    if (entry.description !== undefined) { sets.push('description = ?'); params.push(entry.description); }
    if (entry.sparql !== undefined) { sets.push('sparql = ?'); params.push(entry.sparql); }
    params.push(id);
    this.db.prepare(`UPDATE saved_queries SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  deleteSavedQuery(id: number): void {
    this.db.prepare('DELETE FROM saved_queries WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}

// --- Row types ---

export interface MetricSnapshotRow {
  id?: number;
  ts: number;
  cpu_percent: number | null;
  mem_used_bytes: number | null;
  mem_total_bytes: number | null;
  disk_used_bytes: number | null;
  disk_total_bytes: number | null;
  heap_used_bytes: number | null;
  uptime_seconds: number | null;
  peer_count: number | null;
  direct_peers: number | null;
  relayed_peers: number | null;
  mesh_peers: number | null;
  paranet_count: number | null;
  total_triples: number | null;
  total_kcs: number | null;
  total_kas: number | null;
  store_bytes: number | null;
  confirmed_kcs: number | null;
  tentative_kcs: number | null;
  rpc_latency_ms: number | null;
  rpc_healthy: number | null;
}

export interface OperationRow {
  id: number;
  operation_id: string;
  operation_name: string;
  started_at: number;
  duration_ms: number | null;
  status: string;
  peer_id: string | null;
  paranet_id: string | null;
  triple_count: number | null;
  error_message: string | null;
  details: string | null;
}

export interface LogRow {
  id: number;
  ts: number;
  level: string;
  operation_name: string | null;
  operation_id: string | null;
  module: string | null;
  message: string;
}

export interface QueryHistoryRow {
  id: number;
  ts: number;
  sparql: string;
  duration_ms: number | null;
  result_count: number | null;
  error: string | null;
}

export interface SavedQueryRow {
  id: number;
  name: string;
  description: string | null;
  sparql: string;
  created_at: number;
  updated_at: number;
}
