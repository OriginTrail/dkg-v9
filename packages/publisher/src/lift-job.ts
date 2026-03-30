export const LIFT_JOB_STATES = [
  'accepted',
  'claimed',
  'validated',
  'broadcast',
  'included',
  'finalized',
  'failed',
] as const;

export type LiftJobState = (typeof LIFT_JOB_STATES)[number];

export const LIFT_TRANSITION_TYPES = ['CREATE', 'MUTATE', 'REVOKE'] as const;

export type LiftTransitionType = (typeof LIFT_TRANSITION_TYPES)[number];

export const LIFT_AUTHORITY_TYPES = ['owner', 'multisig', 'quorum', 'capability'] as const;

export type LiftAuthorityType = (typeof LIFT_AUTHORITY_TYPES)[number];

export const LIFT_JOB_FAILURE_PHASES = [
  'validation',
  'broadcast',
  'confirmation',
  'recovery',
] as const;

export type LiftJobFailurePhase = (typeof LIFT_JOB_FAILURE_PHASES)[number];

export const LIFT_JOB_FAILURE_MODES = ['retryable', 'terminal', 'timeout'] as const;

export type LiftJobFailureMode = (typeof LIFT_JOB_FAILURE_MODES)[number];

export const LIFT_JOB_TIMEOUT_HANDLINGS = [
  'reset_to_accepted',
  'fail_job',
  'check_chain_then_finalize_or_reset',
  'retry_recovery',
] as const;

export type LiftJobTimeoutHandling = (typeof LIFT_JOB_TIMEOUT_HANDLINGS)[number];

export const LIFT_JOB_FAILURE_RESOLUTIONS = [
  'reset_to_accepted',
  'fail_job',
  'check_chain_then_finalize_or_reset',
  'retry_recovery',
] as const;

export type LiftJobFailureResolution = (typeof LIFT_JOB_FAILURE_RESOLUTIONS)[number];

export const LIFT_JOB_FAILURE_CODES = [
  'workspace_unavailable',
  'workspace_slice_not_found',
  'canonicalization_failed',
  'authority_unavailable',
  'authority_forbidden',
  'validation_timeout',
  'wallet_claim_timeout',
  'wallet_unavailable',
  'rpc_unavailable',
  'tx_submit_timeout',
  'tx_reverted',
  'insufficient_funds',
  'nonce_conflict',
  'inclusion_timeout',
  'finality_timeout',
  'confirmation_mismatch',
  'chain_reorg',
  'recovery_lookup_timeout',
  'recovery_chain_unavailable',
  'recovery_state_inconsistent',
] as const;

export type LiftJobFailureCode = (typeof LIFT_JOB_FAILURE_CODES)[number];

export type LiftJobActiveState = Exclude<LiftJobState, TerminalLiftJobState>;

export type LiftRecoverableJobState = Extract<LiftJobState, 'claimed' | 'validated' | 'broadcast' | 'included'>;

export type LiftJobResettableState = Extract<LiftRecoverableJobState, 'claimed' | 'validated' | 'broadcast'>;

export type LiftJobChainRecoverableState = Extract<LiftRecoverableJobState, 'broadcast' | 'included'>;

export type LiftJobHex = `0x${string}`;

export type LiftJobBigInt = `${bigint}`;

export interface LiftJobTimeoutMetadata {
  readonly timeoutMs: number;
  readonly timeoutAt: number;
  readonly handling: LiftJobTimeoutHandling;
}

export interface LiftJobFailurePolicy {
  readonly code: LiftJobFailureCode;
  readonly phase: LiftJobFailurePhase;
  readonly mode: LiftJobFailureMode;
  readonly retryable: boolean;
  readonly resolution: LiftJobFailureResolution;
  readonly timeoutHandling?: LiftJobTimeoutHandling;
}

