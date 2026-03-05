# Transport Abstraction Tasks

Goal: make networking provider-pluggable (libp2p now, iroh later) without changing DKG protocol behavior.

## Phase 0 - Tracking

- [x] Keep this file updated as implementation progresses.
- [x] Record design decisions and trade-offs in this file.

## Phase 1 - Core Abstraction Surface

- [x] Add provider-neutral methods to `DKGNode` for:
  - protocol request/response
  - pubsub subscribe/publish/receive
  - peer and connection inspection
  - dialing and peer address hints
  - peer protocol capability checks
- [x] Keep existing `DKGNode` behavior unchanged for libp2p runtime.
- [x] Keep temporary compatibility with existing `node.libp2p` access points.

## Phase 2 - Decouple Core Managers

- [x] Refactor `ProtocolRouter` to use `DKGNode` provider-neutral protocol methods.
- [x] Refactor `GossipSubManager` to use `DKGNode` pubsub methods.
- [x] Refactor `PeerDiscoveryManager` to use `DKGNode` connection/event methods.

## Phase 3 - Reduce Upstream Coupling

- [x] Refactor `@dkg/agent` to replace direct `node.libp2p` usage where possible.
- [x] Refactor `@dkg/cli` daemon metrics and API connection endpoints to use `DKGNode` methods.
- [x] Refactor adapter packages to remove direct `node.libp2p` reads.

## Phase 4 - Identity and Relay Neutrality

- [x] Remove hard dependency on libp2p PeerId internals for key derivation in messaging.
- [x] Use profile-published public keys as primary source for peer encryption keys.
- [x] Replace hardcoded relay transport string assumptions in non-core packages.

## Phase 5 - Provider Contracts and Tests

- [x] Add a provider contract test suite (protocol, pubsub, connection reporting, relay semantics).
- [x] Keep existing libp2p E2E tests green while abstraction lands.
- [x] Add mock-provider tests for core managers where practical.

## Phase 6 - Iroh Provider (Future)

- [ ] Implement an `IrohProvider` behind the same `DKGNode` abstraction.
- [ ] Run provider contract suite against iroh backend.
- [ ] Validate DKG agent E2E flows on iroh-only network.

## Notes

- Current default: no breaking public API changes during abstraction phase.
- Known high-coupling hotspots: `@dkg/core/node.ts`, `@dkg/core/protocol-router.ts`, `@dkg/agent/dkg-agent.ts`, `@dkg/agent/messaging.ts`, `@dkg/cli/daemon.ts`.
- Completed now: core managers use provider-neutral `DKGNode` APIs; agent and CLI moved off direct `libp2p` in main runtime paths.
- Messaging now resolves peer keys from profile-published `dkg:publicKey` first, with PeerId parsing fallback for compatibility.
- Decision: keep `DKGNode` as the first abstraction boundary (instead of introducing a separate provider interface package) to reduce initial churn.
- Decision: keep `DKGNode.libp2p` available temporarily for compatibility while upstream packages migrate incrementally.
- Non-core relay-specific string checks were moved behind `DKGNode` methods (`addRelayAddress`, `hasRelayReservation`, `getRelayReservationAddresses`).
- Added mock-provider tests for ProtocolRouter, GossipSubManager, and PeerDiscoveryManager.
