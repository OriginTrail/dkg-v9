# Unresolved PR Review Comments

Collected at merge time (2026-03-09) from the 21 PRs merged to `main`.
These are review comments that were posted after our fix round (or not addressed by it).

---

## 🔴 Bugs (High Priority)

### PR #58 — OpenClaw Chat Bridge
- [ ] **`packages/cli/src/daemon.ts`** — Reply-matching logic only keys on `direction`, `ts`, and `peer`; unrelated inbound messages from the same peer can be returned as the "reply." Needs a correlation/conversation ID.
- [ ] **`packages/node-ui/src/ui/pages/AgentHub.tsx`** — `send()` appends the async response to shared `messages` state even if the user switches `selectedAgent` mid-flight, so replies can land in the wrong chat.

### PR #57 — Notifications
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — Emits a `vote_cast` notification on every received `vote:cast` message, but votes are rebroadcast by heartbeat, creating duplicate unread notifications every few seconds.

### PR #56 — Leaderboard & TRAC Spending
- [ ] **`packages/origin-trail-game/src/engine/game-engine.ts`** — `forceResolveTurn` defaults to `syncMemory` when no votes are present; after TRAC drops below cost, automatic resolutions loop forever without advancing.
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — Leader-only guard drops leaderboard publishes when a non-leader force-resolves after deadline, so finished games are never recorded.

### PR #55 — Provenance Chain
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — Guard allows writing provenance when `ual` exists but `txHash` is empty, creating ambiguous/colliding provenance nodes with empty transaction hashes.

### PR #54 — Consensus Attestation
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — `this.topologyTimer` is used but no class field is declared; fails TypeScript strict mode.
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — `scheduleTopologySnapshots()` is never invoked, so periodic topology snapshots never actually run.

### PR #53 — Strategy Patterns
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — `publishStrategyPatterns` runs even when turn publish fails, producing derived strategy RDF without corresponding turn/attestation data.
- [ ] **`packages/origin-trail-game/src/dkg/rdf.ts`** — Provenance subject keyed only by `txHash`; when empty, all records collapse to `<rootEntity>/provenance/`, causing collisions and data loss.
- [ ] **`packages/origin-trail-game/src/dkg/rdf.ts`** — Changing predicate from `forTurnResult` to `forTurn` breaks the existing RDF contract; current readers/tests still query `forTurnResult`.
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — Successful publish paths no longer record workspace lineage; `writeLineageFromSnapshot(...)` is never called on success.

### PR #52 — Workspace Lineage
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — `workspaceOps` is only cleared when `isLeader`; followers' ops persist across turns and leak into later `forceResolveTurn` with incorrect attribution.
- [ ] **`packages/origin-trail-game/test/handler.test.ts`** — New `describe(...)` block starts before the surrounding test block is closed, making the test file syntactically invalid.

### PR #51 — Topology Snapshots
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — Topology snapshot interval fires async publish without an in-flight guard; overlapping `writeToWorkspace` calls can complete out of order and overwrite newer data.
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — `lastSeen`/`messageAgeMs` are computed only from `swarm.votes`, but votes are cleared after each turn; active peers immediately lose recent activity.
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — `messageAgeMs` falls back to `0` when a peer has no current-turn vote, falsely reporting stale peers as freshly active.

