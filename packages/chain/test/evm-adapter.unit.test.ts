/**
 * Unit tests for evm-adapter pure helpers and constructor-only surface (07 EVM_MODULE —
 * revert decoding used across chain operations). No live RPC / Hardhat.
 */
import { describe, it, expect } from 'vitest';
import { Interface, ethers } from 'ethers';
import { decodeEvmError, enrichEvmError, EVMChainAdapter, type EVMAdapterConfig } from '../src/evm-adapter.js';

const DEPLOYER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const OTHER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b63b91100';
const ADMIN_PK = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

function minimalConfig(overrides: Partial<EVMAdapterConfig> = {}): EVMAdapterConfig {
  return {
    rpcUrl: 'http://127.0.0.1:59998',
    privateKey: DEPLOYER_PK,
    adminPrivateKey: ADMIN_PK,
    hubAddress: '0x0000000000000000000000000000000000000001',
    chainId: 'evm:31337',
    ...overrides,
  };
}

describe('decodeEvmError / enrichEvmError (07 EVM_MODULE — custom errors)', () => {
  it('returns null for too-short hex', () => {
    expect(decodeEvmError('0x')).toBeNull();
    expect(decodeEvmError('0x1234')).toBeNull();
  });

  it('decodes BatchNotFound from merged Hub ABI errors', () => {
    const iface = new Interface(['error BatchNotFound(uint256 batchId)']);
    const data = iface.encodeErrorResult('BatchNotFound', [42n]);
    const d = decodeEvmError(data);
    expect(d).not.toBeNull();
    expect(d!.name).toBe('BatchNotFound');
    expect(d!.args[0]).toBe(42n);
  });

  it('accepts Uint8Array input', () => {
    const iface = new Interface(['error BatchNotFound(uint256 batchId)']);
    const hex = iface.encodeErrorResult('BatchNotFound', [7n]);
    const bytes = ethers.getBytes(hex);
    const d = decodeEvmError(bytes);
    expect(d?.name).toBe('BatchNotFound');
  });

  it('enrichEvmError replaces unknown custom error substring when data is decodable', () => {
    const iface = new Interface(['error InvalidKARange(uint64 startKAId, uint64 endKAId)']);
    const data = iface.encodeErrorResult('InvalidKARange', [1n, 2n]);
    const err = new Error(
      `execution reverted (unknown custom error data="${data}")`,
    );
    const name = enrichEvmError(err);
    expect(name).toBe('InvalidKARange');
    expect(err.message).not.toContain('unknown custom error');
    expect(err.message).toContain('InvalidKARange');
  });

  it('enrichEvmError returns null when message has no data=', () => {
    expect(enrichEvmError(new Error('rpc failed'))).toBeNull();
  });

  it('decodes NotBatchPublisher from V10 contract errors', () => {
    const iface = new Interface(['error NotBatchPublisher(uint256 batchId, address caller)']);
    const data = iface.encodeErrorResult('NotBatchPublisher', [5n, '0x0000000000000000000000000000000000000001']);
    const d = decodeEvmError(data);
    expect(d).not.toBeNull();
    expect(d!.name).toBe('NotBatchPublisher');
    expect(d!.args[0]).toBe(5n);
  });

  it('decodes KnowledgeCollectionExpired', () => {
    const iface = new Interface(['error KnowledgeCollectionExpired(uint256 id, uint256 currentEpoch, uint256 endEpoch)']);
    const data = iface.encodeErrorResult('KnowledgeCollectionExpired', [1n, 100n, 50n]);
    const d = decodeEvmError(data);
    expect(d).not.toBeNull();
    expect(d!.name).toBe('KnowledgeCollectionExpired');
  });

  it('decodes CannotUpdateImmutableKnowledgeCollection', () => {
    const iface = new Interface(['error CannotUpdateImmutableKnowledgeCollection(uint256 id)']);
    const data = iface.encodeErrorResult('CannotUpdateImmutableKnowledgeCollection', [7n]);
    const d = decodeEvmError(data);
    expect(d).not.toBeNull();
    expect(d!.name).toBe('CannotUpdateImmutableKnowledgeCollection');
  });

  it('enrichEvmError returns decoded name for V10 errors', () => {
    const iface = new Interface(['error NotBatchPublisher(uint256 batchId, address caller)']);
    const data = iface.encodeErrorResult('NotBatchPublisher', [3n, '0x0000000000000000000000000000000000000001']);
    const err = new Error(`execution reverted (unknown custom error data="${data}")`);
    const name = enrichEvmError(err);
    expect(name).toBe('NotBatchPublisher');
    expect(err.message).toContain('NotBatchPublisher');
    expect(err.message).not.toContain('unknown custom error');
  });

  it('returns null for unrecognized error selector', () => {
    expect(decodeEvmError('0xdeadbeef')).toBeNull();
  });
});

