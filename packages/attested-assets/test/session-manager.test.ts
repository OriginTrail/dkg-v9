import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionManager, AKASessionEvent } from '../src/session-manager.js';
import { ReducerRegistry } from '../src/reducer.js';
import { computeStateHash } from '../src/canonical.js';
import { TypedEventBus, generateEd25519Keypair, type Ed25519Keypair } from '@dkg/core';
import type { ReducerModule, QuorumPolicy, SessionMember } from '../src/types.js';

const mockGossip = {
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  publish: vi.fn().mockResolvedValue(undefined),
  onMessage: vi.fn(),
  offMessage: vi.fn(),
  get subscribedTopics() { return []; },
};

function makeTestReducer(): ReducerModule {
  const genesisBytes = new Uint8Array([0, 0, 0, 0]);
  return {
    name: 'test-reducer',
    version: '1.0.0',
    hash: 'test-hash-123',
    reduce: (prev: Uint8Array, inputs: Uint8Array[]) => {
      const state = new Uint8Array(prev.length);
      state.set(prev);
      for (const input of inputs) {
        for (let i = 0; i < Math.min(input.length, state.length); i++) {
          state[i] = (state[i] + input[i]) % 256;
        }
      }
      return state;
    },
    genesisState: () => new Uint8Array(genesisBytes),
  };
}

