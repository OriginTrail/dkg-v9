import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveRegistryConfig, listSlugs, fetchEntry } from '../src/integrations/registry-client.js';
import { isIntegrationEntry } from '../src/integrations/schema.js';
import { installCli } from '../src/integrations/install-cli.js';
import { installMcp } from '../src/integrations/install-mcp.js';
import type { IntegrationEntry } from '../src/integrations/schema.js';

// ── Fixtures ──────────────────────────────────────────────────────────────

const baseEntry: IntegrationEntry = {
  slug: 'dkg-hello-world',
  name: 'DKG Hello World',
  description: 'Test fixture',
  maintainer: { github: '@OriginTrail/core-developers' },
  repo: 'https://github.com/OriginTrail/dkg-hello-world',
  commit: '0000000000000000000000000000000000000000',
  license: 'Apache-2.0',
  memoryLayers: ['WM'],
  v10PrimitivesUsed: ['ContextGraph', 'Assertion'],
  publicInterfacesUsed: ['http-api'],
  install: {
    kind: 'cli',
    package: '@origintrail/dkg-hello-world',
    version: '0.1.0',
    binary: 'dkg-hello-world',
    envRequired: ['DKG_API_URL', 'DKG_AUTH_TOKEN'],
    usageHint: 'dkg-hello-world greet "first post"\ndkg-hello-world list',
  },
  security: {},
  trustTier: 'featured',
};

const mcpEntry: IntegrationEntry = {
  ...baseEntry,
  slug: 'cursor-mcp-dkg',
  name: 'DKG MCP server',
  install: {
    kind: 'mcp',
    command: 'npx',
    args: ['-y', '@origintrail-official/dkg-mcp@0.1.0'],
    env: { DKG_API_URL: '${DKG_API_URL}', DKG_AUTH_TOKEN: '${DKG_AUTH_TOKEN}' },
  },
};

// ── isIntegrationEntry ────────────────────────────────────────────────────

describe('isIntegrationEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(isIntegrationEntry(baseEntry)).toBe(true);
  });

  it('rejects null, non-objects, and entries missing required keys', () => {
    expect(isIntegrationEntry(null)).toBe(false);
    expect(isIntegrationEntry('string')).toBe(false);
    expect(isIntegrationEntry({})).toBe(false);
    expect(isIntegrationEntry({ slug: 'x', name: 'y', trustTier: 'featured' })).toBe(false);
    expect(isIntegrationEntry({ ...baseEntry, install: { notKind: true } })).toBe(false);
  });
});

// ── resolveRegistryConfig ─────────────────────────────────────────────────

describe('resolveRegistryConfig', () => {
  it('falls back to registry defaults when env is empty', () => {
    const cfg = resolveRegistryConfig({});
    expect(cfg.indexUrl).toContain('api.github.com');
    expect(cfg.indexUrl).toContain('dkg-integrations');
    expect(cfg.rawBase).toContain('raw.githubusercontent.com');
    expect(cfg.githubToken).toBeUndefined();
  });

  it('honors overrides', () => {
    const cfg = resolveRegistryConfig({
      DKG_REGISTRY_INDEX_URL: 'https://staging.example/index',
      DKG_REGISTRY_RAW_BASE: 'https://staging.example/raw',
      GITHUB_TOKEN: 'ghp_xyz',
    });
    expect(cfg.indexUrl).toBe('https://staging.example/index');
    expect(cfg.rawBase).toBe('https://staging.example/raw');
    expect(cfg.githubToken).toBe('ghp_xyz');
  });
});

// ── listSlugs / fetchEntry via mocked fetch ───────────────────────────────

describe('listSlugs', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('filters out TEMPLATE.json and non-json / directory entries', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { name: 'dkg-hello-world.json', type: 'file' },
          { name: 'cursor-mcp-dkg.json', type: 'file' },
          { name: 'TEMPLATE.json', type: 'file' },
          { name: 'README.md', type: 'file' },
          { name: 'subdir', type: 'dir' },
        ]),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const slugs = await listSlugs(resolveRegistryConfig({}));
    expect(slugs).toEqual(['cursor-mcp-dkg', 'dkg-hello-world']);
  });

  it('throws a useful error on rate limit / 403', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"message":"forbidden"}', { status: 403, statusText: 'Forbidden' })) as unknown as typeof fetch;
    await expect(listSlugs(resolveRegistryConfig({}))).rejects.toThrow(/Failed to list registry entries: 403/);
  });
});

