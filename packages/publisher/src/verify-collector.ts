import {
  PROTOCOL_VERIFY_PROPOSAL,
  encodeVerifyProposal,
  decodeVerifyApproval,
  computeACKDigest,
  type VerifyProposalMsg,
  type VerifyApprovalMsg,
} from '@origintrail-official/dkg-core';
import { ethers } from 'ethers';

export interface VerifyCollectorDeps {
  sendP2P: (peerId: string, protocol: string, data: Uint8Array) => Promise<Uint8Array>;
  getParticipantPeers: (contextGraphId: string) => string[];
  verifyIdentity?: (recoveredAddress: string, claimedIdentityId: bigint) => Promise<boolean>;
  log?: (msg: string) => void;
}

export interface CollectedApproval {
  peerId: string;
  signatureR: Uint8Array;
  signatureVS: Uint8Array;
  approverAddress: string;
  identityId: bigint;
}

export interface VerifyCollectionResult {
  approvals: CollectedApproval[];
  merkleRoot: Uint8Array;
  contextGraphId: string;
  verifiedMemoryId: bigint;
}

const MAX_RETRIES = 2;

/**
 * VerifyCollector implements spec §10.1: collecting M-of-N approval
 * signatures for VERIFY proposals via direct P2P streams.
 *
 * Flow:
 * 1. Send VerifyProposal to each participant peer via PROTOCOL_VERIFY_PROPOSAL
 * 2. Each participant signs keccak256(contextGraphId, merkleRoot) and returns VerifyApproval
 * 3. Collect until requiredSignatures reached or timeout
 */
export class VerifyCollector {
  private deps: VerifyCollectorDeps;

  constructor(deps: VerifyCollectorDeps) {
    this.deps = deps;
  }

  async collect(params: {
    contextGraphId: string;
    contextGraphIdOnChain: bigint;
    verifiedMemoryId: bigint;
    batchId: bigint;
    merkleRoot: Uint8Array;
    entities: string[];
    proposerSignature: { r: Uint8Array; vs: Uint8Array };
    requiredSignatures: number;
    timeoutMs: number;
  }): Promise<VerifyCollectionResult> {
    const {
      contextGraphId, contextGraphIdOnChain, verifiedMemoryId,
      batchId, merkleRoot, entities, proposerSignature,
      requiredSignatures, timeoutMs,
    } = params;

    const log = this.deps.log ?? (() => {});

    const proposalId = crypto.getRandomValues(new Uint8Array(16));
    const expiresAt = new Date(Date.now() + timeoutMs).toISOString();

    // Use { low, high, unsigned } Long objects for uint64 fields to avoid
    // precision loss above 2^53 - 1 (protobufjs uint64 representation).
    const toLong = (n: bigint) => ({ low: Number(n & 0xFFFFFFFFn), high: Number((n >> 32n) & 0xFFFFFFFFn), unsigned: true });
    const proposal: VerifyProposalMsg = {
      proposalId,
      verifiedMemoryId: toLong(verifiedMemoryId),
      batchId: toLong(batchId),
      merkleRoot,
      entities,
      agentSignatureR: proposerSignature.r,
      agentSignatureVS: proposerSignature.vs,
      expiresAt,
      contextGraphId,
    };
    const proposalBytes = encodeVerifyProposal(proposal);

    const peers = this.deps.getParticipantPeers(contextGraphId);
    if (peers.length === 0) {
      throw new Error('verify_no_peers: no participant peers connected');
    }
    if (peers.length < requiredSignatures) {
      throw new Error(
        `verify_insufficient_peers: need ${requiredSignatures} approvals but only ${peers.length} participants connected`,
      );
    }

    log(`[VerifyCollector] Requesting approvals from ${peers.length} participants (need ${requiredSignatures})`);

    // Digest for signature verification: keccak256(contextGraphId, merkleRoot)
    const digest = computeACKDigest(contextGraphIdOnChain, merkleRoot);

    const collected: CollectedApproval[] = [];
    const seenAddresses = new Set<string>();

    const requestApproval = async (peerId: string): Promise<CollectedApproval | null> => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await this.deps.sendP2P(peerId, PROTOCOL_VERIFY_PROPOSAL, proposalBytes);
          const approval: VerifyApprovalMsg = decodeVerifyApproval(response);

          const recovered = this.recoverSigner(approval, digest);
          if (!recovered) {
            log(`[VerifyCollector] Invalid signature from ${peerId.slice(-8)}`);
            return null;
          }

          log(`[VerifyCollector] Valid approval from ${peerId.slice(-8)} (address=${recovered.slice(0, 10)}...)`);

          return {
            peerId,
            signatureR: approval.agentSignatureR,
            signatureVS: approval.agentSignatureVS,
            approverAddress: recovered,
            identityId: 0n, // resolved during on-chain submission
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < MAX_RETRIES) {
            log(`[VerifyCollector] Retry ${attempt + 1} for ${peerId.slice(-8)}: ${msg}`);
            await new Promise(r => setTimeout(r, (attempt + 1) * 1000));
          } else {
            log(`[VerifyCollector] Failed from ${peerId.slice(-8)} after ${MAX_RETRIES + 1} attempts: ${msg}`);
          }
        }
      }
      return null;
    };

    let quorumResolve: (() => void) | undefined;
    const quorumPromise = new Promise<void>(resolve => { quorumResolve = resolve; });

    await Promise.race([
      (async () => {
        const promises = peers.map(async (peerId) => {
          if (collected.length >= requiredSignatures) return;
          const approval = await requestApproval(peerId);
          if (approval && !seenAddresses.has(approval.approverAddress)) {
            seenAddresses.add(approval.approverAddress);
            collected.push(approval);
            if (collected.length >= requiredSignatures) {
              quorumResolve?.();
            }
          }
        });
        await Promise.race([Promise.allSettled(promises), quorumPromise]);
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`verify_timeout: ${collected.length}/${requiredSignatures} approvals within ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);

    if (collected.length < requiredSignatures) {
      throw new Error(
        `verify_insufficient: got ${collected.length}/${requiredSignatures} valid approvals from ${peers.length} participants`,
      );
    }

    log(`[VerifyCollector] Collected ${collected.length} approvals — quorum reached`);
    return {
      approvals: collected.slice(0, requiredSignatures),
      merkleRoot,
      contextGraphId,
      verifiedMemoryId,
    };
  }

  private recoverSigner(approval: VerifyApprovalMsg, digest: Uint8Array): string | null {
    try {
      const r = ethers.hexlify(approval.agentSignatureR);
      const vs = ethers.hexlify(approval.agentSignatureVS);
      const prefixedHash = ethers.hashMessage(digest);
      return ethers.recoverAddress(prefixedHash, { r, yParityAndS: vs }) || null;
    } catch {
      return null;
    }
  }
}
