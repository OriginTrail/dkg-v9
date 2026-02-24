import { createContext, useContext } from 'react';
import type { RdfGraphViz } from '../core/rdf-graph-viz.js';
import type { GraphNode } from '../core/types.js';

export interface RdfGraphContextValue {
  /** The core RdfGraphViz instance */
  viz: RdfGraphViz | null;
  /** Currently selected node (clicked) */
  selectedNode: GraphNode | null;
  /** Currently hovered node */
  hoveredNode: GraphNode | null;
}

export const RdfGraphContext = createContext<RdfGraphContextValue>({
  viz: null,
  selectedNode: null,
  hoveredNode: null,
});

export function useRdfGraphContext(): RdfGraphContextValue {
  return useContext(RdfGraphContext);
}
