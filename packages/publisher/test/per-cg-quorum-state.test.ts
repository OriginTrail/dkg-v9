/**
 * PR #229 bot review round 11 (dkg-publisher.ts:1471).
 *
 * The `perCgRequiredSignatures` gate used to short-circuit to
 * tentative as soon as ANY peer ACK had been collected, because
 * `selfSignEligible` was keyed on `v10ACKs.length === 0`. In an
 * M-of-N context graph a publish with 1 peer ACK plus the local
 * publisher's own participant ACK can still meet quorum — the old
 * gate dropped that self-sign contribution on the floor and forced
 * an unnecessary tentative result even though the on-chain contract
 * would have accepted the combined set.
 *
 * These tests pin the new semantic of `computePerCgQuorumState`
 * (extracted from the `publish()` body precisely so the quorum math
 * can be asserted without standing up Hardhat):
 *
 *   - selfSignEligible iff publisher identity NOT already present;
 *   - effectiveAckCount = collected + (selfSignEligible ? 1 : 0);
 *   - perCgQuorumUnmet iff perCgRequired > 0 AND effective < required;
 *   - double-count defence: if publisher ACK is already in the
 *     collected set, self-sign eligibility is FALSE (dedupe by id).
 */
import { describe, it, expect } from 'vitest';
import { computePerCgQuorumState } from '../src/dkg-publisher.js';

const PUBLISHER_ID = 101n;
const PEER_A = 201n;
const PEER_B = 202n;

function baseInputs(overrides: Partial<Parameters<typeof computePerCgQuorumState>[0]> = {}) {
  return {
    perCgRequiredSignatures: undefined,
    collectedAcks: undefined as
      | ReadonlyArray<{ readonly nodeIdentityId: bigint }>
      | undefined,
    publisherWalletReady: true,
    publisherNodeIdentityId: PUBLISHER_ID,
    v10ChainReady: true,
    ...overrides,
  };
}

describe('computePerCgQuorumState (bot review r11-1)', () => {
  it('single-node baseline: no peer ACKs, self-sign is the ONE ACK, meets required=1', () => {
    const s = computePerCgQuorumState(baseInputs({ perCgRequiredSignatures: 1 }));
    expect(s.collectedAckCount).toBe(0);
    expect(s.selfSignEligible).toBe(true);
    expect(s.publisherAlreadyAcked).toBe(false);
    expect(s.effectiveAckCount).toBe(1);
    expect(s.perCgQuorumUnmet).toBe(false);
  });

  // r11-1 regression core: 1 peer ACK + self-sign must clear required=2.
  it('M-of-N (required=2): 1 peer ACK + self-sign counts toward quorum and clears', () => {
    const s = computePerCgQuorumState(
      baseInputs({
        perCgRequiredSignatures: 2,
        collectedAcks: [{ nodeIdentityId: PEER_A }],
      }),
    );
    expect(s.collectedAckCount).toBe(1);
    expect(s.selfSignEligible).toBe(true);
    expect(s.effectiveAckCount).toBe(2);
    expect(s.perCgQuorumUnmet).toBe(false);
  });

  it('M-of-N (required=3): 1 peer ACK + self-sign still short — stays tentative', () => {
    const s = computePerCgQuorumState(
      baseInputs({
        perCgRequiredSignatures: 3,
        collectedAcks: [{ nodeIdentityId: PEER_A }],
      }),
    );
    expect(s.effectiveAckCount).toBe(2);
    expect(s.perCgQuorumUnmet).toBe(true);
  });

  it('M-of-N (required=2): 2 peer ACKs already enough, self-sign still adds exactly one more', () => {
    const s = computePerCgQuorumState(
      baseInputs({
        perCgRequiredSignatures: 2,
        collectedAcks: [{ nodeIdentityId: PEER_A }, { nodeIdentityId: PEER_B }],
      }),
    );
    expect(s.collectedAckCount).toBe(2);
    expect(s.selfSignEligible).toBe(true);
    expect(s.effectiveAckCount).toBe(3);
    expect(s.perCgQuorumUnmet).toBe(false);
  });

  // Double-count defence: publisher identity is ALREADY in collected
  // set — self-sign eligibility flips off so we don't dedupe-adjust
  // the count twice.
  it('publisher ACK already present in v10ACKs → selfSignEligible=false (dedupe)', () => {
    const s = computePerCgQuorumState(
      baseInputs({
        perCgRequiredSignatures: 1,
        collectedAcks: [{ nodeIdentityId: PUBLISHER_ID }],
      }),
    );
    expect(s.publisherAlreadyAcked).toBe(true);
    expect(s.selfSignEligible).toBe(false);
    expect(s.effectiveAckCount).toBe(1);
    expect(s.perCgQuorumUnmet).toBe(false);
  });

  it('no publisher identity (0n) → selfSignEligible=false regardless of collected set', () => {
    const s = computePerCgQuorumState(
      baseInputs({
        perCgRequiredSignatures: 1,
        collectedAcks: undefined,
        publisherNodeIdentityId: 0n,
      }),
    );
    expect(s.selfSignEligible).toBe(false);
    expect(s.effectiveAckCount).toBe(0);
    expect(s.perCgQuorumUnmet).toBe(true);
  });

  it('no wallet ready → selfSignEligible=false', () => {
    const s = computePerCgQuorumState(
      baseInputs({
        perCgRequiredSignatures: 1,
        publisherWalletReady: false,
      }),
    );
    expect(s.selfSignEligible).toBe(false);
    expect(s.effectiveAckCount).toBe(0);
    expect(s.perCgQuorumUnmet).toBe(true);
  });

  it('no V10 chain context → selfSignEligible=false (would emit digest against nothing)', () => {
    const s = computePerCgQuorumState(
      baseInputs({
        perCgRequiredSignatures: 1,
        v10ChainReady: false,
      }),
    );
    expect(s.selfSignEligible).toBe(false);
    expect(s.perCgQuorumUnmet).toBe(true);
  });

  it('perCgRequired=0 means "no explicit gate" → quorumUnmet always false', () => {
    const s = computePerCgQuorumState(
      baseInputs({
        perCgRequiredSignatures: 0,
        collectedAcks: undefined,
      }),
    );
    expect(s.perCgQuorumUnmet).toBe(false);
  });

  // Pre-r11-1 behaviour guard: the OLD gate would have reported
  // effectiveAckCount === 1 here (because `selfSignEligible` was
  // keyed on `collectedAckCount === 0`). Asserting effective=2
  // explicitly ensures we notice if the broadened eligibility
  // regresses back to the narrower form.
  it('regression floor: 1 peer ACK + publisher ready → effectiveAckCount MUST be 2', () => {
    const s = computePerCgQuorumState(
      baseInputs({
        collectedAcks: [{ nodeIdentityId: PEER_A }],
      }),
    );
    expect(s.effectiveAckCount).toBe(2);
  });
});
