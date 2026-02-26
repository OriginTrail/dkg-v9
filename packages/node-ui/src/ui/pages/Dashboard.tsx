import React from 'react';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useFetch, formatBytes, formatDuration } from '../hooks.js';
import { fetchStatus, fetchMetrics, fetchMetricsHistory } from '../api.js';

export function DashboardPage() {
  const { data: status } = useFetch(fetchStatus, [], 10_000);
  const { data: metrics } = useFetch(fetchMetrics, [], 10_000);
  const { data: history } = useFetch(
    () => fetchMetricsHistory(Date.now() - 86_400_000, Date.now(), 200),
    [],
    60_000,
  );

  const snapshots = history?.snapshots ?? [];

  const chartData = snapshots.map((s: any) => ({
    time: new Date(s.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    cpu: s.cpu_percent ?? 0,
    mem: s.mem_used_bytes ? Math.round(s.mem_used_bytes / 1048576) : 0,
    peers: s.peer_count ?? 0,
    triples: s.total_triples ?? 0,
  }));

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>

      <div className="stats-grid">
        <StatCard label="Status" value={status ? 'Online' : '—'} cls="success" />
        <StatCard label="Uptime" value={status ? formatDuration(status.uptimeMs) : '—'} />
        <StatCard label="Peers" value={status?.connectedPeers ?? '—'} />
        <StatCard label="Relay" value={status?.relayConnected ? 'Connected' : 'No'} cls={status?.relayConnected ? 'success' : 'warning'} />
        <StatCard label="CPU" value={metrics?.cpu_percent != null ? `${metrics.cpu_percent}%` : '—'} />
        <StatCard label="Memory" value={formatBytes(metrics?.mem_used_bytes)} />
        <StatCard label="Triples" value={metrics?.total_triples ?? '—'} />
        <StatCard label="Store" value={formatBytes(metrics?.store_bytes)} />
      </div>

      <div className="charts-grid">
        <div className="card">
          <div className="card-title">CPU Usage (24h)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} unit="%" />
              <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }} />
              <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="rgba(59,130,246,0.15)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Memory (MB, 24h)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
              <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }} />
              <Area type="monotone" dataKey="mem" stroke="#8b5cf6" fill="rgba(139,92,246,0.15)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Connected Peers (24h)</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }} />
              <Line type="monotone" dataKey="peers" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Total Triples (24h)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
              <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }} />
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
