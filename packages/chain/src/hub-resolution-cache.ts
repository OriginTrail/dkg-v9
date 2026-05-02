/**
 * Caches a Hub-resolved value (typically a `Contract` instance for a
 * given Hub-registered contract name). Re-resolves lazily when:
 *   - cache is empty (first call),
 *   - TTL expired (when `ttlMs > 0`), OR
 *   - `invalidate()` was called explicitly (e.g. from a Hub
 *     `ContractChanged` / `NewContract` event listener, or after a
 *     write surfaced `UnauthorizedAccess(Only Contracts in Hub)`).
 *
 * This is the structural fix for the post-rotation stale-address bug:
 * `EVMChainAdapter` cached every Hub-resolved address once at boot, so
 * a contract rotation on the live Hub (e.g. `RandomSampling` swapped
 * to a new deployment) silently broke writes from running daemons —
 * the OLD address kept getting called, was no longer "in Hub", and
 * its writes to its storage contract reverted with
 * `UnauthorizedAccess(Only Contracts in Hub)` until the daemon was
 * restarted.
 *
 * The cache is intentionally agnostic to what `T` is: callers wire it
 * up with a resolver closure that does the actual `Hub.getContractAddress`
 * + `new Contract(...)` step.
 */
export interface HubResolutionCacheOptions {
  /** Re-resolve when the cached value is older than this. `0` disables periodic refresh. */
  ttlMs?: number;
  /** Override clock for tests. */
  now?: () => number;
}

export class HubResolutionCache<T> {
  private cached: T | null = null;
  private resolvedAt = 0;
  private inflight: Promise<T> | null = null;

  constructor(
    private readonly resolve: () => Promise<T>,
    private readonly opts: HubResolutionCacheOptions = {},
  ) {}

  /**
   * Return the cached value, re-resolving if it is missing or stale.
   * Concurrent callers during a re-resolve share the same in-flight
   * promise so we don't issue duplicate Hub reads.
   */
  async get(): Promise<T> {
    const now = this.opts.now?.() ?? Date.now();
    if (this.cached !== null) {
      const ttl = this.opts.ttlMs ?? 0;
      const stale = ttl > 0 && now - this.resolvedAt > ttl;
      if (!stale) return this.cached;
    }
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const value = await this.resolve();
        this.cached = value;
        this.resolvedAt = this.opts.now?.() ?? Date.now();
        return value;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /** Drop the cached value. Next `get()` will re-resolve from source. */
  invalidate(): void {
    this.cached = null;
    this.resolvedAt = 0;
  }

  /** Snapshot the cached value without triggering a refresh. Returns `null` if never resolved or invalidated. */
  peek(): T | null {
    return this.cached;
  }
}
