import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

  async function loadEntryWithFakeRuntime(options: { skillText?: string } = {}) {
    const tempRoot = mkdtempSync(join(tmpdir(), 'openclaw-entry-test-'));
    tempRoots.push(tempRoot);
    const root = join(tempRoot, 'adapter-openclaw');
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
    if (options.skillText !== undefined) {
      const skillPath = join(tempRoot, 'cli', 'skills', 'dkg-node', 'SKILL.md');
      mkdirSync(dirname(skillPath), { recursive: true });
      writeFileSync(skillPath, options.skillText, 'utf8');
    }
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
        'export function isPartialAdapterConfigOverlay(value) {',
        '  if (!looksLikeAdapterPluginConfig(value)) return false;',
        '  const partialOverlayKeys = new Set([\'daemonUrl\', \'dkgHome\', \'stateDir\', \'stateDirSource\', \'installedWorkspace\']);',
        '  const partialModuleKeys = new Set([\'memory\', \'channel\']);',
        '  const keys = Object.keys(value);',
        '  return keys.length > 0 && keys.every((key) => partialOverlayKeys.has(key) || (partialModuleKeys.has(key) && isObjectRecord(value[key]) && !Object.prototype.hasOwnProperty.call(value[key], \'enabled\')));',
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

  for (const registrationMode of ['setup-only', 'cli-metadata'] as const) {
    it(`defers singleton config updates during ${registrationMode} re-registration`, async () => {
      const entry = await loadEntryWithFakeRuntime();
      const firstApi = makeApi('http://127.0.0.1:9200');
      const metadataApi = makeDirectPluginConfigApi({
        daemonUrl: 'http://127.0.0.1:9300',
        memory: { enabled: false },
        channel: { enabled: true, port: 9301 },
      }, { registrationMode });
      const runtimeApi = makeDirectPluginConfigApi({
        daemonUrl: 'http://127.0.0.1:9300',
        memory: { enabled: false },
        channel: { enabled: true, port: 9301 },
      }, { registrationMode: 'setup-runtime' });

      entry(firstApi);
      entry(metadataApi);

      const instance = globalThis.__openclawEntryTestInstances![0];
      expect(instance.updateConfigCalls).toEqual([]);
      expect(instance.config).toMatchObject({
        daemonUrl: 'http://127.0.0.1:9200',
        memory: { enabled: true },
        channel: { enabled: false },
      });
      expect(instance.registerCalls).toEqual([firstApi, metadataApi]);

      entry(runtimeApi);

      expect(instance.updateConfigCalls).toHaveLength(1);
      expect(instance.updateConfigCalls[0].options).toEqual({ partial: false });
      expect(instance.config).toMatchObject({
        daemonUrl: 'http://127.0.0.1:9300',
        memory: { enabled: false },
        channel: { enabled: true, port: 9301 },
      });
    });

    it(`defers skill sync during ${registrationMode} re-registration`, async () => {
      const installedWorkspace = mkdtempSync(join(tmpdir(), 'openclaw-metadata-skill-workspace-'));
      tempRoots.push(installedWorkspace);
      const skillPath = join(installedWorkspace, 'skills', 'dkg-node', 'SKILL.md');
      const entry = await loadEntryWithFakeRuntime({ skillText: 'fresh skill' });
      const firstApi = makeApi('http://127.0.0.1:9200');
      const metadataApi = makeDirectPluginConfigApi({
        stateDir: join(installedWorkspace, '.dkg-adapter'),
        stateDirSource: 'setup-default',
        installedWorkspace,
      }, { registrationMode });
      const runtimeApi = makeDirectPluginConfigApi({
        stateDir: join(installedWorkspace, '.dkg-adapter'),
        stateDirSource: 'setup-default',
        installedWorkspace,
      }, { registrationMode: 'setup-runtime' });

      entry(firstApi);
      entry(metadataApi);

      expect(existsSync(skillPath)).toBe(false);

      entry(runtimeApi);

      expect(existsSync(skillPath)).toBe(true);
      expect(readFileSync(skillPath, 'utf8')).toBe('fresh skill');
    });
  }

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

  it('accepts api.cfg when the gateway passes validated plugin config directly', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({}, {
      cfg: {
        daemonUrl: 'http://127.0.0.1:9505',
        stateDir: '/direct-cfg/.dkg-adapter',
        stateDirSource: 'setup-default',
        installedWorkspace: '/direct-cfg',
      },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9505',
      stateDir: '/direct-cfg/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/direct-cfg',
    });
  });

  it('deep-merges direct plugin memory and channel config over entry config', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({}, {
      config: {
        memory: { enabled: false },
        channel: { enabled: true },
      },
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

  it('keeps refreshed api.config ahead of stale api.pluginConfig', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({
      daemonUrl: 'http://127.0.0.1:9610',
      memory: { enabled: true },
      channel: { enabled: false },
    }, {
      config: {
        daemonUrl: 'http://127.0.0.1:9715',
        memory: { enabled: false },
        channel: { enabled: true, port: 9716 },
      },
    });

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9715',
      memory: { enabled: false },
      channel: { enabled: true, port: 9716 },
    });
  });

  it('keeps refreshed api.cfg ahead of stale api.pluginConfig', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({
      daemonUrl: 'http://127.0.0.1:9615',
      memory: { enabled: true },
      channel: { enabled: false },
    }, {
      cfg: {
        daemonUrl: 'http://127.0.0.1:9725',
        memory: { enabled: false },
        channel: { enabled: true, port: 9726 },
      },
    });

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9725',
      memory: { enabled: false },
      channel: { enabled: true, port: 9726 },
    });
  });

  it('keeps current entry config ahead of stale api.pluginConfig', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({
      daemonUrl: 'http://127.0.0.1:9620',
      memory: { enabled: true },
      channel: { enabled: false },
    }, {
      cfg: {
        plugins: {
          entries: {
            'adapter-openclaw': {
              config: {
                daemonUrl: 'http://127.0.0.1:9735',
                memory: { enabled: false },
                channel: { enabled: true, port: 9736 },
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
      daemonUrl: 'http://127.0.0.1:9735',
      memory: { enabled: false },
      channel: { enabled: true, port: 9736 },
    });
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: false });
  });

  it('merges fresh api.pluginConfig when the current entry config only carries state metadata', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({
      daemonUrl: 'http://127.0.0.1:9745',
      stateDir: '/stale-plugin/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/stale-plugin',
      memory: { enabled: false },
      channel: { enabled: true, port: 9746 },
    }, {
      cfg: {
        plugins: {
          entries: {
            'adapter-openclaw': {
              config: {
                stateDir: '/metadata-workspace/.dkg-adapter',
                stateDirSource: 'setup-default',
                installedWorkspace: '/metadata-workspace',
              },
            },
          },
        },
      },
      runtime: {
        pluginConfig: {
          daemonUrl: 'http://127.0.0.1:9600',
          stateDir: '/stale-runtime/.dkg-adapter',
          memory: { enabled: true },
          channel: { enabled: false, port: 9601 },
        },
      },
    });

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9745',
      stateDir: '/metadata-workspace/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/metadata-workspace',
      memory: { enabled: false },
      channel: { enabled: true, port: 9746 },
    });
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: false });
  });

  it('keeps metadata-only entry plus metadata-only api.pluginConfig as a partial update', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({
      stateDir: '/plugin-metadata/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/plugin-metadata',
    }, {
      cfg: {
        plugins: {
          entries: {
            'adapter-openclaw': {
              config: {
                stateDir: '/entry-metadata/.dkg-adapter',
                stateDirSource: 'setup-default',
                installedWorkspace: '/entry-metadata',
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
      stateDir: '/entry-metadata/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/entry-metadata',
      memory: { enabled: true },
      channel: { enabled: false },
    });
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: true });
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

  it('replaces singleton config when direct plugin config carries a full snapshot', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({
      daemonUrl: 'http://127.0.0.1:9600',
      stateDir: '/second/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/second',
      memory: { enabled: false },
      channel: { enabled: true, port: 9601 },
    });

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9600',
      stateDir: '/second/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/second',
      memory: { enabled: false },
      channel: { enabled: true, port: 9601 },
    });
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: false });
    expect(instance.registerCalls).toEqual([firstApi, secondApi]);
  });

  it('treats empty direct pluginConfig as no current config source', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({}, {
      runtime: {
        pluginConfig: {
          daemonUrl: 'http://127.0.0.1:9999',
          memory: { enabled: true },
          channel: { enabled: true },
        },
      },
    });

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9999',
      memory: { enabled: true },
      channel: { enabled: true },
    });
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

  it('does not let empty first-load pluginConfig hide runtime pluginConfig fallback', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({}, {
      runtime: {
        pluginConfig: {
          daemonUrl: 'http://127.0.0.1:9740',
          memory: { enabled: true },
          channel: { enabled: false },
        },
      },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9740',
      memory: { enabled: true },
      channel: { enabled: false },
    });
    expect(instance.updateConfigCalls).toEqual([]);
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

  it('treats daemon/home-only direct re-registration config as a partial overlay', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({
      daemonUrl: 'http://127.0.0.1:9810',
      dkgHome: '/next-daemon-home',
    });

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9810',
      dkgHome: '/next-daemon-home',
      memory: { enabled: true },
      channel: { enabled: false },
    });
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: true });
  });

  it('treats module-shaped direct re-registration config without enabled as a partial overlay', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({
      daemonUrl: 'http://127.0.0.1:9800',
      channel: { port: 9801 },
    });

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9800',
      memory: { enabled: true },
      channel: { enabled: false, port: 9801 },
    });
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: true });
  });

  it('treats module-shaped direct re-registration config with enabled as a full snapshot', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({
      daemonUrl: 'http://127.0.0.1:9800',
      channel: { enabled: true, port: 9801 },
    });

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9800',
      channel: { enabled: true, port: 9801 },
    });
    expect(instance.config).not.toHaveProperty('memory');
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: false });
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
    const secondApi = makeDirectPluginConfigApi({}, {
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

  it('merges daemon/home-only first-load overlays with fallback runtime entry modules', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({}, {
      config: {
        daemonUrl: 'http://127.0.0.1:9820',
        dkgHome: '/current-daemon-home',
      },
      runtime: {
        config: {
          plugins: {
            entries: {
              'adapter-openclaw': {
                config: {
                  daemonUrl: 'http://127.0.0.1:9720',
                  memory: { enabled: true, memoryDir: '/persisted-memory' },
                  channel: { enabled: false, port: 9721 },
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
      daemonUrl: 'http://127.0.0.1:9820',
      dkgHome: '/current-daemon-home',
      memory: { enabled: true, memoryDir: '/persisted-memory' },
      channel: { enabled: false, port: 9721 },
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
                    dkgHome: '/old-daemon-home',
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
        dkgHome: undefined,
        memory: { enabled: true },
        channel: { enabled: false },
      });
      const startupLog = api.logger.info.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes('[dkg-entry] config'));
      expect(startupLog).toContain('daemonUrl: http://127.0.0.1:9730');
      expect(startupLog).not.toContain('http://127.0.0.1:9500');
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
    expect(instance.config).toMatchObject({
      daemonUrl: 'http://127.0.0.1:9200',
      stateDir: '/cfg-workspace/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/cfg-workspace',
      memory: { enabled: true },
      channel: { enabled: false },
    });
    expect(instance.updateConfigCalls[0].options).toEqual({ partial: true });
    expect(instance.workspaceDirsAtRegister).toEqual([undefined, '/cfg-workspace']);
  });

  it('does not let installedWorkspace mask a later runtime workspace', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({
      stateDir: '/setup/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/setup',
    }, {
      runtime: {
        config: {
          agents: {
            defaults: {
              workspace: '/setup',
            },
          },
        },
      },
    });

    entry(api);
    expect((api as any).workspaceDir).toBe('/setup');

    // The first value was assigned by this entry wrapper, so a later runtime
    // workspace from config should still replace it.
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
    expect(instance.workspaceDirsAtRegister).toEqual(['/setup', '/runtime-workspace']);
  });

  it('keeps caller workspaceDir ahead of stale merged config workspace', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const firstApi = makeApi('http://127.0.0.1:9200');
    const secondApi = makeDirectPluginConfigApi({}, {
      cfg: {
        agents: { defaults: { workspace: '/stale-config-workspace' } },
        plugins: {
          entries: {
            'adapter-openclaw': {
              config: {
                stateDir: '/stale-config-workspace/.dkg-adapter',
                stateDirSource: 'setup-default',
                installedWorkspace: '/stale-config-workspace',
              },
            },
          },
        },
      },
    });
    (secondApi as any).workspaceDir = '/live-runtime-workspace';

    entry(firstApi);
    entry(secondApi);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect((secondApi as any).workspaceDir).toBe('/live-runtime-workspace');
    expect(instance.workspaceDirsAtRegister).toEqual([undefined, '/live-runtime-workspace']);
  });

  it('keeps fresh direct installedWorkspace ahead of stale route workspace metadata', async () => {
    const freshWorkspace = mkdtempSync(join(tmpdir(), 'openclaw-fresh-workspace-'));
    const staleWorkspace = mkdtempSync(join(tmpdir(), 'openclaw-stale-route-workspace-'));
    tempRoots.push(freshWorkspace, staleWorkspace);
    const entry = await loadEntryWithFakeRuntime({ skillText: 'fresh skill' });
    const api = makeDirectPluginConfigApi({
      stateDir: join(freshWorkspace, '.dkg-adapter'),
      stateDirSource: 'setup-default',
      installedWorkspace: freshWorkspace,
    }, {
      cfg: {
        agents: { defaults: { workspace: staleWorkspace } },
      },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect((api as any).workspaceDir).toBeUndefined();
    expect(instance.config.installedWorkspace).toBe(freshWorkspace);
    expect(instance.workspaceDirsAtRegister).toEqual([undefined]);
    expect(readFileSync(join(freshWorkspace, 'skills', 'dkg-node', 'SKILL.md'), 'utf8')).toBe('fresh skill');
    expect(existsSync(join(staleWorkspace, 'skills', 'dkg-node', 'SKILL.md'))).toBe(false);
  });

  it('keeps current workspace metadata when direct installedWorkspace has no setup-default stateDir evidence', async () => {
    const currentWorkspace = mkdtempSync(join(tmpdir(), 'openclaw-current-workspace-'));
    const staleWorkspace = mkdtempSync(join(tmpdir(), 'openclaw-stale-installed-workspace-'));
    tempRoots.push(currentWorkspace, staleWorkspace);
    const entry = await loadEntryWithFakeRuntime({ skillText: 'current skill' });
    const api = makeDirectPluginConfigApi({
      installedWorkspace: staleWorkspace,
    }, {
      cfg: {
        agents: { defaults: { workspace: currentWorkspace } },
      },
    });

    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect((api as any).workspaceDir).toBe(currentWorkspace);
    expect(instance.config.installedWorkspace).toBe(staleWorkspace);
    expect(instance.workspaceDirsAtRegister).toEqual([currentWorkspace]);
    expect(readFileSync(join(currentWorkspace, 'skills', 'dkg-node', 'SKILL.md'), 'utf8')).toBe('current skill');
    expect(existsSync(join(staleWorkspace, 'skills', 'dkg-node', 'SKILL.md'))).toBe(false);
  });

  it('does not reuse a workspaceDir written by an earlier same-api registration', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({
      stateDir: '/first/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/first',
    }, {
      runtime: {
        config: {
          workspace: '/runtime-first',
        },
      },
    });

    entry(api);
    expect((api as any).workspaceDir).toBe('/runtime-first');

    delete (api as any).runtime;
    (api as any).pluginConfig = {
      stateDir: '/second/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/second',
    };
    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect((api as any).workspaceDir).toBeUndefined();
    expect(instance.workspaceDirsAtRegister).toEqual(['/runtime-first', undefined]);
  });

  it('keeps a caller-provided workspaceDir even when it matches an earlier wrapper assignment', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({
      stateDir: '/first/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/first',
    }, {
      runtime: {
        config: {
          workspace: '/runtime-same',
        },
      },
    });

    entry(api);
    expect((api as any).workspaceDir).toBe('/runtime-same');

    (api as any).workspaceDir = '/runtime-same';
    delete (api as any).runtime;
    (api as any).pluginConfig = {
      stateDir: '/second/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/second',
    };
    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect((api as any).workspaceDir).toBe('/runtime-same');
    expect(instance.workspaceDirsAtRegister).toEqual(['/runtime-same', '/runtime-same']);
  });

  it('syncs skills into installedWorkspace without stamping api.workspaceDir', async () => {
    const installedWorkspace = mkdtempSync(join(tmpdir(), 'openclaw-installed-workspace-'));
    tempRoots.push(installedWorkspace);
    const entry = await loadEntryWithFakeRuntime({ skillText: 'fresh skill' });
    const api = makeDirectPluginConfigApi({
      stateDir: join(installedWorkspace, '.dkg-adapter'),
      stateDirSource: 'setup-default',
      installedWorkspace,
    });

    entry(api);

    expect((api as any).workspaceDir).toBeUndefined();
    const skillPath = join(installedWorkspace, 'skills', 'dkg-node', 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);
    expect(readFileSync(skillPath, 'utf8')).toBe('fresh skill');
  });

  it('preserves a caller-provided api.workspaceDir value', async () => {
    const entry = await loadEntryWithFakeRuntime();
    const api = makeDirectPluginConfigApi({
      stateDir: '/caller/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/caller',
    });
    (api as any).workspaceDir = '/caller-workspace';

    entry(api);
    entry(api);

    const instance = globalThis.__openclawEntryTestInstances![0];
    expect((api as any).workspaceDir).toBe('/caller-workspace');
    expect(instance.workspaceDirsAtRegister).toEqual(['/caller-workspace', '/caller-workspace']);
  });
});
