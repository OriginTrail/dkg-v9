import React, { useState } from 'react';
import { useFetch, formatTime, formatDuration, shortId } from '../hooks.js';
import { fetchOperations, fetchOperation, fetchLogs } from '../api.js';

export function OperationsPage() {
  const [tab, setTab] = useState<'operations' | 'logs'>('operations');

  return (
    <div>
      <h1 className="page-title">Operations & Logs</h1>
      <div className="tab-group">
        <button className={`tab-item ${tab === 'operations' ? 'active' : ''}`} onClick={() => setTab('operations')}>Operations</button>
        <button className={`tab-item ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>Logs</button>
      </div>
      {tab === 'operations' ? <OperationsTab /> : <LogsTab />}
    </div>
  );
}

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

  const operations = data?.operations ?? [];

  if (selectedOp && detail?.operation) {
    return <OperationDetail op={detail.operation} logs={detail.logs} onBack={() => setSelectedOp(null)} />;
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
                <th>Operation ID</th>
                <th>Peer</th>
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
                  <td className="mono">{shortId(op.operation_id)}</td>
                  <td className="mono">{shortId(op.peer_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function OperationDetail({ op, logs, onBack }: { op: any; logs: any[]; onBack: () => void }) {
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
            {op.error_message && <tr><td style={{ color: '#9ca3af' }}>Error</td><td style={{ color: 'var(--error)' }}>{op.error_message}</td></tr>}
          </tbody>
        </table>
      </div>

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

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'success' ? 'badge-success' : status === 'error' ? 'badge-error' : 'badge-warning';
  return <span className={`badge ${cls}`}>{status}</span>;
}
