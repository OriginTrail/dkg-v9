import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { useFetch, formatTime, formatDuration, shortId } from '../hooks.js';
import { fetchOperations, fetchOperation, fetchLogs, fetchOperationStats, fetchStatus } from '../api.js';

const PHASE_COLORS: Record<string, string> = {
  prepare: '#3b82f6',
  store: '#8b5cf6',
  chain: '#f59e0b',
  broadcast: '#22c55e',
  parse: '#3b82f6',
  execute: '#8b5cf6',
  transfer: '#3b82f6',
  verify: '#22c55e',
};

const PHASE_DESCRIPTIONS: Record<string, string> = {
  prepare: 'Partitioning triples by root entity, computing Merkle hashes, validating the publish request, and signing EVM transactions.',
  store: 'Inserting public and private triples into the local Oxigraph triple store and data graph.',
  chain: 'Submitting the on-chain publish transaction to the blockchain and waiting for confirmation.',
  broadcast: 'Broadcasting the published knowledge collection to network peers via GossipSub.',
  parse: 'Validating and parsing the SPARQL query syntax.',
  execute: 'Running the SPARQL query against the local triple store.',
  transfer: 'Fetching triple pages from the remote peer over the sync protocol.',
  verify: 'Verifying Merkle proofs and inserting synced triples into the local store.',
};

export function OperationsPage() {
  const [tab, setTab] = useState<'operations' | 'stats' | 'logs'>('operations');

  return (
    <div>
      <h1 className="page-title">Operations & Logs</h1>
      <div className="tab-group">
        <button className={`tab-item ${tab === 'operations' ? 'active' : ''}`} onClick={() => setTab('operations')}>Operations</button>
        <button className={`tab-item ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>Stats</button>
        <button className={`tab-item ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>Logs</button>
      </div>
      {tab === 'operations' ? <OperationsTab /> : tab === 'stats' ? <StatsTab /> : <LogsTab />}
    </div>
  );
}

/* ================================================================
   Stats Tab
   ================================================================ */

function StatsTab() {
  const [period, setPeriod] = useState('24h');
  const [nameFilter, setNameFilter] = useState('');

  const params = useMemo(() => {
    const p: { name?: string; period: string } = { period };
    if (nameFilter) p.name = nameFilter;
    return p;
  }, [period, nameFilter]);

  const { data } = useFetch(() => fetchOperationStats(params), [period, nameFilter], 10_000);
  const summary = data?.summary;
  const timeSeries = data?.timeSeries ?? [];

  const chartData = useMemo(() => timeSeries.map((b: any) => ({
    ...b,
    time: new Date(b.bucket).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    successPct: Math.round((b.successRate ?? 0) * 100),
    avgDurS: ((b.avgDurationMs ?? 0) / 1000).toFixed(1),
  })), [timeSeries]);

  return (
    <div>
      <div className="filters">
        <select className="input" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="publish">publish</option>
          <option value="query">query</option>
          <option value="sync">sync</option>
          <option value="connect">connect</option>
        </select>
        <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Operations</div><div className="stat-value">{summary?.totalCount ?? '—'}</div></div>
        <div className="stat-card"><div className="stat-label">Success Rate</div><div className="stat-value">{summary ? `${(summary.successRate * 100).toFixed(1)}%` : '—'}</div></div>
        <div className="stat-card"><div className="stat-label">Avg Duration</div><div className="stat-value">{summary ? formatDuration(summary.avgDurationMs) : '—'}</div></div>
        <div className="stat-card"><div className="stat-label">Total Gas (ETH)</div><div className="stat-value">{summary?.totalGasCostEth != null ? summary.totalGasCostEth.toFixed(6) : '—'}</div></div>
        <div className="stat-card"><div className="stat-label">Total TRAC</div><div className="stat-value">{summary?.totalTracCost != null ? summary.totalTracCost.toFixed(4) : '—'}</div></div>
      </div>

      {chartData.length > 1 && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Operations Over Time</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12, color: '#e5e7eb' }} />
                <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Success Rate (%)</div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12, color: '#e5e7eb' }} />
                <Line type="monotone" dataKey="successPct" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Average Duration (s)</div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12, color: '#e5e7eb' }} />
                <Line type="monotone" dataKey="avgDurS" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <div className="card-title">Gas Cost (ETH)</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12, color: '#e5e7eb' }} />
                <Bar dataKey="totalGasCostEth" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      {chartData.length <= 1 && (
        <div className="card"><div className="empty-state">Not enough data for charts yet</div></div>
      )}
    </div>
  );
}

