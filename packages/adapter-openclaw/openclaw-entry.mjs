import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DkgNodePlugin,
  isObjectRecord,
  isPartialAdapterConfigOverlay,
  isStateMetadataOnlyAdapterConfig,
  looksLikeAdapterPluginConfig,
  mergeAdapterPluginConfigs,
} from './dist/index.js';

/** Module-level singleton - prevents duplicate registration during gateway multi-phase init. */
let instance = null;
const lifecycleServiceApis = new WeakMap();
const entryAssignedWorkspaceDirMarkers = new WeakMap();
let lifecycleOwnerToken = null;

export default function (api) {
  const log = api.logger ?? console;
  const { config, bootstrapConfig, workspaceDir, apiWorkspaceDir, configIsPartial } = resolveEntryConfig(api, {
    hasInstance: instance !== null,
  });

  // Pass only runtime/cfg workspace evidence to the API for auto-detection.
  // `installedWorkspace` remains setup metadata consumed by DkgNodePlugin's
  // resolver; writing it onto api.workspaceDir would make it look like a live
  // runtime workspace and could mask a later higher-priority runtime value.
  if (apiWorkspaceDir) {
    setEntryAssignedWorkspaceDir(api, apiWorkspaceDir);
  } else {
    clearEntryAssignedWorkspaceDir(api);
  }

  if (instance) {
    log.info?.('[dkg-entry] Re-registering plugin surfaces (channel, memory, tools) into new registry (gateway multi-phase init)');
    if (registrationModeEnablesRuntime(api)) {
      instance.updateConfig?.(config, { partial: configIsPartial });
    } else {
      log.debug?.('[dkg-entry] Deferred singleton config update during metadata-only registration pass');
    }
    instance.register(api);
    registerLifecycleService(api, log);
    if (registrationModeEnablesRuntime(api)) {
      syncSkillToWorkspace(workspaceDir, log);
    }
    return;
  }

  log.info?.(
    `[dkg-entry] config (from OpenClaw plugin config) - daemonUrl: ${bootstrapConfig.daemonUrl ?? 'http://127.0.0.1:9200'}, `
      + `memory.enabled: ${bootstrapConfig.memory?.enabled}, `
      + `channel.enabled: ${bootstrapConfig.channel?.enabled}, `
      + `registrationMode: ${api.registrationMode ?? 'full'}`,
  );

  const dkg = new DkgNodePlugin(bootstrapConfig);
  dkg.register(api);
  instance = dkg;
  registerLifecycleService(api, log);

  // Sync SKILL.md to workspace so the agent always reads the latest version.
  // The CLI dist ships the canonical template; the workspace copy goes stale
  // after adapter/CLI upgrades unless re-synced. This runs on every plugin
  // load, is idempotent (skips when content matches), and non-fatal.
  if (registrationModeEnablesRuntime(api)) {
    syncSkillToWorkspace(workspaceDir, log);
  }

  log.info?.('[dkg-entry] DkgNodePlugin registered');
}

