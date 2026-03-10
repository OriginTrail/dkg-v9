/**
 * DkgMemoryPlugin — Spike B: DKG-backed MemorySearchManager.
 *
 * Implements OpenClaw's read-only MemorySearchManager interface backed by
 * SPARQL queries against the DKG daemon's agent-memory paranet.
 *
 * Memory reads go through this plugin:
 *   search(query) → SPARQL FILTER(CONTAINS) on agent-memory literals
 *   readFile(path) → SPARQL lookup by source-path predicate
 *   status()       → daemon health check
 *
 * Memory writes are captured separately by `write-capture.ts`.
 *
 * Spike B must validate:
 *   1. SPARQL text search quality is acceptable
 *   2. Round-trip: write → capture → DKG graph → search → result
 *   3. Performance: < 200ms typical search latency
 */

import type { DkgDaemonClient } from './dkg-client.js';
import type {
  DkgOpenClawConfig,
  MemorySearchOptions,
  MemorySearchResult,
  OpenClawMemorySearchManager,
  OpenClawPluginApi,
} from './types.js';

const AGENT_MEMORY_PARANET = 'agent-memory';

/**
 * SPARQL namespaces used in the agent-memory graph.
 * Must match the schema in ChatMemoryManager.
 */
const NS = {
  schema: 'http://schema.org/',
  dkg: 'http://dkg.io/ontology/',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  memory: 'urn:dkg:memory:',
  chat: 'urn:dkg:chat:',
};

export class DkgMemoryPlugin implements OpenClawMemorySearchManager {
  private api: OpenClawPluginApi | null = null;

  constructor(
    private readonly client: DkgDaemonClient,
    private readonly config: NonNullable<DkgOpenClawConfig['memory']>,
  ) {}

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  register(api: OpenClawPluginApi): void {
    this.api = api;

    // Register as the memory search manager if the slot is available
    // This is an exclusive slot — only one memory plugin active at a time
    if ((api as any).memory?.register) {
      (api as any).memory.register(this);
      api.logger.info?.('[dkg-memory] Registered as memory search manager');
    } else {
      api.logger.warn?.(
        '[dkg-memory] api.memory.register not available — memory reads will use fallback file search. ' +
        'DKG memory sync (writes) will still work.',
      );
    }

    // Register the memory search/import tools so the agent can explicitly
    // search DKG memory even if the memory slot is not available
    api.registerTool({
      name: 'dkg_memory_search',
      description:
        'Search the DKG knowledge graph for memories, conversation history, and extracted entities. ' +
        'Uses SPARQL to query the agent-memory paranet. ' +
        'Returns matching memory items with relevance scores.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language search query' },
          limit: { type: 'string', description: 'Max results (default: 10)' },
        },
        required: ['query'],
      },
      execute: async (_id, params) => {
        try {
          const results = await this.search(
            String(params.query),
            { limit: params.limit ? parseInt(String(params.limit), 10) : 10 },
          );
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
            details: results,
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
          };
        }
      },
    });

    api.registerTool({
      name: 'dkg_memory_import',
      description:
        'Import text into the DKG memory graph. Uses LLM-powered parsing to extract ' +
        'structured memories, entities, and relationships from the input text.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to import as memories' },
          source: {
            type: 'string',
            description: 'Source type',
            enum: ['claude', 'chatgpt', 'gemini', 'other'],
          },
        },
        required: ['text'],
      },
      execute: async (_id, params) => {
        try {
          const result = await this.client.importMemories(
            String(params.text),
            String(params.source ?? 'other'),
            { useLlm: true },
          );
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
          };
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // MemorySearchManager interface
  // ---------------------------------------------------------------------------

  async search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const limit = options?.limit ?? 10;

    // Strategy: search across both curated memories and chat message text.
    // Uses FILTER(CONTAINS) for now — Spike B will assess whether this is
    // sufficient or if a hybrid embedding approach is needed.
    const sparql = buildSearchSparql(query, limit);

    try {
      const result = await this.client.query(sparql, { paranetId: AGENT_MEMORY_PARANET });
      return formatSearchResults(result, query);
    } catch (err: any) {
      this.api?.logger.warn?.(`[dkg-memory] Search failed: ${err.message}`);
      return [];
    }
  }

  async readFile(path: string): Promise<string | null> {
    // Look up a memory by its source file path in the graph
    const sparql = `
      PREFIX dkg: <${NS.dkg}>
      PREFIX schema: <${NS.schema}>
      SELECT ?text WHERE {
        ?m dkg:sourcePath "${escapeSparqlString(path)}" ;
           schema:text ?text .
      }
      LIMIT 1
    `;

    try {
      const result = await this.client.query(sparql, { paranetId: AGENT_MEMORY_PARANET });
      const bindings = result?.results?.bindings ?? result?.bindings ?? [];
      if (bindings.length > 0) {
        return bindings[0].text?.value ?? null;
      }
      return null;
    } catch {
      return null;
    }
  }

  async status(): Promise<{ ready: boolean; indexedFiles?: number; lastSync?: number }> {
    try {
      const stats = await this.client.getMemoryStats();
      return {
        ready: stats.initialized,
        indexedFiles: stats.totalTriples,
        lastSync: Date.now(),
      };
    } catch {
      return { ready: false };
    }
  }

  async sync(): Promise<void> {
    // No-op — DKG graph is the source of truth, no local index to sync.
  }

  async close(): Promise<void> {
    // No resources to release.
  }
}

