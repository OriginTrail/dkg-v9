import React, { useMemo, useState } from 'react';
import { fetchMetrics, fetchNodeLog, fetchStatus } from '../api.js';
import { useFetch } from '../hooks.js';

function formatNow(value: Date): string {
  return value.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function TestPage() {
  const [clicks, setClicks] = useState(0);
  const [note, setNote] = useState('v9 auto-update test live');
  const [showRaw, setShowRaw] = useState(false);
  const loadedAt = useMemo(() => new Date(), []);
  const { data: status, loading: statusLoading, refresh: refreshStatus } = useFetch(fetchStatus, [], 5000);
  const { data: metrics, loading: metricsLoading, refresh: refreshMetrics } = useFetch(fetchMetrics, [], 5000);
  const { data: nodeLog, loading: logLoading, refresh: refreshLog } = useFetch(() => fetchNodeLog({ lines: 5 }), [], 7000);
  const peerCount = Number((status as any)?.connectedPeers ?? (status as any)?.peerCount ?? 0);
  const cpu = Number((metrics as any)?.cpuPct ?? 0);
  const memory = Number((metrics as any)?.memoryMb ?? 0);
  const heartbeat = statusLoading || metricsLoading || logLoading ? 'polling...' : 'live';

  return (
    <div className="page-section">
      <h1 className="page-title">UI Test Page</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
        <div className="stat-card">
          <div className="accent" style={{ background: 'var(--green)' }} />
          <div className="stat-label">Loaded At</div>
          <div className="stat-value" style={{ fontSize: 16, lineHeight: 1.3 }}>{formatNow(loadedAt)}</div>
          <div className="stat-sub">Rendered by React route `/test`</div>
        </div>
        <div className="stat-card">
          <div className="accent" style={{ background: 'var(--blue)' }} />
          <div className="stat-label">Button Clicks</div>
          <div className="stat-value">{clicks}</div>
          <div className="stat-sub">Basic interactivity check</div>
        </div>
        <div className="stat-card">
          <div className="accent" style={{ background: 'var(--amber)' }} />
          <div className="stat-label">Peer Count</div>
          <div className="stat-value">{peerCount}</div>
          <div className="stat-sub">Live status poll every 5s</div>
        </div>
      </div>

      <div className="card" style={{ padding: 16, display: 'grid', gap: 12, maxWidth: 880 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="dkg-btn" onClick={() => setClicks(v => v + 1)}>Increment</button>
          <button className="dkg-btn dkg-btn-secondary" onClick={() => setClicks(0)}>Reset</button>
          <button className="dkg-btn dkg-btn-secondary" onClick={() => { refreshStatus(); refreshMetrics(); refreshLog(); }}>Refresh APIs</button>
          <button className="dkg-btn dkg-btn-secondary" onClick={() => setShowRaw(v => !v)}>{showRaw ? 'Hide Raw' : 'Show Raw'}</button>
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', alignSelf: 'center' }}>Heartbeat: {heartbeat}</span>
        </div>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Test note</span>
          <input
            className="chat-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Type a note"
            style={{ maxWidth: 560 }}
          />
        </label>

        <div className="mono" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          Preview: {note || '(empty)'}
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>CPU</div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-alt)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(0, Math.min(cpu, 100))}%`, background: 'linear-gradient(90deg,var(--blue),var(--cyan))', transition: 'width .25s ease' }} />
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{Number.isFinite(cpu) ? `${cpu.toFixed(1)}%` : '—'}</div>

          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Memory</div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-alt)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(0, Math.min((memory / 4096) * 100, 100))}%`, background: 'linear-gradient(90deg,var(--green),var(--blue))', transition: 'width .25s ease' }} />
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{Number.isFinite(memory) ? `${memory.toFixed(1)} MB` : '—'}</div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Recent node log lines</div>
          <div style={{ background: '#070c14', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', maxHeight: 160, overflow: 'auto' }}>
            {(nodeLog as any)?.lines?.length ? (
              ((nodeLog as any).lines as string[]).map((line, i) => (
                <div key={i} className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.55 }}>{line}</div>
              ))
            ) : (
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{logLoading ? 'Loading logs...' : 'No log lines available.'}</div>
            )}
          </div>
        </div>

        {showRaw && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'grid', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Raw status payload</div>
              <pre className="mono" style={{ margin: 0, fontSize: 11, background: 'rgba(255,255,255,.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, overflow: 'auto' }}>{JSON.stringify(status ?? {}, null, 2)}</pre>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Raw metrics payload</div>
              <pre className="mono" style={{ margin: 0, fontSize: 11, background: 'rgba(255,255,255,.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, overflow: 'auto' }}>{JSON.stringify(metrics ?? {}, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
