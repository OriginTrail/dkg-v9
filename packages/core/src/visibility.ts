import type { AccessPolicy, Visibility } from './types.js';

export interface ResolvedVisibility {
  accessPolicy: AccessPolicy;
  allowedPeers: string[];
  broadcast: boolean;
}

/**
 * Resolves the unified Visibility type to internal access control parameters.
 * Handles backward compatibility with legacy parameters.
 *
 * Precedence:
 *  1. `visibility` (new unified parameter) takes priority
 *  2. Legacy parameters (`private`, `localOnly`, `accessPolicy`) are used as fallback
 *  3. Default: public (broadcast, public access) — matches pre-migration behavior
 */
export function resolveVisibility(
  visibility: Visibility | undefined,
  legacy?: {
    accessPolicy?: AccessPolicy;
    allowedPeers?: string[];
    localOnly?: boolean;
    private?: boolean;
  },
): ResolvedVisibility {
  // New parameter takes precedence
  if (visibility !== undefined) {
    if (visibility === 'private') {
      return { accessPolicy: 'ownerOnly', allowedPeers: [], broadcast: false };
    }
    if (visibility === 'public') {
      return { accessPolicy: 'public', allowedPeers: [], broadcast: true };
    }
    if (typeof visibility === 'object' && 'peers' in visibility) {
      // Validate peer list: trim whitespace, remove empty strings, deduplicate
      const cleaned = [...new Set(visibility.peers.map(p => p.trim()).filter(p => p.length > 0))];
      if (cleaned.length === 0) {
        throw new Error('visibility { peers: [...] } requires at least one valid peer ID');
      }
      // allowList must NOT broadcast on GossipSub — any subscribed peer can
      // read raw gossip messages. allowList data reaches peers via sync only.
      return { accessPolicy: 'allowList', allowedPeers: cleaned, broadcast: false };
    }
  }

  // Fall back to legacy parameters
  if (legacy?.private || legacy?.localOnly) {
    return { accessPolicy: 'ownerOnly', allowedPeers: [], broadcast: false };
  }
  if (legacy?.accessPolicy === 'ownerOnly') {
    return { accessPolicy: 'ownerOnly', allowedPeers: legacy.allowedPeers ?? [], broadcast: false };
  }
  if (legacy?.accessPolicy === 'allowList') {
    return { accessPolicy: 'allowList', allowedPeers: legacy.allowedPeers ?? [], broadcast: false };
  }
  if (legacy?.accessPolicy === 'public') {
    return { accessPolicy: 'public', allowedPeers: [], broadcast: true };
  }

  // Default: public (matches current behavior for pre-migration callers)
  return { accessPolicy: 'public', allowedPeers: [], broadcast: true };
}
