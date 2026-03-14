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
  const envRaw = process.env.DKG_API_PORT?.trim();
  if (envRaw) return parsePort(envRaw);

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
