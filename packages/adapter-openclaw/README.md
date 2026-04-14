# DKG V10 OpenClaw Adapter

`@origintrail-official/dkg-adapter-openclaw` connects a local OpenClaw agent to a DKG V10 node.

The adapter is a thin bridge into the DKG node. It does not run its own DKG node. The DKG daemon owns the node, triple store, P2P networking, `/.well-known/skill.md`, the right-side UI chat surface, and DKG-backed chat and memory persistence.

## What It Does

- bridges the DKG node UI to a local OpenClaw agent
- keeps connected-agent chat persisted in DKG Working Memory via the `chat-turns` assertion of the `agent-context` context graph
- registers the DKG memory provider as OpenClaw's memory-slot capability, so slot-backed recall reads flow through real V10 primitives (assertion-scoped SPARQL queries with `view: 'working-memory'`) rather than the legacy filesystem-watcher path
- exposes `dkg_memory_import` as an agent-callable write tool for recording memories into a project's Working Memory assertion
- exposes DKG agent-network tools to the OpenClaw runtime

## What It Does Not Do Anymore

- it is not the source of truth for `SKILL.md`
- it does not copy workspace skill files during setup
- it does not enable OriginTrail Game behavior in the default OpenClaw path
- it does not try to be the product-level owner of the DKG install and UI experience

## Quick Start

Install the adapter globally, then run setup:

```bash
npm install -g @origintrail-official/dkg-adapter-openclaw
dkg-openclaw setup
```

Or via the DKG CLI if it is already installed:

```bash
dkg openclaw setup
```

The setup flow is non-interactive and idempotent. It installs or verifies the DKG CLI, writes the local DKG config, merges the adapter into `~/.openclaw/openclaw.json`, writes `WORKSPACE_DIR/config.json`, starts the daemon if requested, and verifies the node.

If the OpenClaw gateway does not auto-reload after the config change, run:

```bash
openclaw gateway restart
```

## Verification

A healthy setup should satisfy all of the following:

- `dkg_status` works from the OpenClaw agent
- the DKG node UI loads at `http://127.0.0.1:9200/ui`
- the right-side chat surface can connect to OpenClaw and send a message successfully
- the conversation survives UI reload because the turns are persisted in DKG memory

## Config Files

| File | Owner | Purpose |
| --- | --- | --- |
| `~/.dkg/config.json` | DKG node | node config: networking, chain, auth, API |
| `WORKSPACE_DIR/config.json` | adapter setup | adapter-facing `dkg-node` config such as daemon URL, memory, and channel flags |
| `~/.openclaw/openclaw.json` | OpenClaw | plugin loading config |

## Adapter Config

These keys live under `"dkg-node"` in `WORKSPACE_DIR/config.json`.

| Key | Default | Purpose |
| --- | --- | --- |
| `daemonUrl` | `http://127.0.0.1:9200` | DKG daemon HTTP URL |
| `memory.enabled` | `false` (`true` after setup) | register the DKG memory-slot capability on attach and enable the `dkg_memory_import` write tool |
| `channel.enabled` | `false` (`true` after setup) | enable the DKG UI to OpenClaw bridge |
| `channel.port` | `9201` | standalone bridge port when gateway route registration is unavailable |

The legacy `memory.memoryDir` and `memory.watchDebounceMs` config keys, and the filesystem-watcher + `/api/memory/import` ingestion flow they configured, were retired in the openclaw-dkg-primary-memory work. Memory now flows exclusively through `api.registerMemoryCapability` for slot-backed recall reads (handled by `DkgMemorySearchManager` which runs dual-graph SPARQL against `agent-context` / `chat-turns` plus the resolved project CG / `memory`) and through the `dkg_memory_import` tool for explicit per-project writes (which land in a project CG's `memory` Working Memory assertion via `POST /api/assertion/:name/write`). See `agent-docs/openclaw-dkg-primary-memory-plan.md` and ADR-018 in `agent-docs/notes/decisions.md` for the full architecture.

## Notes

- The DKG node serves the canonical `SKILL.md` at `GET /.well-known/skill.md`.
- Connected-agent chat in DKG V10 belongs in the right-side shell chat surface, not the legacy Agent Hub tab.
- The adapter package includes a lightweight `setup-entry.mjs` so newer OpenClaw setup/runtime flows can load setup-safe surfaces separately from the full runtime.
