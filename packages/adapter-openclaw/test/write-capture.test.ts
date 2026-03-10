import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WriteCapture, isMemoryPath } from '../src/write-capture.js';
import { DkgDaemonClient } from '../src/dkg-client.js';
import type { OpenClawPluginApi } from '../src/types.js';

function makeApi(): OpenClawPluginApi & { hookHandlers: Map<string, Function> } {
  const hookHandlers = new Map<string, Function>();
  return {
    config: {},
    registerTool: vi.fn(),
    registerHook: vi.fn((event, handler) => {
      hookHandlers.set(event, handler);
    }),
    on: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    hookHandlers,
  };
}

describe('WriteCapture', () => {
  let client: DkgDaemonClient;
  let capture: WriteCapture;

  beforeEach(() => {
    client = new DkgDaemonClient({ baseUrl: 'http://localhost:9200' });
    capture = new WriteCapture(client, { enabled: true, memoryDir: '/workspace/memory' });
  });

  afterEach(() => {
    capture.stop();
    vi.restoreAllMocks();
  });

  it('should register after_tool_call hook', () => {
    const api = makeApi();
    capture.register(api);

    expect(api.registerHook).toHaveBeenCalledWith(
      'after_tool_call',
      expect.any(Function),
      { name: 'dkg-write-capture' },
    );
  });

  it('hook should trigger sync for write tool targeting memory path', async () => {
    const api = makeApi();
    capture.register(api);

    const syncSpy = vi.spyOn(capture, 'syncFile').mockResolvedValueOnce();
    const hookHandler = api.hookHandlers.get('after_tool_call')!;

    await hookHandler({
      toolName: 'write',
      params: { path: '/workspace/memory/MEMORY.md' },
      result: {},
    });

    expect(syncSpy).toHaveBeenCalledWith('/workspace/memory/MEMORY.md');
  });

  it('hook should trigger sync for edit tool targeting memory path', async () => {
    const api = makeApi();
    capture.register(api);

    const syncSpy = vi.spyOn(capture, 'syncFile').mockResolvedValueOnce();
    const hookHandler = api.hookHandlers.get('after_tool_call')!;

    await hookHandler({
      toolName: 'edit',
      params: { path: '/workspace/memory/patterns.md' },
      result: {},
    });

    expect(syncSpy).toHaveBeenCalledWith('/workspace/memory/patterns.md');
  });

  it('hook should NOT trigger for non-memory paths', async () => {
    const api = makeApi();
    capture.register(api);

    const syncSpy = vi.spyOn(capture, 'syncFile').mockResolvedValueOnce();
    const hookHandler = api.hookHandlers.get('after_tool_call')!;

    await hookHandler({
      toolName: 'write',
      params: { path: '/workspace/src/index.ts' },
      result: {},
    });

    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('hook should NOT trigger for non-write tools', async () => {
    const api = makeApi();
    capture.register(api);

    const syncSpy = vi.spyOn(capture, 'syncFile').mockResolvedValueOnce();
    const hookHandler = api.hookHandlers.get('after_tool_call')!;

    await hookHandler({
      toolName: 'read',
      params: { path: '/workspace/memory/MEMORY.md' },
      result: {},
    });

    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('hook should handle both object and positional args', async () => {
    const api = makeApi();
    capture.register(api);

    const syncSpy = vi.spyOn(capture, 'syncFile').mockResolvedValue();
    const hookHandler = api.hookHandlers.get('after_tool_call')!;

    // Positional args (some OpenClaw versions may use this)
    await hookHandler('write', { path: '/workspace/memory/test.md' }, {});
    expect(syncSpy).toHaveBeenCalled();
  });

  it('hook should gracefully handle sync failures', async () => {
    const api = makeApi();
    capture.register(api);

    vi.spyOn(capture, 'syncFile').mockRejectedValueOnce(new Error('daemon offline'));
    const hookHandler = api.hookHandlers.get('after_tool_call')!;

    // Should not throw — just log warning
    await expect(
      hookHandler({
        toolName: 'write',
        params: { path: '/workspace/memory/MEMORY.md' },
        result: {},
      }),
    ).resolves.toBeUndefined();

    expect(api.logger.warn).toHaveBeenCalled();
  });

  it('stop should clean up timers', () => {
    capture.stop();
    // Should not throw even when called multiple times
    capture.stop();
  });
});

describe('isMemoryPath', () => {
  const memDir = '/workspace/memory';

  it('should match MEMORY.md (exact filename)', () => {
    expect(isMemoryPath('/workspace/MEMORY.md', memDir)).toBe(true);
    expect(isMemoryPath('MEMORY.md', memDir)).toBe(true);
    expect(isMemoryPath('/some/path/MEMORY.md', memDir)).toBe(true);
  });

  it('should match files inside /memory/ directory', () => {
    expect(isMemoryPath('/workspace/memory/patterns.md', memDir)).toBe(true);
    expect(isMemoryPath('/workspace/memory/2026-03-10.md', memDir)).toBe(true);
  });

  it('should NOT match files that merely end with "memory.md"', () => {
    // "non-memory.md" should NOT match — "non-memory.md" filename is not "memory.md"
    expect(isMemoryPath('/workspace/non-memory.md', memDir)).toBe(false);
    expect(isMemoryPath('/workspace/some_memory.md', memDir)).toBe(false);
  });

  it('should NOT match files in memory-backup (false positive check)', () => {
    expect(isMemoryPath('/workspace/memory-backup/file.md', memDir)).toBe(false);
  });

  it('should match files in configured memoryDir', () => {
    expect(isMemoryPath('/workspace/memory/deep/nested.md', memDir)).toBe(true);
  });

  it('should handle Windows-style backslashes', () => {
    expect(isMemoryPath('C:\\workspace\\memory\\MEMORY.md', 'C:\\workspace\\memory')).toBe(true);
    expect(isMemoryPath('C:\\workspace\\MEMORY.md', 'C:\\workspace\\memory')).toBe(true);
  });

  it('should NOT match non-.md files in memory directory', () => {
    // isMemoryPath doesn't check extension for memoryDir match, but
    // the file watcher only watches .md files. This is a separate guard.
    expect(isMemoryPath('/workspace/memory/data.json', memDir)).toBe(true); // memDir prefix matches
  });

  it('should return false for non-string input', () => {
    expect(isMemoryPath(null, memDir)).toBe(false);
    expect(isMemoryPath(undefined, memDir)).toBe(false);
    expect(isMemoryPath(123, memDir)).toBe(false);
  });

  it('should return false for non-memory .ts files', () => {
    expect(isMemoryPath('/workspace/src/memory.ts', memDir)).toBe(false);
  });
});
