import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DashboardDB } from '../src/db.js';
import { ChatAssistant } from '../src/chat-assistant.js';

let db: DashboardDB;
let dir: string;
let assistant: ChatAssistant;
let mockQuery: ReturnType<typeof vi.fn>;

function seedMetrics() {
  db.insertSnapshot({
    ts: Date.now(),
    cpu_percent: 23.5,
    mem_used_bytes: 512_000_000,
    mem_total_bytes: 8_000_000_000,
    disk_used_bytes: 50_000_000_000,
    disk_total_bytes: 256_000_000_000,
    heap_used_bytes: 200_000_000,
    uptime_seconds: 3661,
    peer_count: 4,
    direct_peers: 2,
    relayed_peers: 2,
    mesh_peers: 3,
    paranet_count: 2,
    total_triples: 1500,
    total_kcs: 10,
    total_kas: 25,
    store_bytes: 2_000_000,
    confirmed_kcs: 8,
    tentative_kcs: 2,
    rpc_latency_ms: 15,
    rpc_healthy: 1,
  });
}

function seedOperations() {
  db.insertOperation({
    operation_id: 'op-1',
    operation_name: 'publish',
    started_at: Date.now() - 60_000,
    paranet_id: 'testing',
  });
  db.completeOperation({ operation_id: 'op-1', duration_ms: 350, triple_count: 50 });

  db.insertOperation({
    operation_id: 'op-2',
    operation_name: 'query',
    started_at: Date.now() - 30_000,
  });
  db.failOperation({ operation_id: 'op-2', duration_ms: 120, error_message: 'SPARQL syntax error' });

  db.insertOperation({
    operation_id: 'op-3',
    operation_name: 'sync',
    started_at: Date.now() - 10_000,
    paranet_id: 'agents',
  });
  db.completeOperation({ operation_id: 'op-3', duration_ms: 800, triple_count: 200 });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dkg-chat-test-'));
  db = new DashboardDB({ dataDir: dir });
  mockQuery = vi.fn().mockResolvedValue({ bindings: [] });
  assistant = new ChatAssistant(db, mockQuery);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ChatAssistant', () => {
  describe('uptime', () => {
    it('reports uptime when metrics exist', async () => {
      seedMetrics();
      const res = await assistant.answer({ message: 'What is the uptime?' });
      expect(res.reply).toContain('1h 1m');
      expect(res.data).toHaveProperty('uptimeSeconds', 3661);
    });

    it('reports no metrics when DB is empty', async () => {
      const res = await assistant.answer({ message: 'How long has the node been running?' });
      expect(res.reply).toContain('No metrics');
    });
  });

  describe('peer count', () => {
    it('reports peer counts', async () => {
      seedMetrics();
      const res = await assistant.answer({ message: 'How many peers am I connected to?' });
      expect(res.reply).toContain('4');
      expect(res.reply).toContain('2 direct');
      expect(res.reply).toContain('2 relayed');
    });
  });

  describe('triple count', () => {
    it('reports triple, KC, and KA counts', async () => {
      seedMetrics();
      const res = await assistant.answer({ message: 'How many triples do I have?' });
      expect(res.reply).toContain('1500');
      expect(res.reply).toContain('10');
      expect(res.reply).toContain('25');
    });
  });

  describe('CPU / memory', () => {
    it('reports CPU and memory usage', async () => {
      seedMetrics();
      const res = await assistant.answer({ message: 'Show me CPU and memory' });
      expect(res.reply).toContain('23.5%');
      expect(res.reply).toContain('488'); // ~512MB in MB
    });
  });

  describe('failed operations', () => {
    it('reports failed operations', async () => {
      seedOperations();
      const res = await assistant.answer({ message: 'Are there any failures?' });
      expect(res.reply).toContain('1');
      expect(res.reply).toContain('SPARQL syntax error');
    });

    it('reports no failures when all operations succeed', async () => {
      db.insertOperation({
        operation_id: 'op-ok',
        operation_name: 'publish',
        started_at: Date.now(),
        paranet_id: 'testing',
      });
      db.completeOperation({ operation_id: 'op-ok', duration_ms: 100, triple_count: 10 });
      const res = await assistant.answer({ message: 'Any errors?' });
      expect(res.reply).toContain('No failed operations');
    });
  });

  describe('operations summary', () => {
    it('returns operation counts by type', async () => {
      seedOperations();
      const res = await assistant.answer({ message: 'How many operations were processed?' });
      expect(res.reply).toContain('3');
      expect(res.reply).toContain('1 publishes');
      expect(res.reply).toContain('1 queries');
      expect(res.reply).toContain('1 syncs');
    });
  });

  describe('agents', () => {
    it('queries the triple store for agents', async () => {
      mockQuery.mockResolvedValueOnce({
        bindings: [
          { name: '"TestAgent"', peerId: '12D3KooWTestAgent12345' },
        ],
      });
      const res = await assistant.answer({ message: 'Which agents are on the network?' });
      expect(mockQuery).toHaveBeenCalled();
      expect(res.reply).toContain('1');
      expect(res.reply).toContain('TestAgent');
    });

    it('handles empty agents list', async () => {
      const res = await assistant.answer({ message: 'Who is on the network?' });
      expect(res.reply).toContain('No agents discovered');
    });
  });

  describe('store/disk', () => {
    it('reports store and disk sizes', async () => {
      seedMetrics();
      const res = await assistant.answer({ message: 'How big is my store?' });
      expect(res.reply).toContain('1.91'); // 2MB in MB
      expect(res.reply).toContain('46.6'); // ~50GB in GB
    });
  });

  describe('SPARQL passthrough', () => {
    it('runs a query starting with SELECT', async () => {
      mockQuery.mockResolvedValueOnce({
        bindings: [{ s: 'test:a', p: 'test:b', o: 'test:c' }],
      });
      const res = await assistant.answer({ message: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 1' });
      expect(mockQuery).toHaveBeenCalledWith('SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 1');
      expect(res.reply).toContain('1');
      expect(res.sparql).toBe('SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 1');
    });

    it('handles SPARQL errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('parse error'));
      const res = await assistant.answer({ message: 'SELECT broken query' });
      expect(res.reply).toContain('SPARQL error');
      expect(res.reply).toContain('parse error');
    });
  });

  describe('help / fallback', () => {
    it('returns help text for unrecognized messages', async () => {
      const res = await assistant.answer({ message: 'hello there' });
      expect(res.reply).toContain('assistant');
      expect(res.reply).toContain('uptime');
    });
  });

  describe('recent logs', () => {
    it('returns recent logs when available', async () => {
      db.insertLog({
        ts: Date.now(),
        level: 'info',
        module: 'agent',
        operation_name: 'publish',
        operation_id: 'op-log-1',
        message: 'Published 50 triples',
      });
      const res = await assistant.answer({ message: 'Show me the latest logs' });
      expect(res.reply).toContain('Published 50 triples');
      expect(res.reply).toContain('info');
    });
  });
});
