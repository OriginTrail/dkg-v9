#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadMcpDeps() {
  const sdkBase = pathToFileURL(
    join(
      __dirname,
      '..',
      'packages',
      'mcp-server',
      'node_modules',
      '@modelcontextprotocol',
      'sdk',
      'dist',
      'esm',
    ) + '/',
  );

  const zodEntry = pathToFileURL(
    join(
      __dirname,
      '..',
      'packages',
      'mcp-server',
      'node_modules',
      'zod',
      'index.js',
    ),
  ).href;

  try {
    const [{ McpServer }, { StdioServerTransport }, { z }] = await Promise.all([
      import(new URL('server/mcp.js', sdkBase)),
      import(new URL('server/stdio.js', sdkBase)),
      import(zodEntry),
    ]);
    return { McpServer, StdioServerTransport, z };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load MCP dependencies from workspace node_modules. ${message}\n` +
      'Run `pnpm install` at repo root first.',
    );
  }
}

const { McpServer, StdioServerTransport, z } = await loadMcpDeps();

const SCHEMA = 'https://schema.org/';
const DCTERMS = 'http://purl.org/dc/terms/';
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';

const DEFAULT_PARANET = process.env.DKG_DOCS_PARANET || 'testing';

function dkgHome() {
  return process.env.DKG_HOME || join(homedir(), '.dkg');
}

async function readTextFile(path) {
  const raw = await readFile(path, 'utf8');
  return raw.trim();
}

async function readApiPort() {
  if (process.env.DKG_API_PORT) {
    const envPort = Number.parseInt(process.env.DKG_API_PORT, 10);
    if (Number.isFinite(envPort) && envPort > 0) return envPort;
  }

  const path = join(dkgHome(), 'api.port');
  const value = await readTextFile(path);
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid API port in ${path}`);
  }
  return port;
}

async function readAuthToken() {
  if (process.env.DKG_API_TOKEN) return process.env.DKG_API_TOKEN;

  const path = join(dkgHome(), 'auth.token');
  if (!existsSync(path)) return undefined;

  const raw = await readFile(path, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) return trimmed;
  }
  return undefined;
}

class DkgClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  static async connect() {
    const port = await readApiPort();
    const token = await readAuthToken();
    return new DkgClient(`http://127.0.0.1:${port}`, token);
  }

  authHeaders() {
    if (!this.token) return {};
    return { Authorization: `Bearer ${this.token}` };
  }

  async post(path, body) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
      },
      body: JSON.stringify(body),
    });

    const payload = await response
      .json()
      .catch(() => ({ error: response.statusText || `HTTP ${response.status}` }));

    if (!response.ok) {
      const error =
        payload && typeof payload === 'object' && 'error' in payload
          ? String(payload.error)
          : `HTTP ${response.status}`;
      throw new Error(error);
    }

    return payload;
  }

  async query(sparql, paranetId) {
    return this.post('/api/query', { sparql, paranetId });
  }
}

let _client = null;

async function client() {
  if (!_client) _client = await DkgClient.connect();
  return _client;
}

