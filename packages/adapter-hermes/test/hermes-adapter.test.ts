import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { HermesAdapterPlugin } from '../src/HermesAdapterPlugin.js';
import { registerHermesRoutes } from '../src/hermes-routes.js';
import type { DaemonPluginApi } from '../src/types.js';
import { HermesDkgClient, redact } from '../src/dkg-client.js';
import {
  disconnectHermesProfile,
  planHermesSetup,
  runDoctor,
  runDisconnect,
  runReconnect,
  resolveHermesProfile,
  runSetup,
  runUninstall,
  runVerify,
  setupHermesProfile,
  uninstallHermesProfile,
  verifyHermesProfile,
} from '../src/setup.js';

interface TrackingApi extends DaemonPluginApi {
  routes: Map<string, (req: any, res: any) => Promise<void>>;
  hooks: Map<string, () => Promise<void>>;
  registerHttpRouteCalls: any[];
  registerHookCalls: any[];
}

function createTrackingApi(): TrackingApi {
  const routes = new Map<string, (req: any, res: any) => Promise<void>>();
  const hooks = new Map<string, () => Promise<void>>();
  const registerHttpRouteCalls: any[] = [];
  const registerHookCalls: any[] = [];

  const storeChatTurnCalls: any[][] = [];
  const importMemoriesCalls: any[][] = [];
  let storeChatTurnError: Error | null = null;
  let importMemoriesError: Error | null = null;

  return {
    routes,
    hooks,
    registerHttpRouteCalls,
    registerHookCalls,
    registerHttpRoute: (opts: any) => {
      registerHttpRouteCalls.push(opts);
      routes.set(`${opts.method} ${opts.path}`, opts.handler);
    },
    registerHook: (event: string, handler: any, meta?: any) => {
      registerHookCalls.push({ event, handler, meta });
      hooks.set(event, handler);
    },
    logger: {
      info: () => {},
      warn: () => {},
      debug: () => {},
    },
    agent: {
      query: async () => {},
      share: async () => {},
      importMemories: async (...args: any[]) => {
        importMemoriesCalls.push(args);
        if (importMemoriesError) throw importMemoriesError;
        return undefined;
      },
      storeChatTurn: async (...args: any[]) => {
        storeChatTurnCalls.push(args);
        if (storeChatTurnError) throw storeChatTurnError;
        return undefined;
      },
      _storeChatTurnCalls: storeChatTurnCalls,
      _importMemoriesCalls: importMemoriesCalls,
      _setStoreChatTurnError: (e: Error | null) => { storeChatTurnError = e; },
      _setImportMemoriesError: (e: Error | null) => { importMemoriesError = e; },
    },
  } as any;
}

