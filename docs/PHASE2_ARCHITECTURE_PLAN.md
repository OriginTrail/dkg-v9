## Phase 2 — Architecture refactor PR plan

This document scopes the refactoring work that came out of the v10‑rc cleanup pass. Phase 0 (dead code / unused deps) shipped as PR #238. Phase 1 (security/correctness fixes) shipped as PRs #239, #241, #242, #243. Phase 2 is everything that needs more design discussion and *should not* land overnight.

The headline observations:

| File | LOC | Concern |
|---|---|---|
| `packages/cli/src/daemon.ts` | 10,303 | Single-file HTTP daemon with 60+ routes, journaling, MCP install, agent registration, publisher queue, sync, file uploads, and start-up wiring all interleaved |
| `packages/agent/src/dkg-agent.ts` | 7,259 | A "god class" wrapping publisher + sync + discovery + chain + WM/SWM + chat + skills + endorse/verify + curator gates — ~170 methods |
| `packages/cli/src/cli.ts` | 2,983 | Mixed CLI command dispatch + interactive REPL + setup wizards |
| `packages/origin-trail-game/src/dkg/coordinator.ts` | 2,584 | Out of scope (game) |
| `packages/publisher/src/dkg-publisher.ts` | 2,250 | Two publish paths (V10/V9) and two update paths inlined into one class — see also P‑1.2 follow‑up |
| `packages/chain/src/evm-adapter.ts` | 2,060 | Acceptable for now (one adapter per chain, lots of typed view-call helpers) |
| `packages/adapter-openclaw/src/DkgChannelPlugin.ts` | 1,824 | Out of scope (adapter, not core) |

This plan covers the two highest‑leverage targets: `daemon.ts` and `dkg-agent.ts`. Other files are flagged as follow‑ups but not designed in detail here.

---

### 1. `packages/cli/src/daemon.ts` (10.3k LOC) — split into a routed daemon

#### Today

`daemon.ts` is one 10k‑line file that:

- Bootstraps process state (env, config, agent, publisher, memory manager, journal).
- Runs an HTTP server with 60+ routes (`/api/status`, `/api/agents`, `/api/publisher/...`, `/api/context-graph/...`, `/api/assertion/...`, `/api/query`, `/api/openclaw-channel/...`, `/api/file/...`, `/api/genui/render`, etc.).
- Owns operations journaling, catch‑up tracker, MCP install/version logic, manifest resolution, MarkItDown lifecycle, semver parsing, peer connect, and a long tail of helpers.
- Reads request bodies, parses query strings, JSON‑responds, and writes the operations journal — all inline.

#### Split target (one PR per group, mergeable independently)

Each split is a "lift, don't rewrite" — extract a module that takes `{ agent, publisher, journal, log, config }` and exposes a `register(router)` function. Behaviour stays the same; only the file boundary moves.

```
packages/cli/src/
├── daemon.ts                        ~600 LOC — bootstrap + listen + auth
├── daemon/
│   ├── http/
│   │   ├── router.ts                # tiny pattern matcher (req.method, path) → handler
│   │   ├── auth.ts                  # extractBearerToken, resolveAgentAddress
│   │   ├── responses.ts             # jsonResponse, errorResponse, sse helpers
│   │   └── readBody.ts
│   ├── routes/
│   │   ├── status.ts                # /api/status, /api/info, /api/connections, /api/peer-info
│   │   ├── agents.ts                # /api/agent/register, /api/agents, /api/agent/identity
│   │   ├── skills.ts                # /api/skills, /api/invoke-skill
│   │   ├── chat.ts                  # /api/chat, /api/messages, /api/chat-openclaw
│   │   ├── openclaw-channel.ts      # /api/openclaw-channel/*  (~600 LOC today)
│   │   ├── publisher.ts             # /api/publisher/*  (~400 LOC today)
│   │   ├── context-graph.ts         # /api/context-graph/*  + /api/sub-graph/*
│   │   ├── assertion.ts             # /api/assertion/*
│   │   ├── query.ts                 # /api/query
│   │   ├── connect.ts               # /api/connect, /api/update
│   │   ├── files.ts                 # /api/file/*
│   │   ├── genui.ts                 # /api/genui/render
│   │   ├── events.ts                # /api/events  (SSE)
│   │   └── well-known.ts            # /.well-known/skill.md
│   ├── manifest/                    # buildManifestInstallContext + helpers
│   ├── markitdown/                  # carryForwardBundledMarkItDownBinary etc.
│   ├── mcp-version.ts               # parseSemver, versionSatisfiesRange, readMcpDkgVersion
│   ├── catchup.ts                   # CatchupTracker + job state
│   └── journal/                     # operations journal (already partially separated)
```