describe('fetchEntry', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('rejects directory-traversal-style slugs', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    await expect(fetchEntry('../etc/passwd', resolveRegistryConfig({}))).rejects.toThrow(/Invalid slug/);
  });

  it('returns a well-shaped entry on success', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(baseEntry), { status: 200 })) as unknown as typeof fetch;
    const e = await fetchEntry('dkg-hello-world', resolveRegistryConfig({}));
    expect(e.slug).toBe('dkg-hello-world');
    expect(e.install.kind).toBe('cli');
  });

  it('gives a specific message on 404', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch;
    await expect(fetchEntry('ghost', resolveRegistryConfig({}))).rejects.toThrow(/not found in the registry/);
  });

  it('rejects payloads that do not match the schema', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ not: 'an entry' }), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchEntry('dkg-hello-world', resolveRegistryConfig({}))).rejects.toThrow(/does not match the expected shape/);
  });
});

// ── installCli (dry-run) ──────────────────────────────────────────────────

describe('installCli', () => {
  it('renders the correct npm command in dry-run mode and emits post-instructions', async () => {
    const logs: string[] = [];
    const result = await installCli({ entry: baseEntry, dryRun: true, logger: (m) => logs.push(m) });
    expect(result.command).toBe('npm');
    expect(result.args).toEqual(['install', '--global', '@origintrail/dkg-hello-world@0.1.0']);
    expect(result.binary).toBe('dkg-hello-world');
    expect(result.postInstructions.join('\n')).toContain('DKG_AUTH_TOKEN');
    expect(result.postInstructions.join('\n')).toContain('dkg-hello-world greet');
    expect(logs.join('\n')).toContain('npm install --global @origintrail/dkg-hello-world@0.1.0');
  });

  it('throws when called with a non-cli entry', async () => {
    await expect(installCli({ entry: mcpEntry, dryRun: true })).rejects.toThrow(/non-cli install spec/);
  });
});

// ── installMcp (pure render) ──────────────────────────────────────────────

describe('installMcp', () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'dkg-cli-mcp-'));
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    if (originalHome) process.env.HOME = originalHome;
    else delete process.env.HOME;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('emits a paste-ready mcpServers block with api-url and placeholder token', async () => {
    const logs: string[] = [];
    const res = await installMcp({ entry: mcpEntry, apiUrl: 'http://127.0.0.1:9200', logger: (m) => logs.push(m) });
    const parsed = JSON.parse(res.mcpJson);
    expect(parsed.mcpServers['cursor-mcp-dkg'].command).toBe('npx');
    expect(parsed.mcpServers['cursor-mcp-dkg'].args).toEqual(['-y', '@origintrail-official/dkg-mcp@0.1.0']);
    expect(parsed.mcpServers['cursor-mcp-dkg'].env.DKG_API_URL).toBe('http://127.0.0.1:9200');
    expect(parsed.mcpServers['cursor-mcp-dkg'].env.DKG_AUTH_TOKEN).toBe('<DKG_AUTH_TOKEN>');
    expect(res.token).toBeUndefined();
    expect(logs.some((l) => l.includes('mcpServers'))).toBe(true);
  });

  it('substitutes the real token when ~/.dkg/auth.token is present', async () => {
    await mkdir(join(tmpHome, '.dkg'), { recursive: true });
    await writeFile(
      join(tmpHome, '.dkg', 'auth.token'),
      '# DKG node API token — treat this like a password\nreal-token-xyz\n',
      'utf8',
    );
    const res = await installMcp({ entry: mcpEntry, apiUrl: 'http://127.0.0.1:9200', logger: () => {} });
    const parsed = JSON.parse(res.mcpJson);
    expect(parsed.mcpServers['cursor-mcp-dkg'].env.DKG_AUTH_TOKEN).toBe('real-token-xyz');
    expect(res.token).toBe('real-token-xyz');
  });
});
