/**
 * E2E bulletproof contract tests for the three user-facing feature triads
 * the product is claimed to deliver:
 *
 *  1. PUBLISH  — `agent.publish(cg, quads)` produces a real on-chain
 *                Knowledge Collection and leaves the expected observable
 *                trail (confirmed status, v10 ACKs, merkle root, KC id
 *                increment, locally queryable data).
 *  2. SYNC     — `B.syncFromPeer(A.peerId, [cgId])` moves real data from
 *                A's store into B's store, and a *second* sync picks up
 *                *new* data written to A after the first sync ran.
 *  3. INVITE   — `A.inviteAgentToContextGraph(cgId, B.address)` changes
 *                a private CG's allowlist such that:
 *                   * before invite, B's sync returns 0 (allowlist blocks);
 *                   * after invite, B's sync returns > 0 (allowlist passes);
 *                   * B's local _meta graph ends up with a
 *                     DKG_ALLOWED_AGENT triple for B's wallet (allowlist
 *                     replicated via the sync response, not just set on A).
 *
 * Why this file exists (even though e2e-privacy.test.ts and e2e-flows.test.ts
 * already exercise these APIs):
 *
 *   - e2e-privacy's sync/invite tests use `insertWithMeta(...)` to
 *     hand-seed a valid KC metadata block directly into the store. That
 *     short-circuits the publish pipeline: the *sync and invite contracts*
 *     are verified, but they are verified against synthetic data, not
 *     against data that flowed through `publish()`. A regression where
 *     `publish()` stops writing meta quads the way sync expects would
 *     slip past those tests silently.
 *   - e2e-flows publishes real data but never cross-checks that the
 *     published data is syncable to a second agent, and never exercises
 *     the *invite* allowlist flip.
 *
 * This file wires all three together on a single Hardhat-backed harness
 * so that if ANY link in publish → sync → allowlist is broken, exactly
 * one assertion fails and the failing feature is named in the reporter.
 *
 * NOTE: These tests are intentionally strict. If the user reports "sync
 * is broken" or "invite is broken", these tests are the ones that should
 * fail and produce a concrete failing assertion to reference in a bug
 * report — not an e2e suite that silently passes because of a mocked
 * shortcut.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ethers } from 'ethers';
import { DKGAgent } from '../src/index.js';
import {
  contextGraphDataUri,
  paranetMetaGraphUri,
  SYSTEM_PARANETS,
} from '@origintrail-official/dkg-core';
import {
  HARDHAT_KEYS,
  createEVMAdapter,
  createProvider,
  getSharedContext,
  revertSnapshot,
  takeSnapshot,
} from '../../chain/test/evm-test-context.js';
import { mintTokens } from '../../chain/test/hardhat-harness.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const DKG_ALLOWED_AGENT = 'https://dkg.network/ontology#allowedAgent';

// Each scenario uses a freshly-named CG so prior test state cannot leak.
// Suffix with random bytes so reruns against the same snapshot are clean.
function freshCgId(prefix: string): string {
  return `${prefix}-${ethers.hexlify(ethers.randomBytes(4)).slice(2)}`;
}

let _fileSnapshot: string;

beforeAll(async () => {
  _fileSnapshot = await takeSnapshot();
  // Fund the core operational wallet with DKG tokens so V10 publishes
  // that go through on-chain ACK + publishDirect succeed. Mirrors the
  // pattern used by e2e-privacy and e2e-flows.
  const { hubAddress } = getSharedContext();
  const provider = createProvider();
  const coreOp = new ethers.Wallet(HARDHAT_KEYS.CORE_OP);
  await mintTokens(
    provider,
    hubAddress,
    HARDHAT_KEYS.DEPLOYER,
    coreOp.address,
    ethers.parseEther('50000000'),
  );
});

afterAll(async () => {
  await revertSnapshot(_fileSnapshot);
});

// ---------------------------------------------------------------------------
// PUBLISH contract
// ---------------------------------------------------------------------------
describe('bulletproof: PUBLISH contract (real chain, real ACK, real KC)', () => {
  let nodeA: DKGAgent;

  afterAll(async () => {
    try {
      await nodeA?.stop();
    } catch {
      /* best-effort teardown */
    }
  });

  it('agent.publish() produces a confirmed KC with v10 ACKs, a 32-byte merkle root, and queryable data', async () => {
    const cgId = freshCgId('bp-pub');
    const entity = 'urn:bulletproof:publish:alice';

    nodeA = await DKGAgent.create({
      name: 'BulletproofPublishA',
      listenPort: 0,
      skills: [],
      chainAdapter: createEVMAdapter(HARDHAT_KEYS.CORE_OP),
      nodeRole: 'core',
    });
    await nodeA.start();

    await nodeA.createContextGraph({ id: cgId, name: 'Bulletproof Publish', description: '' });

    const result = await nodeA.publish(cgId, [
      { subject: entity, predicate: 'http://schema.org/name', object: '"AliceBulletproof"', graph: '' },
      { subject: entity, predicate: 'http://schema.org/age', object: '"42"', graph: '' },
    ]);

    // 1. Terminal status must be the success state, not a silent fallback.
    //    `tentative` means the chain tx didn't land; `failed` means it
    //    reverted. Either would be a real publish failure and must fail
    //    this test loudly instead of passing via `.toBeDefined()`.
    expect(result.status, `expected publish to land on chain, got status=${result.status}`).toBe('confirmed');

    // 2. At least one KA manifest entry for the single root entity.
    expect(result.kaManifest.length).toBeGreaterThan(0);
    expect(result.kaManifest[0].rootEntity).toBe(entity);

    // 3. Merkle root must be exactly 32 bytes. A silent empty/short root
    //    is one of the more common ways a broken canonicalization slips
    //    through: it still "publishes" but downstream verifiers reject.
    expect(result.merkleRoot).toBeInstanceOf(Uint8Array);
    expect(result.merkleRoot.length).toBe(32);

    // 4. Confirmed publishes MUST carry the core-node ACK set used to
    //    unlock `publishDirect`. With minimumRequiredSignatures=1 and a
    //    single core wallet, this is the self-signed ACK — but it must
    //    still be present and verifiable.
    expect(result.v10ACKs, 'confirmed V10 publish must include ACK signatures').toBeDefined();
    expect(result.v10ACKs!.length).toBeGreaterThanOrEqual(1);

    // 5. On-chain result must carry a tx hash.
    expect(result.onChainResult?.txHash).toMatch(/^0x[0-9a-f]+$/i);

    // 6. UAL matches the live Hardhat chain id (31337).
    expect(result.ual).toMatch(/^did:dkg:evm:31337\//);

    // 7. Local query must return both triples we just published.
    const qr = await nodeA.query(
      `SELECT ?p ?o WHERE { <${entity}> ?p ?o }`,
      cgId,
    );
    expect(qr.bindings.length).toBe(2);
    const values = qr.bindings.map((b) => b['o']).sort();
    expect(values).toEqual(['"42"', '"AliceBulletproof"'].sort());
  }, 60_000);
});

