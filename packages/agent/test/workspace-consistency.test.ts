import { describe, it, expect } from 'vitest';
import { monotonicTransition } from '../src/workspace-consistency.js';

const STAGES = ['recruiting', 'traveling', 'finished'] as const;
const SUBJECT = 'urn:test:swarm:1';
const PREDICATE = 'https://origintrail-game.dkg.io/status';

describe('monotonicTransition', () => {
  it('allows forward transition recruiting → traveling', () => {
    const { condition, quad } = monotonicTransition(STAGES, SUBJECT, PREDICATE, 'recruiting', 'traveling');
    expect(condition.subject).toBe(SUBJECT);
    expect(condition.predicate).toBe(PREDICATE);
    expect(condition.expectedValue).toBe('"recruiting"');
    expect(quad.object).toBe('"traveling"');
  });

  it('allows forward transition traveling → finished', () => {
    const { condition, quad } = monotonicTransition(STAGES, SUBJECT, PREDICATE, 'traveling', 'finished');
    expect(condition.expectedValue).toBe('"traveling"');
    expect(quad.object).toBe('"finished"');
  });

  it('allows skip transition recruiting → finished', () => {
    const { condition, quad } = monotonicTransition(STAGES, SUBJECT, PREDICATE, 'recruiting', 'finished');
    expect(condition.expectedValue).toBe('"recruiting"');
    expect(quad.object).toBe('"finished"');
  });

  it('allows initial creation (null → first stage)', () => {
    const { condition, quad } = monotonicTransition(STAGES, SUBJECT, PREDICATE, null, 'recruiting');
    expect(condition.expectedValue).toBeNull();
    expect(quad.object).toBe('"recruiting"');
  });

  it('rejects backward transition traveling → recruiting', () => {
    expect(() => monotonicTransition(STAGES, SUBJECT, PREDICATE, 'traveling', 'recruiting'))
      .toThrow('Non-monotonic transition');
  });

  it('rejects same-state transition', () => {
    expect(() => monotonicTransition(STAGES, SUBJECT, PREDICATE, 'traveling', 'traveling'))
      .toThrow('Non-monotonic transition');
  });

  it('rejects unknown from stage', () => {
    expect(() => monotonicTransition(STAGES, SUBJECT, PREDICATE, 'unknown', 'finished'))
      .toThrow('not in the stage list');
  });

  it('rejects unknown to stage', () => {
    expect(() => monotonicTransition(STAGES, SUBJECT, PREDICATE, 'recruiting', 'unknown'))
      .toThrow('not in the stage list');
  });
});
