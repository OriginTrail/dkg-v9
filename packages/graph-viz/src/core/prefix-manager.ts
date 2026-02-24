import type { PrefixMap } from './types.js';

/** Well-known namespace prefixes shipped as defaults */
const WELL_KNOWN_PREFIXES: PrefixMap = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  schema: 'https://schema.org/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  dcterms: 'http://purl.org/dc/terms/',
  dc: 'http://purl.org/dc/elements/1.1/',
  prov: 'http://www.w3.org/ns/prov#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
};

/**
 * Manages namespace prefix ↔ URI mappings for compacting and expanding URIs.
 */
export class PrefixManager {
  private _prefixes: Map<string, string>;
  /** Reverse map: namespace URI → prefix */
  private _reverse: Map<string, string>;

  constructor(userPrefixes?: PrefixMap) {
    this._prefixes = new Map();
    this._reverse = new Map();

    // Load well-known first, then user overrides
    for (const [prefix, ns] of Object.entries(WELL_KNOWN_PREFIXES)) {
      this._prefixes.set(prefix, ns);
      this._reverse.set(ns, prefix);
    }

    if (userPrefixes) {
      for (const [prefix, ns] of Object.entries(userPrefixes)) {
        this._prefixes.set(prefix, ns);
        this._reverse.set(ns, prefix);
      }
    }
  }

  /** Register a new prefix */
  addPrefix(prefix: string, namespace: string): void {
    this._prefixes.set(prefix, namespace);
    this._reverse.set(namespace, prefix);
  }

  /** Merge in multiple prefixes */
  addPrefixes(prefixes: PrefixMap): void {
    for (const [prefix, ns] of Object.entries(prefixes)) {
      this.addPrefix(prefix, ns);
    }
  }

  /** Get the namespace URI for a prefix */
  getNamespace(prefix: string): string | undefined {
    return this._prefixes.get(prefix);
  }

  /** Get the prefix for a namespace URI */
  getPrefix(namespace: string): string | undefined {
    return this._reverse.get(namespace);
  }

  /**
   * Compact a full URI to prefixed form (e.g., "https://schema.org/name" → "schema:name").
   * Returns null if no matching prefix is found.
   */
  compact(uri: string): string | null {
    for (const [ns, prefix] of this._reverse) {
      if (uri.startsWith(ns)) {
        const localName = uri.slice(ns.length);
        if (localName.length > 0) {
          return `${prefix}:${localName}`;
        }
      }
    }
    return null;
  }

  /**
   * Expand a prefixed term to a full URI (e.g., "schema:name" → "https://schema.org/name").
   * Returns the input unchanged if it's already a full URI or no prefix matches.
   */
  expand(term: string): string {
    const colonIdx = term.indexOf(':');
    if (colonIdx === -1) return term;

    // Don't expand things that look like full URIs
    if (term.startsWith('http://') || term.startsWith('https://') || term.startsWith('urn:')) {
      return term;
    }

    const prefix = term.slice(0, colonIdx);
    const localName = term.slice(colonIdx + 1);
    const ns = this._prefixes.get(prefix);

    return ns ? ns + localName : term;
  }

  /**
   * Extract the local name from a URI (the part after the last # or /).
   */
  static localName(uri: string): string {
    const hashIdx = uri.lastIndexOf('#');
    if (hashIdx !== -1) return uri.slice(hashIdx + 1);

    const slashIdx = uri.lastIndexOf('/');
    if (slashIdx !== -1) return uri.slice(slashIdx + 1);

    return uri;
  }

  /** Get all registered prefixes */
  get prefixes(): PrefixMap {
    const result: PrefixMap = {};
    for (const [prefix, ns] of this._prefixes) {
      result[prefix] = ns;
    }
    return result;
  }
}
