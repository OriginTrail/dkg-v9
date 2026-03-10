/**
 * WriteCapture — Spike B: Hook-based + file-watcher memory write capture.
 *
 * OpenClaw's MemorySearchManager is read-only.  Memory writes happen through
 * three paths that all bypass the memory plugin:
 *
 *   Path 1: Agent tool calls (write/edit to memory files) → after_tool_call hook
 *   Path 2: Pre-compaction memory flush (wrapped write tool) → after_tool_call hook
 *   Path 3: session-memory hook direct writes → file watcher only
 *
 * This module captures writes from all three paths and syncs them to the
 * DKG agent-memory graph via the daemon HTTP API.
 *
 * Defense in depth: hooks fire immediately; file watcher is the universal
 * fallback with a configurable debounce (default 1.5s, matching OpenClaw's
 * existing pattern).
 */

import { readFile, stat } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import type { DkgDaemonClient } from './dkg-client.js';
import type { DkgOpenClawConfig, OpenClawPluginApi } from './types.js';

const AGENT_MEMORY_PARANET = 'agent-memory';

/** N-Quads namespace prefixes matching ChatMemoryManager's schema. */
const NS = {
  schema: 'http://schema.org/',
  dkg: 'http://dkg.io/ontology/',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  memory: 'urn:dkg:memory:',
};

export class WriteCapture {
  private api: OpenClawPluginApi | null = null;
  private watcher: FSWatcher | null = null;
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly memoryDir: string;
  private readonly debounceMs: number;
  /** Track files we've already synced (by mtime) to avoid duplicate work. */
  private readonly syncedMtimes = new Map<string, number>();

