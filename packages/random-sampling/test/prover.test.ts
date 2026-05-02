/**
 * RandomSamplingProver orchestrator end-to-end tests.
 *
 * Drives the prover with a stub chain adapter (only the
 * RandomSampling + KC view methods it actually uses) plus a real
 * OxigraphStore seeded with KC quads. Pins:
 *   1. Happy path: tick -> submitted, WAL records each transition.
 *   2. Period closed: tick returns period-closed, no chain writes.
 *   3. No eligible CG / KC: tick returns no-challenge.
 *   4. Already solved: tick returns already-solved.
 *   5. cgId == 0 (KC unregistered): tick returns cg-not-found.
 *   6. KC not synced locally (KCNotFoundError): tick returns kc-not-synced.
 *   7. ChallengeNoLongerActive on submit: tick returns submit-stale.
 *   8. Single-flight: concurrent ticks share one outcome.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChallengeNoLongerActiveError,
  NoEligibleContextGraphError,
  NoEligibleKnowledgeCollectionError,
  type ChainAdapter,
  type CreateChallengeResult,
  type NodeChallenge,
  type ProofPeriodStatus,
  type TxResult,
} from '@origintrail-official/dkg-chain';
import {
  V10MerkleTree,
  contextGraphDataUri,
  contextGraphMetaUri,
  hashTripleV10,
} from '@origintrail-official/dkg-core';
import { OxigraphStore, type Quad } from '@origintrail-official/dkg-storage';
import { InMemoryProverWal, RandomSamplingProver } from '../src/index.js';

const DKG = 'http://dkg.io/ontology/';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

interface FakeChainState {
  status: ProofPeriodStatus;
  challengeForNode: NodeChallenge | null;
  createChallenge: () => Promise<CreateChallengeResult>;
  expectedRoot: Uint8Array;
  expectedLeafCount: number;
  cgIdForKc: bigint;
  submitProof: (leaf: Uint8Array, proof: Uint8Array[]) => Promise<TxResult>;
  /** When set, exposes `chain.getBlockNumber` so the wall-clock stale
   *  check inside the prover engages. Tests that omit this fall back
   *  to "stale check always false" (the production-safe default). */
  blockNumber?: number;
}

function makeChain(state: FakeChainState): ChainAdapter {
  // Only the methods the prover touches need to be implemented.
  const partial: Partial<ChainAdapter> = {
    chainType: 'evm',
    chainId: '31337',
    getActiveProofPeriodStatus: vi.fn(async () => state.status),
    getNodeChallenge: vi.fn(async () => state.challengeForNode),
    createChallenge: vi.fn(state.createChallenge),
    getLatestMerkleRoot: vi.fn(async () => state.expectedRoot),
    getMerkleLeafCount: vi.fn(async () => state.expectedLeafCount),
    getKCContextGraphId: vi.fn(async () => state.cgIdForKc),
    submitProof: vi.fn(state.submitProof),
  };
  if (state.blockNumber !== undefined) {
    partial.getBlockNumber = vi.fn(async () => state.blockNumber!);
  }
  return partial as ChainAdapter;
}

interface KCFixture {
  cgId: bigint;
  kcId: bigint;
  ual: string;
  rootEntities: string[];
  publicTriples: { subject: string; predicate: string; object: string }[];
}

async function seedKC(store: OxigraphStore, fixture: KCFixture): Promise<{ root: Uint8Array; leafCount: number }> {
  const cgIdStr = fixture.cgId.toString();
  // Mirror the agent's CG name → on-chain id mapping the extractor
  // looks up. `cg-<n>` is a synthetic name; in production the name is
  // human-chosen (e.g. "devnet-test"), but the URI shape is identical.
  const cgName = `cg-${cgIdStr}`;
  await store.insert([
    {
      subject: `did:dkg:context-graph:${cgName}`,
      predicate: 'https://dkg.network/ontology#ParanetOnChainId',
      object: `"${cgIdStr}"`,
      graph: 'did:dkg:context-graph:ontology',
    },
  ]);
  const metaGraph = contextGraphMetaUri(cgName, cgIdStr);
  const dataGraph = contextGraphDataUri(cgName, cgIdStr);

  const metaQuads: Quad[] = [
    { subject: fixture.ual, predicate: `${DKG}batchId`, object: `"${fixture.kcId}"^^<${XSD}integer>`, graph: metaGraph },
  ];
  for (let i = 0; i < fixture.rootEntities.length; i++) {
    const kaUri = `${fixture.ual}/${i + 1}`;
    metaQuads.push(
      { subject: kaUri, predicate: `${DKG}partOf`, object: fixture.ual, graph: metaGraph },
      { subject: kaUri, predicate: `${DKG}rootEntity`, object: fixture.rootEntities[i], graph: metaGraph },
    );
  }
  await store.insert(metaQuads);
  await store.insert(fixture.publicTriples.map((t) => ({ ...t, graph: dataGraph })));

  const leaves = fixture.publicTriples.map((t) => hashTripleV10(t.subject, t.predicate, t.object));
  const tree = new V10MerkleTree(leaves);
  return { root: tree.root, leafCount: tree.leafCount };
}

