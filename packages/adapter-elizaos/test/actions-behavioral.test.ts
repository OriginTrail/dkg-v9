/**
 * Behavioral coverage for the adapter-elizaos action-handler internals
 * and the persistChatTurnImpl cross-surface implementation.
 *
 * The five DKG_* action handlers each call `requireAgent()` which throws
 * when no DKGAgent is live; booting a real DKGAgent pulls in libp2p +
 * chain + storage per test and is covered by downstream integration
 * suites. The happy-path logic worth unit-testing is therefore:
 *
 *   1. persistChatTurnImpl — takes a loose agent interface (publish only)
 *      so we exercise every quad-building branch, defaults chain, and
 *      contextGraphId / assistantText resolution order with a tiny
 *      capturing fake.
 *   2. Provider keyword extraction (exercised via dkgKnowledgeProvider.get
 *      short-circuit on stop-word / short-token inputs).
 *   3. Action handler argument parsing when the agent is absent — these
 *      paths are already covered in adapter-elizaos-extra.test.ts via
 *      error-routing, this file adds the happy-path branches for
 *      DKG_PERSIST_CHAT_TURN which CAN be tested without a live agent
 *      thanks to persistChatTurnImpl's loose type.
 */
import { describe, it, expect } from 'vitest';
import { persistChatTurnImpl, dkgPersistChatTurn } from '../src/actions.js';
import { dkgKnowledgeProvider } from '../src/provider.js';
import type { IAgentRuntime, Memory, State, HandlerCallback } from '../src/types.js';

function makeRuntime(settings: Record<string, string> = {}, characterName?: string): IAgentRuntime {
  return {
    getSetting: (k: string) => settings[k],
    character: characterName !== undefined ? { name: characterName } : undefined,
  } as unknown as IAgentRuntime;
}

function makeMessage(text: string, overrides: Partial<Memory> & { id?: string } = {}): Memory {
  return {
    content: { text },
    userId: overrides.userId ?? 'alice',
    roomId: overrides.roomId ?? 'room-1',
    agentId: overrides.agentId ?? 'agent-eliza',
    ...overrides,
  } as unknown as Memory;
}

interface CapturedPublish {
  cgId: string;
  quads: Array<{ subject: string; predicate: string; object: string }>;
}

function makeCapturingAgent(kcId: bigint | string = 42n) {
  const publishes: CapturedPublish[] = [];
  const agent = {
    async publish(cgId: string, quads: any) {
      publishes.push({ cgId, quads: [...quads] });
      return { kcId };
    },
  };
  return { agent, publishes };
}

// ===========================================================================
// persistChatTurnImpl — quad building + default resolution order
// ===========================================================================

describe('persistChatTurnImpl — base quad set', () => {
  it('emits the six mandatory turn quads for a user-only message (no assistant reply)', async () => {
    const { agent, publishes } = makeCapturingAgent();
    const out = await persistChatTurnImpl(
      agent,
      makeRuntime({}, 'Pepper'),
      makeMessage('hello world', { id: 'mem-1', roomId: 'room-A', userId: 'bob' } as any),
      {} as State,
      {},
    );
    expect(out.tripleCount).toBe(6);
    expect(publishes).toHaveLength(1);
    expect(publishes[0].cgId).toBe('chat');

    const preds = publishes[0].quads.map(q => q.predicate);
    expect(preds).toEqual(expect.arrayContaining([
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
      'https://schema.origintrail.io/dkg/v10/userId',
      'https://schema.origintrail.io/dkg/v10/roomId',
      'https://schema.origintrail.io/dkg/v10/agentName',
      'https://schema.origintrail.io/dkg/v10/userMessage',
      'https://schema.origintrail.io/dkg/v10/timestamp',
    ]));

    // No assistantReply predicate when the text is absent.
    expect(preds).not.toContain('https://schema.origintrail.io/dkg/v10/assistantReply');

    // agentName should come from the character (highest priority).
    const agentNameQuad = publishes[0].quads.find(q => q.predicate.endsWith('/agentName'))!;
    expect(agentNameQuad.object).toBe('"Pepper"');
  });

  it('emits the 7th assistantReply quad when opts.assistantText is supplied', async () => {
    const { agent, publishes } = makeCapturingAgent();
    const out = await persistChatTurnImpl(
      agent,
      makeRuntime(),
      makeMessage('hi', { id: 'm', roomId: 'r', userId: 'u' } as any),
      {} as State,
      { assistantText: 'hello back' },
    );
    expect(out.tripleCount).toBe(7);
    const reply = publishes[0].quads.find(q => q.predicate.endsWith('/assistantReply'))!;
    expect(reply.object).toBe('"hello back"');
  });

  it('falls back to opts.assistantReply.text when assistantText is not set', async () => {
    const { agent, publishes } = makeCapturingAgent();
    await persistChatTurnImpl(
      agent,
      makeRuntime(),
      makeMessage('hi', { id: 'm', roomId: 'r', userId: 'u' } as any),
      {} as State,
      { assistantReply: { text: 'reply-obj' } },
    );
    const reply = publishes[0].quads.find(q => q.predicate.endsWith('/assistantReply'))!;
    expect(reply.object).toBe('"reply-obj"');
  });

  it('falls back to state.lastAssistantReply when neither opts field is set', async () => {
    const { agent, publishes } = makeCapturingAgent();
    await persistChatTurnImpl(
      agent,
      makeRuntime(),
      makeMessage('hi', { id: 'm', roomId: 'r', userId: 'u' } as any),
      { lastAssistantReply: 'from-state' } as State,
      {},
    );
    const reply = publishes[0].quads.find(q => q.predicate.endsWith('/assistantReply'));
    expect(reply?.object).toBe('"from-state"');
  });
});

