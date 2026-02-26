import React, { useState } from 'react';
import { useFetch, shortId } from '../hooks.js';
import { fetchWalletsBalances, fetchRpcHealth } from '../api.js';

export function WalletPage() {
  const { data: balancesData } = useFetch(fetchWalletsBalances, [], 15_000);
  const { data: rpcHealth } = useFetch(fetchRpcHealth, [], 10_000);

  const balances = balancesData?.balances ?? [];
  const chainId = balancesData?.chainId ?? null;
  const rpcUrl = balancesData?.rpcUrl ?? rpcHealth?.rpcUrl ?? null;
  const symbol = balancesData?.symbol ?? 'TRAC';
  const error = balancesData?.error ?? rpcHealth?.error;

  return (
    <div>
      <h1 className="page-title">Wallet & Economics</h1>

      {error && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: 16 }}>
          <div className="card-title" style={{ color: 'var(--warning)' }}>Notice</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{error}</p>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Chain</div>
          <div className="stat-value" style={{ fontSize: 16 }}>{chainId ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">RPC Status</div>
          <div className={`stat-value ${rpcHealth?.ok ? 'success' : 'warning'}`}>
            {rpcHealth?.ok ? 'Healthy' : rpcHealth?.error ? 'Error' : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">RPC Latency</div>
          <div className="stat-value">
            {rpcHealth?.latencyMs != null ? `${rpcHealth.latencyMs} ms` : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Block #</div>
          <div className="stat-value">{rpcHealth?.blockNumber ?? '—'}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">RPC Endpoint</div>
        <p className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{rpcUrl ?? 'Not configured'}</p>
      </div>

      <div className="card">
        <div className="card-title">Operational Wallets</div>
        {balances.length === 0 ? (
          <div className="empty-state">No wallets or chain not configured</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Address</th>
                <th>ETH</th>
                <th>{symbol}</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b: any, i: number) => (
                <tr key={b.address}>
                  <td className="mono" title={b.address}>{shortId(b.address, 10)}</td>
                  <td>{b.eth}</td>
                  <td>{b.trac}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          Fund these addresses with ETH (gas) and {symbol} (staking/publishing). Managed in ~/.dkg/wallets.json.
        </p>
      </div>
    </div>
  );
}
