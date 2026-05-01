import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

type CapturedService = {
  name: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

type FakePluginInstance = {
  config: any;
  updateConfigCalls: Array<{ config: any; options: any }>;
  registerCalls: any[];
  workspaceDirsAtRegister: Array<unknown>;
  stopCalls: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __openclawEntryTestInstances: FakePluginInstance[] | undefined;
}

describe('openclaw-entry', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    delete globalThis.__openclawEntryTestInstances;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  async function loadEntryWithFakeRuntime() {
    const root = mkdtempSync(join(tmpdir(), 'openclaw-entry-test-'));
    tempRoots.push(root);
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
    copyFileSync(new URL('../openclaw-entry.mjs', import.meta.url), join(root, 'openclaw-entry.mjs'));
    writeFileSync(
      join(root, 'dist', 'index.js'),
      [
        'const ADAPTER_PLUGIN_CONFIG_KEYS = [',
        "  'daemonUrl',",
        "  'dkgHome',",
        "  'stateDir',",
        "  'stateDirSource',",
        "  'installedWorkspace',",
        "  'memory',",
        "  'channel',",
        '];',
        "const STATE_METADATA_CONFIG_KEYS = ['stateDir', 'stateDirSource', 'installedWorkspace'];",
        'export function isObjectRecord(value) {',
        "  return !!value && typeof value === 'object' && !Array.isArray(value);",
        '}',
        'export function looksLikeAdapterPluginConfig(value) {',
        '  if (!isObjectRecord(value)) return false;',
        "  if (isObjectRecord(value.plugins) || isObjectRecord(value.agents) || isObjectRecord(value.session) || typeof value.workspace === 'string') return false;",
        '  return ADAPTER_PLUGIN_CONFIG_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key));',
        '}',
        'export function isStateMetadataOnlyAdapterConfig(value) {',
        '  if (!looksLikeAdapterPluginConfig(value)) return false;',
        '  const keys = Object.keys(value);',
        '  return keys.length > 0 && keys.every((key) => STATE_METADATA_CONFIG_KEYS.includes(key));',
        '}',
        'export function mergeAdapterPluginConfigs(...configs) {',
        '  const merged = {};',
        '  for (const config of configs) {',
        '    if (!isObjectRecord(config)) continue;',
        '    const priorMemory = isObjectRecord(merged.memory) ? merged.memory : undefined;',
        '    const priorChannel = isObjectRecord(merged.channel) ? merged.channel : undefined;',
        '    const nextMemory = isObjectRecord(config.memory) ? config.memory : undefined;',
        '    const nextChannel = isObjectRecord(config.channel) ? config.channel : undefined;',
        '    Object.assign(merged, config);',
        '    if (priorMemory || nextMemory) {',
        '      if (nextMemory) merged.memory = { ...(priorMemory ?? {}), ...nextMemory };',
        "      else if (!Object.prototype.hasOwnProperty.call(config, 'memory')) merged.memory = priorMemory;",
        '    }',
        '    if (priorChannel || nextChannel) {',
        '      if (nextChannel) merged.channel = { ...(priorChannel ?? {}), ...nextChannel };',
        "      else if (!Object.prototype.hasOwnProperty.call(config, 'channel')) merged.channel = priorChannel;",
        '    }',
        '  }',
        '  return merged;',
        '}',
        'export class DkgNodePlugin {',
        '  constructor(config) {',
        '    this.config = config;',
        '    this.updateConfigCalls = [];',
        '    this.registerCalls = [];',
        '    this.workspaceDirsAtRegister = [];',
        '    this.stopCalls = 0;',
        '    globalThis.__openclawEntryTestInstances ??= [];',
        '    globalThis.__openclawEntryTestInstances.push(this);',
        '  }',
        '  updateConfig(config, options = {}) {',
        '    this.updateConfigCalls.push({ config, options });',
        '    this.config = options.partial ? mergeAdapterPluginConfigs(this.config, config) : { ...config };',
        '  }',
        '  register(api) { this.registerCalls.push(api); this.workspaceDirsAtRegister.push(api.workspaceDir); }',
        '  async stop() { this.stopCalls += 1; }',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const href = `${pathToFileURL(join(root, 'openclaw-entry.mjs')).href}?t=${Date.now()}-${Math.random()}`;
    return (await import(href)).default as (api: any) => void;
  }

  function makeApi(daemonUrl: string) {
    const services: CapturedService[] = [];
    return {
      cfg: {
        plugins: {
          entries: {
            'adapter-openclaw': {
              config: {
                daemonUrl,
                memory: { enabled: true },
                channel: { enabled: false },
              },
            },
          },
        },
      },
      registerService: vi.fn((service: CapturedService) => { services.push(service); }),
      registerTool: vi.fn(),
      registerHook: vi.fn(),
      on: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      services,
    };
  }

  function makeDirectPluginConfigApi(config: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const services: CapturedService[] = [];
    return {
      pluginConfig: config,
      registerService: vi.fn((service: CapturedService) => { services.push(service); }),
      registerTool: vi.fn(),
      registerHook: vi.fn(),
      on: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      services,
      ...extra,
    };
  }

  it('does not register stale lifecycle event names through api.on', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeApi('http://127.0.0.1:9200');

    entry(api);

    const registeredEvents = api.on.mock.calls.map((call) => call[0]);
    expect(registeredEvents).not.toContain('shutdown');
    expect(registeredEvents).not.toContain('close');
    expect(registeredEvents).not.toContain('restart');
    expect(registeredEvents).not.toContain('reload');
  });

  it('uses registerService stop to clear the singleton so reloads pick up fresh config', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeApi('http://127.0.0.1:9300');

    entry(firstApi);
    const firstInstance = globalThis.__openclawEntryTestInstances![0];
    expect(firstInstance.config.daemonUrl).toBe('http://127.0.0.1:9200');
    expect(firstApi.registerService).toHaveBeenCalledTimes(1);
    expect(firstApi.services[0].name).toBe('dkg-adapter-openclaw-runtime');

    await firstApi.services[0].stop();
    expect(firstInstance.stopCalls).toBe(1);

    entry(secondApi);
    const secondInstance = globalThis.__openclawEntryTestInstances![1];
    expect(globalThis.__openclawEntryTestInstances).toHaveLength(2);
    expect(secondInstance).not.toBe(firstInstance);
    expect(secondInstance.config.daemonUrl).toBe('http://127.0.0.1:9300');
  });

  it('keeps multi-phase singleton re-registration delegated to DkgNodePlugin.register before teardown', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeApi('http://127.0.0.1:9300');

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(globalThis.__openclawEntryTestInstances).toHaveLength(1);
    expect(instance.registerCalls).toEqual([firstApi, secondApi]);
    expect(secondApi.registerService).toHaveBeenCalledTimes(1);

    await firstApi.services[0].stop();
    expect(instance.stopCalls).toBe(0);

    await secondApi.services[0].stop();
    expect(instance.stopCalls).toBe(1);
  });

  it('accepts OpenClaw-provided direct pluginConfig including setup state metadata', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({
      daemonUrl: 'http://127.0.0.1:9400',
      stateDir: '/work/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/work',
      memory: { enabled: true },
      channel: { enabled: false },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9400',
      stateDir: '/work/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/work',
      memory: { enabled: true },
      channel: { enabled: false },
    });
    expect((api as any).workspaceDir).toBeUndefined();
    expect(instance.workspaceDirsAtRegister).toEqual([undefined]);
  });

  it('accepts api.config when the gateway passes validated plugin config directly', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({}, {
      config: {
        daemonUrl: 'http://127.0.0.1:9500',
        stateDir: '/direct/.dkg-adapter',
        stateDirSource: 'setup-default',
        installedWorkspace: '/direct',
      },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9500',
      stateDir: '/direct/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/direct',
    });
  });

  it('deep-merges direct plugin memory and channel config over entry config', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({
      memory: { enabled: false },
      channel: { enabled: true },
    }, {
      cfg: {
        plugins: {
          entries: {
            'adapter-openclaw': {
              config: {
                daemonUrl: 'http://127.0.0.1:9550',
                memory: { enabled: true, memoryDir: '/persisted-memory' },
                channel: { enabled: false, port: 9551 },
              },
            },
          },
        },
      },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9550',
      memory: { enabled: false, memoryDir: '/persisted-memory' },
      channel: { enabled: true, port: 9551 },
    });
  });

  it('keeps current api plugin config ahead of stale runtime plugin config', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({
      daemonUrl: 'http://127.0.0.1:9660',
      memory: { enabled: false },
      channel: { enabled: true, port: 9661 },
    }, {
      runtime: {
        pluginConfig: {
          daemonUrl: 'http://127.0.0.1:9550',
          memory: { enabled: true },
          channel: { enabled: false, port: 9551 },
        },
      },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9660',
      memory: { enabled: false },
      channel: { enabled: true, port: 9661 },
    });
  });

  it('keeps current api config entry ahead of stale runtime config entry', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({}, {
      cfg: {
        plugins: {
          entries: {
            'adapter-openclaw': {
              config: {
                daemonUrl: 'http://127.0.0.1:9665',
                memory: { enabled: false },
              },
            },
          },
        },
      },
      runtime: {
        config: {
          plugins: {
            entries: {
              'adapter-openclaw': {
                config: {
                  daemonUrl: 'http://127.0.0.1:9555',
                  memory: { enabled: true },
                },
              },
            },
          },
        },
      },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9665',
      memory: { enabled: false },
    });
  });

  it('keeps current full api.config workspace and entry ahead of stale runtime config', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({}, {
      config: {
        agents: { defaults: { workspace: '/fresh-workspace' } },
        plugins: {
          entries: {
            'adapter-openclaw': {
              config: {
                daemonUrl: 'http://127.0.0.1:9670',
                stateDir: '/fresh-workspace/.dkg-adapter',
              },
            },
          },
        },
      },
      runtime: {
        config: {
          agents: { defaults: { workspace: '/stale-workspace' } },
          plugins: {
            entries: {
              'adapter-openclaw': {
                config: {
                  daemonUrl: 'http://127.0.0.1:9560',
                  stateDir: '/stale-workspace/.dkg-adapter',
                },
              },
            },
          },
        },
      },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect((api as any).workspaceDir).toBe('/fresh-workspace');
    expect(instance.workspaceDirsAtRegister).toEqual(['/fresh-workspace']);
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9670',
      stateDir: '/fresh-workspace/.dkg-adapter',
    });
  });

  it('keeps plugin-shaped api.config ahead of stale runtime plugin config', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({}, {
      config: {
        stateDir: '/fresh-direct/.dkg-adapter',
        memory: { enabled: false },
      },
      runtime: {
        pluginConfig: {
          stateDir: '/stale-direct/.dkg-adapter',
          memory: { enabled: true },
        },
      },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      stateDir: '/fresh-direct/.dkg-adapter',
      memory: { enabled: false },
    });
  });

  it('prefers live api.cfg over stale api.config for full OpenClaw config', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi(undefined as any, {
      cfg: {
        agents: { defaults: { workspace: '/live-workspace' } },
        plugins: {
          entries: {
            'adapter-openclaw': {
              config: {
                daemonUrl: 'http://127.0.0.1:9710',
                stateDir: '/live-workspace/.dkg-adapter',
                memory: { enabled: true },
                channel: { enabled: false },
              },
            },
          },
        },
      },
      config: {
        agents: { defaults: { workspace: '/stale-workspace' } },
        plugins: {
          entries: {
            'adapter-openclaw': {
              config: {
                daemonUrl: 'http://127.0.0.1:9500',
                stateDir: '/stale-workspace/.dkg-adapter',
                memory: { enabled: false },
                channel: { enabled: true, port: 9501 },
              },
            },
          },
        },
      },
    });
    delete (api as any).pluginConfig;

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect((api as any).workspaceDir).toBe('/live-workspace');
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9710',
      stateDir: '/live-workspace/.dkg-adapter',
      memory: { enabled: true },
      channel: { enabled: false },
    });
  });

  it('treats operational direct plugin config as an authoritative singleton refresh', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({
      daemonUrl: 'http://127.0.0.1:9600',
      stateDir: '/second/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/second',
    });

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9600',
      stateDir: '/second/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/second',
    });
    expect(instance.config.memory).toBeUndefined();
    expect(instance.config.channel).toBeUndefined();
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: false });
    expect(instance.registerCalls).toEqual([firstApi, secondApi]);
  });

  it('treats empty direct pluginConfig as authoritative so omitted keys can clear stale config', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({});

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toEqual({});
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: false });
  });

  it('does not let empty api.config hide runtime pluginConfig fallback', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi(undefined as any, {
      config: {},
      runtime: {
        pluginConfig: {
          daemonUrl: 'http://127.0.0.1:9700',
          memory: { enabled: true },
          channel: { enabled: false },
        },
      },
    });
    delete (api as any).pluginConfig;

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9700',
      memory: { enabled: true },
      channel: { enabled: false },
    });
  });

  it('treats a re-registration with no config source as partial', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi(undefined as any);
    delete (secondApi as any).pluginConfig;

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9200',
      memory: { enabled: true },
      channel: { enabled: false },
    });
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: true });
  });

  it('merges direct-only partial re-registration without dropping existing modules', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({
      stateDir: '/partial/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/partial',
    });

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9200',
      stateDir: '/partial/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/partial',
      memory: { enabled: true },
      channel: { enabled: false },
    });
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: true });
  });

  it('does not backfill stale runtime config when current direct config is state-only partial', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({
      stateDir: '/partial-current/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/partial-current',
    }, {
      runtime: {
        config: {
          plugins: {
            entries: {
              'adapter-openclaw': {
                config: {
                  daemonUrl: 'http://127.0.0.1:9550',
                  memory: { enabled: false },
                  channel: { enabled: true, port: 9551 },
                },
              },
            },
          },
        },
      },
    });

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9200',
      stateDir: '/partial-current/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/partial-current',
      memory: { enabled: true },
      channel: { enabled: false },
    });
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: true });
  });

  it('does not backfill stale runtime config when current api.config is state-only partial', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi(undefined as any, {
      config: {
        stateDir: '/partial-api-config/.dkg-adapter',
        stateDirSource: 'setup-default',
        installedWorkspace: '/partial-api-config',
      },
      runtime: {
        config: {
          plugins: {
            entries: {
              'adapter-openclaw': {
                config: {
                  daemonUrl: 'http://127.0.0.1:9580',
                  memory: { enabled: false },
                  channel: { enabled: true, port: 9581 },
                },
              },
            },
          },
        },
      },
    });
    delete (secondApi as any).pluginConfig;

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9200',
      stateDir: '/partial-api-config/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/partial-api-config',
      memory: { enabled: true },
      channel: { enabled: false },
    });
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: true });
  });

  it('merges state-only first load with fallback runtime entry config', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({
      stateDir: '/bootstrap-current/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/bootstrap-current',
    }, {
      runtime: {
        config: {
          plugins: {
            entries: {
              'adapter-openclaw': {
                config: {
                  daemonUrl: 'http://127.0.0.1:9720',
                  memory: { enabled: true },
                  channel: { enabled: false },
                },
              },
            },
          },
        },
      },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9720',
      stateDir: '/bootstrap-current/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/bootstrap-current',
      memory: { enabled: true },
      channel: { enabled: false },
    });
    expect(instance.updateConfigCalls).toEqual([]);
  });

  it('applies DKG_DAEMON_URL to partial first-load bootstrap config', async () => {
    const prevDaemonUrl = process.env.DKG_DAEMON_URL;
    process.env.DKG_DAEMON_URL = 'http://127.0.0.1:9730';
    try {
      const entry = await loadEntryWithFakeRuntime();
      const api = makeDirectPluginConfigApi({
        stateDir: '/bootstrap-env/.dkg-adapter',
        stateDirSource: 'setup-default',
        installedWorkspace: '/bootstrap-env',
      }, {
        runtime: {
          config: {
            plugins: {
              entries: {
                'adapter-openclaw': {
                  config: {
                    daemonUrl: 'http://127.0.0.1:9500',
                    memory: { enabled: true },
                    channel: { enabled: false },
                  },
                },
              },
            },
          },
        },
      });

      entry(api);

      const instance = globalThis.__openclawEntryTestInstances![0];
      expect(instance.config).toMatchObject({
        daemonUrl: 'http://127.0.0.1:9730',
        stateDir: '/bootstrap-env/.dkg-adapter',
        memory: { enabled: true },
        channel: { enabled: false },
      });
    } finally {
      if (prevDaemonUrl === undefined) delete process.env.DKG_DAEMON_URL;
      else process.env.DKG_DAEMON_URL = prevDaemonUrl;
    }
  });

  it('resolves workspace from runtime.config even when it only carries workspace metadata', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({
      stateDir: '/runtime-only/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/runtime-only',
    }, {
      runtime: {
        config: {
          workspace: '/runtime-only',
        },
      },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect((api as any).workspaceDir).toBe('/runtime-only');
    expect(instance.workspaceDirsAtRegister).toEqual(['/runtime-only']);
  });

  it('sets resolved workspaceDir before singleton re-registration', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({}, {
      cfg: {
        agents: { defaults: { workspace: '/cfg-workspace' } },
        plugins: {
          entries: {
            'adapter-openclaw': {
              config: {
                stateDir: '/cfg-workspace/.dkg-adapter',
                stateDirSource: 'setup-default',
                installedWorkspace: '/cfg-workspace',
              },
            },
          },
        },
      },
    });

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect((secondApi as any).workspaceDir).toBe('/cfg-workspace');
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: false });
    expect(instance.workspaceDirsAtRegister).toEqual([undefined, '/cfg-workspace']);
  });

  it('does not let installedWorkspace mask a later runtime workspace', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({
      stateDir: '/setup/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/setup',
    });

    entry(api);
    expect((api as any).workspaceDir).toBeUndefined();

    // Simulate a stale api.workspaceDir left by an older entry wrapper or
    // caller, then prove a higher-priority runtime workspace replaces it.
    (api as any).workspaceDir = '/setup';
    (api as any).runtime = {
      config: {
        agents: {
          defaults: {
            workspace: '/runtime-workspace',
          },
        },
      },
    };

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect((api as any).workspaceDir).toBe('/runtime-workspace');
    expect(instance.workspaceDirsAtRegister).toEqual([undefined, '/runtime-workspace']);
  });
});