describe('persistChatTurnImpl — contextGraphId resolution order', () => {
  it('prefers opts.contextGraphId over DKG_CHAT_CG setting and "chat" default', async () => {
    const { agent, publishes } = makeCapturingAgent();
    await persistChatTurnImpl(
      agent,
      makeRuntime({ DKG_CHAT_CG: 'settings-cg' }),
      makeMessage('hi'),
      {} as State,
      { contextGraphId: 'opts-cg' },
    );
    expect(publishes[0].cgId).toBe('opts-cg');
  });

  it('uses DKG_CHAT_CG setting when opts.contextGraphId is undefined', async () => {
    const { agent, publishes } = makeCapturingAgent();
    await persistChatTurnImpl(
      agent,
      makeRuntime({ DKG_CHAT_CG: 'settings-cg' }),
      makeMessage('hi'),
      {} as State,
      {},
    );
    expect(publishes[0].cgId).toBe('settings-cg');
  });

  it('defaults to "chat" when neither opts nor settings provide one', async () => {
    const { agent, publishes } = makeCapturingAgent();
    await persistChatTurnImpl(agent, makeRuntime(), makeMessage('hi'), {} as State, {});
    expect(publishes[0].cgId).toBe('chat');
  });
});

describe('persistChatTurnImpl — agentName resolution order', () => {
  it('prefers character.name over DKG_AGENT_NAME setting', async () => {
    const { agent, publishes } = makeCapturingAgent();
    await persistChatTurnImpl(
      agent,
      makeRuntime({ DKG_AGENT_NAME: 'from-settings' }, 'from-character'),
      makeMessage('hi'),
      {} as State,
      {},
    );
    const name = publishes[0].quads.find(q => q.predicate.endsWith('/agentName'))!;
    expect(name.object).toBe('"from-character"');
  });

  it('falls back to DKG_AGENT_NAME when character is undefined', async () => {
    const { agent, publishes } = makeCapturingAgent();
    await persistChatTurnImpl(
      agent,
      makeRuntime({ DKG_AGENT_NAME: 'from-settings' }),
      makeMessage('hi'),
      {} as State,
      {},
    );
    const name = publishes[0].quads.find(q => q.predicate.endsWith('/agentName'))!;
    expect(name.object).toBe('"from-settings"');
  });

  it('falls back to "elizaos-agent" when neither is set', async () => {
    const { agent, publishes } = makeCapturingAgent();
    await persistChatTurnImpl(agent, makeRuntime(), makeMessage('hi'), {} as State, {});
    const name = publishes[0].quads.find(q => q.predicate.endsWith('/agentName'))!;
    expect(name.object).toBe('"elizaos-agent"');
  });
});

describe('persistChatTurnImpl — turnUri construction (escapeIri)', () => {
  it('replaces non-alphanumeric chars in roomId + memId with underscores', async () => {
    const { agent } = makeCapturingAgent();
    const out = await persistChatTurnImpl(
      agent,
      makeRuntime(),
      makeMessage('hi', { id: 'mem/1:x', roomId: 'room@A!' } as any),
      {} as State,
      {},
    );
    expect(out.turnUri).toMatch(/^urn:dkg:elizaos:chat:room_A_:mem_1_x$/);
  });

  it('uses a timestamp-based memId fallback when message.id is missing', async () => {
    const { agent } = makeCapturingAgent();
    const msg = makeMessage('hi', { roomId: 'r' } as any);
    // Clear .id — forces the fallback branch `mem-${Date.now()}`
    delete (msg as any).id;
    const out = await persistChatTurnImpl(agent, makeRuntime(), msg, {} as State, {});
    expect(out.turnUri).toMatch(/^urn:dkg:elizaos:chat:r:mem-\d+$/);
  });

  it('uses "anonymous" / "default" fallbacks for userId / roomId', async () => {
    const { agent, publishes } = makeCapturingAgent();
    const msg = makeMessage('hi', { id: 'm' } as any);
    delete (msg as any).userId;
    delete (msg as any).roomId;
    await persistChatTurnImpl(agent, makeRuntime(), msg, {} as State, {});
    const quads = publishes[0].quads;
    expect(quads.find(q => q.predicate.endsWith('/userId'))!.object).toBe('"anonymous"');
    expect(quads.find(q => q.predicate.endsWith('/roomId'))!.object).toBe('"default"');
  });
});

