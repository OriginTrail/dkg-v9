import React, { useState, useEffect, useCallback } from 'react';
import { useRepo, repoKey } from '../context/RepoContext.js';
import {
  convertToShared,
  sendInvitation,
  getInvitations,
  acceptInvitation,
  declineInvitation,
} from '../api.js';

interface Invitation {
  invitationId: string;
  repoKey: string;
  paranetId: string;
  fromPeerId: string;
  toPeerId: string;
  status: 'pending' | 'accepted' | 'declined';
  direction: 'sent' | 'received';
  createdAt: number;
}

export function AgentsPage() {
  const { selectedRepo, refreshRepos } = useRepo();
  const [peerIdInput, setPeerIdInput] = useState('');
  const [invitations, setInvitations] = useState<{ sent: Invitation[]; received: Invitation[] }>({ sent: [], received: [] });
  const [sharing, setSharing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isLocal = !selectedRepo || (selectedRepo.privacyLevel ?? 'local') === 'local';
  const isShared = selectedRepo && selectedRepo.privacyLevel === 'shared';

  const loadInvitations = useCallback(async () => {
    try {
      const data = await getInvitations();
      setInvitations(data);
    } catch {
      // silent — invitations are not critical
    }
  }, []);

  useEffect(() => {
    loadInvitations();
    const interval = setInterval(loadInvitations, 15_000);
    return () => clearInterval(interval);
  }, [loadInvitations]);

  async function handleShare() {
    if (!selectedRepo) return;
    setSharing(true);
    setError(null);
    try {
      await convertToShared(selectedRepo.owner, selectedRepo.repo);
      await refreshRepos();
    } catch (err: any) {
      setError(err.message ?? 'Failed to share repository');
    } finally {
      setSharing(false);
    }
  }

  async function handleInvite() {
    if (!selectedRepo || !peerIdInput.trim()) return;
    setInviting(true);
    setError(null);
    try {
      await sendInvitation(selectedRepo.owner, selectedRepo.repo, peerIdInput.trim());
      setPeerIdInput('');
      await loadInvitations();
    } catch (err: any) {
      setError(err.message ?? 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  }

  async function handleAccept(invitationId: string) {
    setError(null);
    try {
      await acceptInvitation(invitationId);
      await loadInvitations();
    } catch (err: any) {
      setError(err.message ?? 'Failed to accept invitation');
    }
  }

  async function handleDecline(invitationId: string) {
    setError(null);
    try {
      await declineInvitation(invitationId);
      await loadInvitations();
    } catch (err: any) {
      setError(err.message ?? 'Failed to decline invitation');
    }
  }

  function handleCopyParanetId() {
    if (!selectedRepo) return;
    navigator.clipboard.writeText(selectedRepo.paranetId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!selectedRepo) {
    return (
      <div className="page">
        <h2 className="page-title">Agents & Collaboration</h2>
        <div className="empty-state">
          <p>Multi-agent collaboration features will be available once a repository is configured and synced.</p>
          <p>Agents subscribed to the same paranet can participate in collaborative reviews.</p>
        </div>
      </div>
    );
  }

  const pendingReceived = invitations.received.filter(i => i.status === 'pending');
  const acceptedInvitations = [
    ...invitations.sent.filter(i => i.status === 'accepted'),
    ...invitations.received.filter(i => i.status === 'accepted'),
  ];

  return (
    <div className="page">
      <h2 className="page-title">Agents & Collaboration</h2>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 16, background: 'var(--bg-danger, #2d1b1b)', border: '1px solid var(--danger, #e53e3e)', borderRadius: 'var(--radius)', color: 'var(--danger, #e53e3e)' }}>
          {error}
        </div>
      )}

      {/* Collaboration status banner */}
      {isLocal && (
        <div style={{ padding: '12px 16px', marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--warning, #d69e2e)', borderRadius: 'var(--radius)' }}>
          <p style={{ margin: 0, color: 'var(--warning, #d69e2e)', fontWeight: 600 }}>
            Local Only Mode
          </p>
          <p style={{ margin: '4px 0 12px', color: 'var(--text-muted)' }}>
            Repository <strong className="mono">{repoKey(selectedRepo)}</strong> is in local-only mode.
            Share it to enable P2P collaboration with other DKG nodes.
          </p>
          <button onClick={handleShare} disabled={sharing} style={{ cursor: sharing ? 'wait' : 'pointer' }}>
            {sharing ? 'Sharing...' : 'Share & Collaborate'}
          </button>
        </div>
      )}

      {isShared && (
        <div style={{ padding: '12px 16px', marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--success, #38a169)', borderRadius: 'var(--radius)' }}>
          <p style={{ margin: 0, color: 'var(--success, #38a169)', fontWeight: 600 }}>
            Shared Mode
          </p>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>
            Repository <strong className="mono">{repoKey(selectedRepo)}</strong> is shared via P2P.
          </p>
          {/* Paranet ID display with copy */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span className="mono" style={{ background: 'var(--bg)', padding: '4px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedRepo.paranetId}
            </span>
            <button onClick={handleCopyParanetId} style={{ whiteSpace: 'nowrap' }}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Invite peer section — only for shared repos */}
      {isShared && (
        <div style={{ marginBottom: 24 }}>
          <h3>Invite Peer</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Enter peer ID..."
              value={peerIdInput}
              onChange={e => setPeerIdInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleInvite()}
              style={{ flex: 1, padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            />
            <button onClick={handleInvite} disabled={inviting || !peerIdInput.trim()}>
              {inviting ? 'Sending...' : 'Send Invite'}
            </button>
          </div>
        </div>
      )}

      {/* Pending invitations */}
      {pendingReceived.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3>Pending Invitations</h3>
          {pendingReceived.map(inv => (
            <div key={inv.invitationId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', marginBottom: 8, background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <div>
                <span className="mono" style={{ fontSize: '0.9em' }}>{inv.fromPeerId.slice(0, 12)}...</span>
                <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>invites you to {inv.repoKey}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleAccept(inv.invitationId)}>Accept</button>
                <button onClick={() => handleDecline(inv.invitationId)} style={{ opacity: 0.7 }}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active collaborators */}
      {isShared && (
        <div style={{ marginBottom: 24 }}>
          <h3>Active Collaborators</h3>
          {acceptedInvitations.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>
              No collaborators yet. Send invitations to other DKG node operators.
            </p>
          ) : (
            acceptedInvitations.map(inv => (
              <div key={inv.invitationId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 4, background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success, #38a169)' }} />
                <span className="mono" style={{ fontSize: '0.9em' }}>
                  {inv.direction === 'sent' ? inv.toPeerId : inv.fromPeerId}
                </span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                  ({inv.direction === 'sent' ? 'invited' : 'joined'})
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Sent invitations */}
      {isShared && invitations.sent.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3>Sent Invitations</h3>
          {invitations.sent.map(inv => (
            <div key={inv.invitationId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', marginBottom: 4, background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <span className="mono" style={{ fontSize: '0.9em' }}>{inv.toPeerId.slice(0, 12)}...</span>
              <span style={{
                padding: '2px 8px',
                borderRadius: 'var(--radius)',
                fontSize: '0.8em',
                background: inv.status === 'accepted' ? 'var(--success, #38a169)' : inv.status === 'declined' ? 'var(--danger, #e53e3e)' : 'var(--warning, #d69e2e)',
                color: '#fff',
              }}>
                {inv.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