export const LIFT_JOB_FAILURE_POLICIES: Record<LiftJobFailureCode, LiftJobFailurePolicy> = {
  workspace_unavailable: {
    code: 'workspace_unavailable',
    phase: 'validation',
    mode: 'retryable',
    retryable: true,
    resolution: 'reset_to_accepted',
  },
  workspace_slice_not_found: {
    code: 'workspace_slice_not_found',
    phase: 'validation',
    mode: 'terminal',
    retryable: false,
    resolution: 'fail_job',
  },
  canonicalization_failed: {
    code: 'canonicalization_failed',
    phase: 'validation',
    mode: 'terminal',
    retryable: false,
    resolution: 'fail_job',
  },
  authority_unavailable: {
    code: 'authority_unavailable',
    phase: 'validation',
    mode: 'retryable',
    retryable: true,
    resolution: 'reset_to_accepted',
  },
  authority_forbidden: {
    code: 'authority_forbidden',
    phase: 'validation',
    mode: 'terminal',
    retryable: false,
    resolution: 'fail_job',
  },
  validation_timeout: {
    code: 'validation_timeout',
    phase: 'validation',
    mode: 'timeout',
    retryable: true,
    resolution: 'reset_to_accepted',
    timeoutHandling: 'reset_to_accepted',
  },
  wallet_claim_timeout: {
    code: 'wallet_claim_timeout',
    phase: 'broadcast',
    mode: 'timeout',
    retryable: true,
    resolution: 'reset_to_accepted',
    timeoutHandling: 'reset_to_accepted',
  },
  wallet_unavailable: {
    code: 'wallet_unavailable',
    phase: 'broadcast',
    mode: 'retryable',
    retryable: true,
    resolution: 'reset_to_accepted',
  },
  rpc_unavailable: {
    code: 'rpc_unavailable',
    phase: 'broadcast',
    mode: 'retryable',
    retryable: true,
    resolution: 'reset_to_accepted',
  },
  tx_submit_timeout: {
    code: 'tx_submit_timeout',
    phase: 'broadcast',
    mode: 'timeout',
    retryable: true,
    resolution: 'check_chain_then_finalize_or_reset',
    timeoutHandling: 'check_chain_then_finalize_or_reset',
  },
  tx_reverted: {
    code: 'tx_reverted',
    phase: 'broadcast',
    mode: 'terminal',
    retryable: false,
    resolution: 'fail_job',
  },
  insufficient_funds: {
    code: 'insufficient_funds',
    phase: 'broadcast',
    mode: 'terminal',
    retryable: false,
    resolution: 'fail_job',
  },
  nonce_conflict: {
    code: 'nonce_conflict',
    phase: 'broadcast',
    mode: 'retryable',
    retryable: true,
    resolution: 'reset_to_accepted',
  },
  inclusion_timeout: {
    code: 'inclusion_timeout',
    phase: 'confirmation',
    mode: 'timeout',
    retryable: true,
    resolution: 'check_chain_then_finalize_or_reset',
    timeoutHandling: 'check_chain_then_finalize_or_reset',
  },
  finality_timeout: {
    code: 'finality_timeout',
    phase: 'confirmation',
    mode: 'timeout',
    retryable: true,
    resolution: 'check_chain_then_finalize_or_reset',
    timeoutHandling: 'check_chain_then_finalize_or_reset',
  },
  confirmation_mismatch: {
    code: 'confirmation_mismatch',
    phase: 'confirmation',
    mode: 'terminal',
    retryable: false,
    resolution: 'fail_job',
  },
  chain_reorg: {
    code: 'chain_reorg',
    phase: 'confirmation',
    mode: 'retryable',
    retryable: true,
    resolution: 'check_chain_then_finalize_or_reset',
  },
  recovery_lookup_timeout: {
    code: 'recovery_lookup_timeout',
    phase: 'recovery',
    mode: 'timeout',
    retryable: true,
    resolution: 'retry_recovery',
    timeoutHandling: 'retry_recovery',
  },
  recovery_chain_unavailable: {
    code: 'recovery_chain_unavailable',
    phase: 'recovery',
    mode: 'retryable',
    retryable: true,
    resolution: 'retry_recovery',
  },
  recovery_state_inconsistent: {
    code: 'recovery_state_inconsistent',
    phase: 'recovery',
    mode: 'terminal',
    retryable: false,
    resolution: 'fail_job',
  },
};