function trackingRes() {
  const calls: { status?: number; json?: any }[] = [];
  const res: any = {};
  res.status = (code: number) => { calls.push({ status: code }); return res; };
  res.json = (body: any) => { calls.push({ json: body }); return res; };
  return { res, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('setup-entry.mjs', () => {
  it('skips runtime imports in setup-safe modes', async () => {
    const entry = await import('../setup-entry.mjs');
    const importRuntime = vi.fn(async () => {
      throw new Error('runtime import should be skipped');
    });

    for (const registrationMode of ['setup-only', 'cli-metadata'] as const) {
      const result = entry.default({
        registrationMode,
        _importRuntime: importRuntime,
        logger: { info: vi.fn() },
      });

      expect(result).toBeUndefined();
    }
    expect(importRuntime).not.toHaveBeenCalled();
  });

  it('lazy-loads the runtime plugin for daemon registration', async () => {
    const entry = await import('../setup-entry.mjs');
    const register = vi.fn(() => 'registered');
    let observedConfig: unknown;
    class FakePlugin {
      constructor(config: unknown) {
        observedConfig = config;
      }

      register = register;
    }
    const importRuntime = vi.fn(async () => ({ HermesAdapterPlugin: FakePlugin }));

    const result = await entry.default({
      _importRuntime: importRuntime,
      registerHttpRoute: vi.fn(),
      registerHook: vi.fn(),
      config: { hermes: { profileName: 'dev' } },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result).toBe('registered');
    expect(importRuntime).toHaveBeenCalledTimes(1);
    expect(observedConfig).toEqual({ profileName: 'dev' });
    expect(register).toHaveBeenCalledTimes(1);
  });
});

describe('HermesAdapterPlugin', () => {
  it('registers HTTP routes on first call', () => {
    const plugin = new HermesAdapterPlugin();
    const api = createTrackingApi();

    plugin.register(api);

    expect(api.registerHttpRouteCalls).toHaveLength(1);
    expect([...api.routes.keys()].sort()).toEqual([
      'GET /api/hermes/status',
    ]);
  });

  it('registers session_end lifecycle hook', () => {
    const plugin = new HermesAdapterPlugin();
    const api = createTrackingApi();

    plugin.register(api);

    expect(api.registerHookCalls.some(
      (c: any) => c.event === 'session_end' && c.meta?.name === 'hermes-adapter-stop',
    )).toBe(true);
  });

  it('skips route registration on second call (idempotent)', () => {
    const plugin = new HermesAdapterPlugin();
    const api = createTrackingApi();

    plugin.register(api);
    plugin.register(api);

    expect(api.registerHttpRouteCalls).toHaveLength(1);
  });
});

describe('GET /api/hermes/status', () => {
  it('returns adapter status JSON', async () => {
    const api = createTrackingApi();
    registerHermesRoutes(api);
    const handler = api.routes.get('GET /api/hermes/status')!;
    const { res, calls } = trackingRes();

    await handler({}, res);

    expect(calls.some(c =>
      c.json?.adapter === 'hermes' &&
      c.json?.framework === 'hermes-agent' &&
      c.json?.status === 'connected',
    )).toBe(true);
  });
});

describe('HermesDkgClient', () => {
  it('registers Hermes through the local-agent integration route', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true, integration: { id: 'hermes' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = new HermesDkgClient({
      baseUrl: 'http://127.0.0.1:9200/',
      apiToken: 'secret-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await client.connectHermesIntegration({
      metadata: { profileName: 'dkg-smoke' },
      transport: { bridgeUrl: 'http://127.0.0.1:3199' },
    });

    expect(calls[0].url).toBe('http://127.0.0.1:9200/api/local-agent-integrations/connect');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.id).toBe('hermes');
    expect(body.manifest.setupEntry).toBe('./setup-entry.mjs');
    expect(body.transport.kind).toBe('hermes-channel');
    expect(body.capabilities.localChat).toBe(true);
  });

  it('redacts bearer tokens from daemon errors', async () => {
    const fetchImpl = async () => new Response('Bearer secret-token exploded', { status: 500 });
    const client = new HermesDkgClient({
      apiToken: 'secret-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(client.getHermesChannelHealth()).rejects.toThrow('[REDACTED]');
    await expect(client.getHermesChannelHealth()).rejects.not.toThrow('secret-token');
    expect(redact('Authorization: Bearer secret-token', 'secret-token')).not.toContain('secret-token');
  });

  it('reads the daemon Hermes channel health wire shape', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      ok: true,
      target: 'gateway',
      bridge: { ok: false, error: 'bridge unavailable' },
      gateway: { ok: true, channel: 'hermes-channel' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const client = new HermesDkgClient({
      fetchImpl: fetchImpl as typeof fetch,
    });

    const health = await client.getHermesChannelHealth();

    expect(health.ok).toBe(true);
    expect(health.target).toBe('gateway');
    expect(health.bridge?.ok).toBe(false);
    expect(health.gateway?.channel).toBe('hermes-channel');
  });

  it('marks Hermes disconnected through the local-agent integration route', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true, integration: { id: 'hermes', enabled: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = new HermesDkgClient({
      baseUrl: 'http://127.0.0.1:9200/',
      apiToken: 'secret-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await client.disconnectHermesIntegration();

    expect(calls[0].url).toBe('http://127.0.0.1:9200/api/local-agent-integrations/hermes');
    expect(calls[0].init.method).toBe('PUT');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.enabled).toBe(false);
    expect(body.runtime.status).toBe('disconnected');
    expect(body.runtime.ready).toBe(false);
  });
});

describe('Hermes profile setup helpers', () => {
  it('resolves named Hermes profiles into profile-scoped Hermes homes', () => {
    const profile = resolveHermesProfile({ profileName: 'dkg-smoke' });

    expect(profile.hermesHome.replace(/\\/g, '/')).toContain('/.hermes/profiles/dkg-smoke');
    expect(profile.configPath.replace(/\\/g, '/')).toContain('/.hermes/profiles/dkg-smoke/config.yaml');
  });

  it('plans setup without writing files in dry-run mode', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    const plan = planHermesSetup({
      hermesHome,
      profileName: 'dev',
      dryRun: true,
      daemonUrl: 'http://127.0.0.1:9200/',
    });

    expect(plan.dryRun).toBe(true);
    expect(plan.state.daemonUrl).toBe('http://127.0.0.1:9200');
    expect(plan.actions.some((action) => action.path.endsWith('dkg.json'))).toBe(true);
  });

  it('writes ownership-marked profile artifacts idempotently', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    const first = setupHermesProfile({
      hermesHome,
      profileName: 'dev',
      nodeSkillContent: '# DKG Node\n',
    });
    const second = setupHermesProfile({
      hermesHome,
      profileName: 'dev',
      nodeSkillContent: '# DKG Node\n',
    });
    const verify = verifyHermesProfile({ hermesHome, profileName: 'dev' });

    expect(first.state.installedAt).toBe(second.state.installedAt);
    expect(verify.ok).toBe(true);
    expect(readFileSync(join(hermesHome, 'dkg.json'), 'utf-8')).toContain('@origintrail-official/dkg-adapter-hermes');
    expect(readFileSync(join(hermesHome, 'config.yaml'), 'utf-8')).toContain('provider: dkg');
    expect(readFileSync(join(hermesHome, 'skills', 'dkg-node', 'SKILL.md'), 'utf-8')).toContain('Managed by @origintrail-official/dkg-adapter-hermes');
    expect(readFileSync(join(hermesHome, 'plugins', 'dkg', '__init__.py'), 'utf-8')).toContain('DKGMemoryProvider');
    expect(readFileSync(join(hermesHome, 'plugins', 'dkg', '__init__.py'), 'utf-8')).toContain('from .client import DKGClient');
    expect(readFileSync(join(hermesHome, 'plugins', 'dkg', 'cli.py'), 'utf-8')).not.toContain('plugins.memory.dkg');
    expect(readFileSync(join(hermesHome, 'plugins', 'dkg', '.dkg-adapter-hermes-owner.json'), 'utf-8')).toContain('@origintrail-official/dkg-adapter-hermes');
  });

  it('writes provider-readable publish guard keys into dkg.json', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));

    setupHermesProfile({
      hermesHome,
      publishGuard: {
        defaultToolExposure: 'direct',
        allowDirectPublish: true,
        requireExplicitApproval: false,
        requireWalletCheck: false,
      },
    });

    const config = JSON.parse(readFileSync(join(hermesHome, 'dkg.json'), 'utf-8'));
    expect(config.publish_guard).toEqual({
      defaultToolExposure: 'direct',
      allowDirectPublish: true,
      requireExplicitApproval: false,
      requireWalletCheck: false,
    });
    expect(config.publish_tool).toBe('direct');
    expect(config.allow_direct_publish).toBe(true);
    expect(config.require_explicit_approval).toBe(false);
    expect(config.require_wallet_check).toBe(false);
  });

  it('loads provider guard aliases from dkg.json', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-provider-config-'));
    writeFileSync(join(hermesHome, 'dkg.json'), JSON.stringify({
      publish_guard: {
        defaultToolExposure: 'direct',
        allowDirectPublish: true,
      },
      allowContextGraphAdminTools: true,
    }));
    const script = String.raw`
import importlib.util
import json
import sys
import types
from pathlib import Path

home = Path(r"${hermesHome.replace(/\\/g, '\\\\')}")

agent_pkg = types.ModuleType("agent")
memory_provider = types.ModuleType("agent.memory_provider")
class MemoryProvider:
    pass
memory_provider.MemoryProvider = MemoryProvider
sys.modules["agent"] = agent_pkg
sys.modules["agent.memory_provider"] = memory_provider

tools_pkg = types.ModuleType("tools")
registry = types.ModuleType("tools.registry")
registry.tool_error = lambda message: json.dumps({"error": message})
sys.modules["tools"] = tools_pkg
sys.modules["tools.registry"] = registry

constants = types.ModuleType("hermes_constants")
constants.get_hermes_home = lambda: home
sys.modules["hermes_constants"] = constants

sys.modules["plugins"] = types.ModuleType("plugins")
sys.modules["plugins.memory"] = types.ModuleType("plugins.memory")

plugin_dir = Path(r"${process.cwd().replace(/\\/g, '\\\\')}") / "hermes-plugin"
spec = importlib.util.spec_from_file_location(
    "plugins.memory.dkg",
    plugin_dir / "__init__.py",
    submodule_search_locations=[str(plugin_dir)],
)
module = importlib.util.module_from_spec(spec)
sys.modules["plugins.memory.dkg"] = module
spec.loader.exec_module(module)

config = module._load_config()
assert config["publish_tool"] == "direct", config
assert config["allow_direct_publish"] is True, config
assert config["allow_context_graph_admin_tools"] is True, config
(home / "dkg.json").write_text(json.dumps({"allow_context_graph_admin_tools": True}), encoding="utf-8")
config = module._load_config()
assert config["allow_context_graph_admin_tools"] is True, config
`;
    const result = spawnSync('python', ['-B', '-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('rejects non-loopback bridge URLs during setup', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));

    expect(() => setupHermesProfile({
      hermesHome,
      bridgeUrl: 'https://hermes.example.com:9202',
    })).toThrow('--gateway-url');
    expect(existsSync(join(hermesHome, '.dkg-adapter-hermes', 'setup-state.json'))).toBe(false);
  });

  it('accepts loopback bridge URLs during setup', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));

    const plan = setupHermesProfile({
      hermesHome,
      bridgeUrl: 'http://127.0.0.1:9202/',
    });

    expect(plan.state.bridge).toEqual({ url: 'http://127.0.0.1:9202' });
  });

  it('detects provider conflicts and preserves user config on disconnect/uninstall', async () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    writeFileSync(join(hermesHome, 'config.yaml'), 'memory:\n  provider: mem0\n');

    expect(() => setupHermesProfile({ hermesHome, memoryMode: 'provider' })).toThrow('memory.provider: mem0');

    const plan = setupHermesProfile({ hermesHome, memoryMode: 'tools-only' });
    const verify = verifyHermesProfile({ hermesHome });
    const providerVerify = verifyHermesProfile({ hermesHome, memoryMode: 'provider' });

    expect(plan.warnings).toHaveLength(0);
    expect(verify.ok).toBe(true);
    expect(verify.profile.memoryMode).toBe('tools-only');
    expect(verify.warnings).toHaveLength(0);
    expect(providerVerify.ok).toBe(false);
    expect(providerVerify.status).toBe('error');
    expect(providerVerify.errors[0]).toContain('mem0');
    await expect(runVerify({ hermesHome })).resolves.toBeUndefined();
    await expect(runVerify({ hermesHome, memoryMode: 'provider' })).rejects.toThrow('mem0');
    await expect(runDoctor({ hermesHome, memoryMode: 'provider' })).rejects.toThrow('mem0');

    disconnectHermesProfile({ hermesHome });
    const disconnectedVerify = verifyHermesProfile({ hermesHome, memoryMode: 'provider' });
    expect(disconnectedVerify.ok).toBe(true);
    expect(disconnectedVerify.status).toBe('disconnected');
    expect(disconnectedVerify.errors).toHaveLength(0);
    expect(disconnectedVerify.warnings[0]).toContain('disconnected');

    uninstallHermesProfile({ hermesHome });

    expect(readFileSync(join(hermesHome, 'config.yaml'), 'utf-8')).toContain('provider: mem0');
  });

  it('allows user-owned provider config after disconnecting provider mode', async () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    setupHermesProfile({ hermesHome, memoryMode: 'provider' });
    disconnectHermesProfile({ hermesHome });
    writeFileSync(join(hermesHome, 'config.yaml'), 'memory:\n  provider: mem0\n');

    const verify = verifyHermesProfile({ hermesHome, memoryMode: 'provider' });

    expect(verify.ok).toBe(true);
    expect(verify.status).toBe('disconnected');
    expect(verify.errors).toHaveLength(0);
    expect(verify.warnings[0]).toContain('disconnected');
    await expect(runVerify({ hermesHome, memoryMode: 'provider' })).resolves.toBeUndefined();
    await expect(runDoctor({ hermesHome, memoryMode: 'provider' })).resolves.toBeUndefined();
  });

  it('detects provider conflicts when the top-level memory block has an inline comment', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    writeFileSync(join(hermesHome, 'config.yaml'), 'memory: # existing provider\n  provider: mem0\n');

    expect(() => setupHermesProfile({ hermesHome, memoryMode: 'provider' })).toThrow('memory.provider: mem0');
  });

  it('ignores nested memory provider blocks when managing Hermes provider config', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    writeFileSync(join(hermesHome, 'config.yaml'), [
      'plugins:',
      '  helper:',
      '    memory:',
      '      provider: mem0',
      '',
    ].join('\n'));

    setupHermesProfile({ hermesHome, memoryMode: 'provider' });
    const configured = readFileSync(join(hermesHome, 'config.yaml'), 'utf-8');

    expect(configured).toContain('    memory:\n      provider: mem0');
    expect(configured).toContain('# BEGIN DKG ADAPTER HERMES MANAGED\nmemory:\n  provider: dkg');

    disconnectHermesProfile({ hermesHome });
    const disconnected = readFileSync(join(hermesHome, 'config.yaml'), 'utf-8');

    expect(disconnected).toContain('    memory:\n      provider: mem0');
    expect(disconnected).not.toContain('# BEGIN DKG ADAPTER HERMES MANAGED');
  });

  it('removes only ownership-marked provider plugin artifacts during uninstall', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    setupHermesProfile({ hermesHome, profileName: 'dev' });

    uninstallHermesProfile({ hermesHome, profileName: 'dev' });

    expect(existsSync(join(hermesHome, 'plugins', 'dkg'))).toBe(false);
    expect(existsSync(join(hermesHome, '.dkg-adapter-hermes'))).toBe(false);
  });

  it('preserves manual adapter state files during uninstall', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    setupHermesProfile({ hermesHome, profileName: 'dev' });
    const manualPath = join(hermesHome, '.dkg-adapter-hermes', 'operator-note.txt');
    writeFileSync(manualPath, 'keep me\n');

    uninstallHermesProfile({ hermesHome, profileName: 'dev' });

    expect(existsSync(join(hermesHome, '.dkg-adapter-hermes', 'setup-state.json'))).toBe(false);
    expect(readFileSync(manualPath, 'utf-8')).toBe('keep me\n');
  });

  it('reports a partially removed provider plugin during verify', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    setupHermesProfile({ hermesHome, profileName: 'dev' });
    rmSync(join(hermesHome, 'plugins', 'dkg'), { recursive: true, force: true });

    const verify = verifyHermesProfile({ hermesHome, profileName: 'dev' });

    expect(verify.ok).toBe(false);
    expect(verify.errors[0]).toContain('provider plugin is missing');
  });

  it('reports missing or unowned dkg.json during verify', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    setupHermesProfile({ hermesHome, profileName: 'dev' });
    rmSync(join(hermesHome, 'dkg.json'), { force: true });

    const missingVerify = verifyHermesProfile({ hermesHome, profileName: 'dev' });
    expect(missingVerify.ok).toBe(false);
    expect(missingVerify.errors.some((error) => error.includes('dkg.json'))).toBe(true);

    writeFileSync(join(hermesHome, 'dkg.json'), JSON.stringify({ managedBy: 'someone-else' }));
    const unownedVerify = verifyHermesProfile({ hermesHome, profileName: 'dev' });
    expect(unownedVerify.ok).toBe(false);
    expect(unownedVerify.errors.some((error) => error.includes('not ownership-marked'))).toBe(true);
  });

  it('reports provider-mode config drift when managed memory.provider is missing', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    setupHermesProfile({ hermesHome, memoryMode: 'provider' });
    writeFileSync(join(hermesHome, 'config.yaml'), 'model: gpt-5\nmemory:\n  retrieval_k: 8\n');

    const verify = verifyHermesProfile({ hermesHome, memoryMode: 'provider' });

    expect(verify.ok).toBe(false);
    expect(verify.errors.some((error) => error.includes('managed memory.provider: dkg'))).toBe(true);
  });

  it('adds a managed provider line inside an existing Hermes memory config', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    writeFileSync(join(hermesHome, 'config.yaml'), 'model: gpt-5\nmemory:\n  retrieval_k: 8\n');

    setupHermesProfile({ hermesHome, memoryMode: 'provider' });

    const config = readFileSync(join(hermesHome, 'config.yaml'), 'utf-8');
    expect((config.match(/^memory:/gm) ?? [])).toHaveLength(1);
    expect(config).toContain('  provider: dkg');
    expect(config).toContain('  retrieval_k: 8');
  });

  it('marks an existing dkg provider line so verify and disconnect own it', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    writeFileSync(join(hermesHome, 'config.yaml'), 'model: gpt-5\nmemory:\n  provider: dkg\n  retrieval_k: 8\n');

    setupHermesProfile({ hermesHome, memoryMode: 'provider' });

    const config = readFileSync(join(hermesHome, 'config.yaml'), 'utf-8');
    const verify = verifyHermesProfile({ hermesHome, memoryMode: 'provider' });
    expect(verify.ok).toBe(true);
    expect(config).toContain('BEGIN DKG ADAPTER HERMES MANAGED');
    expect(config).toContain('  retrieval_k: 8');
    expect((config.match(/provider: dkg/g) ?? [])).toHaveLength(1);

    disconnectHermesProfile({ hermesHome });

    const disconnectedConfig = readFileSync(join(hermesHome, 'config.yaml'), 'utf-8');
    const disconnectedVerify = verifyHermesProfile({ hermesHome, memoryMode: 'provider' });
    expect(disconnectedConfig).not.toContain('provider: dkg');
    expect(disconnectedConfig).not.toContain('BEGIN DKG ADAPTER HERMES MANAGED');
    expect(disconnectedConfig).toContain('  retrieval_k: 8');
    expect(disconnectedVerify.ok).toBe(true);
    expect(disconnectedVerify.status).toBe('disconnected');
    expect(disconnectedVerify.errors.some((error) => error.includes('managed memory.provider'))).toBe(false);
  });

  it('best-effort disables the daemon registry during disconnect and uninstall', async () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const body = init?.method === 'GET'
        ? {
            integration: {
              id: 'hermes',
              metadata: { hermesHome },
            },
          }
        : { ok: true };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    setupHermesProfile({
      hermesHome,
      memoryMode: 'provider',
      daemonUrl: 'http://127.0.0.1:9333',
    });

    await runDisconnect({ hermesHome });
    await runUninstall({ hermesHome });

    const disconnectCalls = calls.filter((call) =>
      call.url === 'http://127.0.0.1:9333/api/local-agent-integrations/hermes'
      && call.init.method === 'PUT');
    expect(disconnectCalls).toHaveLength(2);
    for (const call of disconnectCalls) {
      const body = JSON.parse(String(call.init.body));
      expect(body.enabled).toBe(false);
      expect(body.runtime.status).toBe('disconnected');
    }
  });

  it('does not disable a daemon registry entry owned by a different Hermes profile', async () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-a-'));
    const otherHermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-b-'));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        integration: {
          id: 'hermes',
          enabled: true,
          metadata: {
            profileName: 'profile-b',
            hermesHome: otherHermesHome,
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    setupHermesProfile({
      hermesHome,
      profileName: 'profile-a',
      daemonUrl: 'http://127.0.0.1:9333',
    });

    await runDisconnect({ hermesHome, profile: 'profile-a' });
    await runUninstall({ hermesHome, profile: 'profile-a' });

    expect(calls.filter((call) => call.init.method === 'GET')).toHaveLength(2);
    expect(calls.filter((call) => call.init.method === 'PUT')).toHaveLength(0);
  });

  it('does not create adapter setup state when disconnecting an unconfigured profile', async () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const plan = disconnectHermesProfile({ hermesHome });
    await runDisconnect({ hermesHome });

    expect(plan.actions).toEqual([
      expect.objectContaining({
        type: 'skip',
        reason: 'Hermes adapter is not configured for this profile',
      }),
    ]);
    expect(existsSync(join(hermesHome, '.dkg-adapter-hermes', 'setup-state.json'))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removes the managed provider block when switching to tools-only mode', () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));

    setupHermesProfile({ hermesHome, memoryMode: 'provider' });
    expect(readFileSync(join(hermesHome, 'config.yaml'), 'utf-8')).toContain('provider: dkg');

    const dryRun = planHermesSetup({ hermesHome, memoryMode: 'tools-only', dryRun: true });
    expect(dryRun.actions).toContainEqual(expect.objectContaining({
      type: 'update',
      path: join(hermesHome, 'config.yaml'),
    }));
    expect(readFileSync(join(hermesHome, 'config.yaml'), 'utf-8')).toContain('provider: dkg');

    const plan = setupHermesProfile({ hermesHome, memoryMode: 'tools-only' });
    const config = readFileSync(join(hermesHome, 'config.yaml'), 'utf-8');
    const verify = verifyHermesProfile({ hermesHome });

    expect(plan.profile.memoryMode).toBe('tools-only');
    expect(config).not.toContain('provider: dkg');
    expect(config).not.toContain('BEGIN DKG ADAPTER HERMES MANAGED');
    expect(verify.ok).toBe(true);
    expect(verify.profile.memoryMode).toBe('tools-only');
  });

  it('reconnect preserves a disconnected tools-only profile mode', async () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    writeFileSync(join(hermesHome, 'config.yaml'), 'memory:\n  provider: mem0\n');
    setupHermesProfile({ hermesHome, memoryMode: 'tools-only' });
    disconnectHermesProfile({ hermesHome });

    await runReconnect({ hermesHome, start: false });

    const config = readFileSync(join(hermesHome, 'config.yaml'), 'utf-8');
    const verify = verifyHermesProfile({ hermesHome });
    expect(config).toContain('provider: mem0');
    expect(config).not.toContain('provider: dkg');
    expect(verify.ok).toBe(true);
    expect(verify.profile.memoryMode).toBe('tools-only');
  });

  it('reconnect preserves persisted daemon and bridge settings when flags are omitted', async () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    setupHermesProfile({
      hermesHome,
      memoryMode: 'tools-only',
      daemonUrl: 'https://dkg.example.com/',
      gatewayUrl: 'https://hermes.example.com/',
      bridgeHealthUrl: 'https://hermes.example.com/api/hermes-channel/health/',
    });
    disconnectHermesProfile({ hermesHome });

    await runReconnect({ hermesHome, start: false, verify: false });

    const config = JSON.parse(readFileSync(join(hermesHome, 'dkg.json'), 'utf-8'));
    const state = JSON.parse(readFileSync(join(hermesHome, '.dkg-adapter-hermes', 'setup-state.json'), 'utf-8'));
    expect(config.daemon_url).toBe('https://dkg.example.com');
    expect(config.bridge).toEqual({
      gatewayUrl: 'https://hermes.example.com',
      healthUrl: 'https://hermes.example.com/api/hermes-channel/health',
    });
    expect(state.daemonUrl).toBe('https://dkg.example.com');
    expect(state.bridge).toEqual(config.bridge);
    expect(state.profile.memoryMode).toBe('tools-only');
  });

  it('reconnect can override stale persisted daemon and bridge settings', async () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    setupHermesProfile({
      hermesHome,
      memoryMode: 'tools-only',
      daemonUrl: 'https://stale-dkg.example.com',
      gatewayUrl: 'https://stale-hermes.example.com',
      bridgeHealthUrl: 'https://stale-hermes.example.com/api/hermes-channel/health',
    });
    disconnectHermesProfile({ hermesHome });

    await runReconnect({
      hermesHome,
      daemonUrl: 'https://fresh-dkg.example.com/',
      gatewayUrl: 'https://fresh-hermes.example.com/',
      bridgeHealthUrl: 'https://fresh-hermes.example.com/api/hermes-channel/health/',
      start: false,
      verify: false,
    });

    const config = JSON.parse(readFileSync(join(hermesHome, 'dkg.json'), 'utf-8'));
    const state = JSON.parse(readFileSync(join(hermesHome, '.dkg-adapter-hermes', 'setup-state.json'), 'utf-8'));
    expect(config.daemon_url).toBe('https://fresh-dkg.example.com');
    expect(config.bridge).toEqual({
      gatewayUrl: 'https://fresh-hermes.example.com',
      healthUrl: 'https://fresh-hermes.example.com/api/hermes-channel/health',
    });
    expect(state.daemonUrl).toBe('https://fresh-dkg.example.com');
    expect(state.bridge).toEqual(config.bridge);
  });

  it('rejects unsupported non-interactive ask memory mode', async () => {
    await expect(runSetup({
      memoryMode: 'ask' as any,
      dryRun: true,
    })).rejects.toThrow('not supported');
  });

  it('exposes a dry-run CLI setup helper for dkg hermes setup', async () => {
    await expect(runSetup({
      profile: 'dkg-smoke',
      dryRun: true,
      daemonUrl: 'http://127.0.0.1:9200/',
    })).resolves.toBeUndefined();
  });

  it('uses profile in adapter CLI setup options', async () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));

    await runSetup({
      hermesHome,
      profile: 'explicit',
      start: false,
      verify: false,
    });

    const config = JSON.parse(readFileSync(join(hermesHome, 'dkg.json'), 'utf-8'));
    const state = JSON.parse(readFileSync(join(hermesHome, '.dkg-adapter-hermes', 'setup-state.json'), 'utf-8'));
    expect(config.profile_name).toBe('explicit');
    expect(state.profile.profileName).toBe('explicit');
  });

  it('reads the first usable default DKG auth token file line for setup daemon registration', async () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    const dkgHome = mkdtempSync(join(tmpdir(), 'dkg-home-'));
    writeFileSync(join(dkgHome, 'auth.token'), '# comment\n\nfile-token\nignored-token\n');
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const oldDkgHome = process.env.DKG_HOME;
    const oldApiToken = process.env.DKG_API_TOKEN;
    const oldAuthToken = process.env.DKG_AUTH_TOKEN;
    process.env.DKG_HOME = dkgHome;
    delete process.env.DKG_API_TOKEN;
    delete process.env.DKG_AUTH_TOKEN;
    try {
      await runSetup({ hermesHome, verify: false });
    } finally {
      if (oldDkgHome === undefined) delete process.env.DKG_HOME;
      else process.env.DKG_HOME = oldDkgHome;
      if (oldApiToken === undefined) delete process.env.DKG_API_TOKEN;
      else process.env.DKG_API_TOKEN = oldApiToken;
      if (oldAuthToken === undefined) delete process.env.DKG_AUTH_TOKEN;
      else process.env.DKG_AUTH_TOKEN = oldAuthToken;
    }

    expect(calls[0].url).toBe('http://127.0.0.1:9200/api/local-agent-integrations/connect');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer file-token');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.transport).toEqual({ kind: 'hermes-channel' });
    expect(body.transport.bridgeUrl).toBeUndefined();
  });

  it('preserves explicit gateway transport inputs during setup registration', async () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await runSetup({
      hermesHome,
      verify: false,
      gatewayUrl: 'https://hermes.example.com/',
      bridgeHealthUrl: 'https://hermes.example.com/api/hermes-channel/health/',
    });

    const body = JSON.parse(String(calls[0].init.body));
    expect(body.transport).toEqual({
      kind: 'hermes-channel',
      gatewayUrl: 'https://hermes.example.com',
      healthUrl: 'https://hermes.example.com/api/hermes-channel/health',
    });
    const state = JSON.parse(readFileSync(join(hermesHome, '.dkg-adapter-hermes', 'setup-state.json'), 'utf-8'));
    expect(state.bridge).toEqual({
      gatewayUrl: 'https://hermes.example.com',
      healthUrl: 'https://hermes.example.com/api/hermes-channel/health',
    });
  });

  it('rejects bridge health URLs without a matching transport base', async () => {
    const hermesHome = mkdtempSync(join(tmpdir(), 'hermes-profile-'));

    await expect(runSetup({
      hermesHome,
      verify: false,
      bridgeHealthUrl: 'https://hermes.example.com/health',
    })).rejects.toThrow('requires --bridge-url or --gateway-url');

    await expect(runSetup({
      hermesHome,
      verify: false,
      gatewayUrl: 'https://hermes.example.com',
      bridgeHealthUrl: 'https://other-hermes.example.com/api/hermes-channel/health',
    })).rejects.toThrow('must belong to the configured');

    await expect(runSetup({
      hermesHome,
      verify: false,
      gatewayUrl: 'https://hermes.example.com',
      bridgeHealthUrl: 'https://hermes.example.com/health',
    })).rejects.toThrow('must belong to the configured');
  });
});

