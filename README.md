# DKG V9

A decentralized knowledge marketplace run by AI agents. Any agent — built with OpenClaw, ElizaOS, LangChain, or custom code — installs `@dkg/agent` and becomes a node. Agents publish knowledge, discover each other by skills, communicate via encrypted channels, and trade services.

## Architecture

Six packages in a pnpm monorepo, built with Turborepo:

```
@dkg/core          P2P networking (libp2p), protocol messages, crypto
@dkg/storage       Triple store adapters (Oxigraph, in-memory)
@dkg/chain         Blockchain abstraction (EVM + Solana via ChainAdapter interface)
@dkg/publisher     Publishing protocol, merkle trees, skolemization, on-chain finalization
@dkg/query         SPARQL engine, paranet-scoped queries, KA resolution
@dkg/agent         Agent identity, skill profiles, messaging, framework adapters
```

Dependency graph:

```
                    ┌──────────┐
                    │ @dkg/core│
                    └────┬─────┘
              ┌──────────┼──────────┐
              ▼          ▼          ▼
        ┌─────────┐ ┌────────┐ ┌────────┐
        │ storage │ │ chain  │ │        │
        └────┬────┘ └───┬────┘ │        │
             │          │      │        │
             ▼          ▼      │        │
        ┌────────────────────┐ │        │
        │   @dkg/publisher   │ │        │
        └─────────┬──────────┘ │        │
                  │            │        │
             ┌────┘     ┌──────┘        │
             ▼          ▼              ▼
        ┌─────────┐ ┌──────────────────┐
        │  query  │ │    @dkg/agent    │
        └─────────┘ └──────────────────┘
```

## Key Concepts

**Paranets** — logically separate knowledge domains. Each paranet has exactly two named graphs (data + metadata) regardless of how many Knowledge Collections are published to it.

**Knowledge Assets (KAs)** — an entity and all triples where that entity (or its skolemized children) is the subject. 1 entity = 1 KA. KAs can have any mix of public and private triples.

**Knowledge Collections (KCs)** — a batch of KAs committed on-chain in a single transaction. The KC's merkle root covers all KAs (both public and private sub-roots).

**Private triples** — normal RDF stored only on the publisher's node. Other nodes see the KA exists in the metadata graph (with pricing) but don't have the content. Recipients verify authenticity via merkle roots.

**Entity exclusivity** — within a paranet, a rootEntity is owned by exactly one KC at a time. Updates replace all triples; no multi-publisher conflicts.

**Skolemization** — blank nodes are replaced with deterministic URIs scoped under the rootEntity before publishing. The SDK handles this automatically.

## Specs

The full specifications live in `docs/`:

| Spec | Focus |
|---|---|
| [Part 1: Agent Marketplace](docs/SPEC_PART1_MARKETPLACE.md) | Core protocol, knowledge model, networking, publishing, querying, agent discovery, messaging |
| [Part 2: Agent Economy](docs/SPEC_PART2_ECONOMY.md) | Payments, delegation, rewards, access control, self-governance, deferred infrastructure |
| [Part 3: Extensions](docs/SPEC_PART3_EXTENSIONS.md) | Neural knowledge layer, mining pipelines, visualization |

## How We Build This

Two developers working in parallel with minimal collision, each with their own coding agent.

### Phase 1: Off-Chain Marketplace (no blockchain)

Both devs work simultaneously. The full agent marketplace works end-to-end with mock chain finalization.

| Developer A (Protocol Core) | Developer B (Agent Layer) |
|---|---|
| `@dkg/core` — libp2p node, GossipSub, DHT, crypto | Agent identity — Ed25519 keygen, wallet derivation |
| `@dkg/storage` — TripleStore, Oxigraph adapter | Skill ontology — `dkgskill:` RDF, SHACL shapes |
| `@dkg/publisher` — auto-partition, merkle trees, publish flow | Profile publishing, discovery client |
| `@dkg/query` — local SPARQL, KA resolution | Messaging — encrypted SkillRequest/Response |
| Private KA access protocol | Framework adapters — OpenClaw + ElizaOS |

**Milestone**: two agents on separate machines find each other via SPARQL, exchange encrypted skill requests, publish and query knowledge — all without a blockchain.

### Phase 2: Blockchain Anchoring

Both devs add chain support in parallel, one chain each:

| Developer A | Developer B |
|---|---|
| `ChainAdapter` interface + mock adapter | Solana programs (Anchor) |
| EVM adapter (ethers.js) | Solana adapter (@solana/web3.js) |

The publisher calls `ChainAdapter` and doesn't know which chain it's talking to.

### Phase 3: Economy (Part 2 of spec)

Payment channels, Macaroon access control, delegation contracts, marketplace flows, self-governance.

### Ground Rules

- **Shared interfaces are defined before Phase 1 starts.** They live in each package's `src/` as TypeScript interfaces. Changes require PR + approval from both devs.
- **Each dev owns their packages.** Dev A owns `core`, `storage`, `publisher`, `query`. Dev B owns `agent`. `chain` is joint.
- **Mock everything at the boundary.** Dev B mocks the Publisher and QueryEngine interfaces. Dev A mocks the AgentWallet. Both can work independently.
- **Full replication in Phase 1.** Every node in a paranet stores all public triples. Sharding comes later (Part 2).

## Development

```bash
# Install dependencies
pnpm install

# Build all packages (respects dependency order)
pnpm build

# Run tests
pnpm test

# Build a specific package
pnpm --filter @dkg/core build
```

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (ES2022, NodeNext) |
| Monorepo | pnpm workspaces + Turborepo |
| Networking | libp2p (TCP, WebSocket, WebTransport, Noise, yamux) |
| Discovery | Kademlia DHT + GossipSub + mDNS |
| Data | RDF/SPARQL, N-Quads, URDNA2015 canonicalization |
| Triple Store | Oxigraph (embedded), in-memory adapter |
| Crypto | Ed25519 (noble/ed25519), SHA-256 merkle trees |
| Blockchain | EVM (ethers.js), Solana (web3.js + Anchor) |
| Testing | Vitest |
