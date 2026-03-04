import { describe, it, expect } from 'vitest';
import { quorumThreshold, isQuorumMet, getActiveMemberCount } from '../src/quorum.js';
import type { QuorumPolicy } from '../src/types.js';

const policy: QuorumPolicy = { type: 'THRESHOLD', numerator: 2, denominator: 3, minSigners: 2 };

describe('quorumThreshold', () => {
  it('computes ceil(N * 2/3) for 3 members', () => {
    expect(quorumThreshold(policy, 3)).toBe(2);
  });

  it('computes ceil(N * 2/3) for 4 members', () => {
    expect(quorumThreshold(policy, 4)).toBe(3);
  });

  it('computes ceil(N * 2/3) for 5 members', () => {
    expect(quorumThreshold(policy, 5)).toBe(4);
  });

  it('enforces minSigners when fraction is too low', () => {
    expect(quorumThreshold(policy, 1)).toBe(2);
    expect(quorumThreshold(policy, 2)).toBe(2);
  });

  it('handles unanimous policy', () => {
    const unanimous: QuorumPolicy = { type: 'THRESHOLD', numerator: 1, denominator: 1, minSigners: 1 };
    expect(quorumThreshold(unanimous, 3)).toBe(3);
    expect(quorumThreshold(unanimous, 5)).toBe(5);
  });

  it('handles majority policy', () => {
    const majority: QuorumPolicy = { type: 'THRESHOLD', numerator: 1, denominator: 2, minSigners: 1 };
    expect(quorumThreshold(majority, 4)).toBe(2);
    expect(quorumThreshold(majority, 5)).toBe(3);
  });
});

describe('isQuorumMet', () => {
  it('returns true when acks meet threshold', () => {
    expect(isQuorumMet(policy, 3, 2)).toBe(true);
    expect(isQuorumMet(policy, 3, 3)).toBe(true);
  });

  it('returns false when acks are below threshold', () => {
    expect(isQuorumMet(policy, 3, 1)).toBe(false);
    expect(isQuorumMet(policy, 5, 3)).toBe(false);
  });

  it('respects minSigners', () => {
    expect(isQuorumMet(policy, 2, 1)).toBe(false);
    expect(isQuorumMet(policy, 2, 2)).toBe(true);
  });
});

describe('getActiveMemberCount', () => {
  it('subtracts equivocators and inactive members', () => {
    expect(getActiveMemberCount(5, 1, 1)).toBe(3);
  });

  it('returns total when no exclusions', () => {
    expect(getActiveMemberCount(5, 0, 0)).toBe(5);
  });

  it('can reach zero', () => {
    expect(getActiveMemberCount(3, 2, 1)).toBe(0);
  });
});