const IDENTITY_ID = 42n;

function makeChallenge(overrides: Partial<NodeChallenge> = {}): NodeChallenge {
  return {
    knowledgeCollectionId: 7n,
    chunkId: 0n,
    knowledgeCollectionStorageContract: '0x0',
    epoch: 1n,
    activeProofPeriodStartBlock: 1000n,
    proofingPeriodDurationInBlocks: 50n,
    solved: false,
    ...overrides,
  };
}

describe('RandomSamplingProver — happy path', () => {
  let store: OxigraphStore;
  beforeEach(() => {
    store = new OxigraphStore();
  });

  it('tick: extracts, builds, submits, and WAL records every transition', async () => {
    const fixture: KCFixture = {
      cgId: 11n,
      kcId: 7n,
      ual: 'did:dkg:hardhat:31337/0xpub/7',
      rootEntities: ['urn:e:1', 'urn:e:2', 'urn:e:3'],
      publicTriples: [
        { subject: 'urn:e:1', predicate: 'urn:p:k', object: '"a"' },
        { subject: 'urn:e:2', predicate: 'urn:p:k', object: '"b"' },
        { subject: 'urn:e:3', predicate: 'urn:p:k', object: '"c"' },
      ],
    };
    const { root, leafCount } = await seedKC(store, fixture);

    const submitProof = vi.fn(async () => ({ hash: '0xabc123', blockNumber: 1001, success: true }));
    const challenge = makeChallenge({
      knowledgeCollectionId: fixture.kcId,
      chunkId: 1n,
    });
    const chain = makeChain({
      status: { activeProofPeriodStartBlock: 1000n, isValid: true },
      challengeForNode: null,
      createChallenge: async () => ({
        challenge,
        contextGraphId: fixture.cgId,
        hash: '0xchallenge',
        blockNumber: 1000,
        success: true,
      }),
      expectedRoot: root,
      expectedLeafCount: leafCount,
      cgIdForKc: fixture.cgId,
      submitProof,
    });

    const wal = new InMemoryProverWal();
    const prover = new RandomSamplingProver({ chain, store, identityId: IDENTITY_ID, wal });
    const outcome = await prover.tick();

    expect(outcome).toEqual({
      kind: 'submitted',
      txHash: '0xabc123',
      kcId: fixture.kcId,
      cgId: fixture.cgId,
      chunkId: 1n,
    });
    expect(submitProof).toHaveBeenCalledTimes(1);

    const trail = (await wal.readAll()).map((e) => e.status);
    expect(trail).toEqual(['challenge', 'extracted', 'built', 'submitted']);
    await prover.close();
  });
});