function resolveEntryConfig(api, options = {}) {
  const anyApi = api;
  const runtime = anyApi?.runtime;
  const currentFullConfigCandidatesMostToLeast = [
    anyApi?.cfg,
    anyApi?.config,
  ].filter(isObjectRecord);
  const currentFullConfigCandidatesLeastToMost = [
    anyApi?.config,
    anyApi?.cfg,
  ].filter(isObjectRecord);
  const fallbackFullConfigCandidatesMostToLeast = [
    runtime?.cfg,
    runtime?.config,
  ].filter(isObjectRecord);
  const currentWorkspaceConfig = currentFullConfigCandidatesMostToLeast.find(hasWorkspaceConfig);
  const fallbackWorkspaceConfig = fallbackFullConfigCandidatesMostToLeast.find(hasWorkspaceConfig);
  const currentEntryConfigs = currentFullConfigCandidatesLeastToMost
    .map((candidate) => candidate?.plugins?.entries?.['adapter-openclaw']?.config)
    .filter(isObjectRecord);
  const fallbackConfigSources = [
    directPluginConfigFrom(runtime?.pluginConfig),
    ...adapterConfigSourcesFromFullConfig(runtime?.config),
    ...adapterConfigSourcesFromFullConfig(runtime?.cfg),
  ].filter(isObjectRecord);
  const currentDirectApiConfigs = [
    directApiConfigFrom(anyApi?.config),
    directApiConfigFrom(anyApi?.cfg),
  ].filter(isObjectRecord);
  const hasCurrentDirectApiConfig = currentDirectApiConfigs.length > 0;
  const currentPluginConfig = directPluginConfigFrom(anyApi?.pluginConfig);
  const strongestCurrentEntryConfig = currentEntryConfigs[currentEntryConfigs.length - 1];
  const strongestCurrentEntryConfigIsMetadataOnly =
    isStateMetadataOnlyAdapterConfig(strongestCurrentEntryConfig);
  const currentPluginConfigForMetadataEntry =
    strongestCurrentEntryConfigIsMetadataOnly
      ? stripStateMetadataFromAdapterConfig(currentPluginConfig)
      : currentPluginConfig;
  const currentDirectConfigs = hasCurrentDirectApiConfig
    ? currentDirectApiConfigs
    : currentEntryConfigs.length === 0 || strongestCurrentEntryConfigIsMetadataOnly
      ? [currentPluginConfigForMetadataEntry].filter(isObjectRecord)
      : [];
  const currentDirectConfigsArePartialOverlays =
    currentDirectConfigs.length > 0 &&
    currentDirectConfigs.every(isPartialAdapterConfigOverlay);
  const hasCurrentConfigSource = currentEntryConfigs.length > 0 || currentDirectConfigs.length > 0;
  const currentConfigSourcesForMerge =
    !hasCurrentDirectApiConfig &&
    strongestCurrentEntryConfigIsMetadataOnly &&
    currentDirectConfigs.length > 0
      ? [
          ...(currentDirectConfigsArePartialOverlays
            ? currentEntryConfigs.slice(0, -1)
            : currentEntryConfigs.slice(0, -1).filter(isStateMetadataOnlyAdapterConfig)),
          ...currentDirectConfigs,
          strongestCurrentEntryConfig,
        ].filter(isObjectRecord)
      : [
          ...currentEntryConfigs,
          ...(currentDirectConfigs.length > 0 ? currentDirectConfigs : []),
        ];
  const configSources = hasCurrentConfigSource
    ? currentConfigSourcesForMerge
    : fallbackConfigSources;
  const config = mergeAdapterPluginConfigs(...configSources);
  const hasConfigSource = configSources.length > 0;
  const configIsPartial =
    !hasConfigSource ||
    configSources.every(isPartialAdapterConfigOverlay);
  const currentConfigSources = [
    ...currentEntryConfigs,
    ...currentDirectConfigs,
  ];
  const daemonUrlFromCurrentConfig = currentConfigSources.some((candidate) =>
    Object.prototype.hasOwnProperty.call(candidate, 'daemonUrl')
  );
  const dkgHomeFromCurrentConfig = currentConfigSources.some((candidate) =>
    Object.prototype.hasOwnProperty.call(candidate, 'dkgHome')
  );

  const daemonUrlFromEnv = !!process.env.DKG_DAEMON_URL;
  if (process.env.DKG_DAEMON_URL) {
    config.daemonUrl = process.env.DKG_DAEMON_URL;
  }
  const fallbackConfig = mergeAdapterPluginConfigs(...fallbackConfigSources);
  if (configIsPartial && (daemonUrlFromEnv || daemonUrlFromCurrentConfig) && !dkgHomeFromCurrentConfig) {
    delete fallbackConfig.dkgHome;
    if (!Object.prototype.hasOwnProperty.call(config, 'dkgHome')) {
      config.dkgHome = undefined;
    }
  }
  const bootstrapConfig = configIsPartial
    ? mergeAdapterPluginConfigs(fallbackConfig, config)
    : config;

  const apiWorkspaceDir = apiWorkspaceDirFrom(anyApi);
  const installedWorkspaceDir = typeof config.installedWorkspace === 'string'
    ? config.installedWorkspace
    : undefined;
  const currentWorkspaceDir = workspaceDirFromConfig(currentWorkspaceConfig);
  const fallbackWorkspaceDir = workspaceDirFromConfig(fallbackWorkspaceConfig);
  const currentDirectConfigMatchesInstalledWorkspace = currentDirectConfigs.some((candidate) =>
    setupDefaultStateMetadataMatchesWorkspace(candidate, installedWorkspaceDir)
  );
  // Entry setup metadata is useful for rejecting lower-priority stale route
  // workspaces, but a live route workspace on api.cfg remains stronger.
  const currentEntryConfigMatchesInstalledWorkspace =
    (
      !hasCurrentDirectApiConfig ||
      currentWorkspaceConfig !== anyApi?.cfg
    ) &&
    currentEntryConfigs.some((candidate) =>
      setupDefaultStateMetadataMatchesWorkspace(candidate, installedWorkspaceDir)
    );
  const currentWorkspaceMatchesConfiguredStateDir =
    stateDirMatchesWorkspaceDefault(config.stateDir, currentWorkspaceDir);
  const currentRouteWorkspaceIsStale =
    (currentDirectConfigMatchesInstalledWorkspace || currentEntryConfigMatchesInstalledWorkspace) &&
    !!installedWorkspaceDir &&
    !!currentWorkspaceDir &&
    !currentWorkspaceMatchesConfiguredStateDir;
  const configWorkspaceDir = currentRouteWorkspaceIsStale
    ? fallbackWorkspaceDir
    : currentWorkspaceDir ?? fallbackWorkspaceDir;
  const workspaceDir = apiWorkspaceDir ?? configWorkspaceDir ?? installedWorkspaceDir;
  const apiWorkspaceDirToAssign = apiWorkspaceDir ? undefined : configWorkspaceDir;
  return { config, bootstrapConfig, workspaceDir, apiWorkspaceDir: apiWorkspaceDirToAssign, configIsPartial };
}

