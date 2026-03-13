# Relay connections: ~10-minute mass disconnect and "no valid addresses" on redial

**Labels:** `bug`, `relay`, `networking`  
**Component:** `packages/core` (DKGNode relay watchdog), testnet edge nodes

---

## Summary

Edge nodes on the DKG V9 testnet that connect to all four configured relays experience **periodic mass disconnects**: all four relay connections close at almost the same time on an approximately **10-minute cadence**. After each mass disconnect, the relay watchdog redials only one relay successfully in the next tick; redials to the other relays fail with **"The dial request has no valid addresses"**. Sync and other operations that depend on those peers then fail until the next full reconnect cycle. The result is that nodes often operate with only 1–2 relay connections instead of 4, reducing redundancy and potentially causing missed messages (e.g. game moves, sync).

---

## Observed behavior

### 1. Mass disconnect timing

From daemon logs of a testnet edge node (Saito) over several hours:

| Time (UTC) | Event |
|------------|--------|
| 20:24:41 | All 4 relay connections closed within milliseconds |
| 20:24:41–42 | All 4 reconnected within ~1 s |
| 20:34:42 | All 4 closed again (~10 min later) |
| 20:34:42–43 | All 4 reconnected |
| 20:44:44 | All 4 closed again (~10 min) |
| 20:44:44 | All 4 reconnected |
| 20:54:45 | All 4 closed again (~10 min) |
| 20:54:55 | Only relay `qSBUinxj` (167.71.33.105) reconnected via watchdog |
| … | Many sync failures: "The dial request has no valid addresses" for the other three relay peer IDs |
| 21:08:42–21:09:28 | Gradual reconnection of 2–4 relays with more churn |

So:

- **All four relays drop at once** on a ~10-minute interval.
- **Reconnection after a mass disconnect is asymmetric**: one relay comes back quickly; the others either fail redial with "no valid addresses" or reconnect only after a longer period / more watchdog cycles.

### 2. Log excerpts

**Mass disconnect (all four within the same second):**

```
[2026-03-13T20:34:42.822Z] Connection closed: qSBUinxj transport=direct duration=601049ms addr=/ip4/167.71.33.105/tcp/9090/p2p/12D3KooWEpSGSVRZx3DqBijai85PLitzWjMzyFVMP4qeqSBUinxj
[2026-03-13T20:34:42.831Z] Connection closed: aijsNrWw transport=direct duration=601030ms addr=/ip4/157.180.37.169/tcp/9090/p2p/12D3KooWAbLiM6Xy2TfXtFpUrXqttnTSuctW8Lo1mkauaijsNrWw
[2026-03-13T20:34:42.829Z] Connection closed: Gq6hB57M transport=direct duration=601055ms addr=/ip4/178.104.54.178/tcp/9090/p2p/12D3KooWSmU3owJvB9sFw8uApDgKrv2VBMecsGGvgAc4Gq6hB57M
[2026-03-13T20:34:42.832Z] Connection closed: nWcpzsge transport=direct duration=600943ms addr=/ip4/178.156.252.147/tcp/9090/p2p/12D3KooWPyTpqBBtU1AvzSsd5rWXCQzFcGtG44qDmeYenWcpzsge
```

Note: `duration` is ~601 s (~10 min) for each, suggesting a **fixed timeout** on the remote side (relay server or load balancer).

**Watchdog redials only one relay; sync fails for others:**

```
[2026-03-13T20:54:55.102Z] Relay watchdog: qSBUinxj disconnected, redialing…
[2026-03-13T20:54:55.383Z] Connection opened: qSBUinxj transport=direct ...
[2026-03-13T20:54:55.384Z] Relay watchdog: reconnected to qSBUinxj
[2026-03-13T20:54:55.384Z] Relay watchdog: next check in 30s (attempt 1)
...
[DKGAgent] Sync from 12D3KooWAbLiM6Xy2TfXtFpUrXqttnTSuctW8Lo1mkauaijsNrWw failed: The dial request has no valid addresses [WARN]
[DKGAgent] Workspace sync from 12D3KooWSmU3owJvB9sFw8uApDgKrv2VBMecsGGvgAc4Gq6hB57M failed: The dial request has no valid addresses [WARN]
[DKGAgent] Sync from 12D3KooWPyTpqBBtU1AvzSsd5rWXCQzFcGtG44qDmeYenWcpzsge failed: The dial request has no valid addresses [WARN]
```

So immediately after the mass disconnect, the watchdog only logs redial for one relay (`qSBUinxj`). The other three relay peer IDs are still in use for sync, but dials to them fail with "no valid addresses".

### 3. Testnet relay configuration

From `network/testnet.json` the node is configured with four relays:

- `167.71.33.105` — `12D3KooWEpSGSVRZx3DqBijai85PLitzWjMzyFVMP4qeqSBUinxj` (qSBUinxj)
- `178.104.54.178` — `12D3KooWSmU3owJvB9sFw8uApDgKrv2VBMecsGGvgAc4Gq6hB57M` (Gq6hB57M)
- `157.180.37.169` — `12D3KooWAbLiM6Xy2TfXtFpUrXqttnTSuctW8Lo1mkauaijsNrWw` (aijsNrWw)
- `178.156.252.147` — `12D3KooWPyTpqBBtU1AvzSsd5rWXCQzFcGtG44qDmeYenWcpzsge` (nWcpzsge)

The node correctly adds all four to `relayTargets` and dials each at startup; the watchdog iterates over all `relayTargets` and redials any with no connections. So the misbehavior is not "only one relay configured" but "after mass disconnect, only one redial succeeds; others fail with no valid addresses".

---

## Impact

