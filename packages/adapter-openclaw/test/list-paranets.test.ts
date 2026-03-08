import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DkgNodePlugin } from '../src/DkgNodePlugin.js';
import type { OpenClawPluginApi, OpenClawTool } from '../src/types.js';

const SAMPLE_PARANETS = [
  { id: 'paranet-1', name: 'Research', subscribed: true, synced: true },
  { id: 'paranet-2', name: 'Testing', subscribed: false, synced: false },
];

function collectTools(plugin: DkgNodePlugin): OpenClawTool[] {
  const tools: OpenClawTool[] = [];
  const mockApi: OpenClawPluginApi = {
    config: {},
    registerTool: (tool) => tools.push(tool),
    registerHook: () => {},
    on: () => {},
    logger: {},
  };
  plugin.register(mockApi);
  return tools;
}

describe('dkg_list_paranets tool', () => {
  let plugin: DkgNodePlugin;

  beforeEach(() => {
    plugin = new DkgNodePlugin();
  });

  it('is present in the registered tools list', () => {
    const tools = collectTools(plugin);
    const tool = tools.find(t => t.name === 'dkg_list_paranets');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('paranets');
    expect(tool!.parameters.required).toEqual([]);
  });

  it('returns paranets array and count on success', async () => {
    const tools = collectTools(plugin);
    const tool = tools.find(t => t.name === 'dkg_list_paranets')!;

    const mockAgent = { listParanets: vi.fn().mockResolvedValue(SAMPLE_PARANETS) };
    vi.spyOn(plugin, 'start').mockResolvedValue(undefined);
    (plugin as any).agent = mockAgent;

    const result = await tool.execute('call-1', {});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.paranets).toEqual(SAMPLE_PARANETS);
    expect(parsed.count).toBe(2);
    expect(mockAgent.listParanets).toHaveBeenCalledOnce();
  });

  it('returns error when listParanets throws', async () => {
    const tools = collectTools(plugin);
    const tool = tools.find(t => t.name === 'dkg_list_paranets')!;

    const mockAgent = { listParanets: vi.fn().mockRejectedValue(new Error('network failure')) };
    vi.spyOn(plugin, 'start').mockResolvedValue(undefined);
    (plugin as any).agent = mockAgent;

    const result = await tool.execute('call-2', {});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.error).toBe('network failure');
  });
});