const LIFT_JOB_FAILURE_ALLOWED_STATES: Record<LiftJobFailureCode, readonly LiftJobActiveState[]> = {
  workspace_unavailable: ['accepted', 'claimed', 'validated'],
  workspace_slice_not_found: ['accepted', 'claimed', 'validated'],
  canonicalization_failed: ['validated'],
  authority_unavailable: ['validated'],
  authority_forbidden: ['validated'],
  validation_timeout: ['validated'],
  wallet_claim_timeout: ['accepted', 'claimed'],
  wallet_unavailable: ['claimed', 'broadcast'],
  rpc_unavailable: ['broadcast'],
  tx_submit_timeout: ['broadcast'],
  tx_reverted: ['broadcast'],
  insufficient_funds: ['broadcast'],
  nonce_conflict: ['broadcast'],
  inclusion_timeout: ['broadcast', 'included'],
  finality_timeout: ['included'],
  confirmation_mismatch: ['broadcast', 'included'],
  chain_reorg: ['broadcast', 'included'],
  recovery_lookup_timeout: ['broadcast', 'included'],
  recovery_chain_unavailable: ['broadcast', 'included'],
  recovery_state_inconsistent: ['broadcast', 'included'],
};

export interface LiftAuthorityProof {
  readonly type: LiftAuthorityType;
  readonly proofRef: string;
}

export interface LiftRequest {
  readonly workspaceId: string;
  readonly workspaceOperationId: string;
  readonly roots: readonly string[];
  readonly paranetId: string;
  readonly namespace: string;
  readonly scope: string;
  readonly transitionType: LiftTransitionType;
  readonly authority: LiftAuthorityProof;
  readonly priorVersion?: string;
}

export const LIFT_REQUEST_IMMUTABLE_FIELDS = [
  'workspaceId',
  'workspaceOperationId',
  'roots',
  'paranetId',
  'namespace',
  'scope',
  'transitionType',
  'authority',
  'priorVersion',
] as const;

export interface LiftJobTimestamps {
  readonly acceptedAt: number;
  readonly claimedAt?: number;
  readonly validatedAt?: number;
  readonly broadcastAt?: number;
  readonly includedAt?: number;
  readonly finalizedAt?: number;
  readonly failedAt?: number;
  readonly lastRetriedAt?: number;
  readonly nextRetryAt?: number;
  readonly lastRecoveredAt?: number;
  readonly updatedAt: number;
}

export interface LiftJobRetryMetadata {
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly lastRetryReason?: string;
}

export interface LiftJobRecoveryResetToAccepted {
  readonly action: 'reset_to_accepted';
  readonly recoveredFromStatus: LiftJobResettableState;
  readonly txHashChecked?: LiftJobHex;
  readonly note?: string;
}

export interface LiftJobRecoveryFinalizedFromChain {
  readonly action: 'finalized_from_chain';
  readonly recoveredFromStatus: LiftJobChainRecoverableState;
  readonly txHashChecked: LiftJobHex;
  readonly note?: string;
}

export type LiftJobRecoveryMetadata = LiftJobRecoveryResetToAccepted | LiftJobRecoveryFinalizedFromChain;

export interface LiftJobRecoveryResetClaimed extends LiftJobRecoveryResetToAccepted {
  readonly recoveredFromStatus: 'claimed';
}

export interface LiftJobRecoveryResetValidated extends LiftJobRecoveryResetToAccepted {
  readonly recoveredFromStatus: 'validated';
}

export interface LiftJobRecoveryResetBroadcast extends LiftJobRecoveryResetToAccepted {
  readonly recoveredFromStatus: 'broadcast';
}

