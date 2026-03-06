# 001 — ChainEventPoller `eth_getLogs` exceeds 10k block range limit

**Date discovered:** 2026-03-04
**Status:** Open
**Commit that fixes it:** —

## Symptom

Every ~12 seconds the logs flood with:

```
[ChainEventPoller] Poll failed: could not coalesce error
  "eth_getLogs is limited to a 10,000 range"
  fromBlock: "0x1", toBlock: "latest"
```

## Root cause

`ChainEventPoller` (`packages/publisher/src/chain-event-poller.ts`) initialises `lastBlock = 0`. On the first poll it builds a filter with `fromBlock: this.lastBlock + 1` (= 1). The `EventFilter` interface has no `toBlock` field, so the EVM adapter (`packages/chain/src/evm-adapter.ts`) calls `storage.queryFilter(eventFilter, fromBlock)` without a second bound — ethers.js defaults `toBlock` to `'latest'`.

On Base Sepolia `latest` is millions of blocks away from block 1, exceeding the RPC provider's 10,000-block `eth_getLogs` limit. The query fails, `lastBlock` never advances, and the same impossible range is retried on every poll cycle.

## Files involved

- `packages/publisher/src/chain-event-poller.ts` — `lastBlock` init and filter construction (lines ~37, ~86-90)
- `packages/chain/src/chain-adapter.ts` — `EventFilter` interface (lines ~77-80)
- `packages/chain/src/evm-adapter.ts` — `listenForEvents` / `queryFilter` call (lines ~549-557)

## How to fix

The adapter (or poller) needs to cap the block range per request:

1. Add `toBlock?: number | 'latest'` to `EventFilter`.
2. In the EVM adapter, call `provider.getBlockNumber()` to get the chain head.
3. Clamp each query to `Math.min(fromBlock + 9999, currentBlock)` and paginate if the gap is larger.
4. Alternatively, persist `lastBlock` to disk so restarts don't start from 0.

## Notes

- The error is cosmetic when the wallet has no funds (on-chain publishes are already skipped), but it generates a lot of log noise and will be a real problem once the wallet is funded.
