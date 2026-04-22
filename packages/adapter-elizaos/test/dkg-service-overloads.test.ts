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

    // Positive control: well-typed user-turn call compiles and
    // routes through to the persister (which then rejects because
    // no agent is wired up — expected).
    await expect(
      dkgService.persistChatTurn(runtime, userMsg, {} as State, userOpts),
    ).rejects.toThrow(/DKG node not started/);

    // r18-2 negative control: a plain `Memory` WITHOUT a stable
    // `id` must NOT be assignable to `PersistableMemory`. This is
    // the one-line type assertion — the directive is on the line
    // immediately above the offending assignment, which is how
    // `@ts-expect-error` is scoped.
    const plainMemory: Memory = makePlainMemoryWithoutId();
    // @ts-expect-error r18-2: plain `Memory` cannot be assigned to
    // `PersistableMemory` because `id` is optional on the former
    // and required on the latter. If TS stops flagging this, the
    // type narrowing has regressed.
    const shouldFail: PersistableMemory = plainMemory;
    expect(shouldFail).toBeDefined();
  });

  it('the assistant-reply overload requires options.userMessageId at COMPILE TIME', async () => {
    const runtime = makeRuntime();
    const assistantMsg = makePlainMemoryWithoutId();
    // r19-2: `userTurnPersisted` is now mandatory on the typed
    // assistant-reply overload. Explicit `false` is the safe default
    // a caller should pick when it genuinely doesn't know whether
    // the user-turn hook succeeded — it routes the persister
    // through the full-envelope branch which produces a readable
    // reply regardless.
    const replyOpts: AssistantReplyChatTurnOptions = {
      mode: 'assistant-reply',
      userMessageId: 'msg-r18-2-user-parent',
      userTurnPersisted: false,
    };

    // Happy path: mode + userMessageId + userTurnPersisted all
    // present. Compiles, rejects at runtime because no agent is
    // wired up — expected.
    await expect(
      dkgService.persistChatTurn(runtime, assistantMsg, {} as State, replyOpts),
    ).rejects.toThrow(/DKG node not started/);

    // @ts-expect-error r18-2: mode='assistant-reply' WITHOUT
    // userMessageId (and userTurnPersisted) is rejected because the
    // persister cannot reconstruct the parent turn key without it.
    const missingUserMsgId: AssistantReplyChatTurnOptions = { mode: 'assistant-reply' };
    // Reference the value so TS doesn't elide the check.
    expect(missingUserMsgId).toBeDefined();
  });

  it('r19-2: the assistant-reply overload ALSO requires options.userTurnPersisted at COMPILE TIME', () => {
    // PR #229 bot review round 19 (r19-2). Pre-r19-2 the typed
    // assistant-reply overload made `userMessageId` mandatory but
    // left `userTurnPersisted` optional. That reintroduced the
    // unreadable-reply footgun r13-1 closed: if a caller knew the
    // parent id but didn't know whether the user-turn hook
    // actually persisted, `persistChatTurnImpl` would infer
    // `userTurnPersisted=true` from the presence of `userMessageId`
    // alone (the legacyInference branch) and take the cheap
    // append-only path — which produces an orphan
    // `hasAssistantMessage` edge on a turn URI whose type quads
    // were never written, so the reader silently drops the reply.
    //
    // @ts-expect-error r19-2: the typed overload MUST reject this
    // call. If TS stops flagging it, the overload has regressed
    // and the append-only bug is back.
    const missingUserTurnPersisted: AssistantReplyChatTurnOptions = {
      mode: 'assistant-reply',
      userMessageId: 'msg-r19-2-user-parent',
    };
    expect(missingUserTurnPersisted).toBeDefined();

    // Positive control: explicit `false` compiles cleanly and
    // signals the safe full-envelope path.
    const safeDefault: AssistantReplyChatTurnOptions = {
      mode: 'assistant-reply',
      userMessageId: 'msg-r19-2-user-parent',
      userTurnPersisted: false,
    };
    expect(safeDefault.userTurnPersisted).toBe(false);

    // Positive control: explicit `true` also compiles (the in-process
    // ElizaOS hook chain that round 16 introduced knows the user
    // turn just persisted and opts into the cheap append path).
    const inProcessOptimised: AssistantReplyChatTurnOptions = {
      mode: 'assistant-reply',
      userMessageId: 'msg-r19-2-user-parent',
      userTurnPersisted: true,
    };
    expect(inProcessOptimised.userTurnPersisted).toBe(true);
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

    // r18-2 negative control: the `onChatTurn` hook alias must
    // share the narrowed user-turn contract. Asserting the alias
    // signature is `typeof dkgService.persistChatTurn` locks the
    // two in lockstep so a future refactor that loosens one can't
    // silently leave the other with stricter types (or vice versa).
    const persistChatTurn: typeof dkgService.persistChatTurn = dkgService.onChatTurn;
    expect(typeof persistChatTurn).toBe('function');
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
