import React from 'react';
import { useFetch, shortId, formatDuration } from '../hooks.js';
import { fetchConnections, fetchAgents } from '../api.js';

export function NetworkPage() {
  const { data: connData } = useFetch(fetchConnections, [], 10_000);
  const { data: agentData } = useFetch(fetchAgents, [], 15_000);

  const connections = connData?.connections ?? [];
  const agents = agentData?.agents ?? [];

  return (
    <div>
      <h1 className="page-title">Network</h1>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Connections</div>
          <div className="stat-value">{connData?.total ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Direct</div>
          <div className="stat-value">{connData?.direct ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Relayed</div>
          <div className="stat-value">{connData?.relayed ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Known Agents</div>
          <div className="stat-value">{agents.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Active Connections</div>
        {connections.length === 0 ? (
          <div className="empty-state">No connections</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Peer</th>
                <th>Transport</th>
                <th>Direction</th>
                <th>Remote Address</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c: any, i: number) => (
                <tr key={i}>
                  <td className="mono">{shortId(c.peerId, 12)}</td>
                  <td><span className={`badge ${c.transport === 'direct' ? 'badge-success' : 'badge-info'}`}>{c.transport}</span></td>
                  <td>{c.direction}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{c.remoteAddr}</td>
                  <td>{formatDuration(c.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">Discovered Agents</div>
        {agents.length === 0 ? (
          <div className="empty-state">No agents discovered yet</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>PeerId</th>
                <th>Framework</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a: any, i: number) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td className="mono">{shortId(a.peerId, 12)}</td>
                  <td>{a.framework ?? '—'}</td>
                  <td>{a.nodeRole ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
