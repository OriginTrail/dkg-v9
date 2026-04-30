# Testnet reset runbook (V10 RandomSampling + staking consolidation)

This is the operator-facing procedure for resetting the DKG testnet onto the
V10-only contract layout shipped in PR #357. It covers the four roles
involved (maintainer, contracts deployer, node operators, smoke verifier)
and the order they must run in.

The reset is the simplest cutover path because it lets us drop V8
`Staking` + `DelegatorsInfo` + the dual-store coupling completely instead
of running a wholesale state migration. Tradeoff: any node-side state
that references the old chain (oxigraph triple store, publish journal,
RandomSampling WAL) must be wiped per node.

## What this resets and what it preserves

| Preserved | Reset |
|---|---|
| `Hub` contract (same address) | Every other contract (new addresses) |
| `Token` contract (same address) | All on-chain stake / TRAC custody (V8 vault wholesale-drained or abandoned) |
| Operator wallet keystore (same private key per node) | On-chain `identityId` (re-derived clean by `ensureProfile()`) |
| | All published Knowledge Collections + Context Graphs |
| | Per-node oxigraph triple store, publish journal, RandomSampling WAL |

A core node operator running through this end-to-end ends up: same wallet,
fresh on-chain identity (auto-derived), zero KCs, zero stake until it
auto-stakes via `ensureProfile`, prover idle until first KC is published.

## Preconditions

- PR #357 (`feat/v10-random-sampling-and-staking-consolidation`) merged to
  `main`.
- Local Hardhat devnet smoke is green on the merge commit
  (`./scripts/devnet.sh start 6 && ./scripts/devnet-test-random-sampling.sh`).
- Multisig signers available for the deployer multisig (Hub owner).

## Phase A — Maintainer release (one-shot)

1. Tag `main` at the merge commit:
   ```bash
   git tag v10.x.y
   git push origin v10.x.y
   ```
2. The `release.yml` workflow builds binaries, creates the GitHub Release,
   and (manually, per `docs/RELEASE.md`) publishes to npm.
3. Announce the tag + this runbook to operators.

## Phase B — Contracts deploy (deployer + multisig)

The deploy helper at `packages/evm-module/utils/helpers.ts` short-circuits
on contracts whose `deployed: true` flag is set in the network deployments
JSON. To force a fresh deploy of every contract except `Hub` and `Token`,
edit the snapshot before running.