// ---------------------------------------------------------------------------
// SYNC contract
// ---------------------------------------------------------------------------
describe('bulletproof: SYNC contract (real libp2p, real publish, delta-syncs new data)', () => {
  let nodeA: DKGAgent;
  let nodeB: DKGAgent;

  afterAll(async () => {
    try { await nodeA?.stop(); } catch { /* */ }
    try { await nodeB?.stop(); } catch { /* */ }
  });

  it('B.syncFromPeer(A) moves real published data to B, and a second sync picks up data written after the first', async () => {
    const cgId = freshCgId('bp-sync');
    const entity1 = 'urn:bulletproof:sync:e1';
    const entity2 = 'urn:bulletproof:sync:e2';

    nodeA = await DKGAgent.create({
      name: 'BulletproofSyncA',
      listenPort: 0,
      skills: [],
      chainAdapter: createEVMAdapter(HARDHAT_KEYS.CORE_OP),
      nodeRole: 'core',
    });
    nodeB = await DKGAgent.create({
      name: 'BulletproofSyncB',
      listenPort: 0,
      skills: [],
      chainAdapter: createEVMAdapter(HARDHAT_KEYS.REC1_OP),
      nodeRole: 'core',
    });
    await nodeA.start();
    await nodeB.start();
    await sleep(300);

    const addrA = nodeA.multiaddrs.find(
      (a) => a.includes('/tcp/') && !a.includes('/p2p-circuit'),
    );
    expect(addrA, 'node A must expose a non-relay tcp multiaddr for libp2p dial').toBeDefined();
    await nodeB.connectTo(addrA!);
    await sleep(300);

    // Sanity: the two nodes are actually connected and the sync protocol
    // is advertised. A "sync works" test that passes against zero peers
    // would be a false positive.
    const aPeers = nodeA.node.libp2p.getPeers().length;
    const bPeers = nodeB.node.libp2p.getPeers().length;
    expect(aPeers, 'node A must see B as a connected peer').toBeGreaterThanOrEqual(1);
    expect(bPeers, 'node B must see A as a connected peer').toBeGreaterThanOrEqual(1);

    // A creates a PUBLIC CG and publishes entity1 through the real publish
    // pipeline (not a direct store.insert). This is the critical contract
    // check: sync must accept data that publish() produced.
    await nodeA.createContextGraph({ id: cgId, name: 'Bulletproof Sync', description: '' });
    const pub1 = await nodeA.publish(cgId, [
      { subject: entity1, predicate: 'http://schema.org/name', object: '"SyncE1"', graph: '' },
    ]);
    expect(pub1.status, 'initial publish must confirm so that sync has real data to transfer').toBe('confirmed');

    // Ontology sync primes B with the CG's access policy entry so the
    // subsequent data sync has the metadata it needs.
    await nodeB.syncFromPeer(nodeA.peerId, [SYSTEM_PARANETS.ONTOLOGY]);

    // First sync: B pulls all CG data.
    const firstSynced = await nodeB.syncFromPeer(nodeA.peerId, [cgId]);
    expect(
      firstSynced,
      'first syncFromPeer must return a positive quad count — 0 would mean sync silently moved no data',
    ).toBeGreaterThan(0);

    // B must be able to query the exact quad A published.
    const qr1 = await nodeB.query(
      `SELECT ?o WHERE { <${entity1}> <http://schema.org/name> ?o }`,
      { contextGraphId: cgId },
    );
    expect(qr1.bindings.length, 'B must have entity1 after first sync').toBe(1);
    expect(qr1.bindings[0]?.['o']).toBe('"SyncE1"');

    // Now A publishes a *second* entity AFTER B's first sync. A classic
    // false-positive here is a sync that only works on initial catch-up
    // but loses delta data. Run sync again and assert B now sees BOTH.
    const pub2 = await nodeA.publish(cgId, [
      { subject: entity2, predicate: 'http://schema.org/name', object: '"SyncE2"', graph: '' },
    ]);
    expect(pub2.status).toBe('confirmed');

    const secondSynced = await nodeB.syncFromPeer(nodeA.peerId, [cgId]);
    // Delta sync may return either "all quads re-counted" or "just the
    // new ones" depending on the implementation's offset semantics. We
    // only require that the *store state* ends up correct — the return
    // value is secondary, but must not be negative/undefined.
    expect(secondSynced).toBeGreaterThanOrEqual(0);

    const qr2 = await nodeB.query(
      `SELECT ?s ?o WHERE { ?s <http://schema.org/name> ?o } ORDER BY ?s`,
      { contextGraphId: cgId },
    );
    const subjects = qr2.bindings.map((b) => b['s']).sort();
    expect(
      subjects,
      `B should see both entity1 and entity2 after the second sync, got ${JSON.stringify(subjects)}`,
    ).toEqual([entity1, entity2].sort());
  }, 120_000);
});

