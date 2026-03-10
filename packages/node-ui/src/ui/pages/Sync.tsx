import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetch, shortId } from '../hooks.js';
import {
  fetchParanets,
  fetchSyncStatus,
  inspectSync,
  repairSync,
  type SyncInspectResponse,
  type SyncStatusResponse,
} from '../api.js';

type SyncTab = 'overview' | 'tree' | 'reconcile' | 'raw';

function shortHash(hash: string): string {
  if (!hash) return '—';
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function prefixLabel(bits: string): string {
  if (!bits) return '(root)';
  return bits;
}

function renderParityBadge(equal: boolean): React.ReactNode {
  return (
    <span className={`badge ${equal ? 'badge-success' : 'badge-warning'}`}>
      {equal ? 'match' : 'diff'}
    </span>
  );
}

export function SyncPage() {
  const { data: paranetData } = useFetch(fetchParanets, [], 30_000);
  const [paranetId, setParanetId] = useState('');
  const [peerId, setPeerId] = useState('');
  const [tab, setTab] = useState<SyncTab>('overview');
  const [inspectData, setInspectData] = useState<SyncInspectResponse | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [repairLoading, setRepairLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const paranets = useMemo(() => {
    return (paranetData?.paranets ?? [])
      .map((p: any) => ({
        id: p?.id ?? '',
        name: p?.name ?? p?.id ?? '',
        isSystem: Boolean(p?.isSystem),
      }))
      .filter((p: { id: string }) => p.id);
  }, [paranetData]);

  const {
    data: syncStatus,
    loading: statusLoading,
    refresh: refreshSyncStatus,
  } = useFetch<SyncStatusResponse | null>(
    () => (paranetId ? fetchSyncStatus(paranetId) : Promise.resolve(null)),
    [paranetId],
    15_000,
  );

  useEffect(() => {
    if (paranetId) return;
    if (paranets.length === 0) return;
    const preferred = paranets.find((p: { isSystem: boolean }) => !p.isSystem) ?? paranets[0];
    setParanetId(preferred.id);
  }, [paranetId, paranets]);

  useEffect(() => {
    const peers = syncStatus?.peers ?? [];
    const inventoryPeers = peers.filter((p) => p.supportsInventory);
    if (inventoryPeers.length === 0) {
      setPeerId('');
      return;
    }
    if (!peerId || !inventoryPeers.some((p) => p.peerId === peerId)) {
      setPeerId(inventoryPeers[0].peerId);
    }
  }, [syncStatus, peerId]);

  const runInspect = useCallback(async () => {
    setMessage(null);
    if (!paranetId) {
      setError('Select a paranet first.');
      return;
    }
    if (!peerId) {
      setError('Select an inventory-capable peer first.');
      return;
    }
    setInspectLoading(true);
    setError(null);
    try {
      const data = await inspectSync(paranetId, peerId, {
        maxItems: 500,
        maxTreeDepth: 16,
      });
      setInspectData(data);
    } catch (err: any) {
      setError(err.message ?? 'Failed to inspect sync');
    } finally {
      setInspectLoading(false);
    }
  }, [paranetId, peerId]);

  const runRepair = useCallback(async () => {
    setMessage(null);
    if (!paranetId) {
      setError('Select a paranet first.');
      return;
    }
    setRepairLoading(true);
    setError(null);
    try {
      const result = await repairSync(paranetId, {
        peerId: peerId || undefined,
        includeWorkspace: false,
      });
      if (result.mode === 'peer') {
        setMessage(
          `Repair complete from ${shortId(result.peerId, 10)}: data ${result.result.dataSynced}, workspace ${result.result.workspaceSynced}`,
        );
      } else {
        setMessage(
          `Repair complete from connected peers: data ${result.catchup.dataSynced}, workspace ${result.catchup.workspaceSynced}`,
        );
      }
      refreshSyncStatus();
      if (peerId) {
        const data = await inspectSync(paranetId, peerId, {
          maxItems: 500,
          maxTreeDepth: 16,
        });
        setInspectData(data);
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to repair sync');
    } finally {
      setRepairLoading(false);
    }
  }, [paranetId, peerId, refreshSyncStatus]);

  const selectedPeerSupportsInventory = Boolean(
    (syncStatus?.peers ?? []).find((p) => p.peerId === peerId)?.supportsInventory,
  );

  return (
    <div className="page-section">
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Sync Reconciliation</h1>
        <p style={{ marginTop: 4 }}>
          Inspect Merkle tree comparisons and exact KC reconciliation sets per paranet.
        </p>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(320px, 1fr) auto', gap: 10, alignItems: 'end' }}>
          <div>
            <div className="prov-field-label" style={{ marginBottom: 6 }}>Paranet</div>
            <select
              className="input"
              style={{ width: '100%', backgroundImage: 'none', paddingRight: 12 }}
              value={paranetId}
              onChange={(e) => {
                setParanetId(e.target.value);
                setInspectData(null);
                setError(null);
                setMessage(null);
              }}
            >
              {paranets.length === 0 && <option value="">No paranets</option>}
              {paranets.map((p) => (
                <option key={p.id} value={p.id}>{p.id}{p.isSystem ? ' (system)' : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="prov-field-label" style={{ marginBottom: 6 }}>Peer</div>
            <select
              className="input"
              style={{ width: '100%', backgroundImage: 'none', paddingRight: 12 }}
              value={peerId}
              onChange={(e) => {
                setPeerId(e.target.value);
                setInspectData(null);
              }}
            >
              {(syncStatus?.peers ?? []).length === 0 && <option value="">No connected peers</option>}
              {(syncStatus?.peers ?? []).map((p) => (
                <option key={p.peerId} value={p.peerId}>
                  {shortId(p.peerId, 10)} · sync:{p.supportsSync ? 'yes' : 'no'} · inventory:{p.supportsInventory ? 'yes' : 'no'}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => refreshSyncStatus()}
              disabled={!paranetId || statusLoading}
            >
              {statusLoading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={runInspect}
              disabled={!paranetId || !peerId || inspectLoading || !selectedPeerSupportsInventory}
            >
              {inspectLoading ? 'Inspecting…' : 'Inspect Trees'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={runRepair}
              disabled={!paranetId || repairLoading}
            >
              {repairLoading ? 'Repairing…' : 'Repair'}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="badge badge-info">connected peers: {syncStatus?.connectedPeers ?? 0}</span>
          <span className="badge badge-info">sync-capable: {syncStatus?.syncCapablePeers ?? 0}</span>
          <span className="badge badge-info">inventory-capable: {syncStatus?.inventoryCapablePeers ?? 0}</span>
          {selectedPeerSupportsInventory
            ? <span className="badge badge-success">selected peer supports inventory</span>
            : <span className="badge badge-warning">selected peer has no inventory protocol</span>}
        </div>

        {message && (
          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--green-dim)', border: '1px solid rgba(74,222,128,.25)', color: 'var(--green)', fontSize: 12, fontWeight: 600 }}>
            {message}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--red-dim)', border: '1px solid rgba(248,113,113,.25)', color: 'var(--red)', fontSize: 12, fontWeight: 600 }}>
            {error}
          </div>
        )}
      </div>

      {inspectData && (
        <>
          <div className="tab-group" style={{ marginBottom: 12 }}>
            <button className={`tab-item ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
            <button className={`tab-item ${tab === 'tree' ? 'active' : ''}`} onClick={() => setTab('tree')}>Merkle Tree Diff</button>
            <button className={`tab-item ${tab === 'reconcile' ? 'active' : ''}`} onClick={() => setTab('reconcile')}>Reconciled Data</button>
            <button className={`tab-item ${tab === 'raw' ? 'active' : ''}`} onClick={() => setTab('raw')}>Raw JSON</button>
          </div>

          {tab === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="card" style={{ padding: 16 }}>
                <div className="prov-field-label">Local inventory</div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>KCs: {inspectData.local.kcCount}</div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--cyan)', marginTop: 6 }} title={inspectData.local.rootHash}>
                  root: {shortHash(inspectData.local.rootHash)}
                </div>
                <div style={{ marginTop: 8 }}>
                  <span className={`badge ${inspectData.local.leavesTruncated ? 'badge-warning' : 'badge-success'}`}>
                    leaves shown: {inspectData.local.leaves.length}{inspectData.local.leavesTruncated ? ' (truncated)' : ''}
                  </span>
                </div>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div className="prov-field-label">Remote inventory</div>
                {inspectData.remote ? (
                  <>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>KCs: {inspectData.remote.kcCount}</div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--blue)', marginTop: 6 }} title={inspectData.remote.rootHash}>
                      root: {shortHash(inspectData.remote.rootHash)}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <span className={`badge ${inspectData.remote.leavesTruncated ? 'badge-warning' : 'badge-success'}`}>
                        leaves shown: {inspectData.remote.leaves.length}{inspectData.remote.leavesTruncated ? ' (truncated)' : ''}
                      </span>
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No remote inventory available.</div>
                )}
              </div>

              <div className="card" style={{ padding: 16, gridColumn: '1 / -1' }}>
                <div className="prov-field-label">Reconciliation summary</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <span className="badge badge-warning">missing local: {inspectData.reconciliation.counts.missingLocal}</span>
                  <span className="badge badge-warning">mismatched: {inspectData.reconciliation.counts.mismatched}</span>
                  <span className="badge badge-info">extra local: {inspectData.reconciliation.counts.extraLocal}</span>
                  {inspectData.inventoryProtocolAvailable
                    ? <span className="badge badge-success">inventory protocol healthy</span>
                    : <span className="badge badge-warning">inventory protocol partial/unavailable</span>}
                </div>
              </div>
            </div>
          )}

          {tab === 'tree' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {inspectData.tree.comparedPrefixes.length === 0 ? (
                <div className="empty-state">No tree comparison nodes captured.</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Prefix</th>
                      <th>Depth</th>
                      <th>Local Leaves</th>
                      <th>Remote Leaves</th>
                      <th>Local Root</th>
                      <th>Remote Root</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspectData.tree.comparedPrefixes.map((row) => (
                      <tr key={`${row.prefixBits || 'root'}:${row.depth}:${row.localRootHash}`}>
                        <td className="mono" title={row.prefixBits || '(root)'}>{prefixLabel(row.prefixBits)}</td>
                        <td>{row.depth}</td>
                        <td className="mono">{row.localLeafCount}</td>
                        <td className="mono">{row.remoteLeafCount}</td>
                        <td className="mono" title={row.localRootHash}>{shortHash(row.localRootHash)}</td>
                        <td className="mono" title={row.remoteRootHash}>{shortHash(row.remoteRootHash)}</td>
                        <td>{renderParityBadge(row.equal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'reconcile' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>Missing Local KCs</div>
                {inspectData.reconciliation.missingLocal.length === 0 ? (
                  <div className="empty-state" style={{ padding: 20 }}>No missing local KCs.</div>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>KC UAL</th><th>Merkle Root</th><th>Leaf Hash</th></tr></thead>
                    <tbody>
                      {inspectData.reconciliation.missingLocal.map((row) => (
                        <tr key={row.kcUal}>
                          <td className="mono" style={{ fontSize: 11 }}>{row.kcUal}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{shortHash(row.merkleRoot)}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{shortHash(row.leafHash)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>Mismatched KCs</div>
                {inspectData.reconciliation.mismatched.length === 0 ? (
                  <div className="empty-state" style={{ padding: 20 }}>No mismatched KCs.</div>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>KC UAL</th><th>Local Root</th><th>Remote Root</th></tr></thead>
                    <tbody>
                      {inspectData.reconciliation.mismatched.map((row) => (
                        <tr key={row.kcUal}>
                          <td className="mono" style={{ fontSize: 11 }}>{row.kcUal}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{shortHash(row.localMerkleRoot)}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{shortHash(row.remoteMerkleRoot)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>Extra Local KCs</div>
                {inspectData.reconciliation.extraLocal.length === 0 ? (
                  <div className="empty-state" style={{ padding: 20 }}>No extra local KCs.</div>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>KC UAL</th><th>Merkle Root</th><th>Leaf Hash</th></tr></thead>
                    <tbody>
                      {inspectData.reconciliation.extraLocal.map((row) => (
                        <tr key={row.kcUal}>
                          <td className="mono" style={{ fontSize: 11 }}>{row.kcUal}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{shortHash(row.merkleRoot)}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{shortHash(row.leafHash)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {inspectData.reconciliation.itemsTruncated && (
                <div style={{ color: 'var(--amber)', fontSize: 12, fontWeight: 600 }}>
                  Reconciliation lists are truncated to 500 entries.
                </div>
              )}
            </div>
          )}

          {tab === 'raw' && (
            <div className="json-view">
              {JSON.stringify(inspectData, null, 2)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
