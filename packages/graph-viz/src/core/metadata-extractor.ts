import type { MetadataConfig } from './types.js';

/** Default metadata predicates — properties shown in the metadata panel, not as edges */
const DEFAULT_METADATA_PREDICATES = [
  // PROV-O
  'http://www.w3.org/ns/prov#wasGeneratedBy',
  'http://www.w3.org/ns/prov#wasAttributedTo',
  'http://www.w3.org/ns/prov#wasDerivedFrom',
  'http://www.w3.org/ns/prov#startedAtTime',
  'http://www.w3.org/ns/prov#endedAtTime',
  'http://www.w3.org/ns/prov#generatedAtTime',
  'http://www.w3.org/ns/prov#wasStartedBy',
  'http://www.w3.org/ns/prov#wasEndedBy',
  // Dublin Core
  'http://purl.org/dc/terms/created',
  'http://purl.org/dc/terms/modified',
  'http://purl.org/dc/terms/source',
  'http://purl.org/dc/terms/creator',
  'http://purl.org/dc/terms/publisher',
  // Common admin
  'http://www.w3.org/2002/07/owl#versionInfo',
];

/**
 * Provides the list of predicates that should be treated as metadata
 * (shown in the detail panel, not rendered as graph edges).
 *
 * This is a simple config resolver — the actual separation happens in GraphModel.
 */
export class MetadataExtractor {
  private _predicates: Set<string>;

  constructor(config?: MetadataConfig) {
    this._predicates = new Set([
      ...DEFAULT_METADATA_PREDICATES,
      ...(config?.predicates ?? []),
    ]);
  }

  /** Get all metadata predicate URIs */
  get predicates(): string[] {
    return [...this._predicates];
  }

  /** Check if a predicate is a metadata predicate */
  isMetadata(predicateUri: string): boolean {
    return this._predicates.has(predicateUri);
  }

  /** Add additional metadata predicates at runtime */
  addPredicates(predicates: string[]): void {
    for (const p of predicates) {
      this._predicates.add(p);
    }
  }
}