describe('Hermes Python provider', () => {
  it('persists turn identity sequence across provider restarts', () => {
    const script = String.raw`
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path

home = Path(tempfile.mkdtemp(prefix="hermes-dkg-provider-"))

agent_pkg = types.ModuleType("agent")
memory_provider = types.ModuleType("agent.memory_provider")
class MemoryProvider:
    pass
memory_provider.MemoryProvider = MemoryProvider
sys.modules["agent"] = agent_pkg
sys.modules["agent.memory_provider"] = memory_provider

tools_pkg = types.ModuleType("tools")
registry = types.ModuleType("tools.registry")
def tool_error(message):
    return json.dumps({"error": message})
registry.tool_error = tool_error
sys.modules["tools"] = tools_pkg
sys.modules["tools.registry"] = registry

constants = types.ModuleType("hermes_constants")
constants.get_hermes_home = lambda: home
sys.modules["hermes_constants"] = constants

sys.modules["plugins"] = types.ModuleType("plugins")
sys.modules["plugins.memory"] = types.ModuleType("plugins.memory")

plugin_dir = Path(r"${process.cwd().replace(/\\/g, '\\\\')}") / "hermes-plugin"
spec = importlib.util.spec_from_file_location(
    "plugins.memory.dkg",
    plugin_dir / "__init__.py",
    submodule_search_locations=[str(plugin_dir)],
)
module = importlib.util.module_from_spec(spec)
sys.modules["plugins.memory.dkg"] = module
spec.loader.exec_module(module)

def make_provider():
    provider = module.DKGMemoryProvider()
    provider._config = {"profile_name": "dev"}
    provider._agent_name = "agent"
    provider._session_id = module._scoped_session_id("session-1", provider._config)
    provider._cache = module._load_cache("agent")
    provider._offline = True
    provider._client = None
    return provider

first = make_provider()
first.sync_turn("same user", "same assistant")
second = make_provider()
second.sync_turn("same user", "same assistant")

cache = module._load_cache("agent")
turns = [item for item in cache["queued_writes"] if item.get("type") == "turn"]
assert len(turns) == 2, turns
assert turns[0]["turn_id"] != turns[1]["turn_id"], turns
assert turns[0]["idempotency_key"] != turns[1]["idempotency_key"], turns
assert turns[0]["turn_id"].split(":")[-2] == "1", turns
assert turns[1]["turn_id"].split(":")[-2] == "2", turns
`;
    const result = spawnSync('python', ['-B', '-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('CLI sync preserves queued turn idempotency fields', () => {
    const script = String.raw`
import importlib.util
import sys
import types
from pathlib import Path

plugin_dir = Path(r"${process.cwd().replace(/\\/g, '\\\\')}") / "hermes-plugin"

pkg = types.ModuleType("plugins.memory.dkg")
pkg.__path__ = [str(plugin_dir)]
pkg._load_config = lambda: {"daemon_url": "http://127.0.0.1:9200", "agent_name": "agent"}
cache = {
    "queued_writes": [{
        "type": "turn",
        "session_id": "session-1",
        "user": "hello",
        "assistant": "hi",
        "turn_id": "turn-123",
        "idempotency_key": "idem-123",
    }]
}
saved = []
pkg._load_cache = lambda agent_name: cache
pkg._save_cache = lambda next_cache, agent_name: saved.append((next_cache, agent_name))

sys.modules["plugins"] = types.ModuleType("plugins")
sys.modules["plugins.memory"] = types.ModuleType("plugins.memory")
sys.modules["plugins.memory.dkg"] = pkg

store_calls = []
client_mod = types.ModuleType("plugins.memory.dkg.client")
class DKGClient:
    def __init__(self, base_url):
        self.base_url = base_url
    def health_check(self):
        return True
    def store_turn(self, session_id, user, assistant, agent_name="", turn_id="", idempotency_key=""):
        store_calls.append({
            "session_id": session_id,
            "user": user,
            "assistant": assistant,
            "agent_name": agent_name,
            "turn_id": turn_id,
            "idempotency_key": idempotency_key,
        })
        return {"success": True}
    def close(self):
        pass
client_mod.DKGClient = DKGClient
sys.modules["plugins.memory.dkg.client"] = client_mod

click = types.ModuleType("click")
click.echo = lambda *args, **kwargs: None
click.argument = lambda *args, **kwargs: (lambda fn: fn)
class FakeGroup:
    def __init__(self):
        self.commands = {}
    def group(self, name):
        def decorate(fn):
            group = FakeGroup()
            self.commands[name] = group
            return group
        return decorate
    def command(self, name):
        def decorate(fn):
            self.commands[name] = fn
            return fn
        return decorate
click.Group = FakeGroup
sys.modules["click"] = click

spec = importlib.util.spec_from_file_location("plugins.memory.dkg.cli", plugin_dir / "cli.py")
module = importlib.util.module_from_spec(spec)
sys.modules["plugins.memory.dkg.cli"] = module
spec.loader.exec_module(module)

root = FakeGroup()
module.register_cli(root)
root.commands["dkg"].commands["sync"]()

assert store_calls == [{
    "session_id": "session-1",
    "user": "hello",
    "assistant": "hi",
    "agent_name": "agent",
    "turn_id": "turn-123",
    "idempotency_key": "idem-123",
}], store_calls
assert saved[0][0]["queued_writes"] == [], saved
`;
    const result = spawnSync('python', ['-B', '-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('uses assertion-scoped reads for prefetch without requiring an agent-scoped token', () => {
    const script = String.raw`
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path

home = Path(tempfile.mkdtemp(prefix="hermes-dkg-prefetch-"))

agent_pkg = types.ModuleType("agent")
memory_provider = types.ModuleType("agent.memory_provider")
class MemoryProvider:
    pass
memory_provider.MemoryProvider = MemoryProvider
sys.modules["agent"] = agent_pkg
sys.modules["agent.memory_provider"] = memory_provider

tools_pkg = types.ModuleType("tools")
registry = types.ModuleType("tools.registry")
def tool_error(message):
    return json.dumps({"error": message})
registry.tool_error = tool_error
sys.modules["tools"] = tools_pkg
sys.modules["tools.registry"] = registry

constants = types.ModuleType("hermes_constants")
constants.get_hermes_home = lambda: home
sys.modules["hermes_constants"] = constants

sys.modules["plugins"] = types.ModuleType("plugins")
sys.modules["plugins.memory"] = types.ModuleType("plugins.memory")

plugin_dir = Path(r"${process.cwd().replace(/\\/g, '\\\\')}") / "hermes-plugin"
client_spec = importlib.util.spec_from_file_location(
    "plugins.memory.dkg.client",
    plugin_dir / "client.py",
)
client_module = importlib.util.module_from_spec(client_spec)
sys.modules["plugins.memory.dkg.client"] = client_module
client_spec.loader.exec_module(client_module)

client = client_module.DKGClient("http://127.0.0.1:9200")
client_calls = []
def post(path, data=None):
    client_calls.append((path, data or {}))
    return {"quads": []}
client._post = post
client.query_assertion("hermes", "cg:test", "SELECT ?s ?p ?o WHERE { ?s ?p ?o }")
assert client_calls == [
    (
        "/api/assertion/hermes/query",
        {
            "contextGraphId": "cg:test",
            "sparql": "SELECT ?s ?p ?o WHERE { ?s ?p ?o }",
        },
    )
], client_calls
client.query_assertion("hermes", "cg:test")
assert client_calls[-1] == ("/api/assertion/hermes/query", {"contextGraphId": "cg:test"}), client_calls

spec = importlib.util.spec_from_file_location(
    "plugins.memory.dkg",
    plugin_dir / "__init__.py",
    submodule_search_locations=[str(plugin_dir)],
)
module = importlib.util.module_from_spec(spec)
sys.modules["plugins.memory.dkg"] = module
spec.loader.exec_module(module)

class FakeClient:
    def __init__(self):
        self.calls = []

    def query_assertion(self, assertion_name, context_graph_id, sparql=""):
        self.calls.append((assertion_name, context_graph_id, sparql))
        return {
            "quads": [
                {
                    "subject": "urn:hermes:agent:memory",
                    "predicate": "urn:hermes:content",
                    "object": "Needle fact from DKG",
                }
            ]
        }

    def query(self, *args, **kwargs):
        raise AssertionError("prefetch should use the assertion-scoped query path")

provider = module.DKGMemoryProvider()
provider._offline = False
provider._client = FakeClient()
provider._assertion_id = "hermes"
provider._context_graph = "cg:test"
text = provider.prefetch("Needle")

assert len(provider._client.calls) == 1, provider._client.calls
assert provider._client.calls[0][0] == "hermes", provider._client.calls
assert provider._client.calls[0][1] == "cg:test", provider._client.calls
assert "SELECT ?s ?p ?o" in provider._client.calls[0][2], provider._client.calls
assert "CONTAINS" in provider._client.calls[0][2], provider._client.calls
assert "Needle fact from DKG" in text, text
`;
    const result = spawnSync('python', ['-B', '-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('exposes the DKG V10 tool names from OpenClaw and the node skill to Hermes agents', () => {
    const script = String.raw`
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path

home = Path(tempfile.mkdtemp(prefix="hermes-dkg-tools-"))

agent_pkg = types.ModuleType("agent")
memory_provider = types.ModuleType("agent.memory_provider")
class MemoryProvider:
    pass
memory_provider.MemoryProvider = MemoryProvider
sys.modules["agent"] = agent_pkg
sys.modules["agent.memory_provider"] = memory_provider

tools_pkg = types.ModuleType("tools")
registry = types.ModuleType("tools.registry")
def tool_error(message):
    return json.dumps({"error": message})
registry.tool_error = tool_error
sys.modules["tools"] = tools_pkg
sys.modules["tools.registry"] = registry

constants = types.ModuleType("hermes_constants")
constants.get_hermes_home = lambda: home
sys.modules["hermes_constants"] = constants

sys.modules["plugins"] = types.ModuleType("plugins")
sys.modules["plugins.memory"] = types.ModuleType("plugins.memory")

plugin_dir = Path(r"${process.cwd().replace(/\\/g, '\\\\')}") / "hermes-plugin"
spec = importlib.util.spec_from_file_location(
    "plugins.memory.dkg",
    plugin_dir / "__init__.py",
    submodule_search_locations=[str(plugin_dir)],
)
module = importlib.util.module_from_spec(spec)
sys.modules["plugins.memory.dkg"] = module
spec.loader.exec_module(module)

provider = module.DKGMemoryProvider()
provider._config = {"publish_tool": "request-only", "allow_direct_publish": False}
names = sorted(schema["name"] for schema in provider.get_tool_schemas())
expected_default = [
    "dkg_assertion_create",
    "dkg_assertion_discard",
    "dkg_assertion_history",
    "dkg_assertion_import_file",
    "dkg_assertion_promote",
    "dkg_assertion_query",
    "dkg_assertion_write",
    "dkg_context_graph_create",
    "dkg_find_agents",
    "dkg_invoke_skill",
    "dkg_join_request_list",
    "dkg_list_context_graphs",
    "dkg_participant_list",
    "dkg_query",
    "dkg_read_messages",
    "dkg_send_message",
    "dkg_status",
    "dkg_sub_graph_create",
    "dkg_sub_graph_list",
    "dkg_subscribe",
    "dkg_wallet_balances",
    "memory_search",
]
missing = [name for name in expected_default if name not in names]
assert missing == [], missing
assert "dkg_publish" not in names, names
assert "dkg_shared_memory_publish" not in names, names
subscribe_schema = next(schema for schema in provider.get_tool_schemas() if schema["name"] == "dkg_subscribe")
assert "include_shared_memory" in subscribe_schema["parameters"]["properties"], subscribe_schema

guarded = provider.handle_tool_call("dkg_shared_memory_publish", {"context_graph_id": "cg:test"})
assert "disabled by the adapter publish guard" in guarded, guarded
admin_guarded = provider.handle_tool_call("dkg_participant_add", {"context_graph_id": "cg:test", "agent_address": "0xabc"})
assert "Context graph admin tools are disabled" in admin_guarded, admin_guarded

provider._config = {"publish_tool": "direct", "allow_direct_publish": True}
direct_names = sorted(schema["name"] for schema in provider.get_tool_schemas())
for name in ["dkg_publish", "dkg_shared_memory_publish"]:
    assert name in direct_names, direct_names

provider._config = {
    "publish_tool": "direct",
    "allow_direct_publish": True,
    "allow_context_graph_admin_tools": True,
}
operator_names = sorted(schema["name"] for schema in provider.get_tool_schemas())
for name in [
    "dkg_context_graph_invite",
    "dkg_participant_add",
    "dkg_participant_remove",
    "dkg_join_request_approve",
    "dkg_join_request_reject",
]:
    assert name in operator_names, operator_names
`;
    const result = spawnSync('python', ['-B', '-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('routes Hermes parity tools to DKG V10 daemon endpoints', () => {
    const script = String.raw`
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path

home = Path(tempfile.mkdtemp(prefix="hermes-dkg-tool-routes-"))

agent_pkg = types.ModuleType("agent")
memory_provider = types.ModuleType("agent.memory_provider")
class MemoryProvider:
    pass
memory_provider.MemoryProvider = MemoryProvider
sys.modules["agent"] = agent_pkg
sys.modules["agent.memory_provider"] = memory_provider

tools_pkg = types.ModuleType("tools")
registry = types.ModuleType("tools.registry")
def tool_error(message):
    return json.dumps({"error": message})
registry.tool_error = tool_error
sys.modules["tools"] = tools_pkg
sys.modules["tools.registry"] = registry

constants = types.ModuleType("hermes_constants")
constants.get_hermes_home = lambda: home
sys.modules["hermes_constants"] = constants

sys.modules["plugins"] = types.ModuleType("plugins")
sys.modules["plugins.memory"] = types.ModuleType("plugins.memory")

plugin_dir = Path(r"${process.cwd().replace(/\\/g, '\\\\')}") / "hermes-plugin"
client_spec = importlib.util.spec_from_file_location(
    "plugins.memory.dkg.client",
    plugin_dir / "client.py",
)
client_module = importlib.util.module_from_spec(client_spec)
sys.modules["plugins.memory.dkg.client"] = client_module
client_spec.loader.exec_module(client_module)

client = client_module.DKGClient("http://127.0.0.1:9200")
calls = []
client._post = lambda path, data=None: calls.append(("POST", path, data or {})) or {"ok": True}
client._get = lambda path: calls.append(("GET", path, {})) or {"ok": True}

bad_cg = client.create_context_graph("Bad", cg_id="Bad:Id")
assert bad_cg["success"] is False, bad_cg
client.create_context_graph("My Project", "desc")
client.subscribe("cg:test", include_shared_memory=True)
client.write_assertion("a b", "cg:test", [{"subject": "urn:s", "predicate": "urn:p", "object": '"o"'}], "sub")
client.discard_assertion("a b", "cg:test")
client.assertion_history("a b", "cg:test", agent_address="agent", sub_graph_name="sub")
client.create_sub_graph("cg:test", "notes")
client.list_sub_graphs("cg:test")
client.invite_to_context_graph("cg:test", "peer")
client.add_participant("cg:test", "agent")
client.list_join_requests("cg:test")
client.publish("cg:test", selection=["urn:root"], clear_after=False, sub_graph_name="sub")

assert calls == [
    ("POST", "/api/context-graph/create", {"id": "my-project", "name": "My Project", "description": "desc"}),
    ("POST", "/api/context-graph/subscribe", {"contextGraphId": "cg:test", "includeSharedMemory": True}),
    ("POST", "/api/assertion/a%20b/write", {"contextGraphId": "cg:test", "quads": [{"subject": "urn:s", "predicate": "urn:p", "object": '"o"'}], "subGraphName": "sub"}),
    ("POST", "/api/assertion/a%20b/discard", {"contextGraphId": "cg:test"}),
    ("GET", "/api/assertion/a%20b/history?contextGraphId=cg%3Atest&agentAddress=agent&subGraphName=sub", {}),
    ("POST", "/api/sub-graph/create", {"contextGraphId": "cg:test", "subGraphName": "notes"}),
    ("GET", "/api/sub-graph/list?contextGraphId=cg%3Atest", {}),
    ("POST", "/api/context-graph/invite", {"contextGraphId": "cg:test", "peerId": "peer"}),
    ("POST", "/api/context-graph/cg%3Atest/add-participant", {"agentAddress": "agent"}),
    ("GET", "/api/context-graph/cg%3Atest/join-requests", {}),
    ("POST", "/api/shared-memory/publish", {"contextGraphId": "cg:test", "selection": ["urn:root"], "clearAfter": False, "subGraphName": "sub"}),
], calls

client_identity = client_module.DKGClient("http://127.0.0.1:9200")
def fake_get(path):
    if path == "/api/agent/identity":
        return {"peerId": "peer-from-identity"}
    raise AssertionError(path)
client_identity._get = fake_get
assert client_identity._resolve_agent_address() == "peer-from-identity"
assert client_identity._agent_identity_loaded is False

client_status = client_module.DKGClient("http://127.0.0.1:9200")
def fake_status_get(path):
    if path == "/api/agent/identity":
        return {"success": False}
    if path == "/api/status":
        return {"peerId": "peer-from-status"}
    raise AssertionError(path)
client_status._get = fake_status_get
assert client_status._resolve_agent_address() == "peer-from-status"
assert client_status._agent_identity_loaded is False

client_retry = client_module.DKGClient("http://127.0.0.1:9200")
retry_calls = {"count": 0}
def fake_retry_get(path):
    retry_calls["count"] += 1
    if retry_calls["count"] <= 2:
        return {"success": False}
    if path == "/api/agent/identity":
        return {"peerId": "peer-after-retry"}
    raise AssertionError(path)
client_retry._get = fake_retry_get
assert client_retry._resolve_agent_address() is None
assert client_retry._agent_identity_loaded is False
assert client_retry._resolve_agent_address() == "peer-after-retry"
assert client_retry._agent_identity_loaded is False

client_agent_later = client_module.DKGClient("http://127.0.0.1:9200")
later_calls = {"count": 0}
def fake_later_get(path):
    later_calls["count"] += 1
    if path == "/api/agent/identity" and later_calls["count"] == 1:
        return {"peerId": "peer-before-agent"}
    if path == "/api/agent/identity":
        return {"agentAddress": "0xAgent"}
    raise AssertionError(path)
client_agent_later._get = fake_later_get
assert client_agent_later._resolve_agent_address() == "peer-before-agent"
assert client_agent_later._agent_identity_loaded is False
assert client_agent_later._resolve_agent_address() == "0xAgent"
assert client_agent_later._agent_identity_loaded is True
`;
    const result = spawnSync('python', ['-B', '-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('enforces OpenClaw-parity Hermes tool contracts', () => {
    const script = String.raw`
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path

home = Path(tempfile.mkdtemp(prefix="hermes-dkg-contracts-"))

agent_pkg = types.ModuleType("agent")
memory_provider = types.ModuleType("agent.memory_provider")
class MemoryProvider:
    pass
memory_provider.MemoryProvider = MemoryProvider
sys.modules["agent"] = agent_pkg
sys.modules["agent.memory_provider"] = memory_provider

tools_pkg = types.ModuleType("tools")
registry = types.ModuleType("tools.registry")
registry.tool_error = lambda message: json.dumps({"error": message})
sys.modules["tools"] = tools_pkg
sys.modules["tools.registry"] = registry

constants = types.ModuleType("hermes_constants")
constants.get_hermes_home = lambda: home
sys.modules["hermes_constants"] = constants

sys.modules["plugins"] = types.ModuleType("plugins")
sys.modules["plugins.memory"] = types.ModuleType("plugins.memory")

plugin_dir = Path(r"${process.cwd().replace(/\\/g, '\\\\')}") / "hermes-plugin"
client_spec = importlib.util.spec_from_file_location(
    "plugins.memory.dkg.client",
    plugin_dir / "client.py",
)
client_module = importlib.util.module_from_spec(client_spec)
sys.modules["plugins.memory.dkg.client"] = client_module
client_spec.loader.exec_module(client_module)

spec = importlib.util.spec_from_file_location(
    "plugins.memory.dkg",
    plugin_dir / "__init__.py",
    submodule_search_locations=[str(plugin_dir)],
)
module = importlib.util.module_from_spec(spec)
sys.modules["plugins.memory.dkg"] = module
spec.loader.exec_module(module)

client = client_module.DKGClient("http://127.0.0.1:9200")
client._post = lambda path, data=None: {"success": False, "error": "Assertion already exists"}
exists = client.create_assertion("cg:test", "Hermes")
assert exists["success"] is True and exists["alreadyExists"] is True, exists

class FakeError(Exception):
    pass

class FakeResponse:
    text = '{"error":"Assertion already exists"}'

    def json(self):
        return {"error": "Assertion already exists"}

    def raise_for_status(self):
        err = FakeError("400 Client Error")
        err.response = self
        raise err

class FakeSession:
    def post(self, *args, **kwargs):
        return FakeResponse()

client_http = client_module.DKGClient("http://127.0.0.1:9200")
client_http._session = FakeSession()
exists_http = client_http.create_assertion("cg:test", "Hermes")
assert exists_http["success"] is True and exists_http["alreadyExists"] is True, exists_http

class ExistingAssertionClient:
    def __init__(self, base_url, **kwargs):
        self.base_url = base_url

    def health_check(self):
        return True

    def create_assertion(self, context_graph_id, name):
        return {"success": True, "alreadyExists": True}

provider_existing = module.DKGMemoryProvider()
module._load_config = lambda: {
    "daemon_url": "http://127.0.0.1:9200",
    "context_graph": "cg:test",
    "agent_name": "HermesAgent",
}
module._load_cache = lambda agent_name: {"memory": [], "user": [], "queued_writes": []}
client_module.DKGClient = ExistingAssertionClient
provider_existing._backlog_import_if_needed = lambda hermes_home: None
provider_existing.initialize("session-1")
assert provider_existing._assertion_id == "HermesAgent", provider_existing._assertion_id

class QueryClient:
    def __init__(self):
        self.queries = []

    def _resolve_agent_address(self):
        return "peer-default"

    def query(self, sparql, context_graph_id, **kwargs):
        self.queries.append((sparql, context_graph_id, kwargs))
        return {"ok": True}

provider = module.DKGMemoryProvider()
provider._offline = False
provider._context_graph = "default-cg"
provider._client = QueryClient()

for args, needle in [
    ({"sparql": "ASK {}", "paranet_id": "old"}, "paranet_id"),
    ({"sparql": "ASK {}", "include_shared_memory": True}, "include_shared_memory"),
    ({"sparql": "ASK {}", "context_graph": "old"}, "context_graph"),
    ({"sparql": "ASK {}", "context_graph_id": "cg:test", "view": "bad"}, "view"),
    ({"sparql": "ASK {}", "view": "working-memory"}, "context_graph_id"),
    ({"sparql": "ASK {}", "context_graph_id": "cg:test", "view": "working-memory", "agent_address": "   "}, "agent_address"),
]:
    result = json.loads(provider.handle_tool_call("dkg_query", args))
    assert needle in result["error"], (args, result)

result = json.loads(provider.handle_tool_call("dkg_query", {
    "sparql": "ASK {}",
    "context_graph_id": "cg:test",
    "view": "working-memory",
    "agent_address": "did:dkg:agent:peer-explicit",
}))
assert result["ok"] is True, result
assert provider._client.queries[-1][2]["agent_address"] == "peer-explicit", provider._client.queries

result = json.loads(provider.handle_tool_call("dkg_query", {
    "sparql": "ASK {}",
    "context_graph_id": "cg:test",
    "view": "working-memory",
}))
assert result["ok"] is True, result
assert provider._client.queries[-1][2]["agent_address"] == "peer-default", provider._client.queries

class MessageClient:
    def __init__(self):
        self.paths = []

    def _get(self, path):
        self.paths.append(path)
        return {"ok": True}

provider._client = MessageClient()
result = json.loads(provider.handle_tool_call("dkg_read_messages", {
    "peer": "peer one",
    "limit": 10,
    "since": "123",
}))
assert result["ok"] is True, result
assert provider._client.paths == ["/api/messages?peer=peer+one&limit=10&since=123"], provider._client.paths

class RegisterFailClient:
    def __init__(self):
        self.published = False

    def register_context_graph(self, context_graph_id, access_policy=None):
        return {"success": False, "error": "wallet missing"}

    def publish(self, *args, **kwargs):
        self.published = True
        raise AssertionError("publish should not run")

provider._config = {"publish_tool": "direct", "allow_direct_publish": True}
provider._client = RegisterFailClient()
result = json.loads(provider.handle_tool_call("dkg_shared_memory_publish", {
    "context_graph_id": "cg:test",
    "register_if_needed": True,
}))
assert result["success"] is False and "wallet missing" in result["error"], result
assert provider._client.published is False

class AlreadyRegisteredClient(RegisterFailClient):
    def register_context_graph(self, context_graph_id, access_policy=None):
        return {"success": False, "error": "context graph already registered"}

    def publish(self, *args, **kwargs):
        self.published = True
        return {"success": True}

provider._client = AlreadyRegisteredClient()
result = json.loads(provider.handle_tool_call("dkg_shared_memory_publish", {
    "context_graph_id": "cg:test",
    "register_if_needed": True,
}))
assert result["success"] is True and provider._client.published is True, result
assert "registration" in result, result
`;
    const result = spawnSync('python', ['-B', '-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('returns SKILL-shaped Hermes memory_search hits across agent and project layers', () => {
    const script = String.raw`
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path

home = Path(tempfile.mkdtemp(prefix="hermes-dkg-memory-search-"))

agent_pkg = types.ModuleType("agent")
memory_provider = types.ModuleType("agent.memory_provider")
class MemoryProvider:
    pass
memory_provider.MemoryProvider = MemoryProvider
sys.modules["agent"] = agent_pkg
sys.modules["agent.memory_provider"] = memory_provider

tools_pkg = types.ModuleType("tools")
registry = types.ModuleType("tools.registry")
def tool_error(message):
    return json.dumps({"error": message})
registry.tool_error = tool_error
sys.modules["tools"] = tools_pkg
sys.modules["tools.registry"] = registry

constants = types.ModuleType("hermes_constants")
constants.get_hermes_home = lambda: home
sys.modules["hermes_constants"] = constants

sys.modules["plugins"] = types.ModuleType("plugins")
sys.modules["plugins.memory"] = types.ModuleType("plugins.memory")

plugin_dir = Path(r"${process.cwd().replace(/\\/g, '\\\\')}") / "hermes-plugin"
spec = importlib.util.spec_from_file_location(
    "plugins.memory.dkg",
    plugin_dir / "__init__.py",
    submodule_search_locations=[str(plugin_dir)],
)
module = importlib.util.module_from_spec(spec)
sys.modules["plugins.memory.dkg"] = module
spec.loader.exec_module(module)

class FakeClient:
    def __init__(self):
        self.calls = []

    def _resolve_agent_address(self):
        return "0xAgent"

    def query(self, sparql, context_graph_id, **kwargs):
        self.calls.append((context_graph_id, kwargs))
        return {
            "result": {
                "bindings": [{
                    "uri": {"value": f"urn:{context_graph_id}:{kwargs['view']}"},
                    "pred": {"value": "schema:description"},
                    "text": {"value": f"alpha beta from {context_graph_id} {kwargs['view']}"},
                }],
            },
        }

provider = module.DKGMemoryProvider()
provider._offline = False
provider._client = FakeClient()
provider._context_graph = "project-cg"
provider._cache = {}

result = json.loads(provider.handle_tool_call("memory_search", {"query": "alpha beta", "limit": 10}))
assert result["query"] == "alpha beta", result
assert result["scope"] == "project-cg", result
assert result["count"] == 6, result
layers = [hit["layer"] for hit in result["hits"]]
assert set(layers) == {
    "agent-context-wm",
    "agent-context-swm",
    "agent-context-vm",
    "project-wm",
    "project-swm",
    "project-vm",
}, layers
assert layers[:2] == ["agent-context-vm", "project-vm"], layers
assert {hit["source"] for hit in result["hits"] if hit["layer"].startswith("agent-context")} == {"sessions"}, result
assert {hit["source"] for hit in result["hits"] if hit["layer"].startswith("project")} == {"memory"}, result
assert all(hit["score"] == 1.0 for hit in result["hits"]), result
assert all("_rank" not in hit for hit in result["hits"]), result
assert provider._client.calls == [
    ("agent-context", {"view": "working-memory", "agent_address": "0xAgent"}),
    ("agent-context", {"view": "shared-working-memory", "agent_address": None}),
    ("agent-context", {"view": "verified-memory", "agent_address": None}),
    ("project-cg", {"view": "working-memory", "agent_address": "0xAgent"}),
    ("project-cg", {"view": "shared-working-memory", "agent_address": None}),
    ("project-cg", {"view": "verified-memory", "agent_address": None}),
], provider._client.calls
`;
    const result = spawnSync('python', ['-B', '-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('uploads Hermes assertion imports as safe multipart requests', () => {
    const script = String.raw`
import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

home = Path(tempfile.mkdtemp(prefix="hermes-dkg-import-"))
plugin_dir = Path(r"${process.cwd().replace(/\\/g, '\\\\')}") / "hermes-plugin"
client_spec = importlib.util.spec_from_file_location(
    "plugins.memory.dkg.client",
    plugin_dir / "client.py",
)
client_module = importlib.util.module_from_spec(client_spec)
sys.modules["plugins.memory.dkg.client"] = client_module
client_spec.loader.exec_module(client_module)

safe_file = home / "notes.md"
safe_file.write_text("# Notes", encoding="utf-8")
outside_file = Path(tempfile.mkdtemp(prefix="hermes-dkg-import-outside-")) / "notes.md"
outside_file.write_text("# Outside", encoding="utf-8")
symlink_file = home / "linked-outside.md"
try:
    os.symlink(outside_file, symlink_file)
except (AttributeError, NotImplementedError, OSError):
    symlink_file = None
blocked_dir = home / ".dkg"
blocked_dir.mkdir()
blocked_file = blocked_dir / "auth.token"
blocked_file.write_text("secret", encoding="utf-8")
ssh_dir = home / ".ssh"
ssh_dir.mkdir()
ssh_key = ssh_dir / "id_rsa"
ssh_key.write_text("secret", encoding="utf-8")

calls = []
class FakeResponse:
    def raise_for_status(self):
        pass
    def json(self):
        return {"success": True}

def fake_post(url, data=None, files=None, headers=None, timeout=None):
    calls.append({
        "url": url,
        "data": data,
        "files": files,
        "headers": headers,
        "timeout": timeout,
    })
    return FakeResponse()

requests_module = types.ModuleType("requests")
requests_module.post = fake_post
sys.modules["requests"] = requests_module

client = client_module.DKGClient("http://127.0.0.1:9200", import_roots=[str(home)])
client._token = "secret-token"
result = client.import_assertion_file("assertion name", "cg:test", str(safe_file), sub_graph_name="sub")
assert result == {"success": True}, result
assert len(calls) == 1, calls
call = calls[0]
assert call["url"].endswith("/api/assertion/assertion%20name/import-file"), call
assert call["data"] == {"contextGraphId": "cg:test", "subGraphName": "sub"}, call
assert call["headers"] == {"Accept": "application/json", "Authorization": "Bearer secret-token"}, call
file_tuple = call["files"]["file"]
assert file_tuple[0] == "notes.md", file_tuple
assert file_tuple[2] == "text/markdown", file_tuple

blocked = client.import_assertion_file("assertion", "cg:test", str(blocked_file))
assert blocked["success"] is False, blocked
assert "Refusing to import" in blocked["error"], blocked
blocked_ssh = client.import_assertion_file("assertion", "cg:test", str(ssh_key))
assert blocked_ssh["success"] is False, blocked_ssh
assert "Refusing to import" in blocked_ssh["error"], blocked_ssh
outside = client.import_assertion_file("assertion", "cg:test", str(outside_file))
assert outside["success"] is False, outside
assert "safe roots" in outside["error"], outside
if symlink_file is not None:
    symlinked = client.import_assertion_file("assertion", "cg:test", str(symlink_file))
    assert symlinked["success"] is False, symlinked
    assert "safe roots" in symlinked["error"], symlinked
client_without_roots = client_module.DKGClient("http://127.0.0.1:9200", import_roots=[])
no_roots = client_without_roots.import_assertion_file("assertion", "cg:test", str(safe_file))
assert no_roots["success"] is False, no_roots
assert "safe roots" in no_roots["error"], no_roots
assert len(calls) == 1, calls
`;
    const result = spawnSync('python', ['-B', '-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('flushes queued memory writes without reapplying them to the local cache', () => {
    const script = String.raw`
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path

home = Path(tempfile.mkdtemp(prefix="hermes-dkg-queue-"))

agent_pkg = types.ModuleType("agent")
memory_provider = types.ModuleType("agent.memory_provider")
class MemoryProvider:
    pass
memory_provider.MemoryProvider = MemoryProvider
sys.modules["agent"] = agent_pkg
sys.modules["agent.memory_provider"] = memory_provider

tools_pkg = types.ModuleType("tools")
registry = types.ModuleType("tools.registry")
def tool_error(message):
    return json.dumps({"error": message})
registry.tool_error = tool_error
sys.modules["tools"] = tools_pkg
sys.modules["tools.registry"] = registry

constants = types.ModuleType("hermes_constants")
constants.get_hermes_home = lambda: home
sys.modules["hermes_constants"] = constants

sys.modules["plugins"] = types.ModuleType("plugins")
sys.modules["plugins.memory"] = types.ModuleType("plugins.memory")

plugin_dir = Path(r"${process.cwd().replace(/\\/g, '\\\\')}") / "hermes-plugin"
spec = importlib.util.spec_from_file_location(
    "plugins.memory.dkg",
    plugin_dir / "__init__.py",
    submodule_search_locations=[str(plugin_dir)],
)
module = importlib.util.module_from_spec(spec)
sys.modules["plugins.memory.dkg"] = module
spec.loader.exec_module(module)

class FakeClient:
    def __init__(self):
        self.writes = []

    def write_assertion(self, assertion_name, context_graph_id, quads):
        self.writes.append((assertion_name, context_graph_id, quads))
        return {"success": True}

provider = module.DKGMemoryProvider()
provider._client = FakeClient()
provider._offline = False
provider._assertion_id = "hermes"
provider._context_graph = "cg:test"
provider._agent_name = "agent"
provider._cache = {
    "memory": [{"target": "memory", "content": "cached fact"}],
    "queued_writes": [{"type": "memory", "action": "add", "target": "memory", "content": "cached fact"}],
}

provider._flush_queued_writes()

assert provider._cache["memory"] == [{"target": "memory", "content": "cached fact"}], provider._cache
assert provider._cache["queued_writes"] == [], provider._cache
assert len(provider._client.writes) == 1, provider._client.writes
assert provider._client.writes[0][2] == [{
    "subject": "urn:hermes:agent:memory",
    "predicate": "urn:hermes:content",
    "object": "[memory]\ncached fact",
}], provider._client.writes

provider._assertion_id = ""
provider._cache["queued_writes"] = [{"type": "memory", "action": "replace", "target": "memory", "content": "new fact", "old_text": "cached"}]
provider._flush_queued_writes()
assert provider._cache["queued_writes"] == [{"type": "memory", "action": "replace", "target": "memory", "content": "new fact", "old_text": "cached"}], provider._cache
`;
    const result = spawnSync('python', ['-B', '-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
