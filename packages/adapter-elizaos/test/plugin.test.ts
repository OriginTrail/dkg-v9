import { describe, it, expect, vi } from 'vitest';
import {
  dkgPlugin,
  dkgPublish,
  dkgQuery,
  dkgFindAgents,
  dkgSendMessage,
  dkgInvokeSkill,
  dkgPersistChatTurn,
  dkgKnowledgeProvider,
  dkgService,
} from '../src/index.js';

describe('dkgPlugin', () => {
  it('has name and description', () => {
    expect(dkgPlugin.name).toBe('dkg');
    expect(typeof dkgPlugin.description).toBe('string');
    expect(dkgPlugin.description.length).toBeGreaterThan(0);
  });

  it('exports 6 actions (incl. K-11 chat-persist)', () => {
    expect(dkgPlugin.actions).toHaveLength(6);
  });

  it('exports at least 1 provider', () => {
    expect(dkgPlugin.providers!.length).toBeGreaterThanOrEqual(1);
  });

  it('exports at least 1 service', () => {
    expect(dkgPlugin.services!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('actions', () => {
  const actions = [dkgPublish, dkgQuery, dkgFindAgents, dkgSendMessage, dkgInvokeSkill, dkgPersistChatTurn];

  it.each(actions.map(a => [a.name, a]))('%s has name, description, similes, and handler', (_name, action) => {
    expect(typeof action.name).toBe('string');
    expect(action.name.length).toBeGreaterThan(0);
    expect(typeof action.description).toBe('string');
    expect(Array.isArray(action.similes)).toBe(true);
    expect(typeof action.handler).toBe('function');
  });

  it('action names are unique', () => {
    const names = actions.map(a => a.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('DKG_PUBLISH action has validate function', () => {
    expect(typeof dkgPublish.validate).toBe('function');
  });
});

describe('dkgKnowledgeProvider', () => {
  it('has a get method', () => {
    expect(typeof dkgKnowledgeProvider.get).toBe('function');
  });
});

describe('dkgService', () => {
  it('has a name', () => {
    expect(typeof dkgService.name).toBe('string');
    expect(dkgService.name.length).toBeGreaterThan(0);
  });
});

describe('dkgPlugin.hooks wiring', () => {
  it('exposes onChatTurn / onAssistantReply / chatPersistenceHook as functions that delegate to dkgService.persistChatTurn', async () => {
    const p = dkgPlugin as any;
    expect(typeof p.hooks.onChatTurn).toBe('function');
    expect(typeof p.hooks.onAssistantReply).toBe('function');
    expect(typeof p.chatPersistenceHook).toBe('function');

    // Invoking each hook without a live DKGAgent MUST surface the
    // "DKG node not started" error — confirming the hook actually
    // routes into dkgService.persistChatTurn rather than being a stub.
    const runtime = { getSetting: () => undefined, character: { name: 'x' } } as any;
    const msg = { content: { text: 'hi' }, id: 'm', userId: 'u', roomId: 'r' } as any;

    for (const hook of [p.hooks.onChatTurn, p.hooks.onAssistantReply, p.chatPersistenceHook]) {
      await expect(hook(runtime, msg)).rejects.toThrow(/DKG node not started/);
    }
  });
});

// -----------------------------------------------------------------------
// PR #229 bot review round 14 — r14-2: onAssistantReply MUST plumb an
// explicit `userTurnPersisted` signal when the caller doesn't.
// -----------------------------------------------------------------------
describe('dkgPlugin.hooks.onAssistantReply — r14-2 userTurnPersisted plumbing', () => {
  it('defaults userTurnPersisted to false when the caller does not set it', async () => {
    const spy = vi.spyOn(dkgService, 'persistChatTurn' as any)
      .mockResolvedValue({ tripleCount: 0, turnUri: '', kcId: '' } as any);
    try {
      const runtime = { getSetting: () => undefined, character: { name: 'x' } } as any;
      const msg = { content: { text: 'hi' }, id: 'm', userId: 'u', roomId: 'r' } as any;

      await (dkgPlugin as any).hooks.onAssistantReply(runtime, msg, {}, {});
      expect(spy).toHaveBeenCalledTimes(1);
      const opts = spy.mock.calls[0][3] as any;
      expect(opts.mode).toBe('assistant-reply');
      // The key r14-2 invariant: the handler must set userTurnPersisted
      // explicitly so persistChatTurnImpl's legacy inference (presence of
      // userMessageId == "persisted") cannot be reached by accident.
      expect(opts.userTurnPersisted).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('defaults userTurnPersisted to false EVEN when userMessageId is inferred from message.replyTo', async () => {
    const spy = vi.spyOn(dkgService, 'persistChatTurn' as any)
      .mockResolvedValue({ tripleCount: 0, turnUri: '', kcId: '' } as any);
    try {
      const runtime = { getSetting: () => undefined, character: { name: 'x' } } as any;
      const msg = {
        content: { text: 'hi' },
        id: 'm', userId: 'u', roomId: 'r',
        // Runtime provides the parent id — this is exactly the case the
        // bot flagged: under the old inference, persistChatTurnImpl
        // would see `userMessageId` present and take the append-only
        // branch even though the user turn was never persisted.
        replyTo: 'parent-123',
      } as any;

      await (dkgPlugin as any).hooks.onAssistantReply(runtime, msg, {}, {});
      expect(spy).toHaveBeenCalledTimes(1);
      const opts = spy.mock.calls[0][3] as any;
      expect(opts.userMessageId).toBe('parent-123');
      expect(opts.userTurnPersisted).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('honours an explicit userTurnPersisted:true from the caller (well-known chain opt-in)', async () => {
    const spy = vi.spyOn(dkgService, 'persistChatTurn' as any)
      .mockResolvedValue({ tripleCount: 0, turnUri: '', kcId: '' } as any);
    try {
      const runtime = { getSetting: () => undefined, character: { name: 'x' } } as any;
      const msg = { content: { text: 'hi' }, id: 'm', userId: 'u', roomId: 'r', replyTo: 'p' } as any;

      await (dkgPlugin as any).hooks.onAssistantReply(
        runtime, msg, {}, { userTurnPersisted: true },
      );
      const opts = spy.mock.calls[0][3] as any;
      // Caller opt-in wins — they know their hook chain ordered
      // onChatTurn before onAssistantReply in-process.
      expect(opts.userTurnPersisted).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('honours an explicit userTurnPersisted:false from the caller', async () => {
    const spy = vi.spyOn(dkgService, 'persistChatTurn' as any)
      .mockResolvedValue({ tripleCount: 0, turnUri: '', kcId: '' } as any);
    try {
      const runtime = { getSetting: () => undefined, character: { name: 'x' } } as any;
      const msg = { content: { text: 'hi' }, id: 'm', userId: 'u', roomId: 'r', replyTo: 'p' } as any;

      await (dkgPlugin as any).hooks.onAssistantReply(
        runtime, msg, {}, { userTurnPersisted: false },
      );
      const opts = spy.mock.calls[0][3] as any;
      expect(opts.userTurnPersisted).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