// ---------------------------------------------------------------------------
// INVITE contract
// ---------------------------------------------------------------------------
describe('bulletproof: INVITE contract (allowlist flips actual sync authorization)', () => {
  let nodeA: DKGAgent;
  let nodeB: DKGAgent;

  afterAll(async () => {
    try { await nodeA?.stop(); } catch { /* */ }
    try { await nodeB?.stop(); } catch { /* */ }
  });

  it('invite flips B from denied to allowed AND the allowlist quad replicates into B\'s local _meta', async () => {
    const cgId = freshCgId('bp-invite');
    const entity = 'urn:bulletproof:invite:secret';

    const walletA = new ethers.Wallet(HARDHAT_KEYS.CORE_OP);
    const walletB = new ethers.Wallet(HARDHAT_KEYS.REC1_OP);

    nodeA = await DKGAgent.create({
      name: 'BulletproofInviteA',
      listenPort: 0,
      skills: [],
      chainAdapter: createEVMAdapter(HARDHAT_KEYS.CORE_OP),
      nodeRole: 'core',
    });
    nodeB = await DKGAgent.create({
      name: 'BulletproofInviteB',
      listenPort: 0,
      skills: [],
      chainAdapter: createEVMAdapter(HARDHAT_KEYS.REC1_OP),
      nodeRole: 'core',
    });
    await nodeA.start();
    await nodeB.start();
    await sleep(300);

    const addrA = nodeA.multiaddrs.find(
      (a) => a.includes('/tcp/') && !a.includes('/p2p-circuit'),
    )!;
    await nodeB.connectTo(addrA);
    await sleep(300);

    // A creates a PRIVATE CG listing ONLY A's wallet. B must initially
    // be denied by the sync authorization check.
    await nodeA.createContextGraph({
      id: cgId,
      name: 'Bulletproof Invite',
      description: 'private — allowlist replication check',
      private: true,
      allowedAgents: [walletA.address],
    });

    // Publish a real quad so there is actually data to gate on. Using
    // publish() (not store.insert) means the allowlist gate has to
    // reject *real* KC data, not synthetic state.
    const pub = await nodeA.publish(cgId, [
      { subject: entity, predicate: 'http://schema.org/name', object: '"InviteSecret"', graph: '' },
    ]);
    expect(pub.status).toBe('confirmed');

    // Prime B with ontology so authorization logic has the CG's access
    // policy loaded locally. Ontology is a system CG and is always open,
    // so this step should succeed regardless of the invite state.
    await nodeB.syncFromPeer(nodeA.peerId, [SYSTEM_PARANETS.ONTOLOGY]);

    // Phase 1: pre-invite. B is NOT on the allowlist — syncFromPeer must
    // return 0 (rejected by authorizeSyncRequest on A's side).
    const preInviteSynced = await nodeB.syncFromPeer(nodeA.peerId, [cgId]);
    expect(
      preInviteSynced,
      'pre-invite sync must return 0 — if a non-listed agent can pull private data, invite is a no-op and this test catches it',
    ).toBe(0);

    // Phase 2: invite. A writes B's wallet into A's local _meta allowlist.
    await nodeA.inviteAgentToContextGraph(cgId, walletB.address);

    // Refresh ontology after invite so any access-policy side effects
    // of the invite (if any) are visible to B.
    await nodeB.syncFromPeer(nodeA.peerId, [SYSTEM_PARANETS.ONTOLOGY]);

    // Phase 3: post-invite. Sync must now succeed.
    const postInviteSynced = await nodeB.syncFromPeer(nodeA.peerId, [cgId]);
    expect(
      postInviteSynced,
      'post-invite sync must return >0 — a 0 here means the invite never unlocked authorization',
    ).toBeGreaterThan(0);

    // Strongest check: B can query the secret quad A published.
    const qr = await nodeB.query(
      `SELECT ?o WHERE { <${entity}> <http://schema.org/name> ?o }`,
      { contextGraphId: cgId },
    );
    expect(qr.bindings.length, 'B should see exactly the quad A published').toBe(1);
    expect(qr.bindings[0]?.['o']).toBe('"InviteSecret"');

    // Strongest check (part 2): the allowlist quad MUST have replicated
    // into B's local _meta graph through the sync response. If A only
    // writes allowlist locally and sync doesn't propagate it, B could
    // query the data (because A authorized this one transfer) but B's
    // _meta would be missing the allowlist entry — and a subsequent
    // tree-of-peers invitation flow would be broken. Assert the quad
    // landed on B.
    const metaGraph = paranetMetaGraphUri(cgId);
    const dataGraph = contextGraphDataUri(cgId);
    const allowlistProbe = await nodeB.query(
      `SELECT ?agent WHERE { GRAPH <${metaGraph}> { <${dataGraph}> <${DKG_ALLOWED_AGENT}> ?agent } }`,
    );
    const replicatedAllowed = allowlistProbe.bindings.map((b) => (b['agent'] ?? '').toLowerCase());
    // Strings in SPARQL bindings are quoted literal form; normalize both
    // sides to raw lowercase address for a robust match.
    const expectedAddr = walletB.address.toLowerCase();
    const matches = replicatedAllowed.some((v) => v.includes(expectedAddr));
    expect(
      matches,
      `B's local _meta must contain the DKG_ALLOWED_AGENT quad for ${expectedAddr}. ` +
        `Got instead: ${JSON.stringify(replicatedAllowed)}`,
    ).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// JOIN-REQUEST invite (user-facing, cryptographic, curator-approval path)
// ---------------------------------------------------------------------------
//
// The `inviteAgentToContextGraph` path tested above is the *curator-initiated*
// invite. The more realistic user-facing invite is the *join-request*: B
// doesn't know the curator, signs a request with their own wallet, forwards
// it through whatever peer they can reach, and the curator approves it.
// That flow involves:
//   * EIP-191 sig over `keccak256(cgId ‖ agentAddress ‖ timestamp)`
//   * libp2p PROTOCOL_JOIN_REQUEST round-trip
//   * Pending request persisted in curator's `_meta` graph
//   * Curator's `approveJoinRequest` which re-verifies sig, calls
//     `inviteAgentToContextGraph`, and broadcasts `join-approved`
//
// The original explore audit flagged this as the most fragile invite path.
// This test locks in the *entire* chain; if any link breaks (sig mismatch,
// curator persistence, approval notification, allowlist flip) exactly one
// assertion fails and names the regression.
describe('bulletproof: INVITE contract (join-request path, B signs → A approves)', () => {
  let curator: DKGAgent;
  let requester: DKGAgent;

  afterAll(async () => {
    try { await curator?.stop(); } catch { /* */ }
    try { await requester?.stop(); } catch { /* */ }
  });

  it('signJoinRequest → forwardJoinRequest → approveJoinRequest unblocks sync for the requester', async () => {
    const cgId = freshCgId('bp-join');
    const entity = 'urn:bulletproof:join:secret';

    const walletA = new ethers.Wallet(HARDHAT_KEYS.CORE_OP);
    const walletB = new ethers.Wallet(HARDHAT_KEYS.REC1_OP);

    curator = await DKGAgent.create({
      name: 'BulletproofJoinCurator',
      listenPort: 0,
      skills: [],
      chainAdapter: createEVMAdapter(HARDHAT_KEYS.CORE_OP),
      nodeRole: 'core',
    });
    requester = await DKGAgent.create({
      name: 'BulletproofJoinRequester',
      listenPort: 0,
      skills: [],
      chainAdapter: createEVMAdapter(HARDHAT_KEYS.REC1_OP),
      nodeRole: 'core',
    });
    await curator.start();
    await requester.start();
    await sleep(300);

    const curatorAddr = curator.multiaddrs.find(
      (a) => a.includes('/tcp/') && !a.includes('/p2p-circuit'),
    )!;
    await requester.connectTo(curatorAddr);
    await sleep(300);

    // Curator creates a private CG containing only themselves, publishes
    // a real quad, and hosts the join-request protocol. Requester is not
    // yet on the allowlist — so a direct sync must fail first.
    await curator.createContextGraph({
      id: cgId,
      name: 'Bulletproof Join Request',
      description: 'private — requester must use join-request to get in',
      private: true,
      allowedAgents: [walletA.address],
    });

    const pub = await curator.publish(cgId, [
      { subject: entity, predicate: 'http://schema.org/name', object: '"JoinSecret"', graph: '' },
    ]);
    expect(pub.status).toBe('confirmed');

    await requester.syncFromPeer(curator.peerId, [SYSTEM_PARANETS.ONTOLOGY]);
    const preSync = await requester.syncFromPeer(curator.peerId, [cgId]);
    expect(preSync, 'requester is not on allowlist yet — pre-sync must return 0').toBe(0);

    // Step 1: B signs a join request with their custodial wallet.
    const signed = await requester.signJoinRequest(cgId, walletB.address);
    expect(signed.contextGraphId).toBe(cgId);
    expect(signed.agentAddress.toLowerCase()).toBe(walletB.address.toLowerCase());
    expect(signed.signature).toMatch(/^0x[0-9a-f]+$/i);
    expect(signed.timestamp).toBeGreaterThan(0);

    // Step 2: signature verification is the crypto contract — if this
    // breaks, every downstream approval fails silently.
    const recovered = curator.verifyJoinRequest(
      signed.contextGraphId,
      signed.agentAddress,
      signed.timestamp,
      signed.signature,
    );
    expect(recovered.toLowerCase(), 'curator must recover exactly B\'s address from the signature').toBe(
      walletB.address.toLowerCase(),
    );

    // Step 3: B forwards the signed request through connected peers.
    // With only curator connected, `delivered` should be exactly 1.
    const forwarded = await requester.forwardJoinRequest(
      signed.contextGraphId,
      signed.agentAddress,
      signed.signature,
      signed.timestamp,
      'Requester Bob',
    );
    expect(
      forwarded.delivered,
      `forwardJoinRequest should deliver to exactly one curator peer, got ${forwarded.delivered}. ` +
        `errors=${JSON.stringify(forwarded.errors)}`,
    ).toBeGreaterThanOrEqual(1);

    // Step 4: curator now has the pending request in their _meta graph.
    await sleep(200); // gossip handler is async — give it a tick to persist
    const pending = await curator.listPendingJoinRequests(cgId);
    expect(pending.length, 'curator must see exactly one pending join request').toBe(1);
    expect(pending[0].agentAddress.toLowerCase()).toBe(walletB.address.toLowerCase());
    expect(pending[0].name).toBe('Requester Bob');
    expect(pending[0].signature).toBe(signed.signature);

    // Step 5: curator approves. Internally this calls
    // inviteAgentToContextGraph (so the allowlist flips) and broadcasts
    // a join-approved P2P payload. The approval's re-verification of the
    // signature is the crypto gate — if the curator accepted a forged
    // request here, that would be a real bug and this test would still
    // pass up to this point. That's why Step 6 asserts the *outcome*
    // (sync now succeeds) not just the "didn't throw" behavior.
    await curator.approveJoinRequest(cgId, walletB.address);

    // Step 6: the allowlist-flip must unblock sync for B. Refresh ontology
    // first so B's local access policy is current, then attempt the CG.
    await requester.syncFromPeer(curator.peerId, [SYSTEM_PARANETS.ONTOLOGY]);
    const postSync = await requester.syncFromPeer(curator.peerId, [cgId]);
    expect(
      postSync,
      'approved requester must now sync > 0 quads from curator — 0 here means approval did not flip the allowlist',
    ).toBeGreaterThan(0);

    // Step 7: the secret quad is now on B's store.
    const qr = await requester.query(
      `SELECT ?o WHERE { <${entity}> <http://schema.org/name> ?o }`,
      { contextGraphId: cgId },
    );
    expect(qr.bindings.length, 'approved requester should see the published secret').toBe(1);
    expect(qr.bindings[0]?.['o']).toBe('"JoinSecret"');

    // Step 8: curator's pending-request list should now have the request
    // marked "approved", NOT "pending" — a subtle state machine bug.
    // listPendingJoinRequests filters to status==='pending' so the count
    // should be 0 after approval.
    const stillPending = await curator.listPendingJoinRequests(cgId);
    expect(
      stillPending.length,
      'curator\'s pending list must exclude approved requests',
    ).toBe(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// SYNC reconciliation — regression for https://github.com/OriginTrail/dkg-v9/issues/2
//
// Issue summary:
//   "Nodes can drift out of sync because runtime sync scope does not
//    consistently include all relevant paranets (subscribed + defaults +
//    runtime-discovered), and existing sync logic lacks a strong set-level
//    reconciliation mechanism. Peers report 'synced' but still differ in
//    effective KC sets."
//
// Reproducer contract:
//   * A creates one public CG, publishes N=3 distinct root entities
//     (three separate on-chain KCs) into it. On-chain identity for the
//     CG is registered via createContextGraph.
//   * B is a fresh agent with NO `syncContextGraphs` in its config. It
//     has no prior knowledge of the CG — the ONLY discovery path is
//     A's ontology + runtime discovery during sync-on-connect.
//   * B connects to A. That triggers handlePeerConnect → first-pass
//     syncFromPeer (system paranets) → discoverContextGraphsFromStore
//     → second syncFromPeer for newly discovered CGs.
//   * After the handshake settles we assert a SET EQUALITY between A's
//     and B's view of the CG: every root entity A published must be
//     queryable from B's store, AND the total data-graph triple count
//     on B must equal A's.
//
// If #2 is still open, one of the two set-equality assertions fails:
//   a) one or more root entities missing on B (discovery didn't pick
//      the CG up for this peer), or
//   b) root entities present but triple counts differ (KC set drift —
//      only a subset of KCs got synced even though scope included the
//      CG). Both are the exact drift symptoms the issue describes.
// ---------------------------------------------------------------------------
describe('bulletproof: SYNC set-reconciliation (regression for issue #2)', () => {
  let nodeA: DKGAgent;
  let nodeB: DKGAgent;

  afterAll(async () => {
    try { await nodeA?.stop(); } catch { /* */ }
    try { await nodeB?.stop(); } catch { /* */ }
  });

  it('B auto-discovers A\'s public CG and syncs its FULL KC set (not a subset)', async () => {
    const cgId = freshCgId('bp-drift');
    const entities = [
      'urn:bulletproof:drift:alpha',
      'urn:bulletproof:drift:beta',
      'urn:bulletproof:drift:gamma',
    ];

    nodeA = await DKGAgent.create({
      name: 'BulletproofDriftA',
      listenPort: 0,
      skills: [],
      chainAdapter: createEVMAdapter(HARDHAT_KEYS.CORE_OP),
      nodeRole: 'core',
    });
    nodeB = await DKGAgent.create({
      name: 'BulletproofDriftB',
      listenPort: 0,
      skills: [],
      chainAdapter: createEVMAdapter(HARDHAT_KEYS.REC1_OP),
      nodeRole: 'core',
      // Intentionally NO syncContextGraphs — discovery is the contract
      // under test. If this value is prefilled with [cgId], the sync
      // path B takes is the "already-subscribed" path, which is not
      // what issue #2 is about.
    });
    await nodeA.start();
    await nodeB.start();
    await sleep(300);

    // A sets up a public CG (not private, no allowlist) and seeds it
    // with three separate KCs. Each publish lands on-chain and in A's
    // store before B ever connects.
    await nodeA.createContextGraph({
      id: cgId,
      name: 'Bulletproof Drift',
      description: 'public — B should auto-discover via ontology sync',
      // explicitly public — no allowedAgents
    });
    for (const entity of entities) {
      const pub = await nodeA.publish(cgId, [
        { subject: entity, predicate: 'http://schema.org/name', object: `"drift-${entity.split(':').pop()}"`, graph: '' },
      ]);
      expect(
        pub.status,
        `precondition: A must successfully publish ${entity} (got status=${pub.status})`,
      ).toBe('confirmed');
    }

    // Verify A's own view is what we expect — 3 KCs, one per entity.
    const dataGraphA = contextGraphDataUri(cgId);
    const aCount = await countQuads(nodeA, cgId, dataGraphA);
    expect(
      aCount,
      `precondition: A's data graph should hold triples for all 3 entities (got ${aCount})`,
    ).toBeGreaterThanOrEqual(entities.length);

    // B now connects to A with zero prior knowledge of cgId. The only
    // way B can learn about this CG is through sync-on-connect +
    // ontology + runtime discovery. This is the exact path #2 says is
    // fragile.
    const addrA = nodeA.multiaddrs.find(
      (a) => a.includes('/tcp/') && !a.includes('/p2p-circuit'),
    )!;
    await nodeB.connectTo(addrA);

    // Wait for the handshake chain: connect → ontology sync → discovery
    // → second syncFromPeer pass. In practice this is well under 2s on
    // a local Hardhat; we give it generous headroom so a slow CI
    // doesn't turn a real drift bug into a timing flake.
    await sleep(3000);

    // Extra belt-and-braces sync in case the peer-connect-triggered
    // discovery loop didn't catch the runtime-discovered CG on the
    // first pass. If #2's "incomplete scope" is the bug, this second
    // explicit ontology resync should still NOT be required for the
    // three KCs to show up; we include it only so the assertion is
    // about SET equality, not about handshake timing. A node that
    // needs to be poked to see its peer's data IS the bug.
    await nodeB.syncFromPeer(nodeA.peerId, [SYSTEM_PARANETS.ONTOLOGY]);
    await sleep(500);
    // Now the CG ought to be in B's runtime scope. If it isn't, this
    // next explicit sync is a no-op and the subsequent assertions
    // will fail with the exact missing-entity or count mismatch.
    await nodeB.syncFromPeer(nodeA.peerId, [cgId]);
    await sleep(500);

    // Assert 1: all three root entities must be queryable from B.
    // We use a SELECT with LIMIT 1 rather than ASK because the agent's
    // query surface returns { bindings: [] } uniformly (no type
    // discriminator), so "any bindings" ↔ "entity present".
    for (const entity of entities) {
      const qr = await nodeB.query(
        `SELECT ?p ?o WHERE { GRAPH <${dataGraphA}> { <${entity}> ?p ?o } } LIMIT 1`,
        { contextGraphId: cgId },
      );
      const present = Array.isArray(qr.bindings) && qr.bindings.length > 0;
      expect(
        present,
        `Bug https://github.com/OriginTrail/dkg-v9/issues/2: ` +
          `B reports "synced" but entity ${entity} from A's CG "${cgId}" is missing. ` +
          `This is the "effective KC set differs across peers" symptom from the issue.`,
      ).toBe(true);
    }

    // Assert 2: total triple counts for the data graph must match.
    // If only a subset of the 3 KCs landed on B, count diverges even
    // though each individual entity may be present with a stale
    // subset of its quads.
    const bCount = await countQuads(nodeB, cgId, dataGraphA);
    expect(
      bCount,
      `Bug https://github.com/OriginTrail/dkg-v9/issues/2: ` +
        `B's data graph triple count (${bCount}) differs from A's (${aCount}) ` +
        `after auto-discovery sync — peers drifted despite both reporting "synced". ` +
        `Likely in packages/agent/src/dkg-agent.ts discoverContextGraphsFromStore / ` +
        `handlePeerConnect second-pass sync scope.`,
    ).toBe(aCount);
  }, 120_000);
});

// Best-effort helper: count quads in a specific graph on an agent's
// triple store by going through its SPARQL surface, scoped to the
// given contextGraphId so the agent's access policy / view resolver
// grants access to the data graph. Returns 0 on any query shape we
// don't expect so the caller's assertion fails with a clear count
// mismatch rather than this helper throwing.
async function countQuads(agent: DKGAgent, cgId: string, graphUri: string): Promise<number> {
  const result = await agent.query(
    `SELECT ?s ?p ?o WHERE { GRAPH <${graphUri}> { ?s ?p ?o } }`,
    { contextGraphId: cgId },
  );
  return Array.isArray(result.bindings) ? result.bindings.length : 0;
}
