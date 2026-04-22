/**
 * mcp-server / auth-probe
 * ------------------------------------------------------------------
 * Helpers used by the `mcp_auth` tool (see `src/index.ts`) to report
 * both daemon liveness and whether the configured bearer credential
 * is actually accepted by the daemon.
 *
 * These live in a dedicated module for two reasons:
 *   1. `src/index.ts` starts the stdio transport at import time
 *      (via `main()`), which would block any test that imports the
 *      probes directly from there. Extracting them keeps the probes
 *      unit-testable against a real http.Server.
 *   2. The bot review on PR #229 flagged that the original
 *      `probeStatus` only hit `/api/status` — a path on the daemon's
 *      public allow-list — so `mcp_auth status` could report OK for
 *      an invalid credential. Splitting liveness (`probeStatus`) from
 *      authenticated reachability (`probeAuth`) lets us expose both
 *      signals in the tool output *and* pin them individually in
 *      tests.
 */

export interface ProbeResult {
  ok: boolean;
  code?: number;
  body?: string;
}

/**
 * Probe `/api/status` (public / liveness only). Anything 2xx counts as
 * reachable. Note: reachability says NOTHING about whether the bearer
 * credential is accepted — see `probeAuth` for that.
 */
export async function probeStatus(
  url: string,
  token: string,
): Promise<ProbeResult> {
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${url.replace(/\/$/, '')}/api/status`, {
      headers,
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, code: res.status, body: text.slice(0, 240) };
  } catch (e) {
    return { ok: false, body: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Probe an authenticated endpoint so the host can verify the bearer
 * credential is actually accepted by the daemon (separately from
 * whether the daemon is reachable at all).
 *
 * `/api/agents` is a cheap GET on the daemon's auth-gated surface that
 * every DKG node exposes (see `packages/cli/src/daemon.ts`). Anything
 * other than 2xx — including 401 "missing auth token" — surfaces as
 * `FAILED`, so `mcp_auth status` can never again report OK for an
 * invalid or missing credential.
 *
 * When no credential is configured the probe short-circuits and
 * reports failure instead of trying to hit an endpoint that would
 * reject an empty Authorization header.
 */
export async function probeAuth(
  url: string,
  token: string,
): Promise<ProbeResult> {
  if (!token) {
    return { ok: false, body: 'no credential configured' };
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/agents`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, code: res.status, body: text.slice(0, 240) };
  } catch (e) {
    return { ok: false, body: e instanceof Error ? e.message : String(e) };
  }
}
