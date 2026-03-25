/**
 * Code Sync — fetches and indexes repository file trees from GitHub.
 *
 * Phase A: Uses the recursive git tree API to index all files and directories
 * in a single API call, producing RDF quads via the code transformer.
 */

import { GitHubClient } from './client.js';
import { transformFileTree, type GitTreeEntry } from '../rdf/code-transformer.js';
import type { Quad } from '../rdf/uri.js';

/** Default file extensions to include. */
const DEFAULT_INCLUDE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.sol',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.json',
  '.yaml', '.yml',
  '.toml',
  '.md',
  '.css', '.scss',
  '.html',
  '.sh', '.bash',
  '.sql',
  '.graphql', '.gql',
  '.rb', '.php', '.swift', '.kt', '.kts',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cs',
  '.proto',
]);

/** Default path prefixes to exclude. */
const DEFAULT_EXCLUDE_PREFIXES = [
  'node_modules/',
  'dist/',
  'build/',
  '.git/',
  'coverage/',
  '__pycache__/',
  'target/',
  'vendor/',
  'third_party/',
  '.next/',
  '.nuxt/',
];

/** Default filename suffixes to exclude. */
const DEFAULT_EXCLUDE_SUFFIXES = [
  '.min.js', '.min.css', '.map',
  '.lock',
];

/** Default exact filenames to exclude. */
const DEFAULT_EXCLUDE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

export interface CodeSyncOptions {
  /** Maximum file size in bytes to include (default: 100KB). */
  maxFileSize?: number;
  /** Additional path prefixes to exclude. */
  excludePrefixes?: string[];
  /** Additional extensions to include. */
  includeExtensions?: string[];
}

export interface CodeSyncResult {
  quads: Quad[];
  treeSha: string;
  fileCount: number;
  directoryCount: number;
}

export class CodeSync {
  private readonly client: GitHubClient;

  constructor(client: GitHubClient) {
    this.client = client;
  }

  async syncFileTree(
    owner: string,
    repo: string,
    branch: string,
    graph: string,
    options: CodeSyncOptions = {},
  ): Promise<CodeSyncResult> {
    const maxSize = options.maxFileSize ?? 100_000;

    // 1. Get the tree SHA from the branch HEAD
    const { treeSha } = await this.client.getCommitSha(owner, repo, branch);

    // 2. Get the full recursive tree
    const treeData = await this.client.getTree(owner, repo, treeSha, true);
    const allEntries: GitTreeEntry[] = treeData.tree ?? [];

    // 3. Filter entries
    const filtered = this.filterEntries(allEntries, maxSize, options);

    // 4. Transform to quads
    const quads = transformFileTree(filtered, owner, repo, graph);

    const fileCount = filtered.filter(e => e.type === 'blob').length;
    const directoryCount = filtered.filter(e => e.type === 'tree').length;

    return { quads, treeSha, fileCount, directoryCount };
  }

  private filterEntries(
    entries: GitTreeEntry[],
    maxSize: number,
    options: CodeSyncOptions,
  ): GitTreeEntry[] {
    const includeExt = DEFAULT_INCLUDE_EXTENSIONS;
    if (options.includeExtensions) {
      for (const ext of options.includeExtensions) {
        includeExt.add(ext.startsWith('.') ? ext : `.${ext}`);
      }
    }

    const excludePrefixes = [
      ...DEFAULT_EXCLUDE_PREFIXES,
      ...(options.excludePrefixes ?? []),
    ];

    return entries.filter(entry => {
      // Always keep directory entries (tree type)
      if (entry.type === 'tree') {
        // Exclude directories that match exclude prefixes
        return !excludePrefixes.some(p => entry.path.startsWith(p) || entry.path.includes(`/${p}`));
      }

      // For files (blobs):

      // Check exclude prefixes
      if (excludePrefixes.some(p => entry.path.startsWith(p) || entry.path.includes(`/${p}`))) {
        return false;
      }

      // Check excluded filenames
      const fileName = entry.path.split('/').pop() ?? entry.path;
      if (DEFAULT_EXCLUDE_NAMES.has(fileName)) {
        return false;
      }

      // Check excluded suffixes
      if (DEFAULT_EXCLUDE_SUFFIXES.some(s => entry.path.endsWith(s))) {
        return false;
      }

      // Check file size
      if (typeof entry.size === 'number' && entry.size > maxSize) {
        return false;
      }

      // Check extension
      const dotIdx = fileName.lastIndexOf('.');
      if (dotIdx < 0) return false;
      const ext = fileName.substring(dotIdx).toLowerCase();
      return includeExt.has(ext);
    });
  }
}
