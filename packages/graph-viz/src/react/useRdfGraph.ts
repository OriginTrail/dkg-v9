import { useRdfGraphContext } from './context.js';

/**
 * Hook to access the underlying RdfGraphViz instance for imperative operations.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { viz } = useRdfGraph();
 *
 *   const handleAddData = () => {
 *     viz?.addTriples([{ subject: '...', predicate: '...', object: '...' }]);
 *   };
 *
 *   return <button onClick={handleAddData}>Add Data</button>;
 * }
 * ```
 */
export function useRdfGraph() {
  const ctx = useRdfGraphContext();
  return {
    viz: ctx.viz,
    selectedNode: ctx.selectedNode,
    hoveredNode: ctx.hoveredNode,
  };
}