describe('RandomSamplingProver — short-circuits', () => {
  let store: OxigraphStore;
  beforeEach(() => { store = new OxigraphStore(); });

  it('does NOT short-circuit when isValid is false — falls through to createChallenge', async () => {
    // View-side `isValid: false` was previously a terminal short-circuit.
    // That stalled single-tenant deployments because no external tx ever
    // rotated the period. The prover now ignores `isValid` and trusts the
    // on-chain auto-rotation that happens inside `createChallenge`.
    const createChallenge = vi.fn(async () => {
      throw new NoEligibleContextGraphError();
    });
    const chain = makeChain({
      status: { activeProofPeriodStartBlock: 0n, isValid: false },
      challengeForNode: null,
      createChallenge: createChallenge as never,
      expectedRoot: new Uint8Array(32),
      expectedLeafCount: 0,
      cgIdForKc: 0n,
      submitProof: vi.fn() as never,
    });
    const prover = new RandomSamplingProver({ chain, store, identityId: IDENTITY_ID });
    const outcome = await prover.tick();
    // The chain reports no eligible CG, but the prover still tried —
    // that's the contract: `isValid: false` is non-terminal.
    expect(outcome).toEqual({ kind: 'no-challenge', reason: 'no-eligible-cg' });
    expect(createChallenge).toHaveBeenCalledTimes(1);
    await prover.close();
  });

  it('discards a stale existing challenge (different period start block) and creates a fresh one', async () => {
    // Existing challenge is from period 500, status reports current
    // period 1000. The prover must not try to submit against the
    // stale challenge — it'd revert with ChallengeNoLongerActive
    // and burn gas. Instead, force a rotation via createChallenge.
    const fixture: KCFixture = {
      cgId: 11n, kcId: 7n, ual: 'did:dkg:hardhat:31337/0xpub/7',
      rootEntities: ['urn:e:1'],
      publicTriples: [{ subject: 'urn:e:1', predicate: 'urn:p:k', object: '"a"' }],
    };
    const { root, leafCount } = await seedKC(store, fixture);

    const submitProof = vi.fn(async () => ({ hash: '0xfresh', blockNumber: 1, success: true }));
    const createChallenge = vi.fn(async () => ({
      challenge: makeChallenge({
        knowledgeCollectionId: fixture.kcId,
        chunkId: 0n,
        activeProofPeriodStartBlock: 1000n, // current period
      }),
      contextGraphId: fixture.cgId,
      hash: '0x', blockNumber: 1, success: true,
    }));
    const chain = makeChain({
      status: { activeProofPeriodStartBlock: 1000n, isValid: true },
      challengeForNode: makeChallenge({
        knowledgeCollectionId: fixture.kcId,
        activeProofPeriodStartBlock: 500n, // STALE — previous period
      }),
      createChallenge,
      expectedRoot: root,
      expectedLeafCount: leafCount,
      cgIdForKc: fixture.cgId,
      submitProof: submitProof as never,
    });
    const prover = new RandomSamplingProver({ chain, store, identityId: IDENTITY_ID });
    const outcome = await prover.tick();
    expect(outcome.kind).toBe('submitted');
    expect(createChallenge).toHaveBeenCalledTimes(1); // forced fresh
    expect(submitProof).toHaveBeenCalledTimes(1);
    await prover.close();
  });

  it('forces createChallenge when existing unsolved challenge is past its on-chain period boundary by wall-clock', async () => {
    // Reproduces the Base Sepolia testnet deadlock from 2026-05-01:
    // After an RS-contract Hub rotation, every staked node held an
    // unsolved challenge for proof period P. With no submit/create
    // tx landing post-rotation, the contract's
    // `activeProofPeriodStartBlock` cursor stayed frozen at P, so
    // `existing.activeProofPeriodStartBlock === status.activeProofPeriodStartBlock`
    // remained true forever and the prover happily reused the
    // unsolvable stale challenge on every tick (kc-not-synced loop)
    // — never calling createChallenge to advance the period.
    //
    // Fix: mirror the wall-clock stale check that already protected
    // the solved branch. If wallclock is past the cached period's
    // boundary, force a rotation regardless of solved/unsolved.
    //
    // Codex round 1: the rotated challenge from createChallenge must
    // sit in a DIFFERENT period than the frozen cached one — otherwise
    // the test only proves createChallenge was called, not that the
    // prover actually consumed the rotated challenge downstream. So
    // make the frozen cursor sit at period 1000 and have createChallenge
    // return a challenge for the now-current period 9050, then assert
    // the WAL trail records `periodStartBlock` of the rotated period.
    const fixture: KCFixture = {
      cgId: 11n, kcId: 7n, ual: 'did:dkg:hardhat:31337/0xpub/7',
      rootEntities: ['urn:e:1'],
      publicTriples: [{ subject: 'urn:e:1', predicate: 'urn:p:k', object: '"a"' }],
    };
    const { root, leafCount } = await seedKC(store, fixture);

    const FROZEN_PERIOD = 1000n;
    const ROTATED_PERIOD = 9050n;
    const ROTATED_EPOCH = 18n;

    const submitProof = vi.fn(async () => ({ hash: '0xfresh', blockNumber: 9000, success: true }));
    const createChallenge = vi.fn(async () => ({
      challenge: makeChallenge({
        knowledgeCollectionId: fixture.kcId,
        chunkId: 0n,
        // The chain's createChallenge auto-rotates the period internally
        // (`updateAndGetActiveProofPeriodStartBlock` runs inside the tx),
        // so the returned challenge sits in the NEW period — not the
        // frozen cached one. Test asserts the prover consumes this
        // rotated period downstream (WAL entries reflect ROTATED_PERIOD).
        epoch: ROTATED_EPOCH,
        activeProofPeriodStartBlock: ROTATED_PERIOD,
        proofingPeriodDurationInBlocks: 50n,
      }),
      contextGraphId: fixture.cgId,
      hash: '0x', blockNumber: 9000, success: true,
    }));
    const chain = makeChain({
      // Status read still reflects the FROZEN cursor — both the
      // status and the stored challenge agree on the frozen period,
      // so `existingIsCurrent` is truthy. Only the wall-clock check
      // can detect that the period actually expired.
      status: { activeProofPeriodStartBlock: FROZEN_PERIOD, isValid: true },
      challengeForNode: makeChallenge({
        knowledgeCollectionId: fixture.kcId,
        activeProofPeriodStartBlock: FROZEN_PERIOD,
        proofingPeriodDurationInBlocks: 50n,
        solved: false,
      }),
      // Wallclock far past frozen period boundary (1000 + 50 = 1050).
      blockNumber: 9000,
      createChallenge,
      expectedRoot: root,
      expectedLeafCount: leafCount,
      cgIdForKc: fixture.cgId,
      submitProof: submitProof as never,
    });
    const wal = new InMemoryProverWal();
    const prover = new RandomSamplingProver({ chain, store, identityId: IDENTITY_ID, wal });
    const outcome = await prover.tick();
    expect(outcome.kind).toBe('submitted');
    expect(createChallenge).toHaveBeenCalledTimes(1);
    expect(submitProof).toHaveBeenCalledTimes(1);

    // Codex round 1 fix — verify the prover actually advanced to the
    // rotated period. WAL entries written after `periodKey.periodStartBlock
    // = challenge.activeProofPeriodStartBlock` (prover.ts L288) all carry
    // the new period; if the prover had instead reused the frozen cached
    // challenge they'd carry FROZEN_PERIOD's string and this would fail.
    const trail = await wal.readAll();
    const submitted = trail.find((e) => e.status === 'submitted');
    expect(submitted).toBeDefined();
    expect(submitted!.periodStartBlock).toBe(ROTATED_PERIOD.toString());
    expect(submitted!.epoch).toBe(ROTATED_EPOCH.toString());
    expect(trail.map((e) => e.status)).toEqual(['challenge', 'extracted', 'built', 'submitted']);
    await prover.close();
  });

  it('returns no-challenge / no-eligible-cg when createChallenge throws', async () => {
    const chain = makeChain({
      status: { activeProofPeriodStartBlock: 1000n, isValid: true },
      challengeForNode: null,
      createChallenge: async () => { throw new NoEligibleContextGraphError(); },
      expectedRoot: new Uint8Array(32),
      expectedLeafCount: 0,
      cgIdForKc: 0n,
      submitProof: vi.fn() as never,
    });
    const prover = new RandomSamplingProver({ chain, store, identityId: IDENTITY_ID });
    const outcome = await prover.tick();
    expect(outcome).toEqual({ kind: 'no-challenge', reason: 'no-eligible-cg' });
    await prover.close();
  });

  it('returns no-challenge / no-eligible-kc when createChallenge throws', async () => {
    const chain = makeChain({
      status: { activeProofPeriodStartBlock: 1000n, isValid: true },
      challengeForNode: null,
      createChallenge: async () => { throw new NoEligibleKnowledgeCollectionError(); },
      expectedRoot: new Uint8Array(32),
      expectedLeafCount: 0,
      cgIdForKc: 0n,
      submitProof: vi.fn() as never,
    });
    const prover = new RandomSamplingProver({ chain, store, identityId: IDENTITY_ID });
    const outcome = await prover.tick();
    expect(outcome).toEqual({ kind: 'no-challenge', reason: 'no-eligible-kc' });
    await prover.close();
  });

  it('returns already-solved when getNodeChallenge.solved is true', async () => {
    const submitProof = vi.fn();
    const chain = makeChain({
      status: { activeProofPeriodStartBlock: 1000n, isValid: true },
      challengeForNode: makeChallenge({ solved: true }),
      createChallenge: async () => { throw new Error('should not run'); },
      expectedRoot: new Uint8Array(32),
      expectedLeafCount: 0,
      cgIdForKc: 0n,
      submitProof: submitProof as never,
    });
    const prover = new RandomSamplingProver({ chain, store, identityId: IDENTITY_ID });
    expect(await prover.tick()).toEqual({ kind: 'already-solved' });
    expect(submitProof).not.toHaveBeenCalled();
    await prover.close();
  });

  it('returns cg-not-found when getKCContextGraphId returns 0', async () => {
    const chain = makeChain({
      status: { activeProofPeriodStartBlock: 1000n, isValid: true },
      challengeForNode: null,
      createChallenge: async () => ({
        challenge: makeChallenge(),
        contextGraphId: 0n,
        hash: '0x', blockNumber: 1, success: true,
      }),
      expectedRoot: new Uint8Array(32),
      expectedLeafCount: 0,
      cgIdForKc: 0n,
      submitProof: vi.fn() as never,
    });
    const prover = new RandomSamplingProver({ chain, store, identityId: IDENTITY_ID });
    const outcome = await prover.tick();
    expect(outcome).toEqual({ kind: 'cg-not-found', kcId: 7n });
    await prover.close();
  });

  it('returns kc-not-synced when local _meta has no entry for kcId', async () => {
    // No KC seeded in the store; meta + data graphs are empty.
    const chain = makeChain({
      status: { activeProofPeriodStartBlock: 1000n, isValid: true },
      challengeForNode: null,
      createChallenge: async () => ({
        challenge: makeChallenge({ knowledgeCollectionId: 999n }),
        contextGraphId: 11n,
        hash: '0x', blockNumber: 1, success: true,
      }),
      expectedRoot: new Uint8Array(32),
      expectedLeafCount: 0,
      cgIdForKc: 11n,
      submitProof: vi.fn() as never,
    });
    const prover = new RandomSamplingProver({ chain, store, identityId: IDENTITY_ID });
    const outcome = await prover.tick();
    expect(outcome).toMatchObject({ kind: 'kc-not-synced', kcId: 999n, cgId: 11n });
    await prover.close();
  });

  it('returns submit-stale when submitProof throws ChallengeNoLongerActiveError', async () => {
    const fixture: KCFixture = {
      cgId: 11n, kcId: 7n, ual: 'did:dkg:hardhat:31337/0xpub/7',
      rootEntities: ['urn:e:1'],
      publicTriples: [{ subject: 'urn:e:1', predicate: 'urn:p:k', object: '"a"' }],
    };
    const { root, leafCount } = await seedKC(store, fixture);

    const submitProof = vi.fn(async () => { throw new ChallengeNoLongerActiveError(); });
    const chain = makeChain({
      status: { activeProofPeriodStartBlock: 1000n, isValid: true },
      challengeForNode: null,
      createChallenge: async () => ({
        challenge: makeChallenge({ knowledgeCollectionId: fixture.kcId, chunkId: 0n }),
        contextGraphId: fixture.cgId,
        hash: '0x', blockNumber: 1, success: true,
      }),
      expectedRoot: root,
      expectedLeafCount: leafCount,
      cgIdForKc: fixture.cgId,
      submitProof: submitProof as never,
    });
    const wal = new InMemoryProverWal();
    const prover = new RandomSamplingProver({ chain, store, identityId: IDENTITY_ID, wal });
    const outcome = await prover.tick();
    expect(outcome).toEqual({ kind: 'submit-stale' });
    expect(submitProof).toHaveBeenCalledTimes(1);
    const trail = (await wal.readAll()).map((e) => e.status);
    expect(trail).toEqual(['challenge', 'extracted', 'built', 'failed']);
    await prover.close();
  });
});