Acceptance criteria per route module:

- Same wire format and status codes (snapshot the full `daemon.ts` behaviour with a CDC test before splitting; the existing playwright + node-ui tests should keep passing).
- Auth resolution (`requestAgentAddress`) is performed by `http/auth.ts`, not the route module.
- Phase events (`tracker.start/startPhase/completePhase/complete`) stay at the route boundary so the journal contract doesn't change.

Recommended PR ordering (smallest → largest, each is independently mergeable):

1. Extract `http/router.ts`, `http/auth.ts`, `http/responses.ts`, `http/readBody.ts` only. `daemon.ts` keeps the giant `if (req.method === ... && path === ...)` chain but each branch becomes a 5‑line dispatch.
2. Extract `routes/status.ts`, `routes/well-known.ts`, `routes/files.ts`, `routes/events.ts` — the simple, side‑effect‑light routes.
3. Extract `routes/agents.ts`, `routes/skills.ts`, `routes/chat.ts`.
4. Extract `routes/openclaw-channel.ts` — by itself ~600 LOC, the largest single sub‑surface.
5. Extract `routes/publisher.ts`.
6. Extract `routes/context-graph.ts`, `routes/sub-graph.ts`, `routes/assertion.ts`, `routes/query.ts`, `routes/connect.ts`, `routes/genui.ts`.
7. Move helpers into `manifest/`, `markitdown/`, `mcp-version.ts`, `catchup.ts`.

End state: `daemon.ts` ≤ 1 kLOC; no single route module > 800 LOC.

---

### 2. `packages/agent/src/dkg-agent.ts` (7.3k LOC) — split into named subsystems

#### Today

`DKGAgent` wraps almost every primitive in the codebase: publisher, sync, discovery, chain identity, WM/SWM, chat, skills, endorse/verify, curator gates, profile manager, peer connection, key management. ~170 methods, ~30 private fields.

Several Phase 1 fixes (A‑1, A‑12) revealed that the boundary between "the local node" and "an authenticated agent on the local node" is muddled. Splitting the file is also the *enabling step* for the deferred A‑1.2 (authenticated scoped handle for in‑process callers).

#### Split target

```
packages/agent/src/
├── dkg-agent.ts                     ~1.0 kLOC — facade: composes the parts, owns lifecycle
├── agent/
│   ├── identity.ts                  # peerId, wallet, defaultAgentAddress, registerAgent,
│   │                                # listLocalAgents, resolveAgentByToken, resolveAgentAddress
│   ├── profile.ts                   # publishProfile (already exists; merge ProfileManager here)
│   ├── discovery.ts                 # findAgents, findSkills, findAgentByPeerId  (already a module)
│   ├── publish.ts                   # publish, update, share, conditionalShare,
│   │                                # publishFromSharedMemory, enshrineFromWorkspace
│   ├── query.ts                     # query, queryRemote, queryRemoteSparql,
│   │                                # lookupEntity, findEntitiesByType, getEntityTriples
│   │                                # ← lands the A-1.2 callerAgentAddress refactor here
│   ├── sync.ts                      # syncFromPeer, syncSharedMemoryFromPeer,
│   │                                # syncContextGraphFromConnectedPeers,
│   │                                # cleanupExpiredSharedMemory, setSharedMemoryTtlMs
│   ├── context-graph.ts             # createContextGraph, registerContextGraphOnChain,
│   │                                # addBatchToContextGraph, isCuratorOf,
│   │                                # inviteToContextGraph, subscribe/unsubscribe
│   ├── endorse.ts                   # endorse  (delegates to existing endorse.ts builder)
│   ├── verify.ts                    # verify, propose-verify, ConsensusVerified promotion
│   ├── chat.ts                      # sendChat, onChat
│   └── skills.ts                    # invokeSkill + skill registration
└── dkg-agent-types.ts               # public option/result interfaces shared by the parts
```

Acceptance criteria:

- The `DKGAgent` facade is the only public export; sub‑modules are package‑internal (`@internal` JSDoc + barrel‑less).
- Each sub‑module receives its dependencies via constructor (no `this.parent` reach‑backs).
- Existing `import { DKGAgent } from '@origintrail-official/dkg-agent'` keeps working unchanged.
- `agent/query.ts` is the natural landing site for the A‑1.2 follow‑up: it can carry an `AuthenticatedHandle` that pre‑binds `callerAgentAddress`, removing the "trusted in‑process caller" exemption introduced by PR #242.

