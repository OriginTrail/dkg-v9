/**
 * Shared helpers for resolving DKG_HOME, API port, PID, and auth tokens.
 *
 * These were previously duplicated across cli, mcp-server, and adapter-openclaw.
 * Centralizing them here ensures consistent behavior everywhere.
 */

import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Resolve the DKG home directory ($DKG_HOME or ~/.dkg). */
export function dkgHomeDir(): string {
  return process.env.DKG_HOME ?? join(homedir(), '.dkg');
}

/** Read the daemon PID from $DKG_HOME/daemon.pid. Returns null if missing or invalid. */
export async function readDaemonPid(dkgHome?: string): Promise<number | null> {
  try {
    const raw = await readFile(join(dkgHome ?? dkgHomeDir(), 'daemon.pid'), 'utf-8');
    return parseStrictPosInt(raw.trim());
  } catch {
    return null;
  }
}

/** Check whether a process with the given PID is alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the API port from $DKG_API_PORT env or $DKG_HOME/api.port file.
 * If $DKG_API_PORT is set but invalid, returns null immediately (does not
 * fall through to the file) to avoid silently connecting to a stale port.
 */
export async function readDkgApiPort(dkgHome?: string): Promise<number | null> {
  if (process.env.DKG_API_PORT !== undefined) {
    return parsePort(process.env.DKG_API_PORT.trim());
  }

  try {
    const raw = await readFile(join(dkgHome ?? dkgHomeDir(), 'api.port'), 'utf-8');
    return parsePort(raw.trim());
  } catch {
    return null;
  }
}

/**
 * Load the first non-comment, non-blank line from $DKG_HOME/auth.token.
 * Returns undefined if the file does not exist or is unreadable.
 */
export function loadAuthTokenSync(dkgHome?: string): string | undefined {
  const filePath = join(dkgHome ?? dkgHomeDir(), 'auth.token');
  if (!existsSync(filePath)) return undefined;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (t.length > 0 && !t.startsWith('#')) return t;
    }
  } catch { /* unreadable */ }
  return undefined;
}

const DECIMAL_INT_RE = /^[0-9]+$/;

/**
 * Parse a string as a strict positive decimal integer.
 * Rejects empty strings, hex (0x...), scientific notation (1e3), floats, and negative values.
 */
