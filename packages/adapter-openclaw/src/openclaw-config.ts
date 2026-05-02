import type { OpenClawPluginApi } from './types.js';

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const ADAPTER_PLUGIN_CONFIG_KEYS = [
  'daemonUrl',
  'dkgHome',
  'stateDir',
  'stateDirSource',
  'installedWorkspace',
  'memory',
  'channel',
] as const;

const STATE_METADATA_CONFIG_KEYS = [
  'stateDir',
  'stateDirSource',
  'installedWorkspace',
] as const;

const PARTIAL_OVERLAY_CONFIG_KEYS = [
  'daemonUrl',
  'dkgHome',
  'stateDir',
  'stateDirSource',
  'installedWorkspace',
] as const;

const PARTIAL_MODULE_CONFIG_KEYS = [
  'memory',
  'channel',
] as const;

export function looksLikeAdapterPluginConfig(value: unknown): boolean {
  if (!isObjectRecord(value)) return false;
  if (
    isObjectRecord(value.plugins) ||
    isObjectRecord(value.agents) ||
    isObjectRecord(value.session) ||
    typeof value.workspace === 'string'
  ) {
    return false;
  }
  return ADAPTER_PLUGIN_CONFIG_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function isStateMetadataOnlyAdapterConfig(value: unknown): boolean {
  if (!isObjectRecord(value) || !looksLikeAdapterPluginConfig(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) =>
    (STATE_METADATA_CONFIG_KEYS as readonly string[]).includes(key)
  );
}

export function isPartialAdapterConfigOverlay(value: unknown): boolean {
  if (!isObjectRecord(value) || !looksLikeAdapterPluginConfig(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) =>
    (PARTIAL_OVERLAY_CONFIG_KEYS as readonly string[]).includes(key) ||
    isPartialModuleConfigOverlay(key, value[key])
  );
}

function isPartialModuleConfigOverlay(key: string, value: unknown): boolean {
  return (
    (PARTIAL_MODULE_CONFIG_KEYS as readonly string[]).includes(key) &&
    isObjectRecord(value) &&
    !Object.prototype.hasOwnProperty.call(value, 'enabled')
  );
}

export function mergeAdapterPluginConfigs<T extends Record<string, unknown>>(
  ...configs: Array<T | undefined>
): T {
  const merged: Record<string, unknown> = {};
  for (const config of configs) {
    if (!isObjectRecord(config)) continue;
    const priorMemory = isObjectRecord(merged.memory) ? merged.memory : undefined;
    const priorChannel = isObjectRecord(merged.channel) ? merged.channel : undefined;
    const nextMemory = isObjectRecord(config.memory) ? config.memory : undefined;
    const nextChannel = isObjectRecord(config.channel) ? config.channel : undefined;
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
  return merged as T;
}

function hasMergedPluginConfigSignal(value: Record<string, unknown>): boolean {
  return isObjectRecord(value.plugins);
}

function hasRouteMetadataConfigSignal(value: Record<string, unknown>): boolean {
  return isObjectRecord(value.agents) || isObjectRecord(value.session) || typeof value.workspace === 'string';
}

export function resolveOpenClawMergedConfig(api: OpenClawPluginApi): Record<string, unknown> | undefined {
  const anyApi = api as any;
  const runtime = anyApi?.runtime;
  const candidates = [
    anyApi?.cfg,
    anyApi?.config,
    runtime?.cfg,
    runtime?.config,
  ].filter((candidate) =>
    isObjectRecord(candidate) &&
    !looksLikeAdapterPluginConfig(candidate) &&
    hasMergedPluginConfigSignal(candidate)
  );
  return candidates[0];
}

export function resolveOpenClawRouteMetadataConfig(api: OpenClawPluginApi): Record<string, unknown> | undefined {
  const anyApi = api as any;
  const runtime = anyApi?.runtime;
  const candidates = [
    runtime?.config,
    runtime?.cfg,
    anyApi?.config,
    anyApi?.cfg,
  ].filter((candidate) =>
    isObjectRecord(candidate) &&
    !looksLikeAdapterPluginConfig(candidate) &&
    !hasMergedPluginConfigSignal(candidate) &&
    hasRouteMetadataConfigSignal(candidate)
  );
  return candidates.length > 0
    ? mergeRouteMetadataConfigs(...candidates)
    : undefined;
}

function mergeRouteMetadataConfigs(
  ...configs: Record<string, unknown>[]
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const config of configs) {
    const priorAgents = isObjectRecord(merged.agents) ? merged.agents : undefined;
    const priorSession = isObjectRecord(merged.session) ? merged.session : undefined;
    const nextAgents = isObjectRecord(config.agents) ? config.agents : undefined;
    const nextSession = isObjectRecord(config.session) ? config.session : undefined;
    Object.assign(merged, config);
    if (priorAgents || nextAgents) {
      merged.agents = { ...(priorAgents ?? {}), ...(nextAgents ?? {}) };
      const priorDefaults = isObjectRecord(priorAgents?.defaults) ? priorAgents.defaults : undefined;
      const nextDefaults = isObjectRecord(nextAgents?.defaults) ? nextAgents.defaults : undefined;
      if (priorDefaults || nextDefaults) {
        (merged.agents as Record<string, unknown>).defaults = {
          ...(priorDefaults ?? {}),
          ...(nextDefaults ?? {}),
        };
      }
    }
    if (priorSession || nextSession) {
      merged.session = { ...(priorSession ?? {}), ...(nextSession ?? {}) };
    }
  }
  return merged;
}
