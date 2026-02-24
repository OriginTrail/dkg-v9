import type { RdfTriple } from '../core/types.js';

/**
 * A single SPARQL result binding row.
 * Keys are variable names (without ?), values are RDF term strings.
 */
export type SparqlBinding = Record<string, string>;

/** Result of a SPARQL SELECT query */
export interface SparqlSelectResult {
  variables: string[];
  bindings: SparqlBinding[];
}

/** Result of a SPARQL CONSTRUCT/DESCRIBE query — just triples */
export interface SparqlConstructResult {
  triples: RdfTriple[];
}

/**
 * Abstract data source for the graph visualizer.
 *
 * Implementations connect to different knowledge graph backends:
 * - OxigraphSource:       In-browser WASM store (dev/demo)
 * - RemoteSparqlSource:   Remote SPARQL endpoint (Blazegraph, GraphDB, DKG)
 *
 * The visualizer calls these methods to load and query graph data,
 * keeping the rendering layer decoupled from the storage layer.
 */
export interface GraphDataSource {
  /** Human-readable name for this data source */
  readonly name: string;

  /**
   * Load RDF data into the store (N-Triples string).
   * For remote sources, this may be a no-op or trigger an import.
   */
  loadNTriples(data: string): Promise<void>;

  /**
   * Execute a SPARQL SELECT query.
   * Returns variable bindings as plain strings.
   */
  select(sparql: string): Promise<SparqlSelectResult>;

  /**
   * Execute a SPARQL CONSTRUCT query.
   * Returns an array of RdfTriple objects ready for the visualizer.
   */
  construct(sparql: string): Promise<SparqlConstructResult>;

  /**
   * Get the total triple count in the store.
   */
  tripleCount(): Promise<number>;

  /**
   * Check if the source is ready / connected.
   */
  isReady(): Promise<boolean>;
}