export interface LiftJobRecoveryFinalizedBroadcast extends LiftJobRecoveryFinalizedFromChain {
  readonly recoveredFromStatus: 'broadcast';
}

export interface LiftJobRecoveryFinalizedIncluded extends LiftJobRecoveryFinalizedFromChain {
  readonly recoveredFromStatus: 'included';
}

export interface LiftJobClaimMetadata {
  readonly walletId: string;
  readonly claimedBy?: string;
  readonly claimToken?: string;
  readonly claimLeaseExpiresAt?: number;
}

export interface LiftJobValidationMetadata {
  readonly canonicalRoots: readonly string[];
  readonly canonicalRootMap: Readonly<Record<string, string>>;
  readonly workspaceQuadCount: number;
  readonly authorityProofRef: string;
  readonly transitionType: LiftTransitionType;
  readonly priorVersion?: string;
}

export interface LiftJobBroadcastMetadata {
  readonly txHash: LiftJobHex;
  readonly walletId: string;
  readonly merkleRoot?: LiftJobHex;
  readonly publicByteSize?: number;
}

export interface LiftJobInclusionMetadata {
  readonly txHash: LiftJobHex;
  readonly blockNumber: number;
  readonly blockHash?: LiftJobHex;
  readonly blockTimestamp?: number;
}

export interface LiftJobFinalizationMetadata {
  readonly txHash: LiftJobHex;
  readonly ual?: string;
  readonly batchId?: LiftJobBigInt;
  readonly startKAId?: LiftJobBigInt;
  readonly endKAId?: LiftJobBigInt;
  readonly publisherAddress?: LiftJobHex;
}

export interface LiftJobFailureMetadata {
  readonly failedFromState: LiftJobActiveState;
  readonly phase: LiftJobFailurePhase;
  readonly mode: LiftJobFailureMode;
  readonly retryable: boolean;
  readonly resolution: LiftJobFailureResolution;
  readonly code: LiftJobFailureCode;
  readonly message: string;
  readonly errorPayloadRef: string;
  readonly stackTraceRef?: string;
  readonly rpcResponseRef?: string;
  readonly revertReasonRef?: string;
  readonly timeout?: LiftJobTimeoutMetadata;
}

export interface LiftJobControlPlaneRefs {
  readonly jobRef?: string;
  readonly walletLockRef?: string;
}

export const LIFT_JOB_IMMUTABLE_FIELDS = [
  'jobId',
  'request',
  'timestamps.acceptedAt',
  'retries.maxRetries',
] as const;

export const LIFT_JOB_PROGRESS_METADATA_FIELDS = [
  'claim',
  'validation',
  'broadcast',
  'inclusion',
  'finalization',
  'failure',
  'recovery',
] as const;

export const LIFT_JOB_MUTABLE_PERSISTED_FIELDS = [
  'status',
  'timestamps',
  'retries',
  'claim',
  'validation',
  'broadcast',
  'inclusion',
  'finalization',
  'failure',
  'recovery',
  'controlPlane',
] as const;

export interface LiftJobBase {
  readonly jobId: string;
  readonly request: LiftRequest;
  readonly status: LiftJobState;
  readonly timestamps: LiftJobTimestamps;
  readonly retries: LiftJobRetryMetadata;
  readonly recovery?: LiftJobRecoveryMetadata;
  readonly controlPlane?: LiftJobControlPlaneRefs;
}

export interface LiftJobAccepted extends LiftJobBase {
  readonly status: 'accepted';
  readonly claim?: undefined;
  readonly validation?: undefined;
  readonly broadcast?: undefined;
  readonly inclusion?: undefined;
  readonly finalization?: undefined;
  readonly failure?: undefined;
}

export interface LiftJobClaimed extends LiftJobBase {
  readonly status: 'claimed';
  readonly claim: LiftJobClaimMetadata;
  readonly validation?: undefined;
  readonly broadcast?: undefined;
  readonly inclusion?: undefined;
  readonly finalization?: undefined;
  readonly failure?: undefined;
}

