import type { OpenClawPluginApi } from './types.js';

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function looksLikeAdapterPluginConfig(value: unknown): boolean {
  if (!isObjectRecord(value)) return false;
  if (isObjectRecord(value.plugins) || isObjectRecord(value.agents) || typeof value.workspace === 'string') {
    return false;
  }
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

export function resolveOpenClawMergedConfig(api: OpenClawPluginApi): Record<string, unknown> | undefined {
  const anyApi = api as any;
  const runtime = anyApi?.runtime;
  return [
    anyApi?.cfg,
    runtime?.cfg,
    runtime?.config,
    anyApi?.config,
  ].find((candidate) => isObjectRecord(candidate) && !looksLikeAdapterPluginConfig(candidate));
}
