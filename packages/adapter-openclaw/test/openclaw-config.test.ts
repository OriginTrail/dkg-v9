import { describe, expect, it } from 'vitest';
import {
  looksLikeAdapterPluginConfig,
  mergeAdapterPluginConfigs,
  resolveOpenClawMergedConfig,
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

  it('skips empty api.config and falls back to api.cfg route config', () => {
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

    expect(resolveOpenClawMergedConfig(api)).toBe(routeConfig);
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
});
