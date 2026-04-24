// Registry client: talks to the public DKG integration registry
// (https://github.com/OriginTrail/dkg-integrations) over HTTPS.
//
// List goes via the GitHub Contents API; individual entries go via raw.githubusercontent.com.
// Both can be overridden via DKG_REGISTRY_INDEX_URL / DKG_REGISTRY_RAW_BASE for offline
// tests and staging registries. If GITHUB_TOKEN is set we pass it so unauthenticated
// rate limits (60 req/hr) don't hit contributor shells behind shared NATs.

import { IntegrationEntry, isIntegrationEntry } from './schema.js';

const DEFAULT_INDEX_URL =
  'https://api.github.com/repos/OriginTrail/dkg-integrations/contents/integrations?ref=main';
const DEFAULT_RAW_BASE =
  'https://raw.githubusercontent.com/OriginTrail/dkg-integrations/main/integrations';

export interface RegistryConfig {
  indexUrl: string;
  rawBase: string;
  githubToken?: string;
}

export function resolveRegistryConfig(env: NodeJS.ProcessEnv = process.env): RegistryConfig {
  return {
    indexUrl: env.DKG_REGISTRY_INDEX_URL ?? DEFAULT_INDEX_URL,
    rawBase: env.DKG_REGISTRY_RAW_BASE ?? DEFAULT_RAW_BASE,
    githubToken: env.GITHUB_TOKEN || env.GH_TOKEN,
  };
}

function headers(cfg: RegistryConfig, accept: string): HeadersInit {
  const h: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'dkg-cli-integrations/1',
  };
  if (cfg.githubToken) h.Authorization = `Bearer ${cfg.githubToken}`;
  return h;
}

// Lists every *.json entry in the registry except the TEMPLATE.json scaffold.
// Returns just the slugs; callers fetch full entries on demand.
export async function listSlugs(cfg: RegistryConfig): Promise<string[]> {
  const res = await fetch(cfg.indexUrl, { headers: headers(cfg, 'application/vnd.github+json') });
  if (!res.ok) {
    throw new Error(
      `Failed to list registry entries: ${res.status} ${res.statusText}. ` +
        `Check that the registry is reachable (${cfg.indexUrl}) and, if rate-limited, set GITHUB_TOKEN.`,
    );
  }
  const body = (await res.json()) as Array<{ name: string; type?: string }>;
  if (!Array.isArray(body)) {
    throw new Error(`Registry index did not return an array. Got: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body
    .filter((f) => f.type !== 'dir' && f.name.endsWith('.json') && f.name !== 'TEMPLATE.json')
    .map((f) => f.name.replace(/\.json$/, ''))
    .sort();
}

export async function fetchEntry(slug: string, cfg: RegistryConfig): Promise<IntegrationEntry> {
  // Slug constraints mirror the registry schema; guard against directory-traversal sneaking in.
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) {
    throw new Error(`Invalid slug "${slug}". Expected lowercase, digits, and hyphens only.`);
  }
  const url = `${cfg.rawBase}/${slug}.json`;
  const res = await fetch(url, { headers: headers(cfg, 'application/json') });
  if (res.status === 404) {
    throw new Error(`Integration "${slug}" not found in the registry (${url}).`);
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch ${slug}: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  if (!isIntegrationEntry(body)) {
    throw new Error(
      `Registry entry for "${slug}" does not match the expected shape. ` +
        `The CLI may be out of date; check your dkg-integrations schema version.`,
    );
  }
  return body;
}

export async function fetchAllEntries(cfg: RegistryConfig): Promise<IntegrationEntry[]> {
  const slugs = await listSlugs(cfg);
  return Promise.all(slugs.map((s) => fetchEntry(s, cfg)));
}