describe('SessionManager', () => {
  let manager: SessionManager;
  let eventBus: TypedEventBus;
  let reducerRegistry: ReducerRegistry;
  let kp1: Ed25519Keypair;
  let kp2: Ed25519Keypair;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    kp1 = await generateEd25519Keypair();
    kp2 = await generateEd25519Keypair();
    eventBus = new TypedEventBus();
    reducerRegistry = new ReducerRegistry();
    reducerRegistry.register(makeTestReducer());

    mockGossip.subscribe.mockClear();
    mockGossip.unsubscribe.mockClear();
    mockGossip.publish.mockClear();
    mockGossip.onMessage.mockClear();
    mockGossip.offMessage.mockClear();

    manager = new SessionManager(
      mockGossip as any,
      eventBus,
      reducerRegistry,
      {
        localPeerId: 'peer-1',
        secretKey: kp1.secretKey,
        network: 'test-net',
        proposerGraceMs: 500,
        acceptTimeoutMs: 5000,
      },
    );
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  const membership: SessionMember[] = [
    { peerId: 'peer-1', pubKey: kp1?.publicKey ?? new Uint8Array(32), displayName: 'Alice', role: 'creator' },
    { peerId: 'peer-2', pubKey: kp2?.publicKey ?? new Uint8Array(32), displayName: 'Bob', role: 'member' },
  ];

  const quorumPolicy: QuorumPolicy = { type: 'THRESHOLD', numerator: 2, denominator: 3, minSigners: 2 };
  const reducerConfig = { name: 'test-reducer', version: '1.0.0', hash: 'test-hash-123' };

  it('creates a session with correct config', async () => {
    const config = await manager.createSession(
      'paranet-1', 'test-app', membership, quorumPolicy, reducerConfig, 30000, null,
    );

    expect(config.sessionId).toHaveLength(64);
    expect(config.paranetId).toBe('paranet-1');
    expect(config.appId).toBe('test-app');
    expect(config.status).toBe('proposed');
    expect(config.membership).toHaveLength(2);
    expect(config.genesisStateHash).toBeTruthy();
    expect(config.configHash).toHaveLength(64);
  });

  it('emits SESSION_PROPOSED event on creation', async () => {
    const handler = vi.fn();
    eventBus.on(AKASessionEvent.SESSION_PROPOSED, handler);

    const config = await manager.createSession(
      'paranet-1', 'test-app', membership, quorumPolicy, reducerConfig, 30000, null,
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: config.sessionId }),
    );
  });

  it('publishes SessionProposed event via gossip', async () => {
    await manager.createSession(
      'paranet-1', 'test-app', membership, quorumPolicy, reducerConfig, 30000, null,
    );

    expect(mockGossip.publish).toHaveBeenCalled();
    const [topic] = mockGossip.publish.mock.calls[0];
    expect(topic).toContain('paranet-1');
    expect(topic).toContain('sessions');
  });

  it('subscribes to session gossip topic on creation', async () => {
    await manager.createSession(
      'paranet-1', 'test-app', membership, quorumPolicy, reducerConfig, 30000, null,
    );

    expect(mockGossip.subscribe).toHaveBeenCalled();
  });

  it('getSession retrieves a created session', async () => {
    const config = await manager.createSession(
      'paranet-1', 'test-app', membership, quorumPolicy, reducerConfig, 30000, null,
    );

    const session = manager.getSession(config.sessionId);
    expect(session).toBeDefined();
    expect(session!.config.sessionId).toBe(config.sessionId);
    expect(session!.latestStateHash).toBe(config.genesisStateHash);
    expect(session!.currentRound).toBe(0);
  });

  it('listSessions filters by paranetId', async () => {
    await manager.createSession('paranet-1', 'app', membership, quorumPolicy, reducerConfig, 30000, null);
    await manager.createSession('paranet-2', 'app', membership, quorumPolicy, reducerConfig, 30000, null);

    const list = manager.listSessions('paranet-1');
    expect(list).toHaveLength(1);
    expect(list[0].paranetId).toBe('paranet-1');
  });

  it('listSessions filters by status', async () => {
    await manager.createSession('paranet-1', 'app', membership, quorumPolicy, reducerConfig, 30000, null);

    expect(manager.listSessions(undefined, 'proposed')).toHaveLength(1);
    expect(manager.listSessions(undefined, 'active')).toHaveLength(0);
  });

  it('rejects session creation with unknown reducer', async () => {
    const badReducer = { name: 'unknown', version: '1.0.0', hash: 'xxx' };
    await expect(
      manager.createSession('p', 'a', membership, quorumPolicy, badReducer, 30000, null),
    ).rejects.toThrow('not found');
  });

  it('activateSession transitions status to active', async () => {
    const config = await manager.createSession(
      'paranet-1', 'test-app', membership, quorumPolicy, reducerConfig, 30000, null,
    );

    const handler = vi.fn();
    eventBus.on(AKASessionEvent.SESSION_ACTIVATED, handler);

    await manager.activateSession(config.sessionId);

    const session = manager.getSession(config.sessionId);
    expect(session!.config.status).toBe('active');
    expect(handler).toHaveBeenCalledWith({ sessionId: config.sessionId });
  });

  it('activateSession rejects if not creator', async () => {
    const otherManager = new SessionManager(
      mockGossip as any,
      new TypedEventBus(),
      reducerRegistry,
      { localPeerId: 'peer-999', secretKey: kp2.secretKey, network: 'test' },
    );

    const config = await manager.createSession(
      'paranet-1', 'app', membership, quorumPolicy, reducerConfig, 30000, null,
    );

    await expect(otherManager.activateSession(config.sessionId)).rejects.toThrow('not found');
    otherManager.destroy();
  });

  it('startRound publishes RoundStart and transitions to collecting_inputs', async () => {
    const config = await manager.createSession(
      'paranet-1', 'app', membership, quorumPolicy, reducerConfig, 30000, null,
    );
    await manager.activateSession(config.sessionId);

    const session = manager.getSession(config.sessionId)!;
    // round 2: proposerIndex = 2 % 2 = 0 → membership[0] = peer-1
    session.currentRound = 2;

    const roundHandler = vi.fn();
    eventBus.on(AKASessionEvent.ROUND_STARTED, roundHandler);

    const publishCountBefore = mockGossip.publish.mock.calls.length;
    await manager.startRound(config.sessionId);

    expect(mockGossip.publish.mock.calls.length).toBeGreaterThan(publishCountBefore);
    expect(roundHandler).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: config.sessionId, round: 2 }),
    );

    const roundState = session.roundStates.get(2);
    expect(roundState).toBeDefined();
    expect(roundState!.status).toBe('collecting_inputs');
  });

  it('startRound rejects if not the proposer', async () => {
    const config = await manager.createSession(
      'paranet-1', 'app', membership, quorumPolicy, reducerConfig, 30000, null,
    );
    await manager.activateSession(config.sessionId);

    const session = manager.getSession(config.sessionId)!;
    // round 1: proposerIndex = 1 % 2 = 1 → membership[1] = peer-2 (not our localPeerId)
    session.currentRound = 1;

    await expect(manager.startRound(config.sessionId)).rejects.toThrow('not the proposer');
  });

  it('submitInput publishes InputSubmitted via gossip', async () => {
    const config = await manager.createSession(
      'paranet-1', 'app', membership, quorumPolicy, reducerConfig, 30000, null,
    );
    await manager.activateSession(config.sessionId);

    const session = manager.getSession(config.sessionId)!;
    // round 2: proposerIndex = 2 % 2 = 0 → membership[0] = peer-1
    session.currentRound = 2;
    await manager.startRound(config.sessionId);

    const publishCountBefore = mockGossip.publish.mock.calls.length;
    await manager.submitInput(config.sessionId, new Uint8Array([1, 2, 3]));

    expect(mockGossip.publish.mock.calls.length).toBeGreaterThan(publishCountBefore);
  });

  it('submitInput rejects when round is not collecting inputs', async () => {
    const config = await manager.createSession(
      'paranet-1', 'app', membership, quorumPolicy, reducerConfig, 30000, null,
    );
    await manager.activateSession(config.sessionId);

    await expect(
      manager.submitInput(config.sessionId, new Uint8Array([1])),
    ).rejects.toThrow('not collecting inputs');
  });

  it('destroy clears all sessions and timers', async () => {
    await manager.createSession('p', 'a', membership, quorumPolicy, reducerConfig, 30000, null);
    manager.destroy();

    expect(manager.listSessions()).toHaveLength(0);
  });

  it('genesisStateHash is computed from reducer genesis state', async () => {
    const reducer = makeTestReducer();
    const expectedGenesis = reducer.genesisState(membership);
    const expectedHash = computeStateHash(expectedGenesis);

    const config = await manager.createSession(
      'paranet-1', 'app', membership, quorumPolicy, reducerConfig, 30000, null,
    );

    expect(config.genesisStateHash).toBe(expectedHash);
  });
});
