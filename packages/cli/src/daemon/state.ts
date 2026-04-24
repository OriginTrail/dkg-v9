// Shared module-level mutable state for the split `daemon` modules.
//
// The original single-file `daemon.ts` kept a handful of module-level
// `let`/`const` bindings that were read and mutated from multiple
// long-lived sections of the file (manifest helpers, lifecycle,
// handleRequest, auto-update). After splitting those sections into
// sibling files under `daemon/` we need one canonical home for that
// state so every module sees the same value.
//
// We bundle them into one exported object so that `let` bindings stay
// mutable across module boundaries (a direct `export let isUpdating`
// would be read-only for every importer). Mutation goes through the
// object reference, e.g. `daemonState.isUpdating = true`.

import type { CatchupRunner } from '../catchup-runner.js';

export type CorsAllowlist = '*' | string[];

export const daemonState: {
  /** Populated in `runDaemonInner` once the DKGAgent is ready. */
  catchupRunner: CatchupRunner | null;
  /** Set to `true` while a monorepo `git pull` / slot-swap is in flight. */
  isUpdating: boolean;
  /** Most recent "is this daemon up to date?" result; polled by `/status`. */
  lastUpdateCheck: {
    upToDate: boolean;
    checkedAt: number;
    latestCommit: string;
    latestVersion: string;
  };
  /** Memoised result of `isStandaloneInstall()` — null = not yet checked. */
  standaloneCache: boolean | null;
  /** CORS allowlist, set by `runDaemonInner`, read in `handleRequest`. */
  moduleCorsAllowed: CorsAllowlist;
  /** OpenClaw bridge health cache. Mutated from both `openclaw.ts`
   *  (read) and `handle-request.ts` (write after each /send round
   *  trip), so it lives here rather than inside openclaw.ts. */
  openClawBridgeHealth: { ok: boolean; ts: number } | null;
} = {
  catchupRunner: null,
  isUpdating: false,
  lastUpdateCheck: {
    upToDate: true,
    checkedAt: 0,
    latestCommit: '',
    latestVersion: '',
  },
  standaloneCache: null,
  moduleCorsAllowed: '*',
  openClawBridgeHealth: null,
};
