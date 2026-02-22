export interface Quad {
  subject: string;
  predicate: string;
  object: string;
  graph: string;
}

export interface TripleStore {
  insert(quads: Quad[]): Promise<void>;
  delete(quads: Quad[]): Promise<void>;
  deleteByPattern(pattern: Partial<Quad>): Promise<number>;
  query(sparql: string): Promise<Quad[]>;
  hasGraph(graphUri: string): Promise<boolean>;
  createGraph(graphUri: string): Promise<void>;
  dropGraph(graphUri: string): Promise<void>;
}