### PR #50 — Provenance Quads
- [ ] **`packages/origin-trail-game/src/dkg/rdf.ts`** — `if (provenance.blockNumber)` treats `0` as absent due to truthiness, silently dropping a valid block height. *(Also in PRs #55, #53.)*

### PR #49 — Gossip Handler Extraction
- [ ] **`packages/agent/src/gossip-publish-handler.ts`** — Treating every Rule 4-only validation failure as a replay is too broad; different triples for an existing `rootEntity` can still reach tentative metadata insert, creating inconsistent KC metadata.

### PR #48 — Gossip Publish Validation
- [ ] **`packages/agent/src/gossip-publish-handler.ts`** — Setting `normalized = []` for Rule-4 replays breaks downstream metadata; `computeKCRoot` becomes the zero root and tentative metadata is inserted with `kaCount=0`, corrupting existing KC data.

### PR #47 — Publish Crash Recovery
- [ ] **`packages/publisher/src/publish-handler.ts`** — Entries that expired while node was offline are skipped/removed from journal without cleaning tentative triples from storage; stale data remains permanently.
- [ ] **`packages/publisher/src/publish-handler.ts`** — `deleteBySubjectPrefix(metaGraph, ual)` can over-delete when one UAL is a prefix of another (e.g., `.../42` matching `.../420`).
- [ ] **`packages/publisher/src/publish-handler.ts`** — `status` from SPARQL bindings is in literal form (quoted); equality check fails for confirmed records, causing confirmed publishes to be treated as unconfirmed.
- [ ] **`packages/publisher/src/publish-handler.ts`** — If `isPublishConfirmed()` throws, catch exits without deleting tentative data, but the pending entry is already removed from memory/journal — data orphaned.

### PR #46 — Expedition Launch & Auto-Update
- [ ] **`packages/agent/src/dkg-agent.ts`** — `PublishHandler` does not expose `restorePendingPublishes()` or consume the `journal` option; call throws at runtime and journal-based recovery never works.
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — Broad `catch` converts a failed `writeToWorkspace` into a successful launch; workspace state can be stale/divergent after restart.

### PR #42 — Autoresearch Adapter
- [ ] **`packages/adapter-autoresearch/src/tools.ts`** — `val_bpb` is required even when `status` is `crash`, forcing callers to use sentinel values that pollute ranking/query results.
- [ ] **`packages/adapter-autoresearch/src/tools.ts`** — `autoresearch_best_results` ranks all experiments by `valBpb` without excluding non-success statuses; crash/discard records appear as top results.

### PR #41 — Workspace Ownership
- [ ] **`packages/publisher/src/dkg-publisher.ts`** — If reconstruction was skipped/failed, an existing root can be re-claimed by a different peer on first write (branch assumes `liveOwned` is authoritative).
- [ ] **`packages/agent/src/dkg-agent.ts`** — Ownership triples deleted unconditionally for each expired operation; if root is still referenced by a non-expired operation, active ownership is dropped.

### PR #39 — Game UI & Security
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — `rdf.ts` does not export `ChainProvenance` or accept provenance in `turnResolvedQuads`; path fails `tsc` build and second publish just republishes same quads.

### PR #37 — Agent Tab
- [ ] **`packages/node-ui/src/chat-memory.ts`** — SPARQL `OPTIONAL` block not joined to current message `?m`; unbound `?turnId` can join any turn in the session, creating duplicate rows and incorrect `persistStatus`.
- [ ] **`packages/node-ui/src/chat-memory.ts`** — If `opts.rootEntities` is supplied but all entries are invalid IRIs, `requestedRoots` becomes empty and silently falls back to `sessionRoots`, publishing entire session.

---

## 🟡 Issues (Medium Priority)

### PR #58
- [ ] **`packages/cli/src/daemon.ts`** — Undelivered response shape omits `waitMs`, but client type marks it as required; API contract mismatch at runtime.

### PR #57
- [ ] **`packages/origin-trail-game/src/api/handler.ts`** — `POST /notifications/read` with empty body throws 400; should parse empty payloads as `{}` for mark-all-read.
- [ ] **`packages/origin-trail-game/src/api/handler.ts`** — Validation checks `ids` is an array but not that each element is a string; mixed/invalid arrays accepted.
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — `player_left` notification pushed even when the player is already absent from `swarm.players`, creating phantom notifications.

### PR #55
- [ ] **`packages/origin-trail-game/src/dkg/rdf.ts`** — `if (provenance.blockNumber)` drops valid `0` values due to truthiness; use `!= null`. *(Cross-PR issue.)*

### PR #54
- [ ] **`packages/origin-trail-game/test/handler.test.ts`** — `destroy()` test is a no-op (no assertions); passes even if `destroy()` stops clearing timers.

### PR #53
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — `publishProvenanceChain` is defined twice in this class; shadowing is error-prone.

### PR #50
- [ ] **`packages/origin-trail-game/src/dkg/coordinator.ts`** — Provenance-write flow is duplicated across `checkProposalThreshold` and `forceResolveTurn`; extract a shared helper.

### PR #49
- [ ] **`packages/agent/src/gossip-publish-handler.ts`** — `Map<string, any>` drops type safety for `subscribedParanets`; use a concrete shared type. *(Also PR #48.)*
- [ ] **`packages/agent/test/gossip-publish-handler.test.ts`** — Missing regression test for "same rootEntity but different triples" in Rule 4 replay branch.

### PR #48
- [ ] **`packages/agent/test/gossip-publish-handler.test.ts`** — Replay test only checks `not.toThrow()`; needs assertions for KC metadata consistency.

### PR #47
- [ ] **`packages/publisher/src/publish-journal.ts`** — `load()` trusts arbitrary JSON shape via type assertion; non-array JSON breaks restore silently.
- [ ] **`packages/publisher/src/publish-handler.ts`** — No test coverage for restore/expiry behavior; needs regression tests for restore+confirm, restore+expiry, "expired while offline."

### PR #46
- [ ] **`packages/origin-trail-game/test/handler.test.ts`** — Only checks happy path for remote launch; needs assertions for rejected non-leader and duplicate launches.

### PR #44
- [ ] **`packages/cli/src/daemon.ts`** — Cleanliness precheck ignores untracked files, but `git merge --ff-only` can still fail when untracked path would be overwritten.
- [ ] **`packages/cli/test/auto-update.test.ts`** — Missing happy-path regression test for successful fetch + ff-merge + install/build flow.

### PR #42
- [ ] **`packages/mcp-server/src/index.ts`** — Adapter load failures only logged; startup continues, silently dropping requested tools.

### PR #41
- [ ] **`packages/publisher/src/dkg-publisher.ts`** — `reconstructWorkspaceOwnership()` swallows all errors and returns `0`; weakens Rule-4 enforcement silently after restart.

### PR #40
- [ ] **`packages/graph-viz/src/core/renderer.ts`** — Topology hash ignores `collapsedNodeIds`; collapsing/expanding nodes won't reset `_initialFitDone` and `zoomToFit` can be skipped.

### PR #39
- [ ] **`packages/node-ui/src/ui/pages/Apps.tsx`** — `<iframe onError>` fallback is unreliable; HTTP error pages fire `onLoad` not `onError`, so fallback may never trigger.

---

**Total: 33 bugs + 20 issues = 53 unresolved items**
