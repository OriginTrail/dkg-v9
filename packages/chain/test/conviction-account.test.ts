import { describe, it, expect } from 'vitest';
import { MockChainAdapter } from '../src/mock-adapter.js';

describe('Publishing Conviction Account (MockChainAdapter)', () => {
  it('creates a conviction account', async () => {
    const adapter = new MockChainAdapter();
    const result = await adapter.createConvictionAccount(100_000n * 10n ** 18n, 6);

    expect(result.success).toBe(true);
    expect(result.accountId).toBe(1n);
  });

  it('returns correct discount for known conviction', async () => {
    const adapter = new MockChainAdapter();

    // 500K TRAC locked for 6 epochs = conviction of 3M (in ether units)
    // discount = 5000 * 3M / (3M + 3M) = 2500 bps = 25%
    await adapter.createConvictionAccount(500_000n * 10n ** 18n, 6);
    const { discountBps, conviction } = await adapter.getConvictionDiscount(1n);

    expect(conviction).toBe(3_000_000n * 10n ** 18n);
    expect(discountBps).toBe(2500);
  });

  it('returns higher discount for larger locks', async () => {
    const adapter = new MockChainAdapter();

    // 1M TRAC locked for 12 epochs = conviction of 12M
    // discount ≈ 5000 * 12M / (12M + 3M) = 4000 bps = 40%
    await adapter.createConvictionAccount(1_000_000n * 10n ** 18n, 12);
    const { discountBps } = await adapter.getConvictionDiscount(1n);

    expect(discountBps).toBe(4000);
  });

  it('adds funds to account', async () => {
    const adapter = new MockChainAdapter();
    await adapter.createConvictionAccount(100_000n * 10n ** 18n, 6);
    await adapter.addConvictionFunds(1n, 50_000n * 10n ** 18n);

    const info = await adapter.getConvictionAccountInfo(1n);
    expect(info).not.toBeNull();
    expect(info!.balance).toBe(150_000n * 10n ** 18n);
  });

  it('extends lock and recalculates conviction', async () => {
    const adapter = new MockChainAdapter();
    await adapter.createConvictionAccount(100_000n * 10n ** 18n, 6);

    const before = await adapter.getConvictionAccountInfo(1n);
    expect(before!.conviction).toBe(600_000n * 10n ** 18n);

    await adapter.extendConvictionLock(1n, 6);

    const after = await adapter.getConvictionAccountInfo(1n);
    expect(after!.lockEpochs).toBe(12);
    expect(after!.conviction).toBe(1_200_000n * 10n ** 18n);
  });

  it('returns null for nonexistent account', async () => {
    const adapter = new MockChainAdapter();
    const info = await adapter.getConvictionAccountInfo(999n);
    expect(info).toBeNull();
  });

  it('returns zero discount for nonexistent account', async () => {
    const adapter = new MockChainAdapter();
    const { discountBps } = await adapter.getConvictionDiscount(999n);
    expect(discountBps).toBe(0);
  });
});
