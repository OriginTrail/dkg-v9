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
import { _dkgServiceLoose, dkgService, dkgServiceLegacy } from '../src/service.js';
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

  // PR #229 bot review (r30-8 → r31-2 → r31-3 — service.ts:133/180).
  //
  // History:
  //   - Pre-r30-8: `DKGService` carried a public `Record<string,
  //     unknown>` catch-all overload "for backwards compat". The
  //     catch-all silently accepted `{ mode: 'assistant-reply' }`
  //     literals missing the mandatory `userMessageId` /
  //     `userTurnPersisted` fields, defeating the typed overloads
  //     (r18-2 + r19-2). The runtime guard in `persistChatTurnImpl`
  //     still threw, but only AFTER the type check let the bad call
  //     through.
  //   - r30-8: the catch-all was REMOVED from the public surface and
  //     moved to the internal `DKGServiceLoose` handle (which the
  //     plugin uses for genuine framework-shaped routing). Source-
  //     breaking change for downstream TS consumers building options
  //     bags dynamically.
  //   - r31-2: the catch-all was RESTORED on the public surface as
  //     a `@deprecated` THIRD overload (sitting AFTER the strict
  //     overloads in declaration order, so the assumption was that
  //     well-typed callers would still bind to the strict contracts
  //     and only opaque dynamic-bag callers would fall through).
  //   - r31-3: the bot called THAT out as still reopening the
  //     smuggling hole. TypeScript's overload resolution algorithm
  //     reports an error only when NO declared signature matches —
  //     a `{ mode: 'assistant-reply' }` literal that fails the
  //     strict reply overload (missing `userMessageId` /
  //     `userTurnPersisted`) STILL satisfies the `Record<string,
  //     unknown>` catch-all on the same interface, so the call
  //     compiles. Declaration order doesn't fix that — TypeScript
  //     doesn't pick "the closest match"; it picks "any match",
  //     and a wide catch-all matches everything.
  //
  // Final shape (r31-3): `DKGService` carries ONLY the two typed
  // overloads. The compile-time tolerance for dynamic-bag callers
  // moves to a SEPARATELY NAMED `dkgServiceLegacy` export (also
  // `@deprecated`, also routes to the same runtime impl). Callers
  // who legitimately can't narrow at the call site explicitly
  // import `dkgServiceLegacy` instead of `dkgService` — that
  // import-site choice is the new opt-out signal, replacing the
  // implicit "smuggle through the catch-all" path.
  describe('r31-3: deprecated catch-all relocated from `DKGService` to `dkgServiceLegacy`', () => {
    it('`dkgService.persistChatTurn` REJECTS `{ mode: "assistant-reply" }` without `userMessageId` at COMPILE TIME (smuggling hole closed)', () => {
      // The crucial r31-3 property: the public `dkgService` surface
      // does NOT compile the smuggling shape. If TS stops flagging
      // this, the catch-all has been re-added to `DKGService` (or
      // one of the typed overloads has been weakened) and the
      // r30-8/r31-3 hole is back open.
      const runtime = makeRuntime();
      const assistantMsg: Memory = makePlainMemoryWithoutId();
      const malformed: Record<string, unknown> = { mode: 'assistant-reply' };
      // @ts-expect-error r31-3: `dkgService.persistChatTurn`
      // overload 2 requires `userMessageId` + `userTurnPersisted`;
      // overload 1 requires `PersistableMemory`. Neither matches
      // a `Record<string, unknown>` options bag, so the call is
      // rejected. There is intentionally NO catch-all overload.
      const pending = dkgService.persistChatTurn(runtime, assistantMsg, undefined, malformed);
      void (pending as Promise<unknown>).catch(() => {});
      expect(typeof (pending as Promise<unknown>)).toBe('object');
    });

    it('`dkgServiceLegacy.persistChatTurn` ACCEPTS the same `Record<string, unknown>` options bag (compile-time tolerance preserved on the deprecated handle)', async () => {
      const runtime = makeRuntime();
      const assistantMsg: Memory = makePlainMemoryWithoutId();
      // Identical payload to the previous test — moved through the
      // deprecated handle. TypeScript editor tooling (TSServer / VS
      // Code / WebStorm) surfaces the @deprecated annotation on
      // `dkgServiceLegacy` as a strikethrough at the import site,
      // which is the intended migration UX. The runtime path is
      // identical to `dkgService` — same `persistChatTurnImpl`,
      // same defence-in-depth runtime guard.
      const legacyOpts: Record<string, unknown> = {
        mode: 'assistant-reply',
        userMessageId: 'msg-r31-3-user-parent',
        userTurnPersisted: false,
      };
      // No @ts-expect-error — this MUST compile via the legacy handle.
      await expect(
        dkgServiceLegacy.persistChatTurn(runtime, assistantMsg, undefined, legacyOpts),
      ).rejects.toThrow(/DKG node not started/);
    });

    it('`dkgServiceLegacy` and `_dkgServiceLoose` reference the SAME runtime impl as `dkgService` (zero behavioural drift across handles)', () => {
      // All three handles publish the same underlying object so the
      // runtime guard in `persistChatTurnImpl` is the single source
      // of truth regardless of which handle the caller picked.
      // Pinning the identity here means a future refactor that
      // accidentally creates parallel impls (e.g. wrapping
      // `dkgServiceLegacy` in a proxy that strips `as any`) will
      // fail this assertion before users discover behavioural drift.
      expect(dkgServiceLegacy).toBe(_dkgServiceLoose);
      expect((dkgServiceLegacy as { persistChatTurn: unknown }).persistChatTurn)
        .toBe((dkgService as { persistChatTurn: unknown }).persistChatTurn);
      expect((dkgServiceLegacy as { onChatTurn: unknown }).onChatTurn)
        .toBe((dkgService as { onChatTurn: unknown }).onChatTurn);
    });

    it('the runtime guard in `persistChatTurnImpl` is still the single source of truth for malformed payloads routed via `dkgServiceLegacy`', async () => {
      // The whole point of declaring `dkgServiceLegacy` `@deprecated`
      // (rather than dropping all guards) is that the runtime
      // protection from r18-2 / r19-2 / r30-8 still fires — a
      // caller who smuggles `{ mode: 'assistant-reply' }` without
      // the mandatory fields gets a loud throw at runtime even
      // though the compiler accepts the call. We can't directly
      // exercise the missing-userMessageId rejection path here
      // because the agent isn't started (the "DKG node not
      // started" check fires first), but we CAN pin that the
      // legacy handle routes to the same impl path as the strict
      // overloads — anything that breaks that wiring would be
      // visible as a different error message.
      const runtime = makeRuntime();
      const msg: Memory = makePlainMemoryWithoutId();
      const malformed: Record<string, unknown> = { mode: 'assistant-reply' };
      await expect(
        dkgServiceLegacy.persistChatTurn(runtime, msg, undefined, malformed),
      ).rejects.toThrow(/DKG node not started/);
    });

    it('the deprecated catch-all does NOT relax DIRECT assignments to typed option interfaces (literal shape check still fires)', () => {
      // r31-3 only restores tolerance at the function-call overload
      // resolution level for the SEPARATELY NAMED `dkgServiceLegacy`
      // handle. If the caller writes the literal AS the typed
      // interface, the strict structural check still fires
      // (TypeScript validates the assignment against the declared
      // type, not against any service overload). This matters
      // because well-behaved callers SHOULD type their options
      // bag explicitly when they can — and they get the typed
      // contract back automatically.
      // @ts-expect-error r31-3: literal `{ mode: 'assistant-reply' }`
      // assigned to `AssistantReplyChatTurnOptions` still fails the
      // structural check (`userMessageId` and `userTurnPersisted`
      // are mandatory). The legacy handle does NOT widen
      // `AssistantReplyChatTurnOptions` itself — it just exposes a
      // wider call signature.
      const badAssistantReplyOpts: AssistantReplyChatTurnOptions = { mode: 'assistant-reply' };
      expect(badAssistantReplyOpts).toBeDefined();
    });

    it('the internal `_dkgServiceLoose` handle still accepts the wide `Record<string, unknown>` shape (unchanged from r30-8)', async () => {
      // The internal escape hatch is unchanged: the plugin in
      // `src/index.ts` legitimately routes framework-shaped options
      // through here, and `dkgServiceLegacy` now offers downstream
      // consumers the same compile-time tolerance with an explicit
      // import-site opt-out signal.
      const runtime = makeRuntime();
      const msg: Memory = makePlainMemoryWithoutId();
      const looseOpts: Record<string, unknown> = {
        mode: 'assistant-reply',
        userMessageId: 'msg-r30-8-user-parent',
        userTurnPersisted: false,
      };
      await expect(
        _dkgServiceLoose.persistChatTurn(runtime, msg, undefined, looseOpts),
      ).rejects.toThrow(/DKG node not started/);
      const loose: DKGServiceLoose = _dkgServiceLoose;
      expect(typeof loose.persistChatTurn).toBe('function');
      expect(typeof loose.onChatTurn).toBe('function');
    });

    it('well-typed callers on `dkgService` still bind to the strict typed overloads (no behavioural drift from r18-2 / r19-2)', () => {
      // Sanity that the strict overloads on `dkgService` still
      // resolve correctly for well-typed callers. A `UserTurnChatTurnOptions`
      // literal MUST compile and route through the persister;
      // anything else would mean a typed overload regressed.
      const runtime = makeRuntime();
      const userMsg = makePersistableMemory();
      const strictOpts: UserTurnChatTurnOptions = {
        mode: 'user-turn',
        contextGraphId: 'agent-context',
      };
      // No @ts-expect-error — this MUST compile cleanly via the
      // user-turn overload. Runtime throws "DKG node not started"
      // because the service isn't initialised; we swallow that so
      // vitest doesn't surface it as an unhandled rejection.
      const pending = dkgService.persistChatTurn(runtime, userMsg, undefined, strictOpts);
      void (pending as Promise<unknown>).catch(() => {});
      expect(typeof (pending as Promise<unknown>)).toBe('object');
    });

    it('the user-turn-shaped legacy options bag still routes correctly when narrowed (preferred path for new code)', async () => {
      // The strict typed overloads remain the recommended call
      // pattern for new code — narrow at the call site to get the
      // compile-time field-level enforcement.
      const runtime = makeRuntime();
      const userMsg = makePersistableMemory();
      const dynamicOpts: Record<string, unknown> = {
        mode: 'user-turn',
        contextGraphId: 'agent-context',
      };
      const narrowed = dynamicOpts as UserTurnChatTurnOptions;
      await expect(
        dkgService.persistChatTurn(runtime, userMsg, undefined, narrowed),
      ).rejects.toThrow(/DKG node not started/);
    });
  });
});