function parseStrictPosInt(value: string): number | null {
  if (!DECIMAL_INT_RE.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

/** Parse a string as a valid TCP port (1–65535). Only accepts decimal digit strings. */
function parsePort(value: string): number | null {
  const n = parseStrictPosInt(value);
  if (n === null || n > 65535) return null;
  return n;
}

/** Async variant of loadAuthTokenSync. */
export async function loadAuthToken(dkgHome?: string): Promise<string | undefined> {
  const filePath = join(dkgHome ?? dkgHomeDir(), 'auth.token');
  if (!existsSync(filePath)) return undefined;
  try {
    const raw = await readFile(filePath, 'utf-8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (t.length > 0 && !t.startsWith('#')) return t;
    }
  } catch { /* unreadable */ }
  return undefined;
}

const ETH_ADDR_RE = /^0x[0-9a-f]{40}$/;

/**
 * Thrown by `loadAgentEthAddress*` when the keystore contains more than one
 * eth-address top-level key and no `explicitAddress` override was provided.
 *
 * The single-agent path is the common gateway/dev shape; multi-agent
 * deployments must explicitly disambiguate (typically via the
 * `DKG_AGENT_ADDRESS` env var) so the WM-view scope can never silently route
 * memory writes to one identity and reads to another.
 */
export class MultipleAgentsError extends Error {
  readonly addresses: readonly string[];
  constructor(addresses: readonly string[]) {
    super(
      `agent-keystore.json contains ${addresses.length} agent identities (${addresses.join(', ')}); ` +
      `set DKG_AGENT_ADDRESS to disambiguate.`,
    );
    this.name = 'MultipleAgentsError';
    this.addresses = addresses;
  }
}

/**
 * Filter and lowercase eth-address keys from the keystore JSON. Non-eth-shaped
 * keys are dropped (defensive against future schema mixins / corrupted files).
 */
function extractEthAddressKeys(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== 'object') return [];
  return Object.keys(parsed as Record<string, unknown>)
    .map((k) => k.toLowerCase())
    .filter((k) => ETH_ADDR_RE.test(k));
}

/**
 * Resolve an explicit override (typically `process.env.DKG_AGENT_ADDRESS`)
 * against the eth-address shape. Lowercased for stable comparison with the
 * daemon's keystore-write normalization (`packages/agent/src/dkg-agent.ts`
 * uses `.toLowerCase()` on every store).
 *
 * Returns `undefined` if the override is absent or not a valid eth address —
 * the helper's caller then falls through to the keystore read path.
 */
function resolveExplicitAddress(explicit: string | undefined): string | undefined {
  if (typeof explicit !== 'string') return undefined;
  const t = explicit.trim().toLowerCase();
  if (!ETH_ADDR_RE.test(t)) return undefined;
  return t;
}

/**
 * Load the agent's eth address from `<DKG_HOME>/agent-keystore.json`.
 *
 * The keystore is written by `packages/agent/src/dkg-agent.ts:saveToKeystore`
 * as a map of lowercase eth address → `{ authToken, privateKey? }`. The
 * daemon resolves its own writer-side identifier (`defaultAgentAddress`) from
 * the first registered agent in the same store, so the adapter must read
 * from the same source for read-side WM SPARQL `agentAddress` to align with
 * write-side graph URIs (otherwise the daemon's query engine scopes WM to
 * `…/assertion/<peerId>/` while data lives at `…/assertion/<eth>/`).
 *
 * Returns `undefined` if the keystore is missing, unreadable, malformed, or
 * empty. Throws `MultipleAgentsError` if the keystore has more than one eth
 * key and no `explicitAddress` override is provided — refusing to guess in
 * the multi-agent case is intentional: silent mis-routing across identities
 * is a security/correctness footgun.
 *
 * `opts.explicitAddress` (typically `process.env.DKG_AGENT_ADDRESS`) is
 * checked first so operators can disambiguate multi-agent setups without
 * touching the keystore file.
 */
export function loadAgentEthAddressSync(
  dkgHome?: string,
  opts?: { explicitAddress?: string },
): string | undefined {
  const explicit = resolveExplicitAddress(opts?.explicitAddress);
  if (explicit) return explicit;

  const filePath = join(dkgHome ?? dkgHomeDir(), 'agent-keystore.json');
  if (!existsSync(filePath)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    // Unreadable / malformed JSON / EACCES — treat as missing. The caller's
    // existing "agent identity not yet provisioned" path already handles
    // a missing identity gracefully (search returns []), and operators see
    // the gap via the existing `[dkg-memory] DkgMemorySearchManager.search
    // skipped: peer ID not yet available` warn.
    return undefined;
  }

  const keys = extractEthAddressKeys(parsed);
  if (keys.length === 0) return undefined;
  if (keys.length > 1) throw new MultipleAgentsError(keys);
  return keys[0];
}

/** Async variant of `loadAgentEthAddressSync`. */
export async function loadAgentEthAddress(
  dkgHome?: string,
  opts?: { explicitAddress?: string },
): Promise<string | undefined> {
  const explicit = resolveExplicitAddress(opts?.explicitAddress);
  if (explicit) return explicit;

  const filePath = join(dkgHome ?? dkgHomeDir(), 'agent-keystore.json');
  if (!existsSync(filePath)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    return undefined;
  }

  const keys = extractEthAddressKeys(parsed);
  if (keys.length === 0) return undefined;
  if (keys.length > 1) throw new MultipleAgentsError(keys);
  return keys[0];
}
