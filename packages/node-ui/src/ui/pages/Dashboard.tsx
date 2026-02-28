import React, { useState, useMemo, useCallback } from 'react';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useFetch, formatBytes, formatDuration } from '../hooks.js';
import { fetchStatus, fetchMetrics, fetchMetricsHistory } from '../api.js';

type RangeKey = '1h' | '6h' | '24h' | '7d';

const RANGES: { key: RangeKey; label: string; ms: number }[] = [
  { key: '1h', label: '1h', ms: 3_600_000 },
  { key: '6h', label: '6h', ms: 6 * 3_600_000 },
  { key: '24h', label: '24h', ms: 86_400_000 },
  { key: '7d', label: '7d', ms: 7 * 86_400_000 },
];

export function DashboardPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('24h');
  const rangeMs = RANGES.find(r => r.key === rangeKey)!.ms;

  const { data: status } = useFetch(fetchStatus, [], 10_000);
  const { data: metrics } = useFetch(fetchMetrics, [], 10_000);
  const fetcher = useCallback(
    () => fetchMetricsHistory(Date.now() - rangeMs, Date.now(), 200),
    [rangeMs],
  );
  const { data: history } = useFetch(fetcher, [rangeMs], 60_000);

  const snapshots = history?.snapshots ?? [];

  const chartData = useMemo(() => snapshots.map((s: any) => {
    const timeFmt = rangeKey === '7d'
      ? new Date(s.ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
      : new Date(s.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return {
      time: timeFmt,
      cpu: s.cpu_percent ?? 0,
      heapMb: s.heap_used_bytes ? Math.round(s.heap_used_bytes / 1048576) : 0,
      peers: s.peer_count ?? 0,
      triples: s.total_triples ?? 0,
    };
  }), [snapshots, rangeKey]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Dashboard</h1>
        <div className="range-pills">
          {RANGES.map(r => (
            <button
              key={r.key}
              className={`range-pill ${rangeKey === r.key ? 'active' : ''}`}
              onClick={() => setRangeKey(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Status" value={status ? 'Online' : '—'} cls="success" />
        <StatCard label="Uptime" value={status ? formatDuration(status.uptimeMs) : '—'} />
        <StatCard label="Peers" value={status?.connectedPeers ?? '—'} />
        <StatCard label="Relay" value={status?.relayConnected ? 'Connected' : 'No'} cls={status?.relayConnected ? 'success' : 'warning'} />
        <StatCard label="CPU" value={metrics?.cpu_percent != null ? `${metrics.cpu_percent}%` : '—'} />
        <StatCard label="Heap" value={metrics?.heap_used_bytes ? `${Math.round(metrics.heap_used_bytes / 1048576)} MB` : '—'} />
        <StatCard label="Triples" value={metrics?.total_triples ?? '—'} />
        <StatCard label="Store" value={formatBytes(metrics?.store_bytes)} />
      </div>

      <div className="charts-grid">
        <div className="card">
          <div className="card-title">CPU Usage</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} unit="%" domain={[0, 'auto']} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                formatter={(v: number) => [`${v.toFixed(1)}%`, 'CPU']}
              />
              <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="rgba(59,130,246,0.15)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Node Memory (Heap)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} unit=" MB" />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                formatter={(v: number) => [`${v} MB`, 'Heap']}
              />
              <Area type="monotone" dataKey="heapMb" stroke="#8b5cf6" fill="rgba(139,92,246,0.15)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Connected Peers</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                formatter={(v: number) => [v, 'Peers']}
              />
              <Line type="monotone" dataKey="peers" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Total Triples</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                formatter={(v: number) => [v.toLocaleString(), 'Triples']}
              />
              <Area type="monotone" dataKey="triples" stroke="#f59e0b" fill="rgba(245,158,11,0.15)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {status && (
        <div className="card">
          <div className="card-title">Node Info</div>
          <table className="data-table">
            <tbody>
              <tr><td style={{ width: 140, color: '#9ca3af' }}>Name</td><td>{status.name}</td></tr>
              <tr><td style={{ color: '#9ca3af' }}>PeerId</td><td className="mono">{status.peerId}</td></tr>
              <tr><td style={{ color: '#9ca3af' }}>Role</td><td>{status.nodeRole}</td></tr>
              <tr><td style={{ color: '#9ca3af' }}>Network</td><td className="mono">{status.networkId}</td></tr>
              <tr><td style={{ color: '#9ca3af' }}>Connections</td><td>{status.connections?.direct} direct, {status.connections?.relayed} relayed</td></tr>
              <tr><td style={{ color: '#9ca3af' }}>Multiaddrs</td><td className="mono" style={{ fontSize: 11 }}>{status.multiaddrs?.join('\n')}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, cls }: { label: string; value: string | number; cls?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${cls ?? ''}`}>{value}</div>
    </div>
  );
}
