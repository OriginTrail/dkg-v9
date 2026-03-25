import React from 'react';
import { useRepo, repoKey } from '../context/RepoContext.js';

export function AgentsPage() {
  const { selectedRepo } = useRepo();

  const isLocal = !selectedRepo || (selectedRepo.privacyLevel ?? 'local') === 'local';

  return (
    <div className="page">
      <h2 className="page-title">Agents & Collaboration</h2>
      {selectedRepo ? (
        <div className="empty-state">
          <p>
            This tab shows DKG V9 nodes (peers) subscribed to this repository's paranet.
          </p>
          <p>
            Repository: <strong className="mono">{repoKey(selectedRepo)}</strong>
          </p>
          {isLocal ? (
            <p style={{ marginTop: 12, color: 'var(--warning)' }}>
              This repository is in Local Only mode. Switch to Shared mode in Settings to enable collaboration.
            </p>
          ) : (
            <>
              <p style={{ marginTop: 12 }}>
                To collaborate, share your paranet ID with other node operators:
              </p>
              <p>
                <span className="mono" style={{ background: 'var(--bg-card)', padding: '4px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  {selectedRepo.paranetId}
                </span>
              </p>
              <p className="text-muted" style={{ marginTop: 12 }}>
                Agents subscribed to the same paranet can participate in collaborative reviews.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="empty-state">
          <p>Multi-agent collaboration features will be available once a repository is configured and synced.</p>
          <p>Agents subscribed to the same paranet can participate in collaborative reviews.</p>
        </div>
      )}
    </div>
  );
}
