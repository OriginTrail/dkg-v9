import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DkgNodePlugin,
  isObjectRecord,
  isStateMetadataOnlyAdapterConfig,
  looksLikeAdapterPluginConfig,
  mergeAdapterPluginConfigs,
} from './dist/index.js';

/** Module-level singleton - prevents duplicate registration during gateway multi-phase init. */
let instance = null;
const lifecycleServiceApis = new WeakMap();
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
    api.workspaceDir = apiWorkspaceDir;
  }

  if (instance) {
    log.info?.('[dkg-entry] Re-registering plugin surfaces (channel, memory, tools) into new registry (gateway multi-phase init)');
    instance.updateConfig?.(config, { partial: configIsPartial });
    instance.register(api);
    registerLifecycleService(api, log);
    syncSkillToWorkspace(workspaceDir, log);
    return;
  }

  log.info?.(
    `[dkg-entry] config (from OpenClaw plugin config) - daemonUrl: ${config.daemonUrl ?? 'http://127.0.0.1:9200'}, `
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
  syncSkillToWorkspace(workspaceDir, log);

  log.info?.('[dkg-entry] DkgNodePlugin registered');
}

function resolveEntryConfig(api, options = {}) {
  const anyApi = api;
  const runtime = anyApi?.runtime;
  const fullConfigCandidatesMostToLeast = [
    anyApi?.cfg,
    anyApi?.config,
    runtime?.cfg,
    runtime?.config,
  ].filter(isObjectRecord);
  const currentFullConfigCandidatesLeastToMost = [
    anyApi?.config,
    anyApi?.cfg,
  ].filter(isObjectRecord);
  const fallbackFullConfigCandidatesLeastToMost = [
    runtime?.config,
    runtime?.cfg,
  ].filter(isObjectRecord);
  const mergedConfig =
    fullConfigCandidatesMostToLeast.find((candidate) => isObjectRecord(candidate.plugins) || isObjectRecord(candidate.agents)) ??
    {};
  const workspaceConfig =
    fullConfigCandidatesMostToLeast.find((candidate) =>
      typeof candidate?.agents?.defaults?.workspace === 'string' ||
      typeof candidate?.workspace === 'string'
    ) ??
    {};
  const currentEntryConfigs = currentFullConfigCandidatesLeastToMost
    .map((candidate) => candidate?.plugins?.entries?.['adapter-openclaw']?.config)
    .filter(isObjectRecord);
  const fallbackEntryConfigs = fallbackFullConfigCandidatesLeastToMost
    .map((candidate) => candidate?.plugins?.entries?.['adapter-openclaw']?.config)
    .filter(isObjectRecord);
  const currentDirectConfigs = [
    directApiConfigFrom(anyApi?.config),
    directPluginConfigFrom(anyApi?.pluginConfig, { allowEmpty: options.hasInstance === true }),
  ].filter(isObjectRecord);
  const fallbackDirectConfigs = [
    directPluginConfigFrom(runtime?.pluginConfig),
  ].filter(isObjectRecord);
  const hasCurrentConfigSource = currentEntryConfigs.length > 0 || currentDirectConfigs.length > 0;
  const entryConfigs = hasCurrentConfigSource ? currentEntryConfigs : fallbackEntryConfigs;
  const directConfigs = currentDirectConfigs.length > 0
    ? currentDirectConfigs
    : hasCurrentConfigSource
      ? []
      : fallbackDirectConfigs;
  const config = mergeAdapterPluginConfigs(...entryConfigs, ...directConfigs);
  const hasConfigSource = entryConfigs.length > 0 || directConfigs.length > 0;
  const configIsPartial =
    !hasConfigSource ||
    (entryConfigs.length === 0 && directConfigs.every(isStateMetadataOnlyAdapterConfig));

  if (process.env.DKG_DAEMON_URL) {
    config.daemonUrl = process.env.DKG_DAEMON_URL;
  }
  const fallbackConfig = mergeAdapterPluginConfigs(...fallbackEntryConfigs, ...fallbackDirectConfigs);
  const bootstrapConfig = configIsPartial
    ? mergeAdapterPluginConfigs(fallbackConfig, config)
    : config;

  const workspaceDir =
    workspaceConfig?.agents?.defaults?.workspace ??
    workspaceConfig?.workspace ??
    mergedConfig?.agents?.defaults?.workspace ??
    mergedConfig?.workspace ??
    anyApi?.workspaceDir;
  const syncWorkspaceDir =
    workspaceDir ??
    config.installedWorkspace;
  return { config, bootstrapConfig, workspaceDir: syncWorkspaceDir, apiWorkspaceDir: workspaceDir, configIsPartial };
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

function directPluginConfigFrom(config, options = {}) {
  if (!isObjectRecord(config)) return undefined;
  if (options.allowEmpty && Object.keys(config).length === 0) {
    return config;
  }
  if (looksLikeAdapterPluginConfig(config)) {
    return config;
  }
  return undefined;
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