function apiWorkspaceDirFrom(api) {
  if (typeof api?.workspaceDir !== 'string') return undefined;
  return entryAssignedWorkspaceDirMarkers.has(api) ? undefined : api.workspaceDir;
}

function hasWorkspaceConfig(config) {
  return (
    typeof config?.agents?.defaults?.workspace === 'string' ||
    typeof config?.workspace === 'string'
  );
}

function workspaceDirFromConfig(config) {
  return config?.agents?.defaults?.workspace ?? config?.workspace;
}

function stateDirMatchesWorkspaceDefault(stateDir, workspaceDir) {
  if (typeof stateDir !== 'string' || typeof workspaceDir !== 'string') return false;
  const normalized = normalizePath(stateDir);
  return (
    normalized === normalizePath(join(workspaceDir, '.dkg-adapter')) ||
    normalized === normalizePath(join(workspaceDir, '.openclaw'))
  );
}

function setupDefaultStateMetadataMatchesWorkspace(config, workspaceDir) {
  return (
    config?.stateDirSource === 'setup-default' &&
    config?.installedWorkspace === workspaceDir &&
    stateDirMatchesWorkspaceDefault(config?.stateDir, workspaceDir)
  );
}

function normalizePath(value) {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function setEntryAssignedWorkspaceDir(api, workspaceDir) {
  const marker = {};
  let currentValue = workspaceDir;
  entryAssignedWorkspaceDirMarkers.set(api, marker);
  Object.defineProperty(api, 'workspaceDir', {
    configurable: true,
    enumerable: true,
    get() {
      return currentValue;
    },
    set(value) {
      currentValue = value;
      if (entryAssignedWorkspaceDirMarkers.get(api) === marker) {
        entryAssignedWorkspaceDirMarkers.delete(api);
      }
    },
  });
}

function clearEntryAssignedWorkspaceDir(api) {
  if (!entryAssignedWorkspaceDirMarkers.has(api)) return;
  entryAssignedWorkspaceDirMarkers.delete(api);
  delete api.workspaceDir;
}

function directApiConfigFrom(config) {
  if (!isObjectRecord(config)) return undefined;
  if (
    isObjectRecord(config.plugins) ||
    isObjectRecord(config.agents) ||
    isObjectRecord(config.session) ||
    typeof config.workspace === 'string'
  ) {
    return undefined;
  }
  if (looksLikeAdapterPluginConfig(config)) {
    return config;
  }
  return undefined;
}

function registrationModeEnablesRuntime(api) {
  const mode = api?.registrationMode ?? 'full';
  return mode !== 'setup-only' && mode !== 'cli-metadata';
}

function directPluginConfigFrom(config) {
  if (!isObjectRecord(config)) return undefined;
  if (looksLikeAdapterPluginConfig(config)) {
    return config;
  }
  return undefined;
}

function adapterConfigSourcesFromFullConfig(config) {
  if (!isObjectRecord(config)) return [];
  return [
    config.plugins?.entries?.['adapter-openclaw']?.config,
    directPluginConfigFrom(config),
  ].filter(isObjectRecord);
}

function stripStateMetadataFromAdapterConfig(config) {
  if (!isObjectRecord(config)) return undefined;
  const {
    stateDir: _stateDir,
    stateDirSource: _stateDirSource,
    installedWorkspace: _installedWorkspace,
    ...rest
  } = config;
  return Object.keys(rest).length > 0 ? rest : undefined;
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
