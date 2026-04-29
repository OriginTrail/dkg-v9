// Shared scope-check library. Zero runtime dependencies; must work from
// Cursor hooks, Claude Code hooks, git hooks, CLI, and CI. Node 20+.
//
// Source of truth (post-DKG-integration):
//   The agent's "active scope" is derived live from the local DKG daemon —
//   specifically, the union of `tasks:scopedToPath` globs across every
//   `tasks:Task` whose current status is `"in_progress"` AND which is
//   attributed to this agent (`prov:wasAttributedTo <agent-uri>`).
//   See `agent-scope/lib/dkg-source.mjs` for the SPARQL + cache layer.
//
//   Legacy local files (`agent-scope/active`, `agent-scope/tasks/*.json`)
//   are GONE — there is no fallback path. If the daemon is unreachable or
//   the workspace's `.dkg/config.yaml` is incomplete, the guard falls open
//   for non-protected paths (only the hardcoded protected list still
//   applies). Hardcoded protected paths defend the guard's own files;
//   they're disabled only by bootstrap mode.
//
// Bootstrap mode (disables hardcoded protection):
//   1. env: AGENT_SCOPE_BOOTSTRAP=1
//   2. file: agent-scope/.bootstrap-token exists
//   The token file is itself protected — only the human can create / remove
//   it from outside the agent sandbox.

import { existsSync } from 'node:fs';
import { resolve, relative, sep, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  resolveDkgScope, readCachedScopeSync, loadDkgWorkspaceConfig, describeScope,
} from './dkg-source.mjs';

// ---------------------------------------------------------------------------
// Node version check
// ---------------------------------------------------------------------------

const MIN_NODE_MAJOR = 20;

