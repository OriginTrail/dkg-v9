# Changelog

All notable changes to the DKG V9 node are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- (Changes go here for the next release.)

### Changed
- (Optional.)

### Fixed
- (Optional.)

---

## [10.0.0-rc.2] - 2026-05-01

V10 RandomSampling + V8/V10 staking consolidation. Testnet reset required (Base Sepolia) — see `docs/TESTNET_RESET.md`.

### Added
- **V10 RandomSampling end-to-end** (`packages/random-sampling`): per-node challenge/proof loop driven by `RandomSampling.sol`; chunk selection reads `merkleLeafCount` from on-chain V10 storage; non-zero `getNodeEpochProofPeriodScore` once a node holds V10 stake.
- **Auto chain-reset wipe** (`packages/cli/src/daemon/chain-reset-wipe.ts`): on boot, the daemon compares the bundled `network.chainResetMarker` against the persisted marker and one-shot wipes `store.nq{,.tmp}` + `publish-journal.*` + `random-sampling.wal` when they differ. Operators no longer need a manual wipe procedure on a testnet reset.
- **`ensureProfile` auto-stake via V10 path** (`packages/chain/src/evm-adapter.ts`): on a clean chain, agents auto-create their on-chain identity and stake 50k TRAC into a V10 NFT position via `DKGStakingConvictionNFT.createConviction(identityId, amount, lockTier=1)` so the V10 stake vault (`ConvictionStakingStorage.nodeStakeV10`) is non-zero from the first proof period.
- **Required `merkleLeafCount` on the V9→V10 publish bridge** (`packages/chain/src/chain-adapter.ts`, `evm-adapter.ts`): `PublishToContextGraphParams.merkleLeafCount` is now required; the bridge throws on missing/invalid input instead of silently defaulting to 1 (which would corrupt RandomSampling chunk selection for any KC with more than one leaf).
- **Stale-proof-period detection in the prover** (`packages/random-sampling/src/prover.ts`): tick now checks the actual chain block height against the cached period's expiry and forces `createChallenge` to rotate when the period has elapsed, instead of stranding on a stale "already-solved" cache view.
- **Testnet reset runbook** (`docs/TESTNET_RESET.md`): full procedure for the V10 cutover covering maintainer release (npm publish + git merge), contracts deploy, automatic per-node state wipe, and smoke verification.
- **Operator-supplied `randomSampling.walPath`** (`packages/cli/src/daemon/chain-reset-wipe.ts`, `daemon/lifecycle.ts`): chain-reset wipe now honors a custom WAL path from config instead of only the default location.
- **Codex PR review workflow** (`.github/workflows/codex-review.yml`): `pull_request_target` + SHA-pinned for review on every PR.

### Changed
- **Consolidated V8 `StakingStorage` into V10 `ConvictionStakingStorage`**: the dual-store coupling between V8 `Staking` / `DelegatorsInfo` and V10 storage is dropped. V10 contracts (`StakingV10`, `DKGStakingConvictionNFT`, `ConvictionStakingStorage`, `RandomSampling`, `RandomSamplingStorage`) are the canonical staking surface; V8 staking is unregistered from the Hub on the testnet reset.
- **Test helpers updated to V10 staking** (`hardhat-harness.ts:stakeAndSetAsk`): switches from V8 `Staking.stake` to `DKGStakingConvictionNFT.createConviction` so E2E flows match the agent's actual auto-stake path.
- **`enrichEvmError` regex generalised** (`packages/chain`): now decodes EVM revert reasons across Hardhat-style `data="0x..."` and the broader provider variants.

### Fixed
- **Zero RandomSampling node scores** caused by V8/V10 stake-vault split — `RandomSampling.calculateNodeScore` reads `ConvictionStakingStorage.getNodeStakeV10` exclusively, but legacy `Staking.stake` only updated V8 `StakingStorage`. Resolved by routing all stake through V10 (`ensureProfile`, `stakeAndSetAsk`).
- **`chainResetWipe` daemon crash on FS errors** (`packages/cli/src/daemon/chain-reset-wipe.ts`): wipe + `saveState` are now wrapped in `try/catch`; FS errors log a warning and boot continues instead of crashing the daemon.
- **`ensureProfile` profile-without-stake on partial failure**: profile creation and staking are now in separate `try/catch` blocks so a failed stake leaves the on-chain identity intact for retry instead of leaving the operator without either.
- **ABI pinning test drift** for V10 publish/update functions after `merkleLeafCount` was added (`abi-pinning.test.ts`): pin digests refreshed.

[Unreleased]: https://github.com/OriginTrail/dkg/compare/v10.0.0-rc.2...HEAD
[10.0.0-rc.2]: https://github.com/OriginTrail/dkg/releases/tag/v10.0.0-rc.2
[9.0.0]: https://github.com/OriginTrail/dkg-v9/releases/tag/v9.0.0

---

## [9.0.0] - 2026-02-26

First tracked release (DKG V9). Includes:

### Added
- **Cross-agent query protocol** (`/dkg/query/2.0.0`): query another node's knowledge store over libp2p (ENTITY_BY_UAL, ENTITIES_BY_TYPE, ENTITY_TRIPLES, SPARQL_QUERY) with access policies and rate limiting.
- **Node dashboard UI** (`@origintrail-official/dkg-node-ui`): web UI served by the daemon — dashboard, Knowledge Explorer (SPARQL + graph viz), Operations log, Network, Wallet, Integrations, chat assistant (rule-based + optional LLM).
- **Oxigraph persistence and sync**: triple store persists to disk; sync protocol for catch-up on connect.
- **On-chain publishing**: Base Sepolia testnet integration, TRAC staking, ask setting, knowledge asset minting.
- **CLI**: `dkg init`, `start`, `stop`, `status`, `peers`, `publish`, `query`, `query-remote`, `subscribe`, `paranet create/list/info`, `set-ask`, `wallet`, `logs`.
- **GitHub Actions CI**: build and test on push/PR; Solidity compile and tests.

### Changed
- Broadcast publish uses result's `publicQuads` so private triples are not re-sent over gossip.
- Agent supports `listenHost` for binding to a specific interface (e.g. 127.0.0.1 in tests).
