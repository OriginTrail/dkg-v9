/**
 * ElizaOS Provider that enriches message context with DKG knowledge.
 *
 * Automatically runs a SPARQL query against the local knowledge graph
 * when the agent processes a message, injecting relevant knowledge as
 * additional context.
 */
import { getAgent } from './service.js';
import type { Provider, IAgentRuntime, Memory } from './types.js';

export const dkgKnowledgeProvider: Provider = {
  async get(_runtime: IAgentRuntime, message: Memory): Promise<string | null> {
    const agent = getAgent();
    if (!agent) return null;

    try {
      const text = message.content.text;
      const keywords = extractKeywords(text);
      if (keywords.length === 0) return null;

      const filterClause = keywords
        .map(kw => `CONTAINS(LCASE(STR(?o)), "${kw.toLowerCase()}")`)
        .join(' || ');

      const sparql = `
        SELECT ?s ?p ?o WHERE {
          ?s ?p ?o .
          FILTER(${filterClause})
        } LIMIT 10
      `;

      const result = await agent.query(sparql);
      if (result.bindings.length === 0) return null;

      const facts = result.bindings.map(row =>
        `${row['s']} ${row['p']} ${row['o']}`,
      ).join('\n');

      return `[DKG Knowledge Context]\n${facts}`;
    } catch {
      return null;
    }
  },
};

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither',
    'this', 'that', 'these', 'those', 'it', 'its', 'i', 'me', 'my',
    'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'their',
    'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
  ]);

  return text
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()))
    .slice(0, 5);
}