export function checkNodeVersion(minMajor = MIN_NODE_MAJOR) {
  const m = /^v(\d+)\./.exec(process.version);
  const major = m ? parseInt(m[1], 10) : 0;
  if (major < minMajor) {
    throw new Error(
      `agent-scope requires Node ${minMajor}+ but found ${process.version}. ` +
      `Update Node (nvm install 22) and retry.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Protected paths (always-on, regardless of active task)
// ---------------------------------------------------------------------------

export const PROTECTED_PATTERNS = [
  '.cursor/hooks/**',
  '.cursor/hooks.json',
  '.cursor/rules/agent-scope.mdc',
  '.claude/hooks/**',
  '.claude/settings.json',
  'agent-scope/lib/**',
  'agent-scope/.bootstrap-token',
  'AGENTS.md',
  'GEMINI.md',
  '.cursorrules',
];

function bootstrapActive(root) {
  if (process.env.AGENT_SCOPE_BOOTSTRAP === '1') return true;
  try {
    const p = resolve(root || resolveRepoRoot(), 'agent-scope/.bootstrap-token');
    return existsSync(p);
  } catch { return false; }
}

export function isBootstrapActive(root) { return bootstrapActive(root); }

export function checkProtected(relPath, root) {
  if (!relPath || typeof relPath !== 'string') return 'deny';
  if (bootstrapActive(root)) return 'allow';
  for (const pattern of PROTECTED_PATTERNS) {
    if (globToRegex(pattern).test(relPath)) return 'deny';
  }
  return 'allow';
}

// Returns true if `relPath` is a directory that CONTAINS any protected path
// (i.e. a destructive recursive op against it would wipe protected files).
// Used by the pre-shell hook for `rm -rf <dir>`, `find <dir> -delete`, etc.
export function coversProtected(relPath, root) {
  if (!relPath || typeof relPath !== 'string') return false;
  if (bootstrapActive(root)) return false;
  const norm = relPath.replace(/\/+$/, '');
  if (!norm) return false;
  const prefix = norm + '/';
  for (const pattern of PROTECTED_PATTERNS) {
    const literal = pattern
      .replace(/\/\*\*\/?$/, '/')
      .replace(/\/\*$/, '/')
      .replace(/\*+/g, '');
    if (!literal) continue;
    if (literal === norm || literal === prefix) return true;
    if (literal.startsWith(prefix)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Glob → RegExp (no deps)
// ---------------------------------------------------------------------------

function globToRegex(glob) {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (glob[i] === '/') i++;
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+^$(){}|[]\\'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += '$';
  return new RegExp(re);
}

function matchAnyPositive(patterns, relPath) {
  if (!Array.isArray(patterns)) return null;
  for (const p of patterns) {
    if (typeof p !== 'string' || p.startsWith('!')) continue;
    if (globToRegex(p).test(relPath)) return p;
  }
  return null;
}

function matchAnyNegation(patterns, relPath) {
  if (!Array.isArray(patterns)) return null;
  for (const p of patterns) {
    if (typeof p !== 'string' || !p.startsWith('!')) continue;
    if (globToRegex(p.slice(1)).test(relPath)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Path + repo root
// ---------------------------------------------------------------------------

export function resolveRepoRoot(startDir) {
  if (process.env.AGENT_SCOPE_ROOT) return process.env.AGENT_SCOPE_ROOT;
  let dir = startDir || process.cwd();
  for (let i = 0; i < 64; i++) {
    if (existsSync(resolve(dir, 'agent-scope'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir || process.cwd();
}

export function normalizeToRepoPath(root, p) {
  if (!p) return '';
  const abs = isAbsolute(p) ? p : resolve(root, p);
  let rel = relative(root, abs);
  if (sep !== '/') rel = rel.split(sep).join('/');
  return rel;
}

// ---------------------------------------------------------------------------
// Active scope resolution (DKG-backed)
// ---------------------------------------------------------------------------
//
// Two flavours:
//
//   `resolveActiveScope({ root, force })`    async — queries the daemon if
//                                            cache is stale; preferred for
//                                            session-start where we want a
//                                            fresh snapshot.
//
//   `resolveActiveScopeSync({ root })`       sync — reads cache only; falls
//                                            through to a "soft" empty
//                                            scope if cache missing or
//                                            expired. Use from sync-only
//                                            hook contexts (rare); normally
//                                            prefer the async variant.
//
// Both return a "synthetic task" object compatible with the legacy
// `loadTask` shape, so callers just keep using `checkPath(task, ...)`.
//
// Synthetic task shape:
//   {
//     id:         <human-friendly id derived from real task URIs>,
//     dkgTaskUris: [<urn:dkg:task:...>, ...],
//     description: <one-line summary>,
//     allowed:    [...positive globs unioned across all in_progress tasks],
//     exemptions: [...negative ('!...') globs unioned across all in_progress tasks],
//     reason:     'ok' | 'no-active-task' | 'daemon-unreachable' | ...,
//     diagnostic: optional string for surfacing in denial messages,
//   }
//
// `reason !== 'ok'` is NOT itself an error — it just means "no scope is
// active right now". Callers decide whether that means deny-everything or
// allow-everything based on their own policy. Current policy: no active
// scope ⇒ allow non-protected writes (legacy default before agent-scope
// took over). The team can tighten that later by emitting a `dkg:setting`
// triple on the project.

export async function resolveActiveScope({ root, force = false } = {}) {
  const repoRoot = root || resolveRepoRoot();
  const dkg = await resolveDkgScope({ root: repoRoot, force });
  return synthesisTask(dkg);
}

export function resolveActiveScopeSync({ root } = {}) {
  const repoRoot = root || resolveRepoRoot();
  const dkg = readCachedScopeSync({ root: repoRoot });
  return synthesisTask(dkg);
}

function synthesisTask(dkg) {
  const tasks = Array.isArray(dkg.tasks) ? dkg.tasks : [];
  if (tasks.length === 0) {
    return {
      id: null,
      dkgTaskUris: [],
      description: dkg.diagnostic || 'No in_progress task',
      allowed: [],
      exemptions: [],
      reason: dkg.reason || 'no-active-task',
      diagnostic: dkg.diagnostic || null,
      agentUri: dkg.agentUri || null,
      projectId: dkg.projectId || null,
      stale: !!dkg.stale,
      fromCache: !!dkg.fromCache,
    };
  }
  const niceId = tasks.length === 1
    ? tasks[0].uri.split(':').pop()
    : `${tasks.length} in-progress tasks`;
  const description = tasks.length === 1
    ? tasks[0].title
    : tasks.map((t) => `${t.title}`).join(' · ');
  return {
    id: niceId,
    dkgTaskUris: tasks.map((t) => t.uri),
    tasks,
    description,
    allowed: dkg.allowed,
    exemptions: dkg.exemptions,
    reason: 'ok',
    diagnostic: null,
    agentUri: dkg.agentUri,
    projectId: dkg.projectId,
    stale: !!dkg.stale,
    fromCache: !!dkg.fromCache,
  };
}

// ---------------------------------------------------------------------------
// Backwards-compatible shims
// ---------------------------------------------------------------------------
//
// Older hook code calls `resolveActiveTaskId(root)` then `loadTask(root, id)`
// then `checkPath(task, rel, root)`. With the DKG flip, those calls collapse
// into a single async query — but we keep the names so callers don't all
// need to change at once.
//
// `resolveActiveTaskId(root)`  → sync-only, reads cache; returns
//                                `{ id, source, scope }`.
// `loadTask(root, id, scope?)` → no-op if `scope` is passed (we already
//                                resolved it). When `scope` is omitted,
//                                does a sync cache read for backwards
//                                compatibility.
// `checkPath(task, ...)`       → unchanged (works on the synthetic task).

export function resolveActiveTaskId(root, _opts = {}) {
  const scope = resolveActiveScopeSync({ root });
  if (scope.reason === 'ok') {
    return { id: scope.id, source: scope.fromCache ? 'dkg-cache' : 'dkg', scope };
  }
  return { id: null, source: scope.reason, scope };
}

export function loadTask(root, _id, scope) {
  if (scope) return scope;
  // Last-ditch sync read of cache when caller didn't pass a pre-resolved
  // scope. Hooks that have access to async should prefer
  // `resolveActiveScope({ root, force })`.
  return resolveActiveScopeSync({ root });
}

export function getActiveTaskId(root) {
  return resolveActiveTaskId(root).id;
}

// ---------------------------------------------------------------------------
// Core path decision
// ---------------------------------------------------------------------------

export function checkPath(task, relPath, root) {
  if (typeof relPath !== 'string' || relPath.length === 0) return 'deny';
  if (relPath.includes('..')) return 'deny';

  if (checkProtected(relPath, root) === 'deny') return 'protected';

  // No active scope ⇒ allow non-protected writes (soft default before any
  // task is in_progress; matches the legacy file-based behaviour).
  if (!task || task.reason !== 'ok') return 'allow';

  if (matchAnyNegation(task.allowed, relPath)) return 'deny';
  if (matchAnyNegation(task.exemptions, relPath)) return 'deny';
  if (matchAnyPositive(task.exemptions, relPath)) return 'exempt';
  if (matchAnyPositive(task.allowed, relPath)) return 'allow';
  return 'deny';
}

export function explainDeny(task, relPath, decision) {
  if (decision === 'protected') {
    return [
      `PROTECTED PATH — write blocked by system policy.`,
      `Path: ${relPath}`,
      ``,
      `This path is part of the agent-scope enforcement system. Modifying it`,
      `would weaken the very mechanism that keeps agent work in-scope, so`,
      `writes are blocked regardless of the active task.`,
      ``,
      `If this change is legitimate (e.g. you're improving agent-scope itself),`,
      `ask the user to enable bootstrap mode (touch agent-scope/.bootstrap-token`,
      `in their own terminal, or set AGENT_SCOPE_BOOTSTRAP=1 in their env).`,
      ``,
      `Protected patterns:`,
      ...PROTECTED_PATTERNS.map((p) => `  - ${p}`),
    ].join('\n');
  }
  if (!task || task.reason !== 'ok') return '';

  const positives = (task.allowed || []).filter((p) => !p.startsWith('!'));
  const negatives = (task.allowed || []).filter((p) => p.startsWith('!'))
    .concat((task.exemptions || []).filter((p) => p.startsWith('!')));
  const exemptions = (task.exemptions || []).filter((p) => !p.startsWith('!'));

  const header = task.dkgTaskUris && task.dkgTaskUris.length === 1
    ? `Active in-progress task: ${task.dkgTaskUris[0]} — ${task.description || ''}`
    : `Active in-progress tasks (${task.dkgTaskUris?.length || 0}):\n${(task.tasks || []).map((t) => `  - ${t.uri} — ${t.title}`).join('\n')}`;

  const lines = [
    `OUT OF TASK SCOPE.`,
    header,
    `Denied path: ${relPath}`,
    ``,
    `The current scope only permits writes to paths matching:`,
    ...(positives.length ? positives.map((p) => `  - ${p}`) : ['  (nothing)']),
  ];
  if (exemptions.length) {
    lines.push('', 'Exempted patterns (always allowed):', ...exemptions.map((p) => `  - ${p}`));
  }
  if (negatives.length) {
    lines.push('', 'Explicit deny patterns:', ...negatives.map((p) => `  - ${p}`));
  }
  lines.push(
    '',
    `If this change is needed for current work, STOP and ask the user. The agent`,
    `extends scope by editing the relevant DKG task: call`,
    `\`dkg_add_task\` (with status:"in_progress" and a covering glob in scopedToPath)`,
    `for a new piece of work, or — if the user agrees — re-file the existing`,
    `task with an extended scope. Do NOT improvise around denials.`,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Convenience entry-point used by the standalone status CLI / pre-commit
// ---------------------------------------------------------------------------

export async function checkPathFromAnywhere(p, opts = {}) {
  const root = opts.root || resolveRepoRoot();
  const scope = await resolveActiveScope({ root, force: opts.force });
  const rel = normalizeToRepoPath(root, p);
  return {
    root,
    taskId: scope.id,
    task: scope,
    relPath: rel,
    decision: checkPath(scope, rel, root),
  };
}

export const __scopeLibFile = fileURLToPath(import.meta.url);

// Re-export the workspace helpers so legacy callers don't need to learn the
// `dkg-source` module name.
export { loadDkgWorkspaceConfig, describeScope };