export interface LiftJobValidated extends LiftJobBase {
  readonly status: 'validated';
  readonly claim: LiftJobClaimMetadata;
  readonly validation: LiftJobValidationMetadata;
  readonly broadcast?: undefined;
  readonly inclusion?: undefined;
  readonly finalization?: undefined;
  readonly failure?: undefined;
}

export interface LiftJobBroadcast extends LiftJobBase {
  readonly status: 'broadcast';
  readonly claim: LiftJobClaimMetadata;
  readonly validation: LiftJobValidationMetadata;
  readonly broadcast: LiftJobBroadcastMetadata;
  readonly inclusion?: undefined;
  readonly finalization?: undefined;
  readonly failure?: undefined;
}

export interface LiftJobIncluded extends LiftJobBase {
  readonly status: 'included';
  readonly claim: LiftJobClaimMetadata;
  readonly validation: LiftJobValidationMetadata;
  readonly broadcast: LiftJobBroadcastMetadata;
  readonly inclusion: LiftJobInclusionMetadata;
  readonly finalization?: undefined;
  readonly failure?: undefined;
}

export interface LiftJobFinalized extends LiftJobBase {
  readonly status: 'finalized';
  readonly claim: LiftJobClaimMetadata;
  readonly validation: LiftJobValidationMetadata;
  readonly broadcast: LiftJobBroadcastMetadata;
  readonly inclusion: LiftJobInclusionMetadata;
  readonly finalization: LiftJobFinalizationMetadata;
  readonly failure?: undefined;
}

export interface LiftJobFailed extends LiftJobBase {
  readonly status: 'failed';
  readonly finalization?: undefined;
}

export interface LiftJobFailedFromAccepted extends LiftJobFailed {
  readonly status: 'failed';
  readonly claim?: undefined;
  readonly validation?: undefined;
  readonly broadcast?: undefined;
  readonly inclusion?: undefined;
  readonly failure: LiftJobFailureMetadata & { readonly failedFromState: 'accepted' };
  readonly recovery?: undefined;
}

export interface LiftJobFailedFromClaimed extends LiftJobFailed {
  readonly status: 'failed';
  readonly claim: LiftJobClaimMetadata;
  readonly validation?: undefined;
  readonly broadcast?: undefined;
  readonly inclusion?: undefined;
  readonly failure: LiftJobFailureMetadata & { readonly failedFromState: 'claimed' };
  readonly recovery?: LiftJobRecoveryResetClaimed;
}

export interface LiftJobFailedFromValidated extends LiftJobFailed {
  readonly status: 'failed';
  readonly claim: LiftJobClaimMetadata;
  readonly validation: LiftJobValidationMetadata;
  readonly broadcast?: undefined;
  readonly inclusion?: undefined;
  readonly failure: LiftJobFailureMetadata & { readonly failedFromState: 'validated' };
  readonly recovery?: LiftJobRecoveryResetValidated;
}

export interface LiftJobFailedFromBroadcast extends LiftJobFailed {
  readonly status: 'failed';
  readonly claim: LiftJobClaimMetadata;
  readonly validation: LiftJobValidationMetadata;
  readonly broadcast: LiftJobBroadcastMetadata;
  readonly inclusion?: undefined;
  readonly failure: LiftJobFailureMetadata & { readonly failedFromState: 'broadcast' };
  readonly recovery?: LiftJobRecoveryResetBroadcast | LiftJobRecoveryFinalizedBroadcast;
}

export interface LiftJobFailedFromIncluded extends LiftJobFailed {
  readonly status: 'failed';
  readonly claim?: LiftJobClaimMetadata;
  readonly validation: LiftJobValidationMetadata;
  readonly broadcast: LiftJobBroadcastMetadata;
  readonly inclusion: LiftJobInclusionMetadata;
  readonly failure: LiftJobFailureMetadata & { readonly failedFromState: 'included' };
  readonly recovery?: LiftJobRecoveryFinalizedIncluded;
}

