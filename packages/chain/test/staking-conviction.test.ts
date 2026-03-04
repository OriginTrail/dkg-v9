import { describe, it, expect } from 'vitest';
import { MockChainAdapter } from '../src/mock-adapter.js';
import { computeConvictionMultiplier } from '../src/mock-adapter.js';

describe('Staking Conviction (MockChainAdapter)', () => {
  it('stakeWithLock stores lock and returns success', async () => {
    const adapter = new MockChainAdapter();
    const result = await adapter.stakeWithLock(1n, 100_000n, 6);
    expect(result.success).toBe(true);
  });

  it('returns correct multiplier for various lock durations', async () => {
    const adapter = new MockChainAdapter();

    // 0 epochs = 0x (no rewards)
    expect(computeConvictionMultiplier(0)).toBe(0);

    // 1 epoch = 1x (V8 baseline)
    expect(computeConvictionMultiplier(1)).toBeCloseTo(1.0, 2);

    // 3 epochs = 2x
    expect(computeConvictionMultiplier(3)).toBeCloseTo(2.0, 2);

    // 6 epochs ≈ 2.58x
    expect(computeConvictionMultiplier(6)).toBeCloseTo(2.58, 1);

    // 12 epochs = 3x (cap)
    expect(computeConvictionMultiplier(12)).toBeCloseTo(3.0, 1);

    // 24 epochs = still 3x (capped)
    expect(computeConvictionMultiplier(24)).toBe(3.0);
  });

  it('getDelegatorConvictionMultiplier returns correct value after stakeWithLock', async () => {
    const adapter = new MockChainAdapter();
    await adapter.stakeWithLock(1n, 100_000n, 6);

    const { multiplier } = await adapter.getDelegatorConvictionMultiplier(1n, adapter.signerAddress);
    expect(multiplier).toBeCloseTo(2.58, 1);
  });

  it('stakeWithLock only extends, never shortens lock', async () => {
    const adapter = new MockChainAdapter();
    await adapter.stakeWithLock(1n, 100_000n, 12);
    await adapter.stakeWithLock(1n, 50_000n, 3);

    const { multiplier } = await adapter.getDelegatorConvictionMultiplier(1n, adapter.signerAddress);
    // Lock should still be 12, not shortened to 3
    expect(multiplier).toBeCloseTo(3.0, 1);
  });

  it('returns 1x multiplier for default (unset) lock', async () => {
    const adapter = new MockChainAdapter();
    const { multiplier } = await adapter.getDelegatorConvictionMultiplier(1n, '0x0000');
    // Unset defaults to 1 epoch = 1x
    expect(multiplier).toBe(1.0);
  });
});
