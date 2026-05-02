import { describe, expect, it } from 'vitest';
import {
  isPartialAdapterConfigOverlay,
  isStateMetadataOnlyAdapterConfig,
  looksLikeAdapterPluginConfig,
  mergeAdapterPluginConfigs,
  resolveOpenClawMergedConfig,
  resolveOpenClawRouteMetadataConfig,
} from '../src/openclaw-config.js';

describe('openclaw-config helpers', () => {
  it('classifies adapter plugin configs without treating full workspace config as plugin config', () => {
    expect(looksLikeAdapterPluginConfig({
      daemonUrl: 'http://127.0.0.1:9200',
      stateDir: '/workspace/.dkg-adapter',
      memory: { enabled: true },
    })).toBe(true);
    expect(looksLikeAdapterPluginConfig({
      plugins: {},
      agents: {},
    })).toBe(false);
    expect(looksLikeAdapterPluginConfig({
      workspace: '/workspace',
      stateDir: '/workspace/.dkg-adapter',
    })).toBe(false);
    expect(looksLikeAdapterPluginConfig({
      session: { dmScope: 'main' },
      stateDir: '/workspace/.dkg-adapter',
    })).toBe(false);
    expect(isStateMetadataOnlyAdapterConfig({
      stateDir: '/workspace/.dkg-adapter',
      stateDirSource: 'setup-default',
      installedWorkspace: '/workspace',
    })).toBe(true);
    expect(isStateMetadataOnlyAdapterConfig({
      stateDir: '/workspace/.dkg-adapter',
      memory: { enabled: true },
    })).toBe(false);
  });

  it('selects the full merged config when api.config is adapter plugin config', () => {
    const fullConfig = {
      plugins: {
        slots: {
          memory: 'adapter-openclaw',
        },
      },
    };
    const api = {
      config: {
        stateDir: '/workspace/.dkg-adapter',
        memory: { enabled: true },
      },
      runtime: {
        config: fullConfig,
      },
    } as any;

    expect(resolveOpenClawMergedConfig(api)).toBe(fullConfig);
  });

  it('keeps full api.config ahead of stale runtime config', () => {
    const fullConfig = {
      plugins: {
        slots: {
          memory: 'adapter-openclaw',
        },
      },
    };
    const staleRuntimeConfig = {
      plugins: {
        slots: {
          memory: 'other-plugin',
        },
      },
    };
    const api = {
      config: fullConfig,
      runtime: {
        config: staleRuntimeConfig,
      },
    } as any;

    expect(resolveOpenClawMergedConfig(api)).toBe(fullConfig);
  });

  it('keeps live api.cfg ahead of stale api.config when both are exposed', () => {
    const liveConfig = {
      plugins: {
        slots: {
          memory: 'adapter-openclaw',
        },
      },
    };
    const staleConfig = {
      plugins: {
        slots: {
          memory: 'other-plugin',
        },
      },
    };
    const api = {
      cfg: liveConfig,
      config: staleConfig,
    } as any;

    expect(resolveOpenClawMergedConfig(api)).toBe(liveConfig);
  });

  it('prefers plugin-bearing api.config over route-only api.cfg', () => {
    const fullConfig = {
      plugins: {
        slots: {
          memory: 'adapter-openclaw',
        },
      },
    };
    const routeConfig = {
      agents: {},
      session: {
        dmScope: 'main',
      },
    };
    const api = {
      cfg: routeConfig,
      config: fullConfig,
    } as any;

    expect(resolveOpenClawMergedConfig(api)).toBe(fullConfig);
  });

  it('does not treat route-only api.cfg as merged plugin config', () => {
    const routeConfig = {
      agents: {},
      session: {
        dmScope: 'main',
      },
    };
    const api = {
      config: {},
      cfg: routeConfig,
    } as any;

    expect(resolveOpenClawMergedConfig(api)).toBeUndefined();
    expect(resolveOpenClawRouteMetadataConfig(api)).toEqual(routeConfig);
  });

  it('keeps route metadata separate from direct plugin config fallback', () => {
    const routeConfig = {
      agents: {
        defaults: {
          workspace: '/workspace',
        },
      },
    };
    const directPluginConfig = {
      daemonUrl: 'http://localhost:9200',
      channel: { enabled: true, port: 0 },
    };
    const api = {
      cfg: routeConfig,
      pluginConfig: directPluginConfig,
    } as any;

    expect(resolveOpenClawMergedConfig(api)).toBeUndefined();
    expect(resolveOpenClawRouteMetadataConfig(api)).toEqual(routeConfig);
  });

  it('keeps session-only route metadata separate from merged plugin config', () => {
    const routeConfig = {
      session: {
        dmScope: 'main',
      },
    };
    const runtimeConfig = {
      plugins: {
        slots: {
          memory: 'other-plugin',
        },
      },
    };
    const api = {
      config: routeConfig,
      runtime: {
        config: runtimeConfig,
      },
    } as any;

    expect(resolveOpenClawMergedConfig(api)).toBe(runtimeConfig);
    expect(resolveOpenClawRouteMetadataConfig(api)).toEqual(routeConfig);
  });

  it('merges session-only route metadata with lower-priority workspace route metadata', () => {
    const api = {
      cfg: {
        session: {
          dmScope: 'main',
        },
      },
      config: {
        agents: {
          defaults: {
            workspace: '/workspace',
          },
        },
        session: {
          ttlMs: 30_000,
        },
      },
    } as any;

    expect(resolveOpenClawRouteMetadataConfig(api)).toEqual({
      agents: {
        defaults: {
          workspace: '/workspace',
        },
      },
      session: {
        ttlMs: 30_000,
        dmScope: 'main',
      },
    });
  });

  it('deep-merges memory and channel partials without dropping prior subconfig', () => {
    expect(mergeAdapterPluginConfigs(
      {
        daemonUrl: 'http://127.0.0.1:9200',
        memory: { enabled: true, memoryDir: '/memory' },
        channel: { enabled: true, port: 9201 },
      },
      {
        memory: { enabled: false },
        channel: { port: 9202 },
      },
    )).toEqual({
      daemonUrl: 'http://127.0.0.1:9200',
      memory: { enabled: false, memoryDir: '/memory' },
      channel: { enabled: true, port: 9202 },
    });
  });

  it('classifies module objects without enabled as partial overlays', () => {
    expect(isPartialAdapterConfigOverlay({
      channel: { port: 9801 },
    })).toBe(true);
    expect(isPartialAdapterConfigOverlay({
      memory: { memoryDir: '/memory' },
      channel: { port: 9801 },
    })).toBe(true);
    expect(isPartialAdapterConfigOverlay({
      channel: { enabled: false },
    })).toBe(true);
    expect(isPartialAdapterConfigOverlay({
      memory: { enabled: true },
    })).toBe(true);
    expect(isPartialAdapterConfigOverlay({
      daemonUrl: 'http://127.0.0.1:9200',
      memory: { enabled: true },
    })).toBe(false);
  });
});
