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
import { keccak_256 } from '@noble/hashes/sha3.js';

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
 * T62 / T63 — EIP-55 mixed-case checksum for an eth address.
 *
 * Originally added to convert lowercase keystore JSON keys to checksum form
 * because the daemon stores chat-turn graph URIs in EIP-55 case. T63 retired
 * that path: the adapter now HTTP-probes `/api/agent/identity` and gets the
 * canonical form directly from the daemon, so this helper's keystore-read
 * use is gone.
 *
 * Retained narrow purpose: normalize the `DKG_AGENT_ADDRESS` env override on
 * remote-daemon deployments (where there's no keystore + no HTTP probe to
 * derive the canonical case). Operators are likely to supply lowercase
 * (matches the keystore JSON they peeked at); silent SPARQL miss is a
 * worse failure mode than a one-shot normalization.
 *
 * @param address - hex-encoded eth address, with or without `0x` prefix.
 *                  Case-insensitive on input.
 * @returns The address in EIP-55 mixed-case form, with `0x` prefix.
 */
export function toEip55Checksum(address: string): string {
  const lower = address.replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(lower)) {
    throw new Error(`toEip55Checksum: not a 40-hex-digit eth address: ${address}`);
  }
  // EIP-55 hashes the lowercase HEX STRING (ASCII bytes), then uppercases each
  // alpha character in the address whose corresponding hash nibble is >= 8.
  const hashBytes = keccak_256(new TextEncoder().encode(lower));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    if (ch >= 'a' && ch <= 'f') {
      // Each byte yields two hex nibbles. Even index → high nibble.
      const byte = hashBytes[i >> 1];
      const nibble = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
      out += nibble >= 8 ? ch.toUpperCase() : ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Thrown by `loadAgentAuthToken*` when the keystore contains more than one
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
 *
 * T46 — Deduped after lowercasing. A keystore that recorded the same identity
 * under both checksum and lowercase form (e.g. operator hand-edited the file,
 * or two writer paths used different normalisation) would otherwise be flagged
 * as multi-agent and disable WM lookup even though it's a single identity.
 * `Set` over the post-lowercase keys collapses the duplicate to one entry
 * before the multi-agent guardrail counts them.
 *
 * T63 — No longer applies EIP-55 checksumming. The adapter resolves the
 * canonical eth via the daemon's `/api/agent/identity` HTTP probe; this
 * helper is now only used to enumerate keys for the multi-agent guardrail
 * and for case-insensitive matching against an explicit env override.
 */
function extractEthAddressKeys(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const lc = Object.keys(parsed as Record<string, unknown>)
    .map((k) => k.toLowerCase())
    .filter((k) => ETH_ADDR_RE.test(k));
  return Array.from(new Set(lc));
}

/**
 * Resolve an explicit override (typically `process.env.DKG_AGENT_ADDRESS`)
 * against the eth-address shape.
 *
 * T63 — Returns the LOWERCASE form for case-insensitive comparison against
 * keystore keys. Callers that need the canonical EIP-55 form for downstream
 * use (the remote-daemon `nodeAgentAddress` set-direct path) should call
 * `toEip55Checksum` themselves on the result.
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
 * Discriminated result of the keystore agent-auth-token read.
 *
 * T64/T66 — The adapter's probe needs to distinguish three end-states so it
 * can correctly drive the `localKeystoreCheckedAndAbsent` flag (which gates
 * the peerId fallback in `resolveDefaultAgentAddress`):
 *
 * - `'absent'` — file does not exist OR file exists, parses cleanly, and
 *   contains zero eth-shaped keys (legitimate "no agent registered yet"
 *   state). The daemon's `ChatMemoryManager` was almost certainly
 *   constructed with `peerId` (one-shot at lifecycle), so the peerId
 *   fallback is the correct WM scope. Probe sets the flag.
 *
 * - `'unusable'` — file exists but cannot yield a usable token (malformed
 *   JSON, EACCES, eth entries missing `authToken`, or only non-eth keys
 *   that should be eth-shaped). Could be transient (operator mid-write,
 *   permissions blip) or permanently broken — either way, the peerId
 *   fallback is unsafe (the daemon may be using eth on this same host).
 *   Probe does NOT set the flag; warns so operators see the gap.
 *
 * - `{ authToken }` — usable agent token. Probe forwards to the daemon's
 *   `/api/agent/identity` HTTP endpoint.
 *
 * Throws `MultipleAgentsError` for multi-agent without env override
 * (refuse-to-guess); the adapter probe surfaces a warn and the resolver
 * stays at undefined.
 */
export type KeystoreAuthTokenResult =
  | { kind: 'token'; authToken: string }
  | { kind: 'absent' }
  | { kind: 'unusable' };

/**
 * Load the agent's auth token from `<DKG_HOME>/agent-keystore.json`.
 *
 * T63 — The adapter no longer derives the eth address from the keystore
 * JSON key; instead it reads the agent's auth token here, then HTTP-probes
 * the daemon's `/api/agent/identity` endpoint with that token to get the
 * canonical eth (the daemon already stores it in EIP-55 form via
 * `verifyWallet.address`). Single source of truth, no case-conversion
 * plumbing in the adapter.
 *
 * T64/T66 — Returns a discriminated `KeystoreAuthTokenResult` so the probe
 * can distinguish "no agent yet" (peerId fallback OK) from "file present
 * but unusable" (no fallback — could be transient).
 *
 * The keystore is written by `packages/agent/src/dkg-agent.ts:saveToKeystore`
 * as `{ <lowercase-eth>: { authToken, privateKey? } }`.
 *
 * - Single-agent keystore with usable `authToken`: returns
 *   `{ kind: 'token', authToken }`.
 * - Multi-agent + `explicitAddress` (case-insensitive match) with usable
 *   `authToken` on the matched entry: returns
 *   `{ kind: 'token', authToken }`.
 * - Missing keystore file OR file with zero eth-shaped keys: returns
 *   `{ kind: 'absent' }`.
 * - File present but unreadable/malformed/missing-authToken: returns
 *   `{ kind: 'unusable' }`.
 * - Multi-agent without env: throws `MultipleAgentsError`.
 *
 * T67 — When the keystore has duplicate case variants of the same eth
 * (checksum + lowercase), the helper scans ALL case-insensitive matches
 * and returns the first one with a non-empty `authToken`, instead of
 * giving up on the first match.
 */
export function loadAgentAuthTokenSync(
  dkgHome?: string,
  opts?: { explicitAddress?: string },
): KeystoreAuthTokenResult {
  const filePath = join(dkgHome ?? dkgHomeDir(), 'agent-keystore.json');
  if (!existsSync(filePath)) return { kind: 'absent' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return { kind: 'unusable' };
  }

  return resolveAuthTokenFromParsed(parsed, opts?.explicitAddress);
}

/** Async variant of `loadAgentAuthTokenSync`. */
export async function loadAgentAuthToken(
  dkgHome?: string,
  opts?: { explicitAddress?: string },
): Promise<KeystoreAuthTokenResult> {
  const filePath = join(dkgHome ?? dkgHomeDir(), 'agent-keystore.json');
  if (!existsSync(filePath)) return { kind: 'absent' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    return { kind: 'unusable' };
  }

  return resolveAuthTokenFromParsed(parsed, opts?.explicitAddress);
}

/**
 * Shared resolution body for sync + async `loadAgentAuthToken*`.
 * Walks the parsed keystore, applies the multi-agent guardrail, picks the
 * matching entry, and extracts its `authToken` field.
 *
 * T67 — Scans ALL case-insensitive matches for the chosen key, not just
 * the first one. Keystores that recorded the same identity in both
 * checksum and lowercase form (operator hand-edit, two writer paths with
 * different normalisation) might have one duplicate stale/malformed and
 * another carrying the valid token. Pre-fix the helper picked the first
 * raw match and gave up; post-fix it returns the first usable token.
 */
function resolveAuthTokenFromParsed(
  parsed: unknown,
  explicitAddress: string | undefined,
): KeystoreAuthTokenResult {
  const keys = extractEthAddressKeys(parsed);
  if (keys.length === 0) {
    // Two sub-cases: (a) parsed value isn't an object at all (malformed
    // structure that JSON.parse accepted but `extractEthAddressKeys`
    // rejected — e.g. a JSON literal of `null` or a string), and (b)
    // parsed object had keys but none were eth-shaped. (a) is genuinely
    // unusable; (b) is the legitimate "empty keystore" / "non-eth keys
    // only" state where the daemon almost certainly uses peerId. Without
    // finer-grained discrimination, `'absent'` is the safer default
    // (peerId fallback engages) — non-eth-only keystores in practice
    // mean no agent is registered yet, same end-state as a missing file.
    if (!parsed || typeof parsed !== 'object') return { kind: 'unusable' };
    return { kind: 'absent' };
  }

  let chosenKey: string;
  if (keys.length === 1) {
    chosenKey = keys[0];
  } else {
    const explicit = resolveExplicitAddress(explicitAddress);
    if (!explicit) throw new MultipleAgentsError(keys);
    const match = keys.find((k) => k === explicit);
    if (!match) throw new MultipleAgentsError(keys);
    chosenKey = match;
  }

  // T67 — Collect ALL entries whose key matches the chosen lowercase eth
  // (case-insensitive). For each, try to extract a usable `authToken`;
  // return the first one. If every match is malformed, return 'unusable'.
  const obj = parsed as Record<string, unknown>;
  const matchingEntries = Object.entries(obj).filter(([k]) => k.toLowerCase() === chosenKey);
  for (const [, entry] of matchingEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const tok = (entry as Record<string, unknown>).authToken;
    if (typeof tok === 'string' && tok.length > 0) {
      return { kind: 'token', authToken: tok };
    }
  }
  return { kind: 'unusable' };
}
