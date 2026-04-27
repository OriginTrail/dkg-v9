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
import { _dkgServiceLoose, dkgService } from '../src/service.js';
import type {
  AssistantReplyChatTurnOptions,
  ChatTurnPersistResult,
  DKGService,
  DKGServiceLoose,
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

  // PR #229 bot review (r30-8 — service.ts:128).
  //
  // Pre-r30-8 the public `DKGService` interface carried a third
  // catch-all overload `options?: Record<string, unknown>` "for
  // backwards compat with the plugin wiring". That catch-all
  // silently accepted `{ mode: 'assistant-reply' }` literals — i.e.
  // a caller could write `dkgService.persistChatTurn(runtime, msg,
  // undefined, { mode: 'assistant-reply' })` and the compiler would
  // route it onto the catch-all path even though the strict typed
  // overload (Overload 2) rejected it for missing `userMessageId` /
  // `userTurnPersisted`. The runtime guard in `persistChatTurnImpl`
  // would still throw, but only AFTER the type check had let the
  // bad call through — defeating the entire point of the typed
  // overloads r18-2 and r19-2 introduced.
  //
  // r30-8 fix: the catch-all is REMOVED from the public `DKGService`
  // surface (it now lives on the internal-only `DKGServiceLoose`
  // handle that the adapter plugin in `src/index.ts` consumes). The
  // public surface exposes ONLY the strict typed overloads, so the
  // smuggling pattern above no longer compiles. These tests pin
  // both halves: the public-surface rejection AND the internal
  // escape hatch's continued functionality.
  describe('r30-8: public catch-all overload removed', () => {
    it('public `DKGService` REJECTS `{ mode: "assistant-reply" }` smuggled via Record<string, unknown>', () => {
      const runtime = makeRuntime();
      // Plain `Memory` (no stable id) is the realistic shape for an
      // assistant-reply caller — the assistant-side message often has
      // no `id` until the runtime stamps one. Pre-r30-8 the caller
      // could mask the missing id requirement by routing onto the
      // catch-all overload. Post-r30-8 the call must fail to compile.
      const assistantMsg: Memory = makePlainMemoryWithoutId();

      // This is the smuggling pattern that pre-r30-8 compiled cleanly:
      // the caller declares `legacyOpts` as `Record<string, unknown>`
      // and TypeScript routes it onto the catch-all overload, bypassing
      // the strict assistant-reply overload's `userMessageId` /
      // `userTurnPersisted` requirement.
      const legacyOpts: Record<string, unknown> = {
        mode: 'assistant-reply',
        // Deliberately missing userMessageId AND userTurnPersisted —
        // the bug the typed overloads were meant to catch at compile
        // time. The runtime guard in `persistChatTurnImpl` still
        // catches this, but the point of the typed overloads is to
        // catch it FIRST, in the editor.
      };

      // @ts-expect-error r30-8: post-fix, no overload of the public
      // `DKGService.persistChatTurn` accepts a plain `Memory` AND a
      // generic `Record<string, unknown>` options bag. Overload 1
      // (user-turn) rejects `Memory` (id is `string | undefined`,
      // not `string`); Overload 2 (assistant-reply) rejects
      // `Record<string, unknown>` because `mode: unknown` cannot
      // satisfy the literal `mode: 'assistant-reply'` and the
      // mandatory `userMessageId` / `userTurnPersisted` fields are
      // missing. With the catch-all gone, both overloads fail and
      // the call fails to compile. If TS stops flagging this line,
      // the catch-all has crept back onto the public surface and
      // the smuggling regression is back.
      const smuggled = dkgService.persistChatTurn(runtime, assistantMsg, undefined, legacyOpts);
      // Swallow the rejection so vitest doesn't report it as an
      // "unhandled error" — the runtime behaviour isn't what we're
      // testing here, the COMPILE-TIME rejection above is.
      void (smuggled as Promise<unknown>).catch(() => {});
      expect(typeof (smuggled as Promise<unknown>)).toBe('object');
    });

    it('public `DKGService` REJECTS the literal `{ mode: "assistant-reply" }` even without the Record<> cast', () => {
      // The exact bot-flagged smuggling shape: a literal object that
      // claims `mode: 'assistant-reply'` but omits the rest of the
      // contract. Pre-r30-8 this compiled because the catch-all
      // accepted it; post-r30-8 only the strict overload matches
      // (and rejects).
      // @ts-expect-error r30-8: literal `{ mode: 'assistant-reply' }`
      // no longer compiles against any public `DKGService` overload.
      // The strict assistant-reply overload requires `userMessageId`
      // AND `userTurnPersisted`; nothing else can absorb this shape.
      const badAssistantReplyOpts: AssistantReplyChatTurnOptions = { mode: 'assistant-reply' };
      expect(badAssistantReplyOpts).toBeDefined();
    });

    it('the internal `_dkgServiceLoose` handle DOES still accept the wide `Record<string, unknown>` shape', async () => {
      // The catch-all has to exist SOMEWHERE at runtime, because the
      // adapter plugin in `src/index.ts` legitimately wires up
      // generic `(runtime, message, state, options) => …` hook
      // handlers whose `options` shape is determined by the
      // ElizaOS framework, not by the adapter. The compromise is:
      // the wide signature is preserved on the internal-only
      // `DKGServiceLoose` interface, and external code that imports
      // `_dkgServiceLoose` voids the typed contract on purpose.
      const runtime = makeRuntime();
      const msg: Memory = makePlainMemoryWithoutId();
      const looseOpts: Record<string, unknown> = {
        mode: 'assistant-reply',
        userMessageId: 'msg-r30-8-user-parent',
        userTurnPersisted: false,
      };

      // The escape-hatch path: still compiles, still routes through
      // `persistChatTurnImpl`, and the runtime guards there are now
      // the single source of truth for malformed payloads.
      await expect(
        _dkgServiceLoose.persistChatTurn(runtime, msg, undefined, looseOpts),
      ).rejects.toThrow(/DKG node not started/);

      // Also lock the type-level shape: `DKGServiceLoose` retains
      // the wide options bag.
      const loose: DKGServiceLoose = _dkgServiceLoose;
      expect(typeof loose.persistChatTurn).toBe('function');
      expect(typeof loose.onChatTurn).toBe('function');
    });

    it('`DKGService` is NOT structurally assignable from `DKGServiceLoose`', () => {
      // The whole point of removing the catch-all was that
      // `DKGServiceLoose` (with the wide options bag) is no longer
      // assignable to `DKGService` — the strict overloads must reject
      // any caller that passes `Record<string, unknown>`. If a future
      // refactor re-adds the catch-all, this assignment will start
      // compiling and the test will silently turn into a positive
      // control rather than the negative one it's pinned as.
      const loose: DKGServiceLoose = _dkgServiceLoose;
      // @ts-expect-error r30-8: DKGServiceLoose is intentionally NOT
      // assignable to DKGService. The narrow public interface rejects
      // the wide `Record<string, unknown>` options bag.
      const narrow: DKGService = loose;
      expect(narrow).toBeDefined();
    });

    it('the user-turn-shaped legacy options bag still routes correctly when narrowed', async () => {
      // r30-8 isn't a "no legacy options ever" change — callers can
      // still pass dynamically-shaped options as long as they NARROW
      // them to the typed overloads first. This test pins that the
      // safe pattern (cast/narrow before the call) still works
      // end-to-end.
      const runtime = makeRuntime();
      const userMsg = makePersistableMemory();
      const dynamicOpts: Record<string, unknown> = {
        mode: 'user-turn',
        contextGraphId: 'agent-context',
      };
      // The caller's responsibility post-r30-8 — narrow before the
      // call site, not after.
      const narrowed = dynamicOpts as UserTurnChatTurnOptions;
      await expect(
        dkgService.persistChatTurn(runtime, userMsg, undefined, narrowed),
      ).rejects.toThrow(/DKG node not started/);
    });
  });
});
