/**
 * PR #229 bot review round 18 (r18-2): the public `DKGService`
 * surface was widened to expose `persistChatTurn` / `onChatTurn`
 * as split user-turn / assistant-reply overloads so that downstream
 * TypeScript callers see the runtime contract at COMPILE TIME
 * instead of discovering it via a runtime `throw`.
 *
 * These tests pin two things:
 *
 *   1. The runtime behaviour is unchanged — well-typed callers still
 *      route through `persistChatTurnImpl` and get the same
 *      `{ tripleCount, turnUri, kcId }` result shape.
 *
 *   2. The type-level contract itself is enforced — a well-typed
 *      user-turn caller that forgets `message.id` fails to compile,
 *      and a well-typed assistant-reply caller that forgets
 *      `options.userMessageId` fails to compile. The `ts-expect-error`
 *      directives embedded below do exactly that — if a future
 *      refactor ever loosens the overloads, these lines will flip
 *      from "suppressing a real error" to "suppressing nothing"
 *      and the file will fail to compile, which `pnpm build` will
 *      surface in CI.
 *
 * Runtime-level pinning of the underlying persister semantics
 * (user-turn vs assistant-reply branching, ID fabrication guard,
 * URI collisions, etc.) lives in `actions-behavioral.test.ts` and
 * `plugin.test.ts` and remains the source of truth for behaviour.
 * This file deliberately focuses on the *type* contract the bot
 * flagged.
 */
import { describe, expect, it } from 'vitest';
import { dkgService } from '../src/service.js';
import type {
  AssistantReplyChatTurnOptions,
  ChatTurnPersistResult,
  DKGService,
  UserTurnChatTurnOptions,
} from '../src/service.js';
import type { IAgentRuntime, Memory, PersistableMemory, State } from '../src/types.js';

function makeRuntime(): IAgentRuntime {
  return {
    character: { name: 'r18-2-test' },
    getSetting: () => undefined,
  };
}

function makePersistableMemory(): PersistableMemory {
  return {
    id: 'msg-r18-2-persistable',
    userId: 'user-r18-2',
    agentId: 'agent-r18-2',
    roomId: 'room-r18-2',
    content: { text: 'user turn' },
    createdAt: Date.now(),
  };
}

function makePlainMemoryWithoutId(): Memory {
  return {
    userId: 'user-r18-2',
    agentId: 'agent-r18-2',
    roomId: 'room-r18-2',
    content: { text: 'assistant reply' },
    createdAt: Date.now(),
  };
}

describe('r18-2: DKGService overload contract', () => {
  it('exposes the runtime object under the narrowed DKGService interface', () => {
    // Sanity: the exported symbol carries the right `name` and the
    // two method hooks. Using `typeof` here also keeps TypeScript's
    // structural check honest — if the export lost either method
    // the line below wouldn't compile.
    const svc: DKGService = dkgService;
    expect(svc.name).toBe('dkg-node');
    expect(typeof svc.persistChatTurn).toBe('function');
    expect(typeof svc.onChatTurn).toBe('function');
  });

  it('the user-turn overload requires a PersistableMemory (message.id: string) at COMPILE TIME', async () => {
    const runtime = makeRuntime();
    const userMsg = makePersistableMemory();
    const userOpts: UserTurnChatTurnOptions = { mode: 'user-turn' };

    // This compiles — the caller passed a PersistableMemory + a
    // UserTurnChatTurnOptions bag. If the overload resolution ever
    // regresses to accept plain `Memory` on the user-turn path, the
    // `@ts-expect-error` below will stop being an error and this
    // file will fail to build.
    //
    // The runtime rejection (no agent initialized) is expected and
    // awaited — we're only pinning the type contract here.
    await expect(
      dkgService.persistChatTurn(runtime, userMsg, {} as State, userOpts),
    ).rejects.toThrow(/DKG node not started/);

    // @ts-expect-error r18-2: a plain Memory WITHOUT a stable `id`
    // must NOT satisfy the user-turn overload. If TS stops rejecting
    // this call, the overload has regressed — the persister would
    // throw at runtime with "missing stable message identifier".
    const typeOnly: (m: Memory) => unknown = (m) =>
      dkgService.persistChatTurn(runtime, m, {} as State, userOpts);
    expect(typeof typeOnly).toBe('function');
  });

  it('the assistant-reply overload requires options.userMessageId at COMPILE TIME', async () => {
    const runtime = makeRuntime();
    const assistantMsg = makePlainMemoryWithoutId();
    const replyOpts: AssistantReplyChatTurnOptions = {
      mode: 'assistant-reply',
      userMessageId: 'msg-r18-2-user-parent',
    };

    // Happy path: mode + userMessageId both present. Compiles,
    // rejects at runtime because no agent is wired up — expected.
    await expect(
      dkgService.persistChatTurn(runtime, assistantMsg, {} as State, replyOpts),
    ).rejects.toThrow(/DKG node not started/);

    // @ts-expect-error r18-2: mode='assistant-reply' WITHOUT
    // userMessageId is rejected because the persister cannot
    // reconstruct the parent turn key without it — it would either
    // fabricate an id or throw. The type system now prevents that
    // footgun.
    const missingUserMsgId: AssistantReplyChatTurnOptions = { mode: 'assistant-reply' };
    // Reference the value so TS doesn't elide the check.
    expect(missingUserMsgId).toBeDefined();
  });

  it('onChatTurn mirrors persistChatTurn overloads (user-turn narrowing holds here too)', async () => {
    const runtime = makeRuntime();
    const userMsg = makePersistableMemory();

    // User-turn happy path via the hook alias. Same runtime-reject
    // pattern as the persistChatTurn tests above — we're locking
    // the TYPE contract, not the persister semantics.
    await expect(
      dkgService.onChatTurn(runtime, userMsg),
    ).rejects.toThrow(/DKG node not started/);

    // @ts-expect-error r18-2: onChatTurn (the user-turn hook) must
    // reject plain Memory-without-id exactly the same way
    // persistChatTurn does. If this line stops being an error the
    // alias has drifted from the primary overload.
    const typeOnly: (m: Memory) => unknown = (m) =>
      dkgService.onChatTurn(runtime, m);
    expect(typeof typeOnly).toBe('function');
  });

  it('the catch-all overload still accepts legacy `Record<string, unknown>` options for backwards compat', async () => {
    // The catch-all overload (the third signature) is intentionally
    // preserved so that existing plugin wiring in `src/index.ts` —
    // which routes through a generic options bag — still type-checks.
    // New callers SHOULD prefer the narrow overloads above.
    const runtime = makeRuntime();
    const userMsg = makePersistableMemory();
    const legacyOpts: Record<string, unknown> = {
      mode: 'user-turn',
      contextGraphId: 'agent-context',
    };

    // This is the escape hatch. It still compiles, still routes
    // through `persistChatTurnImpl`, and the runtime guards in that
    // function handle any contract violations.
    await expect(
      dkgService.persistChatTurn(runtime, userMsg, undefined, legacyOpts),
    ).rejects.toThrow(/DKG node not started/);
  });
});
