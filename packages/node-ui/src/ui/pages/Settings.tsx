import React from 'react';
import { useFetch } from '../hooks.js';
import { fetchStatus } from '../api.js';

const CHAINS = [
  { id: 'base_testnet',    label: 'Base Sepolia',     status: 'active' },
  { id: 'neuroweb_test',   label: 'NeuroWeb Testnet', status: 'active' },
  { id: 'gnosis_testnet',  label: 'Chiado (Gnosis)',  status: 'inactive' },
];

const SERVICES = [
  { name: 'Blazegraph SPARQL', status: 'healthy',  port: 9999  },
  { name: 'MySQL (operationaldb)', status: 'healthy',  port: 3306  },
  { name: 'Redis Cache', status: 'healthy',  port: 6379  },
  { name: 'Libp2p Network', status: 'healthy',  port: 9000  },
  { name: 'HTTP API', status: 'healthy',  port: 8900  },
];

const SERVICE_COLORS: Record<string, string> = {
  healthy: 'var(--green)', degraded: 'var(--amber)', down: 'var(--red)',
};

export function SettingsPage() {
  const { data: status } = useFetch(fetchStatus, [], 15_000);

  return (
    <div className="page-section">
      <div style={{ marginBottom: 24 }}>
        <h2 className="page-title">Settings</h2>
        <p className="page-subtitle">Wallet management, blockchain configuration, and node health</p>
      </div>

      <div className="settings-grid">

        {/* Management Wallet */}
        <div className="settings-card">
          <div className="settings-title">Management Wallet</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Address</div>
          <div className="mono" style={{ fontSize: 11, padding: '8px 12px', borderRadius: 7, background: '#0a0f1a', border: '1px solid var(--border)', wordBreak: 'break-all', marginBottom: 14 }}>
            0xa4B1cF034145Bd23B405bA7EB085d9ED24fA9F60
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {['TRAC','ETH'].map(tok => (
              <div key={tok} style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#0a0f1a', border: '1px solid var(--border)', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{tok}</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>142.8</div>
              </div>
            ))}
          </div>
        </div>

        {/* Operational Wallet */}
        <div className="settings-card">
          <div className="settings-title">Operational Wallet</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Address</div>
          <div className="mono" style={{ fontSize: 11, padding: '8px 12px', borderRadius: 7, background: '#0a0f1a', border: '1px solid var(--border)', wordBreak: 'break-all', marginBottom: 14 }}>
            0xe68964317Db1a795cA9243a05534c5a051f9f6AE
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {['TRAC','ETH'].map(tok => (
              <div key={tok} style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#0a0f1a', border: '1px solid var(--border)', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{tok}</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>18.4</div>
              </div>
            ))}
          </div>
        </div>

        {/* Blockchain Config */}
        <div className="settings-card">
          <div className="settings-title">Blockchain Networks</div>
          {CHAINS.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8, background: '#0a0f1a' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.status === 'active' ? 'var(--green)' : 'var(--text-dim)', display: 'inline-block' }} />
              <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{c.label}</span>
              <span style={{ fontSize: 10, color: c.status === 'active' ? 'var(--green)' : 'var(--text-dim)', fontWeight: 600 }}>
                {c.status === 'active' ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </div>
          ))}
          <div style={{ marginTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
              <input type="checkbox" defaultChecked style={{ accentColor: 'var(--green)' }} />
              <span style={{ color: 'var(--text-muted)' }}>Testnet mode (no real TRAC spend)</span>
            </label>
          </div>
        </div>

        {/* DKG Engine Health */}
        <div className="settings-card">
          <div className="settings-title">DKG Engine Services</div>
          {SERVICES.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: SERVICE_COLORS[s.status], display: 'inline-block' }} />
              <span style={{ fontSize: 11, fontWeight: 500, flex: 1 }}>{s.name}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>:{s.port}</span>
            </div>
          ))}
          {(status as any)?.version && (
            <div className="mono" style={{ marginTop: 12, fontSize: 10, color: 'var(--text-dim)' }}>
              DKG Engine v{(status as any).version}
            </div>
          )}
        </div>

        {/* Node Info */}
        <div className="settings-card" style={{ gridColumn: '1 / -1' }}>
          <div className="settings-title">Node Identity</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { label: 'Node Name', value: (status as any)?.nodeName ?? 'quantum-guardian-v9' },
              { label: 'Peer ID', value: (status as any)?.peerId ?? 'QmS4vid2uEz…' },
              { label: 'Identity ID', value: '#54' },
              { label: 'Node Role', value: (status as any)?.nodeRole ?? 'edge' },
              { label: 'Network ID', value: '6f63f485c6cce67e' },
              { label: 'Network', value: 'Base Sepolia Testnet' },
            ].map(f => (
              <div key={f.label}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{f.label}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text)', wordBreak: 'break-all' }}>{f.value}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
