# PR #38 Follow-up TODOs

Remaining Codex Review feedback from PR #38 — addressed in follow-up branch.

## 1. daemon.ts — Remove unauthenticated token injection for `/apps/*`  ✅

**File:** `packages/cli/src/daemon.ts`

Removed the loopback fallback that auto-injected a bearer token into `/apps/*`
HTML for any local request. Now only injects the token when the request already
carries a verified `Authorization: Bearer <token>` header.

## 2. Apps.tsx — Prevent token re-handshake after iframe navigation  ✅

**File:** `packages/node-ui/src/ui/pages/Apps.tsx`

Added a `handshakeCompleteRef` flag. After the first successful token delivery,
the `onLoad` handler refuses to issue new nonces, preventing navigated-away
iframes from obtaining fresh tokens.

## 3. coordinator.ts — Verify force-resolved ordering is correct  ✅

**File:** `packages/origin-trail-game/src/dkg/coordinator.ts`

Already fixed in PR #38: the leader-only `force-resolved` fast-path executes
before local tally validation, preventing follower state divergence. Test
`leader force-resolved proposal bypasses tally validation` confirms.
