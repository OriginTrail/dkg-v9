import { useMemo, type ReactNode } from 'react';
import type { GraphNode, RdfValue } from '../core/types.js';
import { useRdfGraphContext } from './context.js';

export interface NodePanelProps {
  /**
   * Custom render function. If provided, replaces the default rendering.
   * Receives the selected node (or null if none selected).
   */
  renderNode?: (node: GraphNode | null) => ReactNode;
  /** CSS class name for the panel container */
  className?: string;
  /** Inline styles for the panel container */
  style?: React.CSSProperties;
  /** Whether to show the URI */
  showUri?: boolean;
  /** Whether to show node types */
  showTypes?: boolean;
  /** Whether to show properties */
  showProperties?: boolean;
  /** Whether to show metadata */
  showMetadata?: boolean;
  /** Maximum length for property values before truncation */
  maxValueLength?: number;
}

/**
 * Node detail panel component.
 *
 * Subscribes to `node:click` events via RdfGraphContext and renders
 * the selected node's properties. Supports custom rendering via
 * the `renderNode` prop.
 *
 * Must be used inside a <RdfGraph> component (or any component providing RdfGraphContext).
 *
 * @example
 * ```tsx
 * <RdfGraph data={data}>
 *   <NodePanel className="my-panel" showMetadata={false} />
 * </RdfGraph>
 * ```
 *
 * @example
 * ```tsx
 * <RdfGraph data={data}>
 *   <NodePanel renderNode={(node) => (
 *     node ? <div>{node.label}</div> : null
 *   )} />
 * </RdfGraph>
 * ```
 */
export function NodePanel({
  renderNode,
  className,
  style,
  showUri = true,
  showTypes = true,
  showProperties = true,
  showMetadata = false,
  maxValueLength = 200,
}: NodePanelProps) {
  const { selectedNode } = useRdfGraphContext();

  // Custom renderer takes priority
  if (renderNode) {
    return <>{renderNode(selectedNode)}</>;
  }

  if (!selectedNode) return null;

  return (
    <div className={className} style={style}>
      <PanelHeader node={selectedNode} showUri={showUri} showTypes={showTypes} />
      {showProperties && selectedNode.properties.size > 0 && (
        <PropertySection
          title="Properties"
          entries={selectedNode.properties}
          maxValueLength={maxValueLength}
        />
      )}
      {showMetadata && selectedNode.metadata.size > 0 && (
        <PropertySection
          title="Metadata"
          entries={selectedNode.metadata}
          maxValueLength={maxValueLength}
        />
      )}
    </div>
  );
}

function PanelHeader({ node, showUri, showTypes }: {
  node: GraphNode;
  showUri: boolean;
  showTypes: boolean;
}) {
  const shortTypes = useMemo(() =>
    node.types.map(t => t.split('/').pop()?.split('#').pop() ?? t),
    [node.types]
  );

  return (
    <div>
      <h3 style={{ margin: '0 0 4px 0', wordBreak: 'break-word' }}>
        {node.label}
      </h3>
      {showUri && (
        <div style={{ fontSize: '0.8em', opacity: 0.6, wordBreak: 'break-all', marginBottom: 4 }}>
          {node.id}
        </div>
      )}
      {showTypes && shortTypes.length > 0 && (
        <div style={{ fontSize: '0.85em', marginBottom: 8 }}>
          {shortTypes.join(', ')}
        </div>
      )}
      <div style={{ fontSize: '0.85em', opacity: 0.7 }}>
        Connections: {node.degree}
      </div>
    </div>
  );
}

function PropertySection({ title, entries, maxValueLength }: {
  title: string;
  entries: Map<string, RdfValue[]>;
  maxValueLength: number;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <h4 style={{ margin: '0 0 4px 0', fontSize: '0.8em', textTransform: 'uppercase', opacity: 0.5 }}>
        {title}
      </h4>
      {[...entries].map(([predicate, values]) => {
        const shortKey = predicate.split('/').pop()?.split('#').pop() ?? predicate;
        return (
          <div key={predicate} style={{ fontSize: '0.85em', marginBottom: 2, lineHeight: 1.5 }}>
            <span style={{ opacity: 0.6 }}>{humanize(shortKey)}: </span>
            <span style={{ wordBreak: 'break-word' }}>
              {values.map(v => truncate(v.value, maxValueLength)).join(', ')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^\w/, c => c.toUpperCase());
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
}
