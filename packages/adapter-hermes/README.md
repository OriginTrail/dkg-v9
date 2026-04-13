# DKG Adapter for Hermes Agent

Connects [Hermes Agent](https://github.com/nousresearch/hermes-agent) (v0.7+) to a DKG V10 node for verifiable, shared agent memory.

This package contains **both sides** of the integration:
- `src/` — TypeScript daemon adapter (registers HTTP routes on the DKG node)
- `hermes-plugin/` — Python memory provider plugin (loaded by Hermes Agent)

## Architecture

```
Hermes Agent (Python)                DKG Daemon (TypeScript)
plugins/memory/dkg/                  packages/adapter-hermes/
  (symlink → hermes-plugin/)           HermesAdapterPlugin
                                       /api/hermes/* routes
  DKGMemoryProvider  ── HTTP ───→      DKGAgent delegation
  5 agent tools          :9200         importMemories() extraction
  Offline fallback   ←── HTTP ────
```

DKG Working Memory is the **primary store** for all persistent knowledge (facts, user profile, decisions). SQLite conversation history is kept as a local non-graph backup.

## Quick Start

### 1. Install the Hermes plugin

```bash
cd packages/adapter-hermes
./install.sh /path/to/hermes-agent
```

This creates a symlink from Hermes's plugin directory to `hermes-plugin/`. If Hermes is in a standard location, the path is auto-detected.

### 2. Configure Hermes

```bash
hermes memory setup
# Select "dkg" → enter daemon URL (default: http://127.0.0.1:9200)
```

Or set directly in `~/.hermes/config.yaml`:
```yaml
memory:
  provider: dkg
```

### 3. Start DKG + Hermes

```bash
dkg start          # Start the DKG daemon
hermes             # Start Hermes (or it picks up the plugin on next session)
```

No restart needed if Hermes is already running — the plugin registers with the daemon on next session init.

## What the Agent Gets

Five DKG tools appear automatically:

| Tool | Description |
|------|-------------|
| `dkg_memory` | Store/update/remove persistent facts in DKG Working Memory (replaces MEMORY.md) |
| `dkg_query` | Run SPARQL queries across the knowledge graph |
| `dkg_share` | Share knowledge to Shared Working Memory (team-visible, free, gossip-replicated) |
| `dkg_publish` | Publish to Verified Memory (chain-anchored, permanent, costs TRAC) |
| `dkg_status` | Check node health, peers, context graphs, assertion stats |

## Memory Model

```
Working Memory (local, free)      agent's private assertions
  │
  ▼  SHARE (free, gossip)
Shared Working Memory             team-visible, provisional
  │
  ▼  PUBLISH (costs TRAC)
Verified Memory                   chain-anchored, trust gradient
                                  (self-attested → endorsed → consensus-verified)
```

## Offline Mode

If the DKG daemon is unreachable:
- Agent continues with cached facts from `$HERMES_HOME/dkg_cache.json`
- Writes are queued and auto-synced when daemon comes back online
- `hermes dkg sync` forces a manual sync

## CLI Commands

```bash
hermes dkg status   # Connection info, context graphs, assertion stats
hermes dkg query "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10"
hermes dkg sync     # Force-sync local cache to DKG
```

## Development

```bash
# Build TypeScript adapter
pnpm build

# Run tests
pnpm test
```

## License

Apache-2.0
