/**
 * Code Transformer — converts GitHub git tree entries to RDF quads.
 *
 * Phase A: File tree indexing. Produces ghcode:File and ghcode:Directory
 * entities from the recursive git tree API response.
 */

import {
  GH, RDF,
  type Quad,
  repoUri, fileUri, directoryUri,
  tripleUri, tripleStr, tripleInt, tripleDateTime,
} from './uri.js';
import { extname } from 'node:path';

/** Language detection from file extension. */
const EXTENSION_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.sol': 'Solidity',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.json': 'JSON',
  '.yaml': 'YAML', '.yml': 'YAML',
  '.toml': 'TOML',
  '.md': 'Markdown',
  '.css': 'CSS', '.scss': 'SCSS',
  '.html': 'HTML',
  '.sh': 'Shell', '.bash': 'Shell',
  '.sql': 'SQL',
  '.graphql': 'GraphQL', '.gql': 'GraphQL',
  '.proto': 'Protobuf',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.c': 'C', '.h': 'C',
  '.cpp': 'C++', '.hpp': 'C++', '.cc': 'C++',
  '.cs': 'C#',
};

export function detectLanguage(filePath: string): string | undefined {
  return EXTENSION_LANGUAGE[extname(filePath).toLowerCase()];
}

export interface GitTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url?: string;
}

/**
 * Transform a list of git tree entries into RDF quads.
 *
 * For each blob (file): creates a ghcode:File with path, size, language, directory link, repo link.
 * For each tree (directory): creates a ghcode:Directory with path, parent directory link, repo link.
 */
export function transformFileTree(
  entries: GitTreeEntry[],
  owner: string,
  repo: string,
  graph: string,
): Quad[] {
  const quads: Quad[] = [];
  const repoId = repoUri(owner, repo);
  const now = new Date().toISOString();

  // Collect all directory paths (both explicit tree entries and implicit parent dirs)
  const dirPaths = new Set<string>();
  for (const entry of entries) {
    if (entry.type === 'tree') {
      dirPaths.add(entry.path);
    }
  }
  // Also add implicit parent directories from file paths
  for (const entry of entries) {
    if (entry.type === 'blob') {
      const parts = entry.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        dirPaths.add(parts.slice(0, i).join('/'));
      }
    }
  }

  // Emit directory quads
  for (const dirPath of dirPaths) {
    const uri = directoryUri(owner, repo, dirPath);
    quads.push(
      tripleUri(uri, `${RDF}type`, `${GH}Directory`, graph),
      tripleStr(uri, `${GH}dirPath`, dirPath, graph),
      tripleUri(uri, `${GH}inRepo`, repoId, graph),
    );

    // Link to parent directory
    const lastSlash = dirPath.lastIndexOf('/');
    if (lastSlash > 0) {
      const parentPath = dirPath.substring(0, lastSlash);
      quads.push(tripleUri(uri, `${GH}parentDir`, directoryUri(owner, repo, parentPath), graph));
    }
  }

  // Emit file quads
  for (const entry of entries) {
    if (entry.type !== 'blob') continue;

    const uri = fileUri(owner, repo, entry.path);
    quads.push(
      tripleUri(uri, `${RDF}type`, `${GH}File`, graph),
      tripleStr(uri, `${GH}filePath`, entry.path, graph),
      tripleUri(uri, `${GH}inRepo`, repoId, graph),
      tripleDateTime(uri, `${GH}snapshotAt`, now, graph),
    );

    if (typeof entry.size === 'number') {
      quads.push(tripleInt(uri, `${GH}fileSize`, entry.size, graph));
    }

    const lang = detectLanguage(entry.path);
    if (lang) {
      quads.push(tripleStr(uri, `${GH}language`, lang, graph));
    }

    // Link to containing directory
    const lastSlash = entry.path.lastIndexOf('/');
    if (lastSlash > 0) {
      const dirPath = entry.path.substring(0, lastSlash);
      quads.push(tripleUri(uri, `${GH}inDirectory`, directoryUri(owner, repo, dirPath), graph));
    }
  }

  return quads;
}
