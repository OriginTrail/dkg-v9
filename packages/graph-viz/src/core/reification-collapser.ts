import type { ReificationConfig, ReificationPattern, PropertyAnnotation } from './types.js';
import { GraphModel } from './graph-model.js';

/** Standard RDF reification pattern */
const STANDARD_RDF_REIFICATION: ReificationPattern = {
  statementType: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement',
  subjectPredicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#subject',
  predicatePredicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate',
  objectPredicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#object',
};

const DEFAULT_CONFIG: Required<ReificationConfig> = {
  enabled: false,
  patterns: [STANDARD_RDF_REIFICATION],
};

interface DetectedStatement {
  statementNodeId: string;
  reifiedSubject: string | null;
  reifiedPredicate: string | null;
  reifiedObject: string | null;
  /** All other properties on the statement node (provenance, timestamps, etc.) */
  annotations: Array<{ predicate: string; value: string; datatype?: string }>;
}

/**
 * Detects and collapses reified statement nodes.
 *
 * When a node matches a reification pattern (has the right rdf:type + subject/predicate/object links),
 * it is removed from the visual graph. Its non-structural properties (provenance, timestamps, etc.)
 * are attached as annotations to the corresponding property on the reified subject node.
 */
export class ReificationCollapser {
  private _config: Required<ReificationConfig>;

  constructor(config: ReificationConfig | undefined) {
    this._config = {
      enabled: config?.enabled ?? DEFAULT_CONFIG.enabled,
      patterns: config?.patterns ?? DEFAULT_CONFIG.patterns,
    };
  }

  get enabled(): boolean {
    return this._config.enabled;
  }

  /**
   * Process the graph model: detect reified statements, collapse them,
   * and attach their metadata as annotations on the original properties.
   *
   * Returns the set of node IDs that were collapsed (removed from visual rendering).
   */
  collapse(model: GraphModel): Set<string> {
    if (!this._config.enabled) return new Set();

    const collapsedNodeIds = new Set<string>();
    const detected = this.detectStatements(model);

    for (const stmt of detected) {
      if (!stmt.reifiedSubject) continue;

      const subjectNode = model.getNode(stmt.reifiedSubject);
      if (!subjectNode) continue;

      // Attach annotations to the correct property on the subject node
      if (stmt.reifiedPredicate && stmt.annotations.length > 0) {
        const annotations: PropertyAnnotation[] = stmt.annotations.map((a) => ({
          predicate: a.predicate,
          value: a.value,
          datatype: a.datatype,
        }));

        // Find the property values for the reified predicate
        const propValues = subjectNode.properties.get(stmt.reifiedPredicate);
        if (propValues) {
          // Try to match the specific value and attach annotations
          for (const pv of propValues) {
            if (stmt.reifiedObject && pv.value === stmt.reifiedObject) {
              pv.annotations = [...(pv.annotations ?? []), ...annotations];
              break;
            }
          }
          // If no specific match, attach to the first value
          if (propValues.length > 0 && !propValues.some((pv) => pv.annotations?.length)) {
            propValues[0].annotations = [...(propValues[0].annotations ?? []), ...annotations];
          }
        }

        // Also check metadata map
        const metaValues = subjectNode.metadata.get(stmt.reifiedPredicate);
        if (metaValues && metaValues.length > 0) {
          metaValues[0].annotations = [...(metaValues[0].annotations ?? []), ...annotations];
        }
      }

      // Mark the statement node for removal from visual graph
      collapsedNodeIds.add(stmt.statementNodeId);
    }

    return collapsedNodeIds;
  }

  /** Detect reified statements in the model */
  private detectStatements(model: GraphModel): DetectedStatement[] {
    const results: DetectedStatement[] = [];

    for (const pattern of this._config.patterns) {
      // Find all nodes with the statement type
      for (const node of model.nodes.values()) {
        if (!node.types.includes(pattern.statementType)) continue;

        const stmt: DetectedStatement = {
          statementNodeId: node.id,
          reifiedSubject: null,
          reifiedPredicate: null,
          reifiedObject: null,
          annotations: [],
        };

        // Extract subject/predicate/object links from edges
        const edgesFrom = model.getEdgesFrom(node.id);
        for (const edge of edgesFrom) {
          if (edge.predicate === pattern.subjectPredicate) {
            stmt.reifiedSubject = edge.target;
          } else if (edge.predicate === pattern.predicatePredicate) {
            stmt.reifiedPredicate = edge.target;
          } else if (edge.predicate === pattern.objectPredicate) {
            stmt.reifiedObject = edge.target;
          }
        }

        // Also check properties for the object (might be a literal)
        for (const [pred, values] of node.properties) {
          if (pred === pattern.objectPredicate && values.length > 0) {
            stmt.reifiedObject = values[0].value;
          }
        }

        // Also check metadata map — needed when the reification predicates
        // (aboutSubject, forPredicate, hasValue) are configured as metadata
        for (const [pred, values] of node.metadata) {
          if (values.length === 0) continue;
          if (!stmt.reifiedSubject && pred === pattern.subjectPredicate) {
            stmt.reifiedSubject = values[0].value;
          } else if (!stmt.reifiedPredicate && pred === pattern.predicatePredicate) {
            stmt.reifiedPredicate = values[0].value;
          } else if (!stmt.reifiedObject && pred === pattern.objectPredicate) {
            stmt.reifiedObject = values[0].value;
          }
        }

        // Everything else on the statement node becomes an annotation
        const structuralPreds = new Set([
          pattern.subjectPredicate,
          pattern.predicatePredicate,
          pattern.objectPredicate,
        ]);

        for (const [pred, values] of node.properties) {
          if (!structuralPreds.has(pred)) {
            for (const v of values) {
              stmt.annotations.push({ predicate: pred, value: v.value, datatype: v.datatype });
            }
          }
        }
        for (const [pred, values] of node.metadata) {
          for (const v of values) {
            stmt.annotations.push({ predicate: pred, value: v.value, datatype: v.datatype });
          }
        }

        results.push(stmt);
      }
    }

    return results;
  }
}