1. Open `packages/evm-module/deployments/base_sepolia_v10_contracts.json`
   (or whichever testnet you're resetting).
2. For every entry **except** `Hub` and `Token`, set `deployed: false`.
   A handy one-liner:
   ```bash
   node -e '
     const fs = require("fs");
     const path = "packages/evm-module/deployments/base_sepolia_v10_contracts.json";
     const j = JSON.parse(fs.readFileSync(path, "utf8"));
     for (const [name, c] of Object.entries(j.contracts)) {
       if (name !== "Hub" && name !== "Token") c.deployed = false;
     }
     fs.writeFileSync(path, JSON.stringify(j, null, 4));
   '
   ```
3. Run hardhat-deploy on the target network:
   ```bash
   pnpm --filter @origintrail-official/dkg-evm-module exec hardhat deploy --network base_sepolia
   ```
   The helper queues every redeployed contract for `Hub.setContractAddress`
   and writes the queue to its own list (see `_writeNewContractsBatch` in
   `helpers.ts`). For non-development networks it does NOT call
   `setContractAddress` directly — Hub is multisig-owned and the helper
   emits a batch JSON for the multisig to consume.
4. The multisig (Hub owner) executes the queued
   `Hub.setContractAddress(name, newAddr)` batch. After this point Hub is
   pointing at the new contracts and consumers re-resolve atomically.
5. Initial bootstrap (one tx — same multisig):
   - `DKGStakingConvictionNFT.finalizeMigrationBatch(currentEpoch)` to set
     the `v10LaunchEpoch` marker on `ConvictionStakingStorage`.
   - No `Hub.transferTokens(StakingStorage, newCSS)` is needed on a true
     reset — there is no V8 TRAC to drain (the V8 staking contracts are
     unregistered, the testnet starts empty).

After Phase B, the chain has fresh empty contracts at fresh addresses. No
KCs, no profiles, no stake. Hub is the only stable entrypoint.

## Phase C — Per-node reset (each operator)

Each node operator runs this on their own host. The order matters: stop
the daemon BEFORE wiping state, then upgrade, then start.

```bash
# 1. Stop the running daemon. If you're using devnet.sh:
./scripts/devnet.sh stop
# Or for production-style installs, SIGTERM the daemon process.

# 2. Wipe per-node chain-state-derived files. KEEP the keystore so the
#    node retains its wallet (ensureProfile re-derives an identityId on
#    the new chain cleanly).
NODE_DATA_DIR="${DKG_HOME:-$HOME/.dkg}"
rm -rf \
  "$NODE_DATA_DIR/store.nq" \
  "$NODE_DATA_DIR/store.nq.tmp" \
  "$NODE_DATA_DIR/publish-journal."* \
  "$NODE_DATA_DIR/random-sampling.wal"

# 3. Upgrade to the v10.x.y release.
#    From git:
git fetch origin --tags
git checkout v10.x.y
pnpm install --frozen-lockfile
pnpm run build
#    Or via npm install -g if running off the published CLI binary.

# 4. Start the daemon. On first start it will:
#      - load the existing keystore (same wallet)
#      - call hub.getContractAddress(...) for each new contract address
#      - find no on-chain identity for this wallet on the new chain
#      - auto-create a profile via Profile.createProfile
#      - auto-stake 50,000 TRAC via DKGStakingConvictionNFT.createConviction
#        with lockTier=1 (1-month tier, cheapest non-zero multiplier)
#      - register the StorageACK handler (cores only)
#      - mount the RandomSampling prover bind (cores only)
./scripts/devnet.sh start 6
# Or systemctl/PM2/etc. for production-style installs.

# 5. Confirm the prover bound and the auto-stake landed.
curl -sS -H "Authorization: Bearer <token>" \
  "http://127.0.0.1:9201/api/random-sampling/status"
# Expected shape:
#   {"enabled":true,"role":"core","identityId":"<N>","loop":{...}}
```

**Things that go wrong if you skip the wipe step:**
- Old `store.nq` references CG IDs and KC merkle roots from the old chain;
  the agent will gossip them to peers and any cross-node validation will
  fail (the on-chain anchors don't exist anymore).
- Old `publish-journal.*` may have idempotency keys that collide with
  fresh publish attempts.
- Old `random-sampling.wal` records challenges (epoch + period start
  block) from the old chain; the prover may attempt to resubmit a "stuck"
  challenge that doesn't exist on the new chain.

The keystore is intentionally preserved so the wallet identity stays
constant — operators don't have to re-fund their wallet, and the new
on-chain `identityId` is auto-derived on first start with no operator
intervention.

## Phase D — Smoke verification (any operator with publish authority)

After enough cores have come back online (≥ 2 for a meaningful
RandomSampling smoke), run the same E2E that gates the devnet smoke:

```bash
# Run from the same checkout used to redeploy contracts so ABIs match.
RS_TIMEOUT=120 \
  ./scripts/devnet-test-random-sampling.sh
```

Expected output:
```
[rs-test] === Random Sampling devnet smoke: PASS ===
[rs-test]   prover node:          <N>
[rs-test]   prover identityId:    <id>
[rs-test]   on-chain solved:      true
[rs-test]   on-chain score:       <non-zero>
```

A non-zero score from `RandomSamplingStorage.getNodeEpochProofPeriodScore`
is the canonical "the consolidation works" signal. A zero score with
`solved=true` would point at the same V8/V10 stake-vault split we
chased on devnet — reach for the ConvictionStakingStorage state +
StakingV10 deploy address before anything else.

## Rollback

A reset is destructive — the only rollback path is "redeploy the V8
contracts again", which is not really a rollback. The conservative
mitigation is to run Phase B against a stage testnet first if there's
any doubt; the smoke test above pins the V10 staking + RS pipeline in
under a minute.

## Cross-references

- `scripts/devnet.sh` — the local Hardhat devnet (mirrors Phases B + C
  for one-host smoke tests).
- `scripts/devnet-test-random-sampling.sh` — the smoke test invoked in
  Phase D.
- `packages/evm-module/utils/helpers.ts` — the deploy helper +
  short-circuit logic.
- `packages/chain/src/evm-adapter.ts:ensureProfile` — the auto-stake
  path each node runs at boot.
- `docs/RELEASE.md` — the npm/GitHub release process used in Phase A.
