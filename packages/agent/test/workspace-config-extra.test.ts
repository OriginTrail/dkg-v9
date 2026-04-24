/**
 * Workspace configuration (`.dkg/config.yaml`) parsing + onboarding flow
 * pins, per dkgv10-spec/22_AGENT_ONBOARDING.md.
 *
 * Audit findings covered:
 *   A-13 (MEDIUM / SPEC-GAP) — the agent layer has no production code path
 *        that reads `.dkg/config.yaml` / `AGENTS.md` frontmatter and feeds
 *        it into `DKGAgent`. This is a pending onboarding feature. Until
 *        the feature lands, this file acts as the schema contract test:
 *
 *          1. Positive: valid YAML loads and satisfies the schema.
 *          2. Positive: `.dkg/config.json` fallback (priority 2) parses.
 *          3. Positive: AGENTS.md frontmatter (priority 3) parses.
 *          4. Negative: missing `contextGraph` is a schema error.
 *          5. Negative: missing `node` is a schema error.
 *          6. Negative: invalid `extractionPolicy` is rejected.
 *          7. SPEC-GAP: `packages/agent/src` ships no workspace-config
 *             loader module (no `workspace-config.ts`, no `loadConfig`
 *             export). Left RED so the gap is visible.
 *
 * No mocks — real `js-yaml` + filesystem + a hermetic tmpdir.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXTRACTION_POLICIES = new Set([
  'structural-only',
  'structural-plus-semantic',
  'semantic-required',
]);

interface WorkspaceConfig {
  contextGraph: string;
  node: string;
  autoShare: boolean;
  extractionPolicy: string;
}

// PR #229 follow-up: the suite originally shipped a LOCAL reference
// loader to keep the schema test green even before the production
// module landed (see SPEC-GAP test below). The production
// `workspace-config.ts` now exports the same surface AND has been
// extended (r21-4 / r22-5) to accept plain-Markdown AGENTS.md via a
// `dkg-config` fence. Re-bind the test names to the production
// exports so this suite actually exercises the shipping behaviour;
// otherwise our regression tests would pass against the local stub
// while the real code regresses unobserved.
import {
  parseWorkspaceConfig as parseWorkspaceConfigImpl,
  parseAgentsMdFrontmatter as parseAgentsMdFrontmatterImpl,
} from '../src/workspace-config.js';
const parseWorkspaceConfig = parseWorkspaceConfigImpl as unknown as (raw: unknown) => WorkspaceConfig;
const parseAgentsMdFrontmatter = parseAgentsMdFrontmatterImpl as unknown as (src: string) => WorkspaceConfig;

describe('A-13: workspace config schema (.dkg/config.yaml)', () => {
  it('parses a spec-compliant YAML with all fields', () => {
    const src = [
      'contextGraph: "my-project"',
      'node: "http://127.0.0.1:9201"',
      'autoShare: true',
      'extractionPolicy: "structural-plus-semantic"',
      '',
    ].join('\n');

    const cfg = parseWorkspaceConfig(yaml.load(src));
    expect(cfg).toEqual({
      contextGraph: 'my-project',
      node: 'http://127.0.0.1:9201',
      autoShare: true,
      extractionPolicy: 'structural-plus-semantic',
    });
  });

  it('applies defaults (autoShare=true, extractionPolicy=structural-plus-semantic)', () => {
    const src = [
      'contextGraph: "proj"',
      'node: "http://127.0.0.1:9201"',
    ].join('\n');
    const cfg = parseWorkspaceConfig(yaml.load(src));
    expect(cfg.autoShare).toBe(true);
    expect(cfg.extractionPolicy).toBe('structural-plus-semantic');
  });

  it('allows autoShare=false', () => {
    const src = [
      'contextGraph: "p"',
      'node: "http://n"',
      'autoShare: false',
    ].join('\n');
    const cfg = parseWorkspaceConfig(yaml.load(src));
    expect(cfg.autoShare).toBe(false);
  });

  it('rejects config missing `contextGraph`', () => {
    const src = 'node: "http://127.0.0.1:9201"';
    expect(() => parseWorkspaceConfig(yaml.load(src))).toThrow(/contextGraph/);
  });

  it('rejects config missing `node`', () => {
    const src = 'contextGraph: "p"';
    expect(() => parseWorkspaceConfig(yaml.load(src))).toThrow(/node/);
  });

  it('rejects config with unsupported `extractionPolicy`', () => {
    const src = [
      'contextGraph: "p"',
      'node: "http://n"',
      'extractionPolicy: "bogus"',
    ].join('\n');
    expect(() => parseWorkspaceConfig(yaml.load(src))).toThrow(/extractionPolicy/);
  });

  it('rejects non-boolean `autoShare`', () => {
    const src = [
      'contextGraph: "p"',
      'node: "http://n"',
      'autoShare: "yes"',
    ].join('\n');
    expect(() => parseWorkspaceConfig(yaml.load(src))).toThrow(/autoShare/);
  });
});

describe('A-13: alternative config locations', () => {
  it('parses `.dkg/config.json` (priority 2)', () => {
    const raw = JSON.parse(
      '{"contextGraph":"p","node":"http://n","autoShare":false,"extractionPolicy":"structural-only"}',
    );
    const cfg = parseWorkspaceConfig(raw);
    expect(cfg).toEqual({
      contextGraph: 'p',
      node: 'http://n',
      autoShare: false,
      extractionPolicy: 'structural-only',
    });
  });

  it('parses AGENTS.md frontmatter (priority 3)', () => {
    const md = [
      '---',
      'dkg:',
      '  contextGraph: "my-project"',
      '  node: "http://127.0.0.1:9201"',
      '  autoShare: true',
      '---',
      '',
      '# Project Agents',
      '',
      'This project uses DKG shared memory.',
    ].join('\n');
    const cfg = parseAgentsMdFrontmatter(md);
    expect(cfg.contextGraph).toBe('my-project');
    expect(cfg.node).toBe('http://127.0.0.1:9201');
    expect(cfg.autoShare).toBe(true);
  });

  it('rejects AGENTS.md with no frontmatter AND no dkg-config fence', () => {
    const md = '# just a heading\n';
    // PR #229 bot review (r21-4): the diagnostic now mentions BOTH
    // carriers because we tried both before failing.
    expect(() => parseAgentsMdFrontmatter(md)).toThrow(
      /frontmatter|dkg-config/,
    );
  });

  it('rejects AGENTS.md frontmatter missing `dkg:` key when no fence is present either', () => {
    const md = ['---', 'title: foo', '---', '# body'].join('\n');
    expect(() => parseAgentsMdFrontmatter(md)).toThrow(/dkg/);
  });

  // PR #229 bot review (r21-4 / r22-5): the AGENTS.md convention used
  // by Cursor / Continue / Codex CLI is plain Markdown WITHOUT
  // frontmatter. The pre-r21-4 code threw "missing YAML frontmatter"
  // and the documented third lookup tier was therefore unusable for
  // the projects that actually rely on it as a workspace-config
  // carrier. The fenced ```dkg-config``` block is the supported
  // alternate carrier.
  it('PR #229 bugbot: parses plain-Markdown AGENTS.md via a ```dkg-config``` fence', () => {
    const md = [
      '# Project Agents',
      '',
      'This project uses DKG shared memory.',
      '',
      '```dkg-config',
      'contextGraph: "fence-only"',
      'node: "http://127.0.0.1:9201"',
      'autoShare: false',
      '```',
    ].join('\n');
    const cfg = parseAgentsMdFrontmatter(md);
    expect(cfg.contextGraph).toBe('fence-only');
    expect(cfg.node).toBe('http://127.0.0.1:9201');
    expect(cfg.autoShare).toBe(false);
  });

  it('PR #229 bugbot: also accepts ```yaml dkg-config``` and ```json dkg-config``` info-string variants', () => {
    const yml = [
      '# header',
      '```yaml dkg-config',
      'contextGraph: "yaml-fence"',
      'node: "http://n"',
      '```',
    ].join('\n');
    expect(parseAgentsMdFrontmatter(yml).contextGraph).toBe('yaml-fence');

    const json = [
      '# header',
      '```json dkg-config',
      '{ "contextGraph": "json-fence", "node": "http://n" }',
      '```',
    ].join('\n');
    expect(parseAgentsMdFrontmatter(json).contextGraph).toBe('json-fence');
  });

  // PR #229 bot review (r22-5): when AGENTS.md has unrelated
  // frontmatter (extremely common for tags/owner/prompt metadata in
  // the AI-agent ecosystem) but the dkg config lives in a fenced
  // block below, the loader MUST fall through to the fence parser
  // instead of throwing on the missing top-level `dkg:` key.
  it('PR #229 bugbot: falls through to fence when frontmatter exists but lacks `dkg:` key', () => {
    const md = [
      '---',
      'title: project notes',
      'owner: alice',
      '---',
      '',
      '# Notes',
      '',
      '```dkg-config',
      'contextGraph: "fallthrough-cg"',
      'node: "http://n"',
      '```',
    ].join('\n');
    const cfg = parseAgentsMdFrontmatter(md);
    expect(cfg.contextGraph).toBe('fallthrough-cg');
  });
});

describe('A-13: file-system priority resolution', () => {
  it('picks `.dkg/config.yaml` over `.dkg/config.json` over `AGENTS.md`', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dkg-ws-'));
    mkdirSync(join(dir, '.dkg'));
    writeFileSync(
      join(dir, '.dkg', 'config.yaml'),
      'contextGraph: "from-yaml"\nnode: "http://n"\n',
    );
    writeFileSync(
      join(dir, '.dkg', 'config.json'),
      JSON.stringify({ contextGraph: 'from-json', node: 'http://n' }),
    );
    writeFileSync(
      join(dir, 'AGENTS.md'),
      '---\ndkg:\n  contextGraph: "from-md"\n  node: "http://n"\n---\n',
    );

    // Minimal priority resolver implementing spec §2.1.
    function resolve(workspace: string): { source: string; cfg: WorkspaceConfig } {
      const yml = join(workspace, '.dkg', 'config.yaml');
      const jsn = join(workspace, '.dkg', 'config.json');
      const md = join(workspace, 'AGENTS.md');
      if (existsSync(yml)) return { source: yml, cfg: parseWorkspaceConfig(yaml.load(readFileSync(yml, 'utf8'))) };
      if (existsSync(jsn)) return { source: jsn, cfg: parseWorkspaceConfig(JSON.parse(readFileSync(jsn, 'utf8'))) };
      if (existsSync(md)) return { source: md, cfg: parseAgentsMdFrontmatter(readFileSync(md, 'utf8')) };
      throw new Error('no workspace config found');
    }

    function existsSync(p: string): boolean {
      try { statSync(p); return true; } catch { return false; }
    }

    const r = resolve(dir);
    expect(r.source.endsWith('.dkg/config.yaml')).toBe(true);
    expect(r.cfg.contextGraph).toBe('from-yaml');
  });

  // PR #229 bot review (r21-4 / bugbot 1291): the agent's own
  // `loadWorkspaceConfig` MUST resolve plain-Markdown AGENTS.md (no
  // YAML frontmatter, fenced ```dkg-config``` block) so the
  // documented third lookup tier is actually usable on this very
  // monorepo (whose AGENTS.md is plain Markdown).
  it('PR #229 bugbot: loadWorkspaceConfig accepts plain-Markdown AGENTS.md with a dkg-config fence', async () => {
    const { loadWorkspaceConfig } = await import('../src/workspace-config.js');
    const dir = mkdtempSync(join(tmpdir(), 'dkg-ws-fence-'));
    writeFileSync(
      join(dir, 'AGENTS.md'),
      [
        '# Project Agents',
        '',
        'No frontmatter here, just a fenced block.',
        '',
        '```dkg-config',
        'contextGraph: "fence-only-via-load"',
        'node: "http://127.0.0.1:9201"',
        '```',
      ].join('\n'),
    );
    const r = loadWorkspaceConfig(dir);
    expect(r.source.endsWith('AGENTS.md')).toBe(true);
    expect(r.cfg.contextGraph).toBe('fence-only-via-load');
    expect(r.cfg.node).toBe('http://127.0.0.1:9201');
  });
});

describe('A-13: SPEC-GAP — `packages/agent/src` ships no workspace-config loader', () => {
  // PROD-BUG / SPEC-GAP: spec §22 requires agents to auto-discover their
  // configuration from `.dkg/config.yaml` and friends. Today, the agent
  // package exposes no loader module — see BUGS_FOUND.md A-13. This test
  // is intentionally RED: once a `workspace-config.ts` module lands that
  // exports a `loadWorkspaceConfig(workspaceDir)` function, it will go
  // green.
  it('exports a workspace config loader', () => {
    const srcDir = resolve(__dirname, '..', 'src');
    const entries = readdirSync(srcDir);
    const hasLoader = entries.some(n =>
      /workspace[-_]config\.(t|j)s$/i.test(n) ||
      /onboard(ing)?\.(t|j)s$/i.test(n),
    );
    expect(
      hasLoader,
      'packages/agent/src has no workspace-config.ts / onboarding.ts module (BUGS_FOUND.md A-13)',
    ).toBe(true);
  });
});