// ---------------------------------------------------------------------------
// SPARQL query builders
// ---------------------------------------------------------------------------

/**
 * Build a SPARQL query that searches across:
 * 1. Curated memory text — both dkg:Memory (ChatMemoryManager) and dkg:MemoryFile (write-capture)
 * 2. Chat message text (urn:dkg:chat:msg:*)
 * 3. Entity labels (urn:dkg:entity:*)
 *
 * Uses case-insensitive CONTAINS for text matching.
 * TODO: Spike B should evaluate if this needs embeddings for quality.
 */
function buildSearchSparql(query: string, limit: number): string {
  // Split query into keywords for multi-term matching.
  // Minimum length 2 so terms like "UI", "AI", "DKG" are included.
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length >= 2);

  if (keywords.length === 0) {
    // Empty/short query — return recent items
    return `
      PREFIX schema: <${NS.schema}>
      PREFIX dkg: <${NS.dkg}>
      SELECT ?uri ?text ?type ?ts WHERE {
        { ?uri a dkg:Memory ; schema:text ?text . BIND("memory" AS ?type) }
        UNION
        { ?uri a dkg:MemoryFile ; schema:text ?text . BIND("memory" AS ?type) }
        UNION
        { ?uri a schema:Message ; schema:text ?text ; schema:dateCreated ?ts . BIND("message" AS ?type) }
      }
      ORDER BY DESC(?ts)
      LIMIT ${limit}
    `;
  }

  // Escape each keyword for safe SPARQL string interpolation
  const filters = keywords
    .map(k => `CONTAINS(LCASE(?text), "${escapeSparqlString(k)}")`)
    .join(' || ');

  return `
    PREFIX schema: <${NS.schema}>
    PREFIX dkg: <${NS.dkg}>
    PREFIX rdf: <${NS.rdf}>
    SELECT ?uri ?text ?type ?label ?ts WHERE {
      {
        ?uri a dkg:Memory ;
             schema:text ?text .
        OPTIONAL { ?uri schema:dateCreated ?ts }
        BIND("memory" AS ?type)
        BIND("" AS ?label)
        FILTER(${filters})
      }
      UNION
      {
        ?uri a dkg:MemoryFile ;
             schema:text ?text .
        OPTIONAL { ?uri schema:dateModified ?ts }
        BIND("memory" AS ?type)
        BIND("" AS ?label)
        FILTER(${filters})
      }
      UNION
      {
        ?uri a schema:Message ;
             schema:text ?text .
        OPTIONAL { ?uri schema:dateCreated ?ts }
        BIND("message" AS ?type)
        BIND("" AS ?label)
        FILTER(${filters})
      }
      UNION
      {
        ?uri schema:name ?label .
        BIND(?label AS ?text)
        BIND("entity" AS ?type)
        FILTER(${filters})
      }
    }
    ORDER BY DESC(?ts)
    LIMIT ${limit}
  `;
}

/**
 * Format SPARQL results into MemorySearchResult[].
 * Computes a simple keyword-overlap relevance score.
 */
function formatSearchResults(result: any, query: string): MemorySearchResult[] {
  const bindings: any[] = result?.results?.bindings ?? result?.bindings ?? [];
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length >= 2);

  return bindings.map((b: any) => {
    const text = b.text?.value ?? b.label?.value ?? '';
    const uri = b.uri?.value ?? '';
    const type = b.type?.value ?? 'unknown';

    // Simple keyword-overlap score
    const lowerText = text.toLowerCase();
    const matchCount = keywords.filter(k => lowerText.includes(k)).length;
    const score = keywords.length > 0 ? matchCount / keywords.length : 0.5;

    return {
      path: `dkg://${type}/${uri}`,
      content: text,
      score,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeSparqlString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