  constructor(
    private readonly client: DkgDaemonClient,
    private readonly config: NonNullable<DkgOpenClawConfig['memory']>,
  ) {
    this.memoryDir = config.memoryDir ?? '';
    this.debounceMs = config.watchDebounceMs ?? 1500;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  register(api: OpenClawPluginApi): void {
    this.api = api;

    // --- Hook-based capture (Path 1 + 2) ---
    api.registerHook('after_tool_call', async (...args: any[]) => {
      // The hook args shape depends on OpenClaw version.
      // Try both { toolName, params, result } and positional args.
      const ctx = typeof args[0] === 'object' ? args[0] : { toolName: args[0], params: args[1], result: args[2] };
      const { toolName, params } = ctx;

      if (isWriteTool(toolName) && params?.path && isMemoryPath(params.path, this.memoryDir)) {
        try {
          await this.syncFile(String(params.path));
          api.logger.debug?.(`[dkg-write-capture] Synced ${params.path} via after_tool_call`);
        } catch (err: any) {
          api.logger.warn?.(`[dkg-write-capture] Hook sync failed for ${params.path}: ${err.message}`);
        }
      }
    }, { name: 'dkg-write-capture' });

    api.logger.info?.('[dkg-write-capture] Registered after_tool_call hook for memory write capture');
  }

  // ---------------------------------------------------------------------------
  // File watcher (universal fallback)
  // ---------------------------------------------------------------------------

  startFileWatcher(memoryDir?: string): void {
    const dir = memoryDir || this.memoryDir;
    if (!dir) {
      this.api?.logger.warn?.('[dkg-write-capture] No memoryDir configured — file watcher not started');
      return;
    }

    // Resolve to absolute path
    const absDir = resolve(dir);

    try {
      this.watcher = watch(absDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = join(absDir, filename);

        // Only watch .md files in the memory directory
        if (!filename.endsWith('.md')) return;

        // Debounce: wait for writes to settle before syncing
        const existing = this.debounceTimers.get(fullPath);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(fullPath, setTimeout(async () => {
          this.debounceTimers.delete(fullPath);
          try {
            await this.syncFile(fullPath);
            this.api?.logger.debug?.(`[dkg-write-capture] Synced ${filename} via file watcher`);
          } catch (err: any) {
            this.api?.logger.warn?.(`[dkg-write-capture] Watcher sync failed for ${filename}: ${err.message}`);
          }
        }, this.debounceMs));
      });

      this.api?.logger.info?.(`[dkg-write-capture] File watcher started on ${absDir}`);
    } catch (err: any) {
      this.api?.logger.warn?.(`[dkg-write-capture] Failed to start file watcher: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Sync a memory file to DKG
  // ---------------------------------------------------------------------------

  async syncFile(filePath: string): Promise<void> {
    const absPath = resolve(filePath);

    // Check mtime to avoid duplicate syncs
    let mtime: number;
    try {
      const stats = await stat(absPath);
      mtime = stats.mtimeMs;
    } catch {
      // File deleted — could remove from graph, but skip for now
      return;
    }

    const lastMtime = this.syncedMtimes.get(absPath);
    if (lastMtime && lastMtime >= mtime) return;

    // Read file content
    let content: string;
    try {
      content = await readFile(absPath, 'utf-8');
    } catch {
      return;
    }

    if (!content.trim()) return;

    // Build triples for the memory file
    const fileName = basename(absPath);
    let relPath = fileName;
    if (this.memoryDir) {
      const computed = relative(resolve(this.memoryDir), absPath);
      // If the file is outside memoryDir, relative() returns a path starting
      // with "..".  Fall back to just the filename to avoid odd URIs.
      relPath = computed.startsWith('..') ? fileName : computed;
    }
    const quads = buildMemoryFileQuads(relPath, content);

    if (quads.length === 0) return;

    // Write to DKG workspace
    await this.client.writeToWorkspace(AGENT_MEMORY_PARANET, quads, { localOnly: true });
    this.syncedMtimes.set(absPath, mtime);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a tool name is a write/edit operation. */
function isWriteTool(toolName: unknown): boolean {
  if (typeof toolName !== 'string') return false;
  const name = toolName.toLowerCase();
  return name === 'write' || name === 'edit' || name === 'fs_write' || name === 'fs_edit';
}

/** Check if a file path targets a memory file. */
export function isMemoryPath(filePath: unknown, memoryDir: string): boolean {
  if (typeof filePath !== 'string') return false;
  const normalized = filePath.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();

  // Match MEMORY.md specifically (as a filename, not suffix)
  const segments = lower.split('/');
  const fileName = segments[segments.length - 1];
  if (fileName === 'memory.md') return true;

  // Match files inside a /memory/ directory
  if (normalized.includes('/memory/') && fileName.endsWith('.md')) return true;

  // Match against configured memory directory (with trailing separator)
  if (memoryDir) {
    const normalizedDir = memoryDir.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') + '/';
    if (lower.startsWith(normalizedDir) || lower + '/' === normalizedDir) return true;
  }

  return false;
}

/**
 * Build RDF quads for a memory file's content.
 *
 * Each memory file becomes a `dkg:MemoryFile` entity with:
 * - `dkg:sourcePath` — the relative file path
 * - `schema:text` — the full file content
 * - `schema:dateModified` — sync timestamp
 * - `dkg:syncedAt` — when this version was synced
 *
 * Individual memory items within the file could be extracted by LLM later
 * (Layer 3 entity extraction), but for Phase 0 we store the full file.
 */
function buildMemoryFileQuads(
  relPath: string,
  content: string,
): Array<{ subject: string; predicate: string; object: string }> {
  // Sanitize the path for use as a URI component
  const uriSafe = relPath.replace(/[\\/ ]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
  const subject = `${NS.memory}file:${uriSafe}`;
  const now = new Date().toISOString();

  return [
    { subject, predicate: `${NS.rdf}type`, object: `${NS.dkg}MemoryFile` },
    { subject, predicate: `${NS.dkg}sourcePath`, object: `"${escapeLiteral(relPath)}"` },
    { subject, predicate: `${NS.schema}text`, object: `"${escapeLiteral(content)}"` },
    { subject, predicate: `${NS.schema}dateModified`, object: `"${now}"^^<${NS.xsd}dateTime>` },
    { subject, predicate: `${NS.dkg}syncedAt`, object: `"${now}"^^<${NS.xsd}dateTime>` },
  ];
}

function escapeLiteral(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