function escapeSparqlString(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function escapeIri(iri) {
  return iri.replace(/[<>"{}|^`\\]/g, '');
}

function isIri(value) {
  return /^(urn|https?|did|ipfs):/i.test(value);
}

function parseBindings(result) {
  return result?.result?.bindings ?? [];
}

function unescapeLiteral(value) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function cleanValue(raw) {
  if (typeof raw !== 'string') return '';

  const typed = raw.match(/^"([\s\S]*)"\^\^<[^>]+>$/);
  if (typed) return unescapeLiteral(typed[1]);

  const lang = raw.match(/^"([\s\S]*)"@[a-zA-Z0-9-]+$/);
  if (lang) return unescapeLiteral(lang[1]);

  const plain = raw.match(/^"([\s\S]*)"$/);
  if (plain) return unescapeLiteral(plain[1]);

  return raw;
}

function asInt(raw, fallback = 0) {
  const n = Number.parseInt(cleanValue(raw), 10);
  return Number.isFinite(n) ? n : fallback;
}

function okJson(obj) {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
  };
}

function errText(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

function formatError(err) {
  return err instanceof Error ? err.message : String(err);
}

async function runSparql(query, paranetId) {
  const c = await client();
  return parseBindings(await c.query(query, paranetId));
}

const server = new McpServer({ name: 'dkg-docs', version: '0.1.0' });

server.registerTool(
  'dkg_docs_list',
  {
    title: 'List DKG Docs',
    description:
      'List DigitalDocument entries from a docs paranet. ' +
      'Use prefix to narrow by path like "docs/setup".',
    inputSchema: {
      prefix: z.string().optional().describe('Optional identifier prefix, e.g. "docs/setup"'),
      limit: z.number().int().min(1).max(500).optional().default(100),
      paranetId: z.string().optional().describe(`Defaults to ${DEFAULT_PARANET}`),
    },
  },
  async ({ prefix, limit = 100, paranetId }) => {
    try {
      const filter = prefix
        ? `FILTER(STRSTARTS(LCASE(?identifier), LCASE("${escapeSparqlString(prefix)}")))`
        : '';

      const query = `
        SELECT ?doc ?identifier ?name ?chunks ?words ?modified WHERE {
          ?doc a <${SCHEMA}DigitalDocument> ;
               <${DCTERMS}identifier> ?identifier .
          OPTIONAL { ?doc <${SCHEMA}name> ?name }
          OPTIONAL { ?doc <${SCHEMA}numberOfItems> ?chunks }
          OPTIONAL { ?doc <${SCHEMA}wordCount> ?words }
          OPTIONAL { ?doc <${SCHEMA}dateModified> ?modified }
          ${filter}
        }
        ORDER BY ?identifier
        LIMIT ${limit}
      `;

      const rows = await runSparql(query, paranetId || DEFAULT_PARANET);
      const docs = rows.map((r) => ({
        docIri: cleanValue(r.doc),
        identifier: cleanValue(r.identifier),
        name: cleanValue(r.name),
        chunks: asInt(r.chunks, 0),
        wordCount: asInt(r.words, 0),
        dateModified: cleanValue(r.modified),
      }));

      return okJson({
        paranetId: paranetId || DEFAULT_PARANET,
        count: docs.length,
        docs,
      });
    } catch (err) {
      return errText(`dkg_docs_list error: ${formatError(err)}`);
    }
  },
);

server.registerTool(
  'dkg_docs_search',
  {
    title: 'Search DKG Docs',
    description:
      'Search docs by identifier/name/chunk text and return matching documents. ' +
      'Use dkg_docs_read to fetch content chunks after selecting a document.',
    inputSchema: {
      query: z.string().min(1).describe('Search text'),
      limit: z.number().int().min(1).max(100).optional().default(10),
      paranetId: z.string().optional().describe(`Defaults to ${DEFAULT_PARANET}`),
    },
  },
  async ({ query, limit = 10, paranetId }) => {
    try {
      const q = escapeSparqlString(query);
      const internalLimit = Math.min(limit * 20, 2000);

      const sparql = `
        SELECT ?doc ?identifier ?name ?pos WHERE {
          ?doc a <${SCHEMA}DigitalDocument> ;
               <${DCTERMS}identifier> ?identifier .
          OPTIONAL { ?doc <${SCHEMA}name> ?name }
          OPTIONAL {
            ?chunk <${SCHEMA}isPartOf> ?doc ;
                   <${SCHEMA}position> ?pos ;
                   <${SCHEMA}text> ?text .
          }
          FILTER(
            CONTAINS(LCASE(?identifier), LCASE("${q}")) ||
            (BOUND(?name) && CONTAINS(LCASE(?name), LCASE("${q}"))) ||
            (BOUND(?text) && CONTAINS(LCASE(?text), LCASE("${q}")))
          )
        }
        ORDER BY ?identifier ?pos
        LIMIT ${internalLimit}
      `;

      const rows = await runSparql(sparql, paranetId || DEFAULT_PARANET);
      const byDoc = new Map();

      for (const row of rows) {
        const docIri = cleanValue(row.doc);
        if (!docIri) continue;

        const posRaw = cleanValue(row.pos);
        const pos = Number.isFinite(Number.parseInt(posRaw, 10))
          ? Number.parseInt(posRaw, 10)
          : null;

        if (!byDoc.has(docIri)) {
          byDoc.set(docIri, {
            docIri,
            identifier: cleanValue(row.identifier),
            name: cleanValue(row.name),
            firstMatchingChunk: pos,
          });
        } else if (pos !== null) {
          const existing = byDoc.get(docIri);
          if (existing.firstMatchingChunk === null || pos < existing.firstMatchingChunk) {
            existing.firstMatchingChunk = pos;
          }
        }
      }

      const matches = [...byDoc.values()].slice(0, limit);
      return okJson({
        paranetId: paranetId || DEFAULT_PARANET,
        query,
        count: matches.length,
        matches,
      });
    } catch (err) {
      return errText(`dkg_docs_search error: ${formatError(err)}`);
    }
  },
);

server.registerTool(
  'dkg_docs_read',
  {
    title: 'Read DKG Doc Chunks',
    description:
      'Read ordered text chunks for a DigitalDocument by identifier or document IRI. ' +
      'Returns metadata plus selected chunk range.',
    inputSchema: {
      identifier: z.string().min(1).describe('dcterms:identifier (e.g. docs/setup/JOIN_TESTNET.md) or document IRI'),
      fromChunk: z.number().int().min(1).optional().default(1),
      chunkCount: z.number().int().min(1).max(50).optional().default(3),
      paranetId: z.string().optional().describe(`Defaults to ${DEFAULT_PARANET}`),
    },
  },
  async ({ identifier, fromChunk = 1, chunkCount = 3, paranetId }) => {
    try {
      const resolver = isIri(identifier)
        ? `
          BIND(<${escapeIri(identifier)}> AS ?doc)
          ?doc <${DCTERMS}identifier> ?identifier .
        `
        : `
          ?doc <${DCTERMS}identifier> "${escapeSparqlString(identifier)}" .
          BIND("${escapeSparqlString(identifier)}" AS ?identifier)
        `;

      const metaQuery = `
        SELECT ?doc ?identifier ?name ?chunks ?words ?modified WHERE {
          ?doc a <${SCHEMA}DigitalDocument> .
          ${resolver}
          OPTIONAL { ?doc <${SCHEMA}name> ?name }
          OPTIONAL { ?doc <${SCHEMA}numberOfItems> ?chunks }
          OPTIONAL { ?doc <${SCHEMA}wordCount> ?words }
          OPTIONAL { ?doc <${SCHEMA}dateModified> ?modified }
        }
        LIMIT 1
      `;

      const metaRows = await runSparql(metaQuery, paranetId || DEFAULT_PARANET);
      if (metaRows.length === 0) {
        return errText(
          `No document found for identifier: ${identifier} in paranet ${paranetId || DEFAULT_PARANET}`,
        );
      }

      const meta = metaRows[0];
      const docIri = cleanValue(meta.doc);

      const chunkQuery = `
        SELECT ?pos ?text WHERE {
          ?chunk <${SCHEMA}isPartOf> <${escapeIri(docIri)}> ;
                 <${SCHEMA}position> ?pos ;
                 <${SCHEMA}text> ?text .
        }
        ORDER BY ?pos
      `;

      const chunkRows = await runSparql(chunkQuery, paranetId || DEFAULT_PARANET);
      const chunks = chunkRows
        .map((r) => ({
          position: asInt(r.pos, 0),
          text: cleanValue(r.text),
        }))
        .filter((c) => c.position > 0)
        .sort((a, b) => a.position - b.position);

      const end = fromChunk + chunkCount;
      const selected = chunks.filter(
        (c) => c.position >= fromChunk && c.position < end,
      );

      return okJson({
        paranetId: paranetId || DEFAULT_PARANET,
        doc: {
          docIri,
          identifier: cleanValue(meta.identifier),
          name: cleanValue(meta.name),
          chunkCount: asInt(meta.chunks, chunks.length),
          wordCount: asInt(meta.words, 0),
          dateModified: cleanValue(meta.modified),
        },
        fromChunk,
        chunkCount,
        returnedChunks: selected.length,
        chunks: selected,
        text: selected.map((c) => c.text).join('\n\n'),
      });
    } catch (err) {
      return errText(`dkg_docs_read error: ${formatError(err)}`);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`dkg-docs MCP fatal error: ${formatError(err)}\n`);
  process.exit(1);
});