- **Reduced redundancy:** Nodes often end up with 1–2 relay connections instead of 4, so a single relay outage has a bigger impact.
- **Sync and messaging:** "The dial request has no valid addresses" causes sync and workspace sync to fail for peers that are actually relay peers (we have their multiaddrs in config). This can contribute to missed game moves or delayed sync.
- **User-visible state:** API may show only one circuit address in `multiaddrs` and fewer `connectedPeers`, so users infer "only connected to one relay" even when two are configured and the intent is to use all four.

---

## Possible causes

### A. Remote ~10-minute idle/timeout (most likely for the mass disconnect)

- **Observation:** All four connections close with almost identical duration (~601 s).
- **Hypothesis:** Relay servers (or a load balancer in front of them) close idle TCP connections after ~10 minutes, or enforce a 10-minute session limit. This would be independent of the DKG node code.
- **Next step:** Confirm with relay/server operators whether there is a 10-minute (or 600 s) idle timeout or session limit on the relay endpoints.

### B. libp2p / peer store state after mass close

- **Observation:** Right after all four connections close, dials to three of the four relays fail with "The dial request has no valid addresses", even though the node has their multiaddrs in `relayTargets` and in `peerStore.merge(peerId, { multiaddrs: [ma] })` at startup.
- **Hypothesis:** When many connections close at once, something in libp2p (e.g. address book, connection manager) may clear or temporarily invalidate addresses for those peers, so `dial(addr)` is not using the known multiaddr. Or the dial is attempted before the peer store has been repopulated.
- **Next step:** Inspect libp2p behavior when multiple connections to different peers close simultaneously; consider ensuring relay multiaddrs are re-merged into the peer store before or during watchdog redial (e.g. always pass the known `addr` from `relayTargets` and/or re-merge before dial).

### C. Watchdog tick ordering and backoff

- **Observation:** Only one relay is logged as "disconnected, redialing" in the first watchdog tick after the mass disconnect.
- **Hypothesis:** The watchdog iterates over `relayTargets` and for each peer with no connection it (1) logs "redialing", (2) waits `RELAY_REDIAL_DELAY_MS + random`, (3) dials. If the first redial succeeds and takes a while, or if the next tick is delayed by backoff ("next check in 30s"), the other three might not be redialed in the same tick. However, "no valid addresses" indicates a dial failure, not "we didn’t try yet".
- **Next step:** Ensure every disconnected relay is redialed using the stored multiaddr from `relayTargets` (and optionally re-merge into peer store) so that "no valid addresses" is not due to missing/stale addresses.

### D. Connection manager / max connections

- Unlikely to be the main cause: the node uses `maxConnections: 500` and only a handful of connections; we are not near the limit when the four relays drop.

---

## Environment

- **Network:** DKG V9 Testnet (`network/testnet.json`, 4 relays).
- **Node role:** Edge.
- **Relevant code:** `packages/core/src/node.ts` (relay targets, startup dial loop, `startRelayWatchdog`, `watchdogTick`).
- **Observed on:** macOS, node name "Saito"; behavior is likely generic for any edge node using the same testnet config.

---

## Suggested next steps

1. **Confirm relay-side timeout:** Check with operators of the testnet relays (167.71.33.105, 178.104.54.178, 157.180.37.169, 178.156.252.147) for any 10-minute (600 s) idle or session timeout. If present, consider increasing it or adding keep-alive/activity so connections are not considered idle.
2. **Redial using stored multiaddr:** In `watchdogTick`, when redialing a disconnected relay, use the `addr` from `relayTargets` (already in use) and optionally call `peerStore.merge(peerId, { multiaddrs: [addr] })` before `node.dial(addr)` so the peer store definitely has a valid address for that peer.
3. **Log and metrics:** Add a log line when a relay dial fails with "no valid addresses" including the relay peer ID and whether we have a multiaddr in `relayTargets`. Consider a metric for "relay connections count" so operators can alert when it drops below 2 or 4.
4. **Stagger or parallel redials:** Evaluate whether redialing all four in parallel (with bounded concurrency) or with a short stagger avoids thundering herd and improves the chance that all four reconnect in the same watchdog cycle.

---

## References

- Relay connection logic: `packages/core/src/node.ts` (e.g. `relayTargets`, `watchdogTick`, startup dial loop).
- Testnet config: `network/testnet.json` (`relays` array).
- Daemon passes all `network.relays` to the agent: `packages/cli/src/daemon.ts` (`relayPeers = network.relays`).

---

## Copy-paste for GitHub Bug Report

**Title:** `Relay connections: ~10-minute mass disconnect and "no valid addresses" on redial`

**Labels:** `bug`, `relay`, `networking`

**Description:** Paste the full content of this file (everything above this section), or the Summary + Observed behavior + Impact + Possible causes + Suggested next steps.

**Steps to Reproduce:**
1. Run an edge node on DKG V9 testnet with default config (all 4 relays from `network/testnet.json`).
2. Let it run for at least 15–20 minutes.
3. Inspect `~/.dkg/daemon.log` (or `dkg logs`) for `Connection closed` and `Relay watchdog` lines.
4. Observe: all four relay connections close within the same second every ~10 minutes; after that, only one relay redial succeeds; sync logs show "The dial request has no valid addresses" for the other relay peer IDs.

**Expected Behavior:** All four relay connections stay up, or after a disconnect all four redial successfully so the node maintains 4 relay connections.

**Actual Behavior:** All four relays disconnect at once on a ~10-minute cadence; only one relay reconnects in the next watchdog tick; the others fail with "The dial request has no valid addresses" so the node often has only 1–2 relay connections.

**Relevant Logs:** See "Log excerpts" in the full report above.
