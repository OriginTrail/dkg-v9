import React, { useMemo, useState } from 'react';

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
  const loadedAt = useMemo(() => new Date(), []);

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
      </div>

      <div className="card" style={{ padding: 16, display: 'grid', gap: 12, maxWidth: 760 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="dkg-btn" onClick={() => setClicks(v => v + 1)}>Increment</button>
          <button className="dkg-btn dkg-btn-secondary" onClick={() => setClicks(0)}>Reset</button>
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
      </div>
    </div>
  );
}
