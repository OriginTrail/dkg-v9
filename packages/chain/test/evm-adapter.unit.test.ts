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