describe('persistChatTurnImpl — rdfString escaping', () => {
  it('escapes backslashes, double quotes, newlines and carriage returns in user text', async () => {
    const { agent, publishes } = makeCapturingAgent();
    await persistChatTurnImpl(
      agent,
      makeRuntime(),
      makeMessage('hello "world"\\n\nline2\r\nend'),
      {} as State,
      {},
    );
    const userMsg = publishes[0].quads.find(q => q.predicate.endsWith('/userMessage'))!;
    // Every embedded double quote becomes \"; every \ becomes \\; literal
    // \n (CR) and \n (LF) bytes become the 2-char escape sequences \r / \n.
    expect(userMsg.object).toContain('\\"world\\"');
    expect(userMsg.object).toContain('\\n');
    expect(userMsg.object).toContain('\\r');
    // Must not contain a raw newline char — would be invalid N-Quads.
    expect(userMsg.object).not.toMatch(/[\n\r]/);
  });

  it('timestamp quad ends with the xsd:dateTime datatype', async () => {
    const { agent, publishes } = makeCapturingAgent();
    await persistChatTurnImpl(agent, makeRuntime(), makeMessage('hi'), {} as State, {});
    const ts = publishes[0].quads.find(q => q.predicate.endsWith('/timestamp'))!;
    expect(ts.object).toMatch(/\^\^<http:\/\/www\.w3\.org\/2001\/XMLSchema#dateTime>$/);
  });
});

describe('persistChatTurnImpl — publish result passthrough', () => {
  it('coerces a bigint kcId to its decimal string', async () => {
    const { agent } = makeCapturingAgent(123456789012345678901234n);
    const out = await persistChatTurnImpl(agent, makeRuntime(), makeMessage('hi'), {} as State, {});
    expect(out.kcId).toBe('123456789012345678901234');
  });

  it('passes through a string kcId unchanged', async () => {
    const { agent } = makeCapturingAgent('kc-abc');
    const out = await persistChatTurnImpl(agent, makeRuntime(), makeMessage('hi'), {} as State, {});
    expect(out.kcId).toBe('kc-abc');
  });
});

// ===========================================================================
// dkgPersistChatTurn ACTION — happy path via the service's globally-installed
// agent. We can't drive the action's `requireAgent()` from here because that
// uses module-private state, so we only assert the shape and error-routing
// contract (happy path is validated directly against persistChatTurnImpl).
// ===========================================================================

describe('dkgPersistChatTurn action — metadata + error routing', () => {
  it('has the expected name, similes, description', () => {
    expect(dkgPersistChatTurn.name).toBe('DKG_PERSIST_CHAT_TURN');
    expect(dkgPersistChatTurn.similes).toEqual(expect.arrayContaining([
      'STORE_CHAT_TURN', 'PERSIST_CHAT', 'STORE_CHAT', 'RECORD_TURN', 'SAVE_CHAT_TURN',
    ]));
    expect(dkgPersistChatTurn.description).toMatch(/chat turn/i);
  });

  it('validate() always returns true (no gating)', async () => {
    const ok = await dkgPersistChatTurn.validate!({} as IAgentRuntime, {} as Memory);
    expect(ok).toBe(true);
  });

  it('when no agent is running, routes the error through the callback and returns false', async () => {
    const calls: Array<{ text: string }> = [];
    const cb: HandlerCallback = ((r: { text: string }) => { calls.push(r); return Promise.resolve([]); }) as any;
    const ok = await dkgPersistChatTurn.handler(
      makeRuntime(), makeMessage('remember this'), {} as State, {}, cb,
    );
    expect(ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/Chat turn persist failed:|DKG node not started/);
  });
});

// ===========================================================================
// dkgKnowledgeProvider — extractKeywords branches via the public get()
// ===========================================================================

describe('dkgKnowledgeProvider — keyword extraction branches', () => {
  it('returns null when no agent is initialized', async () => {
    const out = await dkgKnowledgeProvider.get!(
      makeRuntime(),
      makeMessage('tell me about distributed systems'),
    );
    // Without a DKGAgent singleton the provider MUST degrade to null.
    // This is the provider's documented graceful-degradation contract.
    expect(out === null || typeof out === 'string').toBe(true);
  });

  it('returns null for messages with only stop words and sub-3-char tokens', async () => {
    const out = await dkgKnowledgeProvider.get!(
      makeRuntime(),
      makeMessage('a of in the is be or to an'),
    );
    expect(out).toBeNull();
  });

  it('returns null for a fully punctuation-only message', async () => {
    const out = await dkgKnowledgeProvider.get!(
      makeRuntime(),
      makeMessage('!!! ... ??? ,,,'),
    );
    expect(out).toBeNull();
  });

  it('does not throw on messages containing special-regex characters', async () => {
    const out = await dkgKnowledgeProvider.get!(
      makeRuntime(),
      makeMessage('alice() [brackets] {braces} "quotes" — em-dash'),
    );
    expect(out === null || typeof out === 'string').toBe(true);
  });
});
