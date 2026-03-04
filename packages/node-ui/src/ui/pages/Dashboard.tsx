import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useFetch, formatDuration } from '../hooks.js';
import { fetchStatus, fetchMetrics, fetchMetricsHistory } from '../api.js';

const AGENTS = [
  { name: 'sentinel', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  { name: 'MassContributor', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  { name: 'lupus-in-fabula', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  { name: 'Zivojin', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  { name: 'jurij-dkg-node', color: '#22d3ee', bg: 'rgba(34,211,238,0.12)' },
  { name: 'openclaw-agent', color: '#f472b6', bg: 'rgba(244,114,182,0.12)' },
];

const ACTIONS = ['publish', 'query', 'update', 'verify'] as const;
type Action = typeof ACTIONS[number];

const ACTION_COLORS: Record<Action, string> = {
  publish: 'var(--green)', query: 'var(--blue)', update: 'var(--amber)', verify: 'var(--purple)',
};

const rnd = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const genUAL = () => `did:dkg:${rnd(['base', 'otp'])}:0x${Math.random().toString(16).slice(2, 8)}…/${Math.floor(Math.random() * 999999)}`;

interface FeedEvent { id: number; agent: typeof AGENTS[0]; action: Action; ual: string; ago: string; verified: boolean; }

let _id = 0;
function genEvent(): FeedEvent {
  return { id: _id++, agent: rnd(AGENTS), action: rnd([...ACTIONS]), ual: genUAL(), ago: 'just now', verified: Math.random() > 0.15 };
}

const SHIELD_GREEN = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <polyline points="9 12 11 14 15 10"/>
  </svg>
);

function AgentBadge({ agent }: { agent: typeof AGENTS[0] }) {
  return (
    <span className="agent-badge" style={{ color: agent.color, background: agent.bg, border: `1px solid ${agent.color}22` }}>
      <span className="agent-dot" style={{ background: agent.color }} />
      {agent.name}
    </span>
  );
}

function VerifyBadge({ verified }: { verified: boolean }) {
  return (
    <span className={`verify-badge ${verified ? 'verified' : 'pending'}`}>
      {verified ? SHIELD_GREEN : '⏳'} {verified ? 'VERIFIED' : 'PENDING'}
    </span>
  );
}

const PARANETS = [
  { name: 'Oregon Trail', assets: 847, agents: 12, color: 'var(--green)' },
  { name: 'DeSci Research', assets: 1203, agents: 8, color: 'var(--blue)' },
  { name: 'Supply Chain EU', assets: 797, agents: 4, color: 'var(--amber)' },
];

const QUICK_ACTIONS = [
  { label: 'Query the Graph', desc: 'Run SPARQL queries', icon: '⌘' },
  { label: 'Connect an Agent', desc: 'MCP / HTTP integration', icon: '⚡' },
  { label: 'Join Oregon Trail', desc: 'Test your node', icon: '🎮' },
];

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
  const fetcher = useCallback(() => fetchMetricsHistory(Date.now() - rangeMs, Date.now(), 200), [rangeMs]);
  const { data: history } = useFetch(fetcher, [rangeMs], 60_000);

  const snapshots = (history as any)?.snapshots ?? [];
  const chartData = useMemo(() => snapshots.map((s: any) => ({
    time: rangeKey === '7d'
      ? new Date(s.ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
      : new Date(s.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    cpu: s.cpu_percent ?? 0,
    heapMb: s.heap_used_bytes ? Math.round(s.heap_used_bytes / 1048576) : 0,
    peers: s.peer_count ?? 0,
  })), [snapshots, rangeKey]);

  const [feed, setFeed] = useState<FeedEvent[]>(() => Array.from({ length: 10 }, genEvent));

  useEffect(() => {
    const t = setInterval(() => {
      setFeed(prev => [genEvent(), ...prev].slice(0, 20));
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const statCards = [
    { label: 'Knowledge Assets', value: (metrics as any)?.total_triples?.toLocaleString() ?? '2,847', sub: '↑ 142 this week', color: 'var(--green)' },
    { label: 'Active Peers', value: String((status as any)?.connectedPeers ?? 14), sub: '3 paranets', color: 'var(--blue)' },
    { label: 'Queries / hr', value: '1,204', sub: '↑ 18% vs yesterday', color: 'var(--purple)' },
    { label: 'Verified On-Chain', value: '99.2%', sub: '27 pending', color: 'var(--green)' },
  ];

  return (
    <div className="page-section">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Your node is live · uptime {(status as any) ? formatDuration((status as any).uptimeMs) : '—'} · {(status as any)?.connectedPeers ?? 0} peers
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="range-pills">
            {RANGES.map(r => (
              <button key={r.key} className={`range-pill${rangeKey === r.key ? ' active' : ''}`} onClick={() => setRangeKey(r.key)}>{r.label}</button>
            ))}
          </div>
          <button className="btn-primary">+ Publish Knowledge Asset</button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid">
        {statCards.map(s => (
          <div className="stat-card" key={s.label}>
            <div className="accent" style={{ background: `linear-gradient(90deg,${s.color}44,transparent)` }} />
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Main 2-col grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>

        {/* Activity Feed */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px rgba(74,222,128,0.53)', display: 'inline-block' }} />
              <span style={{ fontSize: 13, fontWeight: 700 }}>Agent Activity Feed</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>LIVE</span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>All paranets</span>
          </div>
          <div style={{ maxHeight: 380, overflow: 'auto' }}>
            {feed.map((ev, i) => (
              <div key={ev.id} className="feed-row" style={i === 0 ? { background: 'rgba(74,222,128,0.02)' } : {}}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{ev.ago}</span>
                <AgentBadge agent={ev.agent} />
                <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: ACTION_COLORS[ev.action] }}>{ev.action.toUpperCase()}</span>
                <span className="ual">{ev.ual}</span>
                <VerifyBadge verified={ev.verified} />
              </div>
            ))}
          </div>
          {/* Mini chart */}
          {chartData.length > 0 && (
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>CPU · {rangeKey}</div>
              <ResponsiveContainer width="100%" height={80}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#475569' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: '#475569' }} unit="%" width={28} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1e2a3a', fontSize: 11 }} />
                  <Area type="monotone" dataKey="cpu" stroke="var(--green)" fill="rgba(74,222,128,0.08)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Paranets */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Paranets</div>
            {PARANETS.map(p => (
              <div className="paranet-item" key={p.name}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 3, background: p.color, display: 'inline-block' }} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</span>
                  </div>
                  <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                </div>
                <div className="mono" style={{ display: 'flex', gap: 16, fontSize: 10, color: 'var(--text-muted)' }}>
                  <span>{p.assets.toLocaleString()} assets</span>
                  <span>{p.agents} agents</span>
                </div>
              </div>
            ))}
          </div>

          {/* Quick Actions */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Quick Actions</div>
            {QUICK_ACTIONS.map(a => (
              <button key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', marginBottom: 6, textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ fontSize: 16 }}>{a.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{a.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{a.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
