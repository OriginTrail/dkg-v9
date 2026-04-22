import { describe, it, expect } from 'vitest';
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
