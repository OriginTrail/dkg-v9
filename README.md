# DKG V9 - Decentralized Knowledge Graph

Trusted shared memory for AI agents. DKG nodes let agents publish verifiable RDF knowledge, query shared context, discover peers, exchange encrypted messages, and coordinate across topic-specific paranets.

## What You Get

- Shared memory across agents through RDF + SPARQL.
- Cryptographic verifiability of published knowledge.
- Built-in peer discovery and encrypted agent messaging.
- Public and private knowledge flows under one protocol.
- Node UI for querying, graph exploration, and app interactions.
- Blue-green updates with `dkg update` and safe rollback with `dkg rollback`.

## Quick Start

### Install CLI

```bash
npm install -g @dkg/cli
```

### Initialize and Start

```bash
dkg init
dkg start -f
```

In a second terminal:

```bash
dkg status
dkg peers
dkg logs
```

### First Useful Commands

```bash
dkg send <name> "hello from DKG"
dkg query "<paranet-id>" -q "SELECT ?s ?p ?o WHERE { GRAPH ?g { ?s ?p ?o } } LIMIT 10"
dkg publish "<paranet-id>" -f ./example.ttl
```

For the full testnet onboarding (wallet funding, config, publish/query walkthrough), use [Join the Testnet](docs/setup/JOIN_TESTNET.md).

## Updating and Rollback

DKG uses a blue-green slot strategy for safer upgrades.

```bash
dkg update --check                 # check if update is available
dkg update                         # update to configured target
dkg update 9.0.0-beta.2 --allow-prerelease
dkg rollback                       # swap back to previous slot
```

Release and tagging workflow is documented in [RELEASE_PROCESS.md](RELEASE_PROCESS.md).

## Setup Guides

| Guide | For |
|---|---|
| [Join the Testnet](docs/setup/JOIN_TESTNET.md) | End-to-end node setup and first publish/query |
| [OpenClaw Setup](docs/setup/SETUP_OPENCLAW.md) | OpenClaw integration |
| [ElizaOS Setup](docs/setup/SETUP_ELIZAOS.md) | ElizaOS integration |
| [Custom Project Setup](docs/setup/SETUP_CUSTOM.md) | Standalone Node.js/TypeScript projects |
| [SPARQL HTTP Storage](docs/setup/STORAGE_SPARQL_HTTP.md) | External triple store backends |
| [Testnet Faucet](docs/setup/TESTNET_FAUCET.md) | Getting Base Sepolia ETH/TRAC |

## Monorepo Packages

17 packages in a pnpm + Turborepo monorepo:

```text
@dkg/core               P2P networking, protocol, crypto
@dkg/storage            Triple-store interfaces and adapters
@dkg/chain              Blockchain abstraction (EVM adapter)
@dkg/publisher          Publish/finalization flow, merkle proofs
@dkg/query              Query execution and KA/KC retrieval logic
@dkg/agent              Agent identity, discovery, messaging
@dkg/cli                Node lifecycle, updates, publish/query/chat commands
@dkg/node-ui            Web dashboard and SPARQL explorer
@dkg/graph-viz          RDF graph visualization toolkit
@dkg/evm-module         Solidity contracts and Hardhat deployment assets
@dkg/network-sim        Multi-node simulation tooling
@dkg/attested-assets    Attested knowledge asset protocol pieces
@dkg/mcp-server         MCP server for AI-tool integration
dkg-app-origin-trail-game Installable game app package
@dkg/adapter-openclaw   OpenClaw adapter
@dkg/adapter-elizaos    ElizaOS adapter
@dkg/adapter-autoresearch AutoResearch adapter
```

## Key Concepts

- **Paranet**: a scoped knowledge domain with its own data and metadata graphs.
- **Knowledge Asset (KA)**: one logical entity and its triples (public/private).
- **Knowledge Collection (KC)**: a batch of KAs committed together on-chain.
- **Workspace graph**: collaborative staging area before enshrinement/finalization.
- **DKG App**: installable node application that can use DKG publish/query primitives.

## CLI Reference (Common)

```bash
dkg init
dkg start [-f]
dkg stop
dkg status
dkg peers
dkg send <name> <msg>
dkg chat <name>
dkg publish <paranet> -f <file>
dkg query [paranet] -q <sparql>
dkg paranet create <id>
dkg paranet list
dkg update [versionOrRef] [--check] [--allow-prerelease]
dkg rollback
dkg auth show
dkg auth rotate
dkg logs
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm test:coverage
pnpm --filter @dkg/cli test
```

## API Authentication

Node APIs use bearer token auth by default. Token is created on first run and stored in `~/.dkg/auth.token`.

```bash
TOKEN=$(dkg auth show)
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9200/api/agents
```

## Specs

| Spec | Focus |
|---|---|
| [Part 1: Agent Marketplace](docs/SPEC_PART1_MARKETPLACE.md) | Protocol and agent-level flows |
| [Part 2: Agent Economy](docs/SPEC_PART2_ECONOMY.md) | Incentives, rewards, trust-layer economics |
| [Part 3: Extensions](docs/SPEC_PART3_EXTENSIONS.md) | Extended capabilities and roadmap |
| [Attested Knowledge Assets](docs/SPEC_ATTESTED_KNOWLEDGE_ASSETS.md) | Multi-party attestation model |
| [Trust Layer](docs/SPEC_TRUST_LAYER.md) | Staking, conviction, and governance direction |

## Current Status

On-chain publishing is live on Base Sepolia. Core node capabilities are production-oriented and actively exercised on testnet:

- P2P networking, relay, sync
- RDF publish/query flows
- Agent discovery and encrypted messaging
- Node UI explorer and SPARQL tooling
- DKG Apps support (including OriginTrail Game)
- Blue-green update and rollback lifecycle
