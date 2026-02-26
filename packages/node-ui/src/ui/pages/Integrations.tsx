import React, { useState } from 'react';
import { useFetch, shortId } from '../hooks.js';
import { fetchIntegrations, subscribeToParanet } from '../api.js';

export function IntegrationsPage() {
  const { data: integrations, loading, refresh } = useFetch(fetchIntegrations, [], 30_000);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [newParanetId, setNewParanetId] = useState('');

  const adapters = integrations?.adapters ?? [];
  const skills = integrations?.skills ?? [];
  const paranets = integrations?.paranets ?? [];

  const handleSubscribe = async (paranetId: string) => {
    if (!paranetId.trim()) return;
    setSubscribing(paranetId);
    try {
      await subscribeToParanet(paranetId.trim());
      refresh();
    } catch {
      // ignore
    } finally {
      setSubscribing(null);
    }
  };

  return (
    <div>
      <h1 className="page-title">Integrations</h1>

      <div className="card">
        <div className="card-title">Adapters</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
          Adapters connect this node to external frameworks (ElizaOS, OpenClaw). Enable/disable and configure via config file.
        </p>
        {adapters.length === 0 ? (
          <div className="empty-state">No adapters listed</div>
        ) : (
          <div className="paranet-list">
            {adapters.map((a: any) => (
              <div key={a.id} className="paranet-card">
                <h3>{a.name}</h3>
                <p>{a.description ?? a.id}</p>
                <span className={`badge ${a.enabled ? 'badge-success' : 'badge-warning'}`}>
                  {a.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Discovered Skills</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
          Skills offered by agents on the network (from the agents paranet).
        </p>
        {skills.length === 0 ? (
          <div className="empty-state">No skills discovered yet</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Skill type</th>
                <th>PeerId</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((s: any, i: number) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{s.agentName ?? s.name ?? '—'}</td>
                  <td>{s.skillType ?? s.type ?? '—'}</td>
                  <td className="mono">{shortId(s.peerId ?? s.agentPeerId ?? '', 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">Paranet Subscriptions</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
          Subscribe to additional paranets. Data will sync from peers.
        </p>
        <div className="filters" style={{ marginBottom: 16 }}>
          <input
            className="input input-mono"
            placeholder="Paranet ID (e.g. testing)"
            value={newParanetId}
            onChange={e => setNewParanetId(e.target.value)}
            style={{ maxWidth: 240 }}
          />
          <button
            className="btn btn-primary"
            disabled={!newParanetId.trim() || subscribing !== null}
            onClick={() => handleSubscribe(newParanetId)}
          >
            {subscribing === newParanetId ? 'Subscribing…' : 'Subscribe'}
          </button>
        </div>
        {paranets.length === 0 ? (
          <div className="empty-state">No paranets listed</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Paranet</th>
                <th>ID / URI</th>
              </tr>
            </thead>
            <tbody>
              {paranets.map((p: any, i: number) => (
                <tr key={i}>
                  <td>{typeof p === 'string' ? p : p.name ?? p.id ?? p}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{typeof p === 'object' && p.uri ? p.uri : p}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
