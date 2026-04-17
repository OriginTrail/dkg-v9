/**
 * Compact horizontal strip of sub-graph chips. Sits above MemoryStrip and
 * scopes the whole project view to the selected sub-graph (or "All").
 *
 * Visual styling is fully driven by the project profile: each SubGraphBinding
 * contributes its icon/color/label. Per-sub-graph entity/triple counts come
 * from the daemon's GET /api/sub-graph/list endpoint. If the profile or list
 * endpoint fail, this component renders nothing — it's purely additive.
 */
import React from 'react';
import { fetchSubGraphs, type SubGraphInfo } from '../api.js';
import type { ProjectProfile } from '../hooks/useProjectProfile.js';

export interface SubGraphBarProps {
  contextGraphId: string;
  profile: ProjectProfile;
  selected: string | null;   // null === "All"
  onSelect: (slug: string | null) => void;
}

export const SubGraphBar: React.FC<SubGraphBarProps> = ({ contextGraphId, profile, selected, onSelect }) => {
  const [subGraphs, setSubGraphs] = React.useState<SubGraphInfo[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSubGraphs(contextGraphId)
      .then(r => { if (!cancelled) setSubGraphs(r.subGraphs ?? []); })
      .catch(() => { /* silent — leave empty */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contextGraphId]);

  const merged = React.useMemo(() => {
    // Filter out the `meta` sub-graph since it holds the profile itself, not
    // user-facing entities. Merge daemon counts with profile display data.
    return subGraphs
      .filter(sg => sg.name !== 'meta')
      .map(sg => {
        const binding = profile.forSubGraph(sg.name);
        return {
          slug: sg.name,
          icon: binding.icon ?? '•',
          color: binding.color ?? '#64748b',
          displayName: binding.displayName ?? sg.name,
          description: binding.description ?? sg.description,
          rank: binding.rank ?? 99,
          entityCount: sg.entityCount,
          tripleCount: sg.tripleCount,
        };
      })
      .sort((a, b) => a.rank - b.rank);
  }, [subGraphs, profile]);

  if (loading && merged.length === 0) return null;
  if (merged.length === 0) return null;

  const totalEntities = merged.reduce((a, b) => a + b.entityCount, 0);
  const totalTriples = merged.reduce((a, b) => a + b.tripleCount, 0);

  return (
    <div className="v10-subgraph-bar">
      <div className="v10-subgraph-bar-label">Sub-graphs</div>
      <button
        type="button"
        className={`v10-subgraph-chip${selected === null ? ' active' : ''}`}
        onClick={() => onSelect(null)}
        title={`All sub-graphs · ${totalEntities} entities · ${totalTriples} triples`}
      >
        <span className="v10-subgraph-chip-icon">⊚</span>
        <span className="v10-subgraph-chip-label">All</span>
        <span className="v10-subgraph-chip-count">{totalEntities}</span>
      </button>
      {merged.map(sg => (
        <button
          key={sg.slug}
          type="button"
          className={`v10-subgraph-chip${selected === sg.slug ? ' active' : ''}`}
          onClick={() => onSelect(sg.slug)}
          title={`${sg.displayName}${sg.description ? ' · ' + sg.description : ''} · ${sg.entityCount} entities · ${sg.tripleCount} triples`}
          style={{
            '--sg-color': sg.color,
          } as React.CSSProperties}
        >
          <span className="v10-subgraph-chip-icon" style={{ color: sg.color }}>{sg.icon}</span>
          <span className="v10-subgraph-chip-label">{sg.displayName}</span>
          <span className="v10-subgraph-chip-count">{sg.entityCount}</span>
        </button>
      ))}
    </div>
  );
};