describe('RandomSamplingProver — concurrency', () => {
  it('single-flights: concurrent ticks resolve to the same outcome and run once', async () => {
    const store = new OxigraphStore();
    const fixture: KCFixture = {
      cgId: 1n, kcId: 1n, ual: 'did:dkg:hardhat:31337/0xpub/1',
      rootEntities: ['urn:s'],
      publicTriples: [{ subject: 'urn:s', predicate: 'urn:p:k', object: '"v"' }],
    };
    const { root, leafCount } = await seedKC(store, fixture);

    let createChallengeCalls = 0;
    const submitProof = vi.fn(async () => ({ hash: '0xfeed', blockNumber: 1, success: true }));
    const chain = makeChain({
      status: { activeProofPeriodStartBlock: 1000n, isValid: true },
      challengeForNode: null,
      createChallenge: async () => {
        createChallengeCalls += 1;
        return {
          challenge: makeChallenge({ knowledgeCollectionId: fixture.kcId, chunkId: 0n }),
          contextGraphId: fixture.cgId,
          hash: '0x', blockNumber: 1, success: true,
        };
      },
      expectedRoot: root,
      expectedLeafCount: leafCount,
      cgIdForKc: fixture.cgId,
      submitProof: submitProof as never,
    });

    const prover = new RandomSamplingProver({ chain, store, identityId: IDENTITY_ID });
    const [a, b, c] = await Promise.all([prover.tick(), prover.tick(), prover.tick()]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(createChallengeCalls).toBe(1);
    expect(submitProof).toHaveBeenCalledTimes(1);
    await prover.close();
  });
});
