// agent-scope/lib/dkg-source.mjs
//
// Resolves the agent's "active scope" from the local DKG daemon, replacing
// the legacy file-based flow (`agent-scope/active` + `agent-scope/tasks/*.json`).
//
// Source of truth: `tasks:Task` entities authored by the agent on this
// project's `tasks` sub-graph. A task is *active* (and therefore contributes
// its `tasks:scopedToPath` globs to the live allow-list) when:
//
//   1. Its current `tasks:status` is `"in_progress"`. (See note on
//      replace-semantics below.)
//   2. It is attributed to THIS agent's URI via `prov:wasAttributedTo`.
//
// Multiple in_progress tasks attributed to the same agent → the union of
// their `tasks:scopedToPath` globs forms the live scope. Zero in_progress
// tasks → no active scope (the legacy "no task = anything goes (except
// protected)" default applies).
//
// Replace semantics: `dkg_add_task` and `dkg_update_task_status` both write
// `tasks:status` into a dedicated assertion (`task-status-<uri-tail>`) that
// is `discardAssertion`'d before each write. So the daemon's main /query
// endpoint sees exactly one `tasks:status` triple per task at any given
// moment — no need for the SPARQL query itself to disambiguate by timestamp.
// (See packages/mcp-dkg/src/tools/writes.ts for the matching write code.)
//
// Cache: hooks fire many times per session and a SPARQL round-trip costs
// ~30–80ms; we cache the resolved scope for CACHE_TTL_MS in
// ~/.cache/agent-scope/scope-<projectId>-<agentSuffix>.json. Cache is keyed
// off both project and agent so multi-project / multi-operator setups don't
// cross-pollinate.

import { readFileSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_API = 'http://localhost:9200';
const CACHE_TTL_MS = 5_000;
const QUERY_TIMEOUT_MS = 4_000;
const CACHE_DIR = path.join(os.homedir(), '.cache', 'agent-scope');

// ---------------------------------------------------------------------------
// .dkg/config.yaml loader (slim, hook-friendly — no deps)
// ---------------------------------------------------------------------------
//
// Walks upward from `start` looking for `.dkg/config.yaml`. Same shape as
// the canonical TS loader in `packages/mcp-dkg/src/config.ts` but inlined
// here so agent-scope stays a zero-runtime-dep library that works from any
// hook context.

function findConfigFile(start) {
  let dir = path.resolve(start);
  const root = path.parse(dir).root;
  for (let i = 0; i < 64; i++) {
    const candidate = path.join(dir, '.dkg', 'config.yaml');
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// Hand-rolled subset of YAML good enough for `.dkg/config.yaml`. Mirrors
// the parser in `packages/mcp-dkg/hooks/capture-chat.mjs` so behaviour stays
// consistent. Two-space indented mapping, scalar leaves, optional quotes.
export function parseDotDkgConfig(yamlText) {
  const lines = String(yamlText || '').split(/\r?\n/);
  const cfg = { node: {}, agent: {}, capture: {} };
  const stack = [cfg];
  const indents = [-1];
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^ */)[0].length;
    while (indents.length > 1 && indent <= indents[indents.length - 1]) {
      stack.pop();
      indents.pop();
    }
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const valRaw = m[2];
    const parent = stack[stack.length - 1];
    if (valRaw === '' || valRaw === undefined) {
      parent[key] = {};
      stack.push(parent[key]);
      indents.push(indent);
    } else {
      const val = valRaw.replace(/^["']|["']$/g, '').trim();
      if (val === 'true') parent[key] = true;
      else if (val === 'false') parent[key] = false;
      else if (/^-?\d+$/.test(val)) parent[key] = parseInt(val, 10);
      else parent[key] = val;
    }
  }
  return cfg;
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function readTokenFile(filePath, configDir) {
  try {
    const expanded = expandHome(filePath);
    const abs = isAbsolute(expanded) ? expanded : resolve(configDir, expanded);
    const raw = readFileSync(abs, 'utf8');
    const line = raw.split('\n').find((l) => l.trim() && !l.startsWith('#'));
    return line ? line.trim() : null;
  } catch {
    return null;
  }
}

export function loadDkgWorkspaceConfig(repoRoot) {
  const cwd = repoRoot || process.cwd();
  const cfgPath = findConfigFile(cwd);
  let fromFile = { node: {}, agent: {}, capture: {} };
  if (cfgPath) {
    try {
      fromFile = parseDotDkgConfig(readFileSync(cfgPath, 'utf8'));
    } catch {
      /* malformed yaml — fall through to env */
    }
  }
  const envApi = process.env.DKG_API ?? process.env.DEVNET_API;
  const envToken = process.env.DKG_TOKEN ?? process.env.DEVNET_TOKEN ?? process.env.DKG_AUTH;
  const envProject = process.env.DKG_PROJECT;
  const envAgent = process.env.DKG_AGENT_URI;

  // Token resolution: literal `node.token` wins, then `node.tokenFile`, then env.
  let token = fromFile.node?.token || '';
  if (!token && fromFile.node?.tokenFile && cfgPath) {
    token = readTokenFile(fromFile.node.tokenFile, dirname(cfgPath)) || '';
  }
  if (!token) token = envToken || '';

  // File wins over env for project/api/agent (matches the TS loader's policy).
  return {
    api: fromFile.node?.api || envApi || DEFAULT_API,
    token,
    projectId: fromFile.contextGraph || fromFile.project || envProject || null,
    agentUri: fromFile.agent?.uri || envAgent || null,
    sourcePath: cfgPath,
  };
}

// ---------------------------------------------------------------------------
// SPARQL query
// ---------------------------------------------------------------------------

const SCOPE_QUERY = `
PREFIX tasks: <http://dkg.io/ontology/tasks/>
PREFIX prov:  <http://www.w3.org/ns/prov#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?task ?title ?modified ?scope WHERE {
  ?task a tasks:Task ;
        tasks:status "in_progress" ;
        prov:wasAttributedTo ?AGENT .
  OPTIONAL { ?task rdfs:label ?title }
  OPTIONAL { ?task dcterms:modified ?modified }
  OPTIONAL { ?task tasks:scopedToPath ?scope }
}
`;

function bindingValue(cell) {
  if (cell == null) return '';
  if (typeof cell === 'string') return cell;
  return cell.value ?? '';
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function querySparqlForActiveTasks({ api, token, projectId, agentUri }) {
  const body = {
    sparql: SCOPE_QUERY.replace(/\?AGENT/g, `<${agentUri}>`),
    contextGraphId: projectId,
    includeSharedMemory: true,
  };
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchWithTimeout(
    `${api.replace(/\/$/, '')}/api/query`,
    { method: 'POST', headers, body: JSON.stringify(body) },
    QUERY_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(`daemon ${api} → HTTP ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  const bindings = json?.result?.bindings ?? [];

  // Aggregate per-task: SPARQL returns one row per (task, scope) so we
  // group on task URI and collect the scope list.
  const byTask = new Map();
  for (const b of bindings) {
    const uri = bindingValue(b.task);
    if (!uri) continue;
    if (!byTask.has(uri)) {
      byTask.set(uri, {
        uri,
        title: bindingValue(b.title) || uri,
        modified: bindingValue(b.modified) || null,
        scopedToPath: [],
      });
    }
    const entry = byTask.get(uri);
    const scope = bindingValue(b.scope);
    if (scope && !entry.scopedToPath.includes(scope)) entry.scopedToPath.push(scope);
  }
  return Array.from(byTask.values());
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function cachePathFor(projectId, agentUri) {
  // Mangle both into filesystem-safe suffixes; cap length so absurdly long
  // URIs don't break filename limits.
  const proj = String(projectId || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  const agent = String(agentUri || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  return path.join(CACHE_DIR, `scope-${proj}-${agent}.json`);
}

function readCache(filePath) {
  try {
    const stat = statSync(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(filePath, payload) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  } catch {
    /* cache write is best-effort; never fail the hook */
  }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Resolve the active agent-scope from the DKG.
 *
 * Returns:
 *   {
 *     agentUri, projectId,
 *     tasks: [{ uri, title, modified, scopedToPath: [..globs] }],
 *     allowed: [..unioned positive globs],
 *     exemptions: [..unioned bang-prefixed globs],
 *     reason: 'ok' | 'no-config' | 'no-agent' | 'no-project' |
 *             'daemon-unreachable' | 'no-active-task',
 *     diagnostic?: string,
 *     fromCache: boolean,
 *   }
 *
 * `reason` is what the hook should surface to the user when scope
 * resolution didn't yield active tasks. The hook NEVER throws — fail-open
 * for daemon unreachable (treated as no active task) so a daemon outage
 * doesn't bleed into the agent's tooling.
 */
export async function resolveDkgScope({ root, force = false } = {}) {
  const cfg = loadDkgWorkspaceConfig(root);
  if (!cfg.sourcePath && !cfg.projectId && !cfg.agentUri) {
    return makeEmpty(cfg, 'no-config', 'No `.dkg/config.yaml` found in the workspace and no DKG_PROJECT/DKG_AGENT_URI in env. agent-scope guard is in soft mode (only protected paths blocked).');
  }
  if (!cfg.projectId) {
    return makeEmpty(cfg, 'no-project', 'No `contextGraph:` pinned in `.dkg/config.yaml` (and no DKG_PROJECT in env). agent-scope guard is in soft mode (only protected paths blocked).');
  }
  if (!cfg.agentUri) {
    return makeEmpty(cfg, 'no-agent', 'No `agent.uri` configured in `.dkg/config.yaml` (and no DKG_AGENT_URI in env). agent-scope guard is in soft mode (only protected paths blocked).');
  }

  const cacheFile = cachePathFor(cfg.projectId, cfg.agentUri);
  if (!force) {
    const cached = readCache(cacheFile);
    if (cached) return { ...cached, fromCache: true };
  }

  let tasks;
  try {
    tasks = await querySparqlForActiveTasks(cfg);
  } catch (err) {
    return makeEmpty(cfg, 'daemon-unreachable',
      `DKG daemon unreachable at ${cfg.api}: ${err?.message || err}. agent-scope guard is in soft mode (only protected paths blocked) until the daemon is back.`);
  }

  if (!tasks.length) {
    const empty = makeEmpty(cfg, 'no-active-task',
      `No \`tasks:Task\` with status "in_progress" attributed to \`${cfg.agentUri}\` on project \`${cfg.projectId}\`. Create one with \`dkg_add_task\` (status: "in_progress", scopedToPath: [...]) when you start work.`);
    writeCache(cacheFile, empty);
    return empty;
  }

  const allowed = [];
  const exemptions = [];
  for (const t of tasks) {
    for (const g of t.scopedToPath) {
      if (typeof g !== 'string' || !g) continue;
      if (g.startsWith('!')) {
        if (!exemptions.includes(g)) exemptions.push(g);
      } else {
        if (!allowed.includes(g)) allowed.push(g);
      }
    }
  }

  const result = {
    agentUri: cfg.agentUri,
    projectId: cfg.projectId,
    tasks,
    allowed,
    exemptions,
    reason: 'ok',
    fromCache: false,
  };
  writeCache(cacheFile, result);
  return result;
}

function makeEmpty(cfg, reason, diagnostic) {
  return {
    agentUri: cfg.agentUri || null,
    projectId: cfg.projectId || null,
    tasks: [],
    allowed: [],
    exemptions: [],
    reason,
    diagnostic,
    fromCache: false,
  };
}

/**
 * Synchronous, sync-IO-only variant the hook can call when async/await
 * would be inconvenient (e.g. shell-precheck reads stdin synchronously).
 * Reads cache only — never queries the daemon. Falls through with `reason:
 * "stale"` if the cache is missing or expired so the caller can decide
 * whether to async-refresh or fail open.
 */
export function readCachedScopeSync({ root } = {}) {
  const cfg = loadDkgWorkspaceConfig(root);
  if (!cfg.projectId || !cfg.agentUri) {
    return { ...makeEmpty(cfg, 'no-config', 'no project / agent configured'), fromCache: false, stale: false };
  }
  const cacheFile = cachePathFor(cfg.projectId, cfg.agentUri);
  const cached = readCache(cacheFile);
  if (cached) return { ...cached, fromCache: true, stale: false };
  return { ...makeEmpty(cfg, 'no-active-task', 'cache miss / expired; resolve async first'), fromCache: false, stale: true };
}

/**
 * Build a human-readable summary line for diagnostics / logs.
 */
export function describeScope(scope) {
  if (!scope) return 'agent-scope: <unresolved>';
  if (scope.reason !== 'ok') return `agent-scope: ${scope.reason}${scope.diagnostic ? ` — ${scope.diagnostic}` : ''}`;
  const tnames = scope.tasks.map((t) => t.title || t.uri.split(':').pop()).join(', ');
  return `agent-scope: ${scope.tasks.length} active task${scope.tasks.length === 1 ? '' : 's'} (${tnames}) → ${scope.allowed.length} allow + ${scope.exemptions.length} deny globs`;
}
