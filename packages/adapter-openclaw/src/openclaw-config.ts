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

function hasOpenClawConfigSignal(value: Record<string, unknown>): boolean {
  return (
    isObjectRecord(value.plugins) ||
    isObjectRecord(value.agents) ||
    isObjectRecord(value.session) ||
    typeof value.workspace === 'string'
  );
}

export function resolveOpenClawMergedConfig(api: OpenClawPluginApi): Record<string, unknown> | undefined {
  const anyApi = api as any;
  const runtime = anyApi?.runtime;
  return [
    anyApi?.cfg,
    anyApi?.config,
    runtime?.cfg,
    runtime?.config,
  ].find((candidate) =>
    isObjectRecord(candidate) &&
    !looksLikeAdapterPluginConfig(candidate) &&
    hasOpenClawConfigSignal(candidate)
  );
}