Recommended PR ordering:

1. Lift `endorse.ts` and `chat.ts` (both already mostly self‑contained).
2. Lift `discovery.ts`, `profile.ts`, `identity.ts` (already partially separated as `discovery.ts` / `profile.ts` / `profile-manager.ts` — finish the move).
3. Lift `verify.ts` and `endorse.ts` consumers.
4. Lift `query.ts`, then `publish.ts`, then `sync.ts`, then `context-graph.ts`.
5. Final pass: thin `dkg-agent.ts` to a facade.

End state: `dkg-agent.ts` ≤ 1.5 kLOC; no sub‑module > 1.2 kLOC; ProfileManager and DiscoveryClient are folded into their respective modules so we no longer have parallel "manager" + "client" classes.

---

### 3. Smaller follow‑ups (separate PRs, no design needed)

| File | LOC | Action |
|---|---|---|
| `packages/cli/src/cli.ts` | 2,983 | Split per command group; same router pattern as daemon.ts |
| `packages/publisher/src/dkg-publisher.ts` | 2,250 | Split V10 publish path / V9 publish path / update path; aligns with the **P‑1.2** follow‑up (split adapter sign/broadcast for write‑ahead txHash persistence) |
| `packages/node-ui/src/ui/api.ts` | 1,431 | Per‑surface split (query, chat, agent, paranet) |
| `packages/node-ui/src/chat-memory.ts` | 1,362 | Already touched in A‑1 review — the WM read/write seam is the natural split point |

---

### 4. Risks & mitigations

- **Risk:** churn in import paths breaks downstream consumers (CLI, node‑ui, MCP).
  **Mitigation:** keep `dkg-agent.ts` and `daemon.ts` as facades that re‑export the public surface. Run `pnpm -r typecheck` + the full agent + publisher + node‑ui suites between every split PR.

- **Risk:** lifting code accidentally widens trust boundaries (e.g. dropping the A‑1 `callerAgentAddress` check during a route move).
  **Mitigation:** the per‑module split happens AFTER PR #242 lands; the new `agent/query.ts` keeps the same enforcement, and a CDC test in `packages/agent/test/wm-multi-agent-isolation-extra.test.ts` (already added in PR #242) catches regressions.

- **Risk:** golden‑sequence tests (e.g. `packages/publisher/test/phase-sequences.test.ts`) break when phases get re‑ordered during a split.
  **Mitigation:** publisher split goes LAST; the phase contract is frozen by PR #241.

---

### 5. Out of scope for Phase 2 (deferred)

- **P‑1.2 / P‑1.3:** real write‑ahead txHash persistence (requires splitting the EVM adapter's sign/broadcast — non‑trivial, want devnet validation).
- **P‑2:** per‑node fencing tokens (needs spec discussion).
- **A‑5:** per‑CG `requiredSignatures` enforcement at publish time (PROD‑BUG; needs quorum manager).
- **A‑7:** ENDORSE signature + nonce (PROD‑BUG; needs key‑mgmt path through `endorse.ts`).
- **A‑15:** sign every gossip envelope (PROD‑BUG; needs `GossipPublisher` to wrap the libp2p layer).
- **A‑13:** workspace‑config loader (SPEC‑GAP; new module).
- **Q‑1:** per‑quad trust filtering inside surviving WM graphs (complement to PR #239's graph‑level minTrust filter).
- **A‑1.2:** authenticated scoped handle for in‑process callers (`ChatMemoryManager`, `DkgMemoryPlugin`). Lands inside the new `agent/query.ts` module from §2.
- **A‑12.2:** migrate the remaining `did:dkg:agent:${this.peerId}` uses inside `dkg-agent.ts` (creator DID, sync‑auth self‑reference, gossip endorsement self‑DID) to the EVM form. Lands during the §2 split.

---

### 6. Suggested merge order

1. PR #238 (Phase 0 cleanup) — already merged
2. PRs #239, #241, #242, #243 (Phase 1 fixes) — review and merge in any order; independent
3. **This doc** — PR for review/discussion before any §1 or §2 PR opens
4. §1 daemon.ts splits (7 PRs)
5. §2 dkg-agent.ts splits (5 PRs), interleaved with §1 if desired
6. §3 follow‑ups
7. Deferred Phase 1 security work (A‑5, A‑7, A‑15, P‑2, etc.) — separate planning doc

Estimated total: ~12 reviewable PRs, each ≤ 1.5 kLOC of moved code, none introducing behavioural change.