/* ================================================================
   Operations Tab (enhanced with cost column & TX link)
   ================================================================ */

function OperationsTab() {
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedOp, setSelectedOp] = useState<string | null>(null);

  const params: Record<string, string> = { limit: '50' };
  if (nameFilter) params.name = nameFilter;
  if (statusFilter) params.status = statusFilter;

  const { data } = useFetch(() => fetchOperations(params), [nameFilter, statusFilter], 5_000);
  const { data: detail } = useFetch(
    () => selectedOp ? fetchOperation(selectedOp) : Promise.resolve(null),
    [selectedOp],
  );
  const { data: statusData } = useFetch(fetchStatus, [], 30_000);
  const explorerUrl = statusData?.blockExplorerUrl;

  const operations = data?.operations ?? [];

  if (selectedOp && detail?.operation) {
    return <OperationDetail op={detail.operation} logs={detail.logs} phases={detail.phases ?? []} explorerUrl={explorerUrl} onBack={() => setSelectedOp(null)} />;
  }

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{data?.total ?? '—'}</div>
        </div>
      </div>

      <div className="filters">
        <select className="input" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="publish">publish</option>
          <option value="query">query</option>
          <option value="sync">sync</option>
          <option value="connect">connect</option>
          <option value="system">system</option>
        </select>
        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="success">success</option>
          <option value="error">error</option>
          <option value="in_progress">in_progress</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {operations.length === 0 ? (
          <div className="empty-state">No operations recorded yet</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Triples</th>
                <th>Cost (ETH)</th>
                <th>TX</th>
                <th>Operation ID</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((op: any) => (
                <tr key={op.operation_id} onClick={() => setSelectedOp(op.operation_id)} style={{ cursor: 'pointer' }}>
                  <td>{formatTime(op.started_at)}</td>
                  <td><span className="badge badge-info">{op.operation_name}</span></td>
                  <td><StatusBadge status={op.status} /></td>
                  <td>{formatDuration(op.duration_ms)}</td>
                  <td>{op.triple_count ?? '—'}</td>
                  <td>{op.gas_cost_eth != null ? op.gas_cost_eth.toFixed(6) : '—'}</td>
                  <td>
                    {op.tx_hash ? (
                      <a
                        href={explorerUrl ? `${explorerUrl}/tx/${op.tx_hash}` : '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={op.tx_hash}
                      >
                        <TxLinkIcon />
                      </a>
                    ) : '—'}
                  </td>
                  <td className="mono">{shortId(op.operation_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   Operation Detail (enhanced with phases, cost, TX link)
   ================================================================ */

function OperationDetail({ op, logs, phases, explorerUrl, onBack }: {
  op: any; logs: any[]; phases: any[]; explorerUrl?: string; onBack: () => void;
}) {
  const totalDuration = op.duration_ms ?? 0;

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 16 }}>&larr; Back</button>

      <div className="card">
        <div className="card-title">Operation Detail</div>
        <table className="data-table">
          <tbody>
            <tr><td style={{ width: 140, color: '#9ca3af' }}>Operation ID</td><td className="mono">{op.operation_id}</td></tr>
            <tr><td style={{ color: '#9ca3af' }}>Type</td><td>{op.operation_name}</td></tr>
            <tr><td style={{ color: '#9ca3af' }}>Status</td><td><StatusBadge status={op.status} /></td></tr>
            <tr><td style={{ color: '#9ca3af' }}>Started</td><td>{new Date(op.started_at).toLocaleString()}</td></tr>
            <tr><td style={{ color: '#9ca3af' }}>Duration</td><td>{formatDuration(op.duration_ms)}</td></tr>
            <tr><td style={{ color: '#9ca3af' }}>Triples</td><td>{op.triple_count ?? '—'}</td></tr>
            <tr><td style={{ color: '#9ca3af' }}>Peer</td><td className="mono">{op.peer_id ?? '—'}</td></tr>
            <tr><td style={{ color: '#9ca3af' }}>Paranet</td><td className="mono">{op.paranet_id ?? '—'}</td></tr>
            {op.gas_cost_eth != null && (
              <tr><td style={{ color: '#9ca3af' }}>Gas Cost</td><td>{op.gas_cost_eth.toFixed(6)} ETH ({op.gas_used?.toLocaleString() ?? '?'} gas @ {op.gas_price_gwei?.toFixed(2) ?? '?'} gwei)</td></tr>
            )}
            {op.trac_cost != null && (
              <tr><td style={{ color: '#9ca3af' }}>TRAC Cost</td><td>{op.trac_cost.toFixed(4)} TRAC</td></tr>
            )}
            {op.tx_hash && (
              <tr>
                <td style={{ color: '#9ca3af' }}>TX Hash</td>
                <td className="mono">
                  {explorerUrl ? (
                    <a href={`${explorerUrl}/tx/${op.tx_hash}`} target="_blank" rel="noopener noreferrer">{op.tx_hash}</a>
                  ) : op.tx_hash}
                </td>
              </tr>
            )}
            {op.error_message && <tr><td style={{ color: '#9ca3af' }}>Error</td><td style={{ color: 'var(--error)' }}>{op.error_message}</td></tr>}
          </tbody>
        </table>
      </div>

      {phases.length > 0 && (
        <div className="card">
          <div className="card-title">Phase Timeline</div>
          <div className="phase-timeline-bar" style={{ marginBottom: 16 }}>
            {phases.map((p: any) => {
              const pct = totalDuration > 0 ? Math.max(((p.duration_ms ?? 0) / totalDuration) * 100, 2) : (100 / phases.length);
              return (
                <div
                  key={p.phase}
                  className="phase-segment"
                  style={{ width: `${pct}%`, background: PHASE_COLORS[p.phase] ?? '#6b7280' }}
                  title={`${p.phase}: ${formatDuration(p.duration_ms)}\n${PHASE_DESCRIPTIONS[p.phase] ?? ''}`}
                >
                  <span className="phase-segment-label">{p.phase}</span>
                </div>
              );
            })}
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Phase</th><th>Description</th><th>Status</th><th>Duration</th><th>% of Total</th></tr>
            </thead>
            <tbody>
              {phases.map((p: any) => {
                const pctOfTotal = totalDuration > 0 ? ((p.duration_ms ?? 0) / totalDuration * 100) : 0;
                return (
                  <tr key={p.phase}>
                    <td style={{ color: PHASE_COLORS[p.phase] ?? '#9ca3af', fontWeight: 500 }}>{p.phase}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12, maxWidth: 300 }} title={PHASE_DESCRIPTIONS[p.phase]}>
                      {PHASE_DESCRIPTIONS[p.phase] ?? '—'}
                    </td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>{formatDuration(p.duration_ms)}</td>
                    <td>{pctOfTotal > 0 ? `${pctOfTotal.toFixed(1)}%` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="card-title">Logs ({logs.length})</div>
        {logs.length === 0 ? (
          <div className="empty-state">No logs for this operation</div>
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {logs.map((l: any) => (
              <div key={l.id} className="log-line">
                <span className="ts">{formatTime(l.ts)}</span>
                <span className={`level-${l.level}`}>{l.level.toUpperCase().padEnd(5)}</span>
                <span className="module">[{l.module}]</span>
                <span className="msg">{l.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   Logs Tab
   ================================================================ */

function LogsTab() {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('');
  const [opId, setOpId] = useState('');

  const params: Record<string, string> = { limit: '200' };
  if (query) params.q = query;
  if (level) params.level = level;
  if (opId) params.operationId = opId;

  const { data } = useFetch(() => fetchLogs(params), [query, level, opId], 5_000);
  const logs = data?.logs ?? [];

  return (
    <div>
      <div className="filters">
        <input className="input" placeholder="Search logs..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All levels</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <input className="input mono" placeholder="Operation ID..." value={opId} onChange={(e) => setOpId(e.target.value)} style={{ minWidth: 240 }} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
          {data?.total ?? 0} logs
        </div>
        <div style={{ maxHeight: 600, overflowY: 'auto', padding: '8px 16px' }}>
          {logs.length === 0 ? (
            <div className="empty-state">No logs found</div>
          ) : (
            logs.map((l: any) => (
              <div key={l.id} className="log-line">
                <span className="ts">{formatTime(l.ts)}</span>
                <span className={`level-${l.level}`}>{l.level.toUpperCase().padEnd(5)}</span>
                {l.operation_id && <span className="op-id" title={l.operation_id}>{shortId(l.operation_id)}</span>}
                <span className="module">[{l.module}]</span>
                <span className="msg">{l.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   Shared components
   ================================================================ */

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'success' ? 'badge-success' : status === 'error' ? 'badge-error' : 'badge-warning';
  return <span className={`badge ${cls}`}>{status}</span>;
}

function TxLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
