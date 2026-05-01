import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DkgNodePlugin } from './dist/index.js';

/** Module-level singleton - prevents duplicate registration during gateway multi-phase init. */
let instance = null;
const lifecycleServiceApis = new WeakMap();
let lifecycleOwnerToken = null;

export default function (api) {
  const log = api.logger ?? console;
  const { config, workspaceDir } = resolveEntryConfig(api);

  // Pass workspace directory to the API for auto-detection.
  if (workspaceDir && !api.workspaceDir) {
    api.workspaceDir = workspaceDir;
  }

  if (instance) {
    log.info?.('[dkg-entry] Re-registering plugin surfaces (channel, memory, tools) into new registry (gateway multi-phase init)');
    instance.updateConfig?.(config);
    instance.register(api);
    registerLifecycleService(api, log);
    syncSkillToWorkspace(workspaceDir, log);
    return;
  }

  log.info?.(
    `[dkg-entry] config (from OpenClaw plugin config) - daemonUrl: ${config.daemonUrl ?? 'http://127.0.0.1:9200'}, `
      + `memory.enabled: ${config.memory?.enabled}, `
      + `channel.enabled: ${config.channel?.enabled}, `
      + `registrationMode: ${api.registrationMode ?? 'full'}`,
  );

  const dkg = new DkgNodePlugin(config);
  dkg.register(api);
  instance = dkg;
  registerLifecycleService(api, log);

  // Sync SKILL.md to workspace so the agent always reads the latest version.
  // The CLI dist ships the canonical template; the workspace copy goes stale
  // after adapter/CLI upgrades unless re-synced. This runs on every plugin
  // load, is idempotent (skips when content matches), and non-fatal.
  syncSkillToWorkspace(workspaceDir, log);

  log.info?.('[dkg-entry] DkgNodePlugin registered');
}

function resolveEntryConfig(api) {
  const anyApi = api;
  const runtime = anyApi?.runtime;
  const fullConfigCandidates = [
    anyApi?.cfg,
    runtime?.cfg,
    runtime?.config,
    anyApi?.config,
  ].filter(isObject);
  const mergedConfig =
    fullConfigCandidates.find((candidate) => isObject(candidate.plugins) || isObject(candidate.agents)) ??
    {};
  const entryConfigs = fullConfigCandidates
    .map((candidate) => candidate?.plugins?.entries?.['adapter-openclaw']?.config)
    .filter(isObject);
  const directConfigs = [
    anyApi?.pluginConfig,
    looksLikePluginConfig(anyApi?.config) ? anyApi.config : undefined,
    runtime?.pluginConfig,
  ].filter(isObject);
  const config = mergePluginConfigs(...entryConfigs, ...directConfigs);

  if (process.env.DKG_DAEMON_URL) {
    config.daemonUrl = process.env.DKG_DAEMON_URL;
  }

  const workspaceDir =
    mergedConfig?.agents?.defaults?.workspace ??
    mergedConfig?.workspace ??
    api.workspaceDir ??
    config.installedWorkspace;
  return { config, workspaceDir };
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function looksLikePluginConfig(value) {
  if (!isObject(value)) return false;
  return [
    'daemonUrl',
    'dkgHome',
    'stateDir',
    'stateDirSource',
    'installedWorkspace',
    'memory',
    'channel',
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function mergePluginConfigs(...configs) {
  const merged = {};
  for (const config of configs) {
    const priorMemory = isObject(merged.memory) ? merged.memory : undefined;
    const priorChannel = isObject(merged.channel) ? merged.channel : undefined;
    const nextMemory = isObject(config.memory) ? config.memory : undefined;
    const nextChannel = isObject(config.channel) ? config.channel : undefined;
    Object.assign(merged, config);
    if (priorMemory || nextMemory) {
      if (nextMemory) {
        merged.memory = { ...(priorMemory ?? {}), ...nextMemory };
      } else if (!Object.prototype.hasOwnProperty.call(config, 'memory')) {
        merged.memory = priorMemory;
      }
    }
    if (priorChannel || nextChannel) {
      if (nextChannel) {
        merged.channel = { ...(priorChannel ?? {}), ...nextChannel };
      } else if (!Object.prototype.hasOwnProperty.call(config, 'channel')) {
        merged.channel = priorChannel;
      }
    }
  }
  return merged;
}

function syncSkillToWorkspace(workspaceDir, log) {
  try {
    // Try both monorepo and npm-installed relative paths. The CLI
    // package ships `skills/` in its `files` array. In the monorepo the
    // directory is named `cli`; on npm it's `dkg` (the package name).
    const candidates = [
      fileURLToPath(new URL('../cli/skills/dkg-node/SKILL.md', import.meta.url)),
      fileURLToPath(new URL('../dkg/skills/dkg-node/SKILL.md', import.meta.url)),
    ];
    const skillSrc = candidates.find(p => existsSync(p));
    if (workspaceDir && skillSrc) {
      const skillDest = join(workspaceDir, 'skills', 'dkg-node', 'SKILL.md');
      const srcContent = readFileSync(skillSrc, 'utf-8');
      if (!existsSync(skillDest) || readFileSync(skillDest, 'utf-8') !== srcContent) {
        mkdirSync(dirname(skillDest), { recursive: true });
        writeFileSync(skillDest, srcContent, 'utf-8');
        log.info?.('[dkg-entry] SKILL.md synced to workspace');
      }
    }
  } catch (err) {
    log.debug?.(`[dkg-entry] SKILL.md sync skipped: ${err.message}`);
  }
}

function registerLifecycleService(api, log) {
  if (!instance || typeof api.registerService !== 'function') return;
  if (lifecycleServiceApis.get(api) === instance) return;

  const serviceInstance = instance;
  const serviceToken = {};
  try {
    api.registerService({
      name: 'dkg-adapter-openclaw-runtime',
      start: async () => {},
      stop: async () => {
        if (lifecycleOwnerToken !== serviceToken) return;
        lifecycleOwnerToken = null;
        try {
          await serviceInstance.stop();
        } finally {
          if (instance === serviceInstance) {
            instance = null;
          }
        }
      },
    });
    lifecycleServiceApis.set(api, serviceInstance);
    lifecycleOwnerToken = serviceToken;
  } catch (err) {
    log.debug?.(`[dkg-entry] lifecycle service registration skipped: ${err.message}`);
  }
}
