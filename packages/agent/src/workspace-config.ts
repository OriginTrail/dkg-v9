/**
 * Workspace configuration loader (spec §22 — AGENT_ONBOARDING).
 *
 * Discovers the active workspace's DKG configuration using the three-step
 * priority order documented in the spec:
 *
 *   1. `<workspace>/.dkg/config.yaml`       (preferred)
 *   2. `<workspace>/.dkg/config.json`       (machine-generated fallback)
 *   3. `<workspace>/AGENTS.md` YAML frontmatter under a top-level `dkg:` key
 *
 * The loader performs schema validation, applies defaults, and returns a
 * normalised `WorkspaceConfig` so the rest of the agent can consume a
 * stable shape regardless of source file. See A-13 in
 * `.test-audit/BUGS_FOUND.md` for the audit context that motivated this
 * module.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

const EXTRACTION_POLICIES = new Set([
  'structural-only',
  'structural-plus-semantic',
  'semantic-required',
] as const);

export type ExtractionPolicy = 'structural-only' | 'structural-plus-semantic' | 'semantic-required';

export interface WorkspaceConfig {
  contextGraph: string;
  node: string;
  autoShare: boolean;
  extractionPolicy: ExtractionPolicy;
}

export interface LoadedWorkspaceConfig {
  source: string;
  cfg: WorkspaceConfig;
}

/**
 * Validate a raw parsed config object and apply defaults. Throws with a
 * descriptive error if the schema is violated.
 */
export function parseWorkspaceConfig(raw: unknown): WorkspaceConfig {
  if (raw == null || typeof raw !== 'object') {
    throw new Error('workspace config: root must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const contextGraph = obj.contextGraph;
  const node = obj.node;
  if (typeof contextGraph !== 'string' || contextGraph.length === 0) {
    throw new Error('workspace config: `contextGraph` is required (string)');
  }
  if (typeof node !== 'string' || node.length === 0) {
    throw new Error('workspace config: `node` is required (string)');
  }
  const autoShare = obj.autoShare ?? true;
  if (typeof autoShare !== 'boolean') {
    throw new Error('workspace config: `autoShare` must be boolean');
  }
  const extractionPolicy = (obj.extractionPolicy as string | undefined) ?? 'structural-plus-semantic';
  if (!EXTRACTION_POLICIES.has(extractionPolicy as ExtractionPolicy)) {
    throw new Error(
      `workspace config: \`extractionPolicy\` must be one of ${[...EXTRACTION_POLICIES].join(', ')}`,
    );
  }
  return {
    contextGraph,
    node,
    autoShare,
    extractionPolicy: extractionPolicy as ExtractionPolicy,
  };
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/**
 * Extract the `dkg:` block from AGENTS.md YAML frontmatter. Accepts a
 * full-file source string and returns the validated config.
 */
export function parseAgentsMdFrontmatter(src: string): WorkspaceConfig {
  const m = FRONTMATTER_RE.exec(src);
  if (!m) throw new Error('AGENTS.md: missing YAML frontmatter');
  const fm = yaml.load(m[1]) as Record<string, unknown> | null;
  if (!fm || typeof fm !== 'object' || !('dkg' in fm)) {
    throw new Error('AGENTS.md frontmatter: missing `dkg` key');
  }
  return parseWorkspaceConfig(fm.dkg);
}

function pathExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the workspace config from `workspaceDir`, following spec §22
 * priority order. Returns the path of the source file alongside the
 * validated config. Throws if no recognised config is found.
 */
export function loadWorkspaceConfig(workspaceDir: string): LoadedWorkspaceConfig {
  const yml = join(workspaceDir, '.dkg', 'config.yaml');
  if (pathExists(yml)) {
    const parsed = yaml.load(readFileSync(yml, 'utf8'));
    return { source: yml, cfg: parseWorkspaceConfig(parsed) };
  }
  const jsn = join(workspaceDir, '.dkg', 'config.json');
  if (pathExists(jsn)) {
    const parsed = JSON.parse(readFileSync(jsn, 'utf8'));
    return { source: jsn, cfg: parseWorkspaceConfig(parsed) };
  }
  const md = join(workspaceDir, 'AGENTS.md');
  if (pathExists(md)) {
    return { source: md, cfg: parseAgentsMdFrontmatter(readFileSync(md, 'utf8')) };
  }
  throw new Error(
    `loadWorkspaceConfig: no workspace configuration found under ${workspaceDir}`,
  );
}