export type LiftJob =
  | LiftJobAccepted
  | LiftJobClaimed
  | LiftJobValidated
  | LiftJobBroadcast
  | LiftJobIncluded
  | LiftJobFinalized
  | LiftJobFailedFromAccepted
  | LiftJobFailedFromClaimed
  | LiftJobFailedFromValidated
  | LiftJobFailedFromBroadcast
  | LiftJobFailedFromIncluded;

export const TERMINAL_LIFT_JOB_STATES = ['finalized', 'failed'] as const;

export type TerminalLiftJobState = (typeof TERMINAL_LIFT_JOB_STATES)[number];

export const LIFT_JOB_ALLOWED_TRANSITIONS: Record<LiftJobState, readonly LiftJobState[]> = {
  accepted: ['claimed', 'failed'],
  claimed: ['validated', 'failed'],
  validated: ['broadcast', 'failed'],
  broadcast: ['included', 'failed'],
  included: ['finalized', 'failed'],
  finalized: [],
  failed: [],
};

export function getAllowedLiftJobTransitions(state: LiftJobState): readonly LiftJobState[] {
  return LIFT_JOB_ALLOWED_TRANSITIONS[state];
}

export function isTerminalLiftJobState(state: LiftJobState): state is TerminalLiftJobState {
  return state === 'finalized' || state === 'failed';
}

export function canTransitionLiftJob(from: LiftJobState, to: LiftJobState): boolean {
  return LIFT_JOB_ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertLiftJobTransition(from: LiftJobState, to: LiftJobState): void {
  if (canTransitionLiftJob(from, to)) {
    return;
  }

  const allowed = getAllowedLiftJobTransitions(from);
  const allowedText = allowed.length > 0 ? allowed.join(', ') : '<none>';
  throw new Error(`Invalid LiftJob transition: ${from} -> ${to}. Allowed: ${allowedText}`);
}

export function getLiftJobFailurePolicy(code: LiftJobFailureCode): LiftJobFailurePolicy {
  return LIFT_JOB_FAILURE_POLICIES[code];
}

export function createLiftJobFailureMetadata(
  params: Omit<LiftJobFailureMetadata, 'phase' | 'mode' | 'retryable' | 'resolution'>,
): LiftJobFailureMetadata {
  const policy = getLiftJobFailurePolicy(params.code);

  const allowedStates = LIFT_JOB_FAILURE_ALLOWED_STATES[params.code];
  if (!allowedStates.includes(params.failedFromState)) {
    throw new Error(
      `Invalid LiftJob failure state for code ${params.code}: ${params.failedFromState}. Allowed: ${allowedStates.join(', ')}`,
    );
  }

  if (policy.mode === 'timeout') {
    if (!params.timeout) {
      throw new Error(`Timeout metadata is required for LiftJob failure code ${params.code}`);
    }
    if (!policy.timeoutHandling) {
      throw new Error(`Timeout handling is not configured for LiftJob failure code ${params.code}`);
    }
    if (params.timeout.handling !== policy.timeoutHandling) {
      throw new Error(
        `Invalid timeout handling for LiftJob failure code ${params.code}: ${params.timeout.handling}. Expected: ${policy.timeoutHandling}`,
      );
    }
  } else if (params.timeout) {
    throw new Error(`Timeout metadata is not allowed for non-timeout LiftJob failure code ${params.code}`);
  }

  return {
    ...params,
    phase: policy.phase,
    mode: policy.mode,
    retryable: policy.retryable,
    resolution: policy.resolution,
  };
}

export function isRetryableLiftJobFailure(code: LiftJobFailureCode): boolean {
  return getLiftJobFailurePolicy(code).retryable;
}

export function isTerminalLiftJobFailure(code: LiftJobFailureCode): boolean {
  return getLiftJobFailurePolicy(code).mode === 'terminal';
}

export function isTimeoutLiftJobFailure(code: LiftJobFailureCode): boolean {
  return getLiftJobFailurePolicy(code).mode === 'timeout';
}