describe('EVMChainAdapter constructor / getters (no init)', () => {
  it('sets chainType, chainId default, and signer pool', () => {
    const a = new EVMChainAdapter(minimalConfig({ chainId: 'evm:84532' }));
    expect(a.chainType).toBe('evm');
    expect(a.chainId).toBe('evm:84532');
    expect(a.getSignerAddress()).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(a.getSignerAddresses()).toHaveLength(1);
    expect(a.getSignerAddresses()[0]).toBe(a.getSignerAddress());
  });

  it('includes additionalKeys in signer pool (round-robin for publish)', () => {
    const a = new EVMChainAdapter(minimalConfig({ additionalKeys: [OTHER_PK] }));
    const addrs = a.getSignerAddresses();
    expect(addrs).toHaveLength(2);
    expect(addrs[0]).not.toBe(addrs[1]);
  });

  it('rejects adminPrivateKey when it duplicates an operational key', () => {
    expect(() => new EVMChainAdapter(minimalConfig({ adminPrivateKey: DEPLOYER_PK })))
      .toThrow('EVM adminPrivateKey must be distinct from operational keys');
  });

  it('allows missing adminPrivateKey for backwards-compatible publish/read-only adapters', () => {
    expect(() => new EVMChainAdapter({
      rpcUrl: 'http://127.0.0.1:59998',
      privateKey: DEPLOYER_PK,
      hubAddress: '0x0000000000000000000000000000000000000001',
      chainId: 'evm:31337',
    })).not.toThrow();

    expect(() => new EVMChainAdapter({
      rpcUrl: 'http://127.0.0.1:59998',
      privateKey: DEPLOYER_PK,
      hubAddress: '0x0000000000000000000000000000000000000001',
      chainId: 'evm:31337',
      allowNoAdminSigner: true,
    })).not.toThrow();
  });

  it('getProvider returns JsonRpcProvider', () => {
    const a = new EVMChainAdapter(minimalConfig());
    expect(a.getProvider()).toBeDefined();
    expect(typeof a.getProvider().getBlockNumber).toBe('function');
  });

  it('signMessage returns 32-byte r and vs (no contract init)', async () => {
    const a = new EVMChainAdapter(minimalConfig());
    const digest = ethers.randomBytes(32);
    const sig = await a.signMessage(digest);
    expect(sig.r).toHaveLength(32);
    expect(sig.vs).toHaveLength(32);
  });

  it('accepts randomSamplingHubRefreshMs override without RPC contact', () => {
    const a = new EVMChainAdapter(minimalConfig({ randomSamplingHubRefreshMs: 60_000 }));
    expect(a.chainType).toBe('evm');
  });

  it('startHubRotationListener swallows async provider rejections without unhandled-rejection or throw (Codex N15)', async () => {
    // ethers v6 `Contract.on(...)` is async — providers that reject
    // filter installation (e.g. HTTP-only endpoints, mocked providers)
    // must NOT bubble as unhandled rejections, and the listener-started
    // flag must NOT be flipped if subscription failed (so a future
    // retry remains possible).
    const a = new EVMChainAdapter(minimalConfig());
    const fakeHub = {
      on: async (_event: string, _cb: (...args: unknown[]) => void) => {
        throw new Error('provider does not support filter subscriptions');
      },
    };
    (a as any).contracts.hub = fakeHub;
    (a as any).hubRotationListenerStarted = false;
    let unhandled: unknown = null;
    const onRejection = (reason: unknown) => { unhandled = reason; };
    process.on('unhandledRejection', onRejection);
    try {
      await expect((a as any).startHubRotationListener()).resolves.toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toBeNull();
      expect((a as any).hubRotationListenerStarted).toBe(false);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('invalidateRandomSamplingPair drops both the cache AND the side-channel contract handles (Codex N15)', () => {
    const a = new EVMChainAdapter(minimalConfig());
    (a as any).contracts.randomSampling = { dummy: 'rs' };
    (a as any).contracts.randomSamplingStorage = { dummy: 'rss' };
    (a as any).randomSamplingPairCache.cached = { rs: 'x', rss: 'y' };
    (a as any).randomSamplingPairCache.resolvedAt = Date.now();

    expect(a.isRandomSamplingReady()).toBe(true);
    (a as any).invalidateRandomSamplingPair();
    expect(a.isRandomSamplingReady()).toBe(false);
    expect((a as any).randomSamplingPairCache.peek()).toBeNull();
  });

  it('resolveAndAssignRandomSamplingPair refuses to write stale handles back when invalidate() raced the await (Codex N16)', async () => {
    const a = new EVMChainAdapter(minimalConfig());
    let releaseResolve: ((v: { rs: any; rss: any }) => void) = () => {};
    const stalePair = { rs: { stale: 'rs' }, rss: { stale: 'rss' } };

    (a as any).randomSamplingPairCache = {
      _gen: 0,
      currentGeneration() { return this._gen; },
      get() {
        return new Promise((resolve) => { releaseResolve = resolve; });
      },
    };

    const pending = (a as any).resolveAndAssignRandomSamplingPair() as Promise<unknown>;
    (a as any).randomSamplingPairCache._gen += 1;
    releaseResolve(stalePair);
    const returned = await pending;

    expect(returned).toBe(stalePair);
    expect((a as any).contracts.randomSampling).toBeUndefined();
    expect((a as any).contracts.randomSamplingStorage).toBeUndefined();
    expect(a.isRandomSamplingReady()).toBe(false);
  });

  it('resolveAndAssignRandomSamplingPair writes handles when no invalidate() raced (happy path)', async () => {
    const a = new EVMChainAdapter(minimalConfig());
    const freshPair = { rs: { fresh: 'rs' }, rss: { fresh: 'rss' } };

    (a as any).randomSamplingPairCache = {
      _gen: 5,
      currentGeneration() { return this._gen; },
      get: async () => freshPair,
    };

    const returned = await (a as any).resolveAndAssignRandomSamplingPair();
    expect(returned).toBe(freshPair);
    expect((a as any).contracts.randomSampling).toBe(freshPair.rs);
    expect((a as any).contracts.randomSamplingStorage).toBe(freshPair.rss);
  });

  it('isContractMissingRevert recognises both the legacy (ZeroAddress→string) shape and ContractDoesNotExist revert (Codex N16)', () => {
    const a = new EVMChainAdapter(minimalConfig());
    expect((a as any).isContractMissingRevert(new Error('reverted with custom error ContractDoesNotExist("RandomSampling")'))).toBe(true);
    expect((a as any).isContractMissingRevert(new Error('AddressDoesNotExist(0x123)'))).toBe(true);
    expect((a as any).isContractMissingRevert(new Error('Contract "X" not found in Hub at 0xabc'))).toBe(false);
    expect((a as any).isContractMissingRevert(new Error('execution reverted: ProfileDoesntExist(0)'))).toBe(false);
    expect((a as any).isContractMissingRevert('not an error')).toBe(false);
  });

  it('getActiveProofPeriodStatus stays best-effort when getActiveProofingPeriodDurationInBlocks rejects (Codex round 3)', async () => {
    // Codex round 3 on PR #369 — pulling the live duration alongside
    // status must NOT promote the duration RPC to a hard prerequisite.
    // If older RS deployments don't expose the method, or a transient
    // RPC error hits only the second leg, the status read should still
    // succeed with `proofingPeriodDurationInBlocks: undefined` and the
    // prover falls back to the cached challenge duration.
    const a = new EVMChainAdapter(minimalConfig());
    const fakeRs = {
      getActiveProofPeriodStatus: async () => ({
        activeProofPeriodStartBlock: 1234n,
        isValid: true,
      }),
      getActiveProofingPeriodDurationInBlocks: async () => {
        throw new Error('OlderRSDeploymentDoesNotExposeThisMethod');
      },
    };
    (a as any).init = async () => undefined;
    (a as any).getRandomSampling = async () => ({ rs: fakeRs, rss: {} });
    const status = await a.getActiveProofPeriodStatus();
    expect(status.activeProofPeriodStartBlock).toBe(1234n);
    expect(status.isValid).toBe(true);
    expect(status.proofingPeriodDurationInBlocks).toBeUndefined();
  });

  it('getActiveProofPeriodStatus surfaces the real status read failure (does not swallow the primary leg)', async () => {
    // The best-effort behaviour from the previous test must NOT extend
    // to the primary status read — if `getActiveProofPeriodStatus` itself
    // fails, the prover MUST hear about it (otherwise we'd silently
    // pin to a fabricated default and the prover's wall-clock check
    // would compare against a nonsense activeProofPeriodStartBlock).
    const a = new EVMChainAdapter(minimalConfig());
    const fakeRs = {
      getActiveProofPeriodStatus: async () => {
        throw new Error('UpstreamRPCBadGateway');
      },
      getActiveProofingPeriodDurationInBlocks: async () => 600n,
    };
    (a as any).init = async () => undefined;
    (a as any).getRandomSampling = async () => ({ rs: fakeRs, rss: {} });
    await expect(a.getActiveProofPeriodStatus()).rejects.toThrow('UpstreamRPCBadGateway');
  });

  it('getActiveProofPeriodStatus populates proofingPeriodDurationInBlocks when both reads succeed', async () => {
    const a = new EVMChainAdapter(minimalConfig());
    const fakeRs = {
      getActiveProofPeriodStatus: async () => ({
        activeProofPeriodStartBlock: 9000n,
        isValid: false,
      }),
      getActiveProofingPeriodDurationInBlocks: async () => 50n,
    };
    (a as any).init = async () => undefined;
    (a as any).getRandomSampling = async () => ({ rs: fakeRs, rss: {} });
    const status = await a.getActiveProofPeriodStatus();
    expect(status.activeProofPeriodStartBlock).toBe(9000n);
    expect(status.isValid).toBe(false);
    expect(status.proofingPeriodDurationInBlocks).toBe(50n);
  });

  it('coerces randomSamplingHubRefreshMs<=0 to the default TTL (no "disable refresh" mode)', () => {
    // The "disable refresh entirely" mode is intentionally not
    // supported — without a TTL backstop, a missed Hub event on a
    // read-only path (e.g. getActiveProofPeriodStatus) would leave
    // the adapter pinned to a stale RandomSampling address until
    // restart. The constructor coerces values <=0 (and undefined) to
    // the same 5-minute default. We verify by peeking the underlying
    // cache's ttlMs option.
    const DEFAULT_TTL_MS = 5 * 60 * 1000;
    const aZero = new EVMChainAdapter(minimalConfig({ randomSamplingHubRefreshMs: 0 }));
    const aNeg = new EVMChainAdapter(minimalConfig({ randomSamplingHubRefreshMs: -42 }));
    const aDefault = new EVMChainAdapter(minimalConfig());
    const ttlOf = (a: EVMChainAdapter) =>
      ((a as any).randomSamplingPairCache.opts as { ttlMs: number }).ttlMs;
    expect(ttlOf(aZero)).toBe(DEFAULT_TTL_MS);
    expect(ttlOf(aNeg)).toBe(DEFAULT_TTL_MS);
    expect(ttlOf(aDefault)).toBe(DEFAULT_TTL_MS);
  });
});
