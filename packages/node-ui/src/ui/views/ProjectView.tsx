import React, { useMemo, useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { useFetch } from '../hooks.js';
import { api } from '../api-wrapper.js';
import { ImportFilesModal } from '../components/Modals/ImportFilesModal.js';
import { useMemoryEntities, type TrustLevel, type MemoryEntity, type Triple } from '../hooks/useMemoryEntities.js';
import { TrustSummaryBar, TrustBadge } from '../components/MemoryExplorer/TrustIndicator.js';

const RdfGraph = lazy(() =>
  import('@origintrail-official/dkg-graph-viz/react').then(m => ({ default: m.RdfGraph }))
);

interface ProjectViewProps {
  contextGraphId: string;
}

type ViewTab = 'conversation' | 'timeline' | 'graph' | 'entities';

const TRUST_COLORS: Record<TrustLevel, string> = {
  verified: '#22c55e',
  shared: '#f59e0b',
  working: '#64748b',
};

const TYPE_LABELS: Record<string, { icon: string; group: string }> = {
  Person: { icon: '👤', group: 'People' },
  SoftwareApplication: { icon: '💻', group: 'Software' },
  SoftwareSourceCode: { icon: '📦', group: 'Code' },
  Organization: { icon: '🏢', group: 'Organizations' },
  Event: { icon: '📅', group: 'Events' },
  ChooseAction: { icon: '⚡', group: 'Decisions' },
  DefinedTerm: { icon: '📘', group: 'Concepts' },
  CreativeWork: { icon: '📄', group: 'Documents' },
  Product: { icon: '🪙', group: 'Products' },
  Thing: { icon: '◆', group: 'Other' },
};

function shortType(uri: string): string {
  const hash = uri.lastIndexOf('#');
  const slash = uri.lastIndexOf('/');
  const cut = Math.max(hash, slash);
  return cut >= 0 ? uri.slice(cut + 1) : uri;
}

function shortPred(uri: string): string {
  const hash = uri.lastIndexOf('#');
  const slash = uri.lastIndexOf('/');
  const cut = Math.max(hash, slash);
  const raw = cut >= 0 ? uri.slice(cut + 1) : uri;
  return raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function entityMeta(e: MemoryEntity) {
  const primaryType = e.types[0] ? shortType(e.types[0]) : 'Entity';
  const info = TYPE_LABELS[primaryType] ?? TYPE_LABELS.Thing;
  return { ...info, type: primaryType };
}

function getDate(e: MemoryEntity): string | null {
  const datePreds = ['http://schema.org/startDate', 'http://schema.org/dateCreated', 'http://schema.org/datePublished'];
  for (const p of datePreds) {
    const v = e.properties.get(p);
    if (v?.[0]) return v[0];
  }
  return null;
}

function getDescription(e: MemoryEntity): string | null {
  const descPreds = ['http://schema.org/description', 'http://schema.org/text'];
  for (const p of descPreds) {
    const v = e.properties.get(p);
    if (v?.[0]) return v[0];
  }
  return null;
}

function getAgentTool(e: MemoryEntity): string | null {
  const v = e.properties.get('http://schema.org/additionalType');
  return v?.[0] ?? null;
}

const CONTRIBUTOR_PREDS = new Set([
  'http://schema.org/contributor',
  'http://schema.org/author',
  'http://schema.org/agent',
  'http://schema.org/creator',
]);

function neighborhoodTriples(entityUri: string, allTriples: Triple[], hops: number = 2): Triple[] {
  const visited = new Set<string>([entityUri]);
  let frontier = new Set<string>([entityUri]);

  for (let i = 0; i < hops; i++) {
    const nextFrontier = new Set<string>();
    for (const t of allTriples) {
      if (frontier.has(t.subject) && !visited.has(t.object)) {
        nextFrontier.add(t.object);
      }
      if (frontier.has(t.object) && !visited.has(t.subject)) {
        nextFrontier.add(t.subject);
      }
    }
    for (const u of nextFrontier) visited.add(u);
    frontier = nextFrontier;
    if (frontier.size === 0) break;
  }

  return allTriples.filter(t => visited.has(t.subject) || visited.has(t.object));
}

// ─── Timeline View ───────────────────────────────────────────

function TimelineView({ memory, search, onSelect }: {
  memory: ReturnType<typeof useMemoryEntities>;
  search: string;
  onSelect: (uri: string) => void;
}) {
  const groups = useMemo(() => {
    const dated: Array<{ date: string; entities: MemoryEntity[] }> = [];
    const undated: MemoryEntity[] = [];
    const dateMap = new Map<string, MemoryEntity[]>();

    for (const e of memory.entityList) {
      if (search && !matchesSearch(e, search)) continue;
      const d = getDate(e);
      if (d) {
        const list = dateMap.get(d) ?? [];
        list.push(e);
        dateMap.set(d, list);
      } else {
        undated.push(e);
      }
    }

    for (const [date, entities] of [...dateMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      dated.push({ date, entities });
    }

    const typeGroups = new Map<string, MemoryEntity[]>();
    for (const e of undated) {
      const { group } = entityMeta(e);
      const list = typeGroups.get(group) ?? [];
      list.push(e);
      typeGroups.set(group, list);
    }

    return { dated, typeGroups: [...typeGroups.entries()] };
  }, [memory.entityList, search]);

  if (groups.dated.length === 0 && groups.typeGroups.length === 0) {
    return <div className="v10-tl-empty">No matching entities.</div>;
  }

  return (
    <div className="v10-tl-scroll">
      {groups.dated.map(({ date, entities }) => (
        <div key={date} className="v10-tl-date-group">
          <div className="v10-tl-date-label">{date}</div>
          <div className="v10-tl-date-items">
            {entities.map(e => (
              <NarrativeCard key={e.uri} entity={e} allEntities={memory.entities} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ))}

      {groups.typeGroups.map(([group, entities]) => (
        <div key={group} className="v10-tl-type-group">
          <div className="v10-tl-type-label">{group}</div>
          <div className="v10-tl-date-items">
            {entities.map(e => (
              <NarrativeCard key={e.uri} entity={e} allEntities={memory.entities} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Conversation View (read-only transcript) ───────────────

interface ConversationTurn {
  uri: string;
  speaker: string;
  speakerLabel: string;
  speakerTool: string | null;
  timestamp: string | null;
  markdown: string | null;
  entityMentions: Array<{ uri: string; label: string }>;
  trustLevel: TrustLevel;
}

function useConversationTurns(memory: ReturnType<typeof useMemoryEntities>): ConversationTurn[] {
  return useMemo(() => {
    const turns: ConversationTurn[] = [];
    for (const entity of memory.entityList) {
      const isConvTurn = entity.types.some(t =>
        t.includes('ConversationTurn') || t.includes('conversationturn')
      );
      if (!isConvTurn) continue;

      const speaker = entity.connections.find(c =>
        c.predicate === 'http://schema.org/agent' || c.predicate === 'http://schema.org/author'
      );
      const speakerToolVal = entity.properties.get('http://dkg.io/ontology/speakerTool');
      const descVal = entity.properties.get('http://schema.org/description')
        ?? entity.properties.get('http://schema.org/text');
      const dateVal = getDate(entity);

      const mentions: Array<{ uri: string; label: string }> = [];
      for (const conn of entity.connections) {
        if (conn.predicate === 'http://schema.org/mentions') {
          mentions.push({ uri: conn.targetUri, label: conn.targetLabel });
        }
      }

      turns.push({
        uri: entity.uri,
        speaker: speaker?.targetUri ?? 'unknown',
        speakerLabel: speaker?.targetLabel ?? entity.label,
        speakerTool: speakerToolVal?.[0] ?? null,
        timestamp: dateVal,
        markdown: descVal?.[0] ?? null,
        entityMentions: mentions,
        trustLevel: entity.trustLevel,
      });
    }

    turns.sort((a, b) => {
      if (a.timestamp && b.timestamp) return a.timestamp.localeCompare(b.timestamp);
      if (a.timestamp) return -1;
      if (b.timestamp) return 1;
      return 0;
    });

    return turns;
  }, [memory.entityList]);
}

function ConversationView({ memory, search, onSelect }: {
  memory: ReturnType<typeof useMemoryEntities>;
  search: string;
  onSelect: (uri: string) => void;
}) {
  const turns = useConversationTurns(memory);

  const filtered = useMemo(() => {
    if (!search) return turns;
    const lower = search.toLowerCase();
    return turns.filter(t =>
      t.speakerLabel.toLowerCase().includes(lower) ||
      t.markdown?.toLowerCase().includes(lower) ||
      t.entityMentions.some(m => m.label.toLowerCase().includes(lower))
    );
  }, [turns, search]);

  if (filtered.length === 0) {
    return (
      <div className="v10-tl-empty">
        {turns.length === 0
          ? 'No conversation turns yet. Ingest turns via POST /api/memory/turn.'
          : 'No matching turns.'}
      </div>
    );
  }

  let currentDate = '';

  return (
    <div className="v10-conv-scroll">
      {filtered.map(turn => {
        const dateLabel = turn.timestamp?.split('T')[0] ?? '';
        const showDate = dateLabel !== currentDate;
        if (showDate) currentDate = dateLabel;

        return (
          <React.Fragment key={turn.uri}>
            {showDate && dateLabel && (
              <div className="v10-conv-date-divider">{dateLabel}</div>
            )}
            <button className="v10-conv-turn" onClick={() => onSelect(turn.uri)}>
              <div className="v10-conv-turn-header">
                <span className="v10-conv-speaker">{turn.speakerLabel}</span>
                {turn.speakerTool && (
                  <span className="v10-conv-tool">{turn.speakerTool}</span>
                )}
                <TrustBadge level={turn.trustLevel} />
                {turn.timestamp && (
                  <span className="v10-conv-time">
                    {turn.timestamp.split('T')[1]?.slice(0, 5) ?? turn.timestamp}
                  </span>
                )}
              </div>
              {turn.markdown && (
                <div className="v10-conv-body">
                  {turn.markdown.length > 300
                    ? turn.markdown.slice(0, 300) + '...'
                    : turn.markdown}
                </div>
              )}
              {turn.entityMentions.length > 0 && (
                <div className="v10-conv-mentions">
                  {turn.entityMentions.map(m => (
                    <span
                      key={m.uri}
                      className="v10-conv-mention"
                      onClick={(e) => { e.stopPropagation(); onSelect(m.uri); }}
                      role="link"
                      tabIndex={0}
                    >
                      {m.label}
                    </span>
                  ))}
                </div>
              )}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Narrative Card (rich entity card) ───────────────────────

function NarrativeCard({ entity, allEntities, onSelect }: {
  entity: MemoryEntity;
  allEntities: Map<string, MemoryEntity>;
  onSelect: (uri: string) => void;
}) {
  const { icon, type } = entityMeta(entity);
  const desc = getDescription(entity);
  const date = getDate(entity);

  const { contributors, otherOut, incoming } = useMemo(() => {
    const contribs: Array<{ uri: string; label: string; agentTool: string | null }> = [];
    const other = new Map<string, Array<{ uri: string; label: string }>>();

    for (const conn of entity.connections) {
      if (CONTRIBUTOR_PREDS.has(conn.predicate)) {
        const target = allEntities.get(conn.targetUri);
        contribs.push({
          uri: conn.targetUri,
          label: conn.targetLabel,
          agentTool: target ? getAgentTool(target) : null,
        });
      } else {
        const pred = shortPred(conn.predicate);
        const list = other.get(pred) ?? [];
        list.push({ uri: conn.targetUri, label: conn.targetLabel });
        other.set(pred, list);
      }
    }

    const inc: Array<{ pred: string; uri: string; label: string; agentTool: string | null }> = [];
    for (const [, o] of allEntities) {
      for (const conn of o.connections) {
        if (conn.targetUri === entity.uri) {
          if (CONTRIBUTOR_PREDS.has(conn.predicate)) {
            contribs.push({
              uri: o.uri,
              label: o.label,
              agentTool: getAgentTool(o),
            });
          } else {
            inc.push({ pred: shortPred(conn.predicate), uri: o.uri, label: o.label, agentTool: null });
          }
        }
      }
    }

    const seen = new Set<string>();
    const deduped = contribs.filter(c => { if (seen.has(c.uri)) return false; seen.add(c.uri); return true; });

    return { contributors: deduped, otherOut: [...other.entries()], incoming: inc };
  }, [entity, allEntities]);

  const clickEntity = (e: React.MouseEvent, uri: string) => {
    e.stopPropagation();
    onSelect(uri);
  };

  return (
    <button className="v10-nc" onClick={() => onSelect(entity.uri)}>
      <div className="v10-nc-header">
        <span className="v10-nc-icon">{icon}</span>
        <span className="v10-nc-label">{entity.label}</span>
        <TrustBadge level={entity.trustLevel} />
      </div>

      {/* Contributor byline — prominent, clickable */}
      {contributors.length > 0 && (
        <div className="v10-nc-contributors">
          {contributors.map((c, i) => (
            <span
              key={c.uri}
              className="v10-nc-contributor"
              onClick={(e) => clickEntity(e, c.uri)}
              role="link"
              tabIndex={0}
            >
              {i > 0 && <span className="v10-nc-contrib-sep">·</span>}
              <span className="v10-nc-contrib-name">{c.label}</span>
              {c.agentTool && <span className="v10-nc-contrib-tool">{c.agentTool}</span>}
            </span>
          ))}
        </div>
      )}

      {desc && <p className="v10-nc-desc">{desc}</p>}

      {/* Other relationships */}
      {(otherOut.length > 0 || incoming.length > 0) && (
        <div className="v10-nc-rels">
          {otherOut.map(([pred, targets]) => (
            <span key={pred} className="v10-nc-rel">
              <span className="v10-nc-rel-pred">{pred}</span>
              {targets.map((t, i) => (
                <span
                  key={t.uri}
                  className="v10-nc-rel-target v10-nc-rel-clickable"
                  onClick={(e) => clickEntity(e, t.uri)}
                  role="link"
                  tabIndex={0}
                >
                  {i > 0 && ', '}{t.label}
                </span>
              ))}
            </span>
          ))}
          {incoming.map((inc, i) => (
            <span key={`in-${i}`} className="v10-nc-rel">
              <span className="v10-nc-rel-pred">← {inc.pred}</span>
              <span
                className="v10-nc-rel-target v10-nc-rel-clickable"
                onClick={(e) => clickEntity(e, inc.uri)}
                role="link"
                tabIndex={0}
              >
                {inc.label}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="v10-nc-footer">
        <span className="v10-nc-type">{type}</span>
        {date && <span className="v10-nc-date">{date}</span>}
        <span className="v10-nc-stats">
          {entity.connections.length} links · {entity.properties.size} props
        </span>
      </div>
    </button>
  );
}

// ─── Entity List View ────────────────────────────────────────

function EntitiesView({ memory, search, onSelect, selectedUri }: {
  memory: ReturnType<typeof useMemoryEntities>;
  search: string;
  onSelect: (uri: string) => void;
  selectedUri: string | null;
}) {
  const typeGroups = useMemo(() => {
    const groups = new Map<string, MemoryEntity[]>();
    for (const e of memory.entityList) {
      if (search && !matchesSearch(e, search)) continue;
      const { group } = entityMeta(e);
      const list = groups.get(group) ?? [];
      list.push(e);
      groups.set(group, list);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [memory.entityList, search]);

  return (
    <div className="v10-ev-scroll">
      {typeGroups.map(([group, entities]) => (
        <div key={group} className="v10-ev-group">
          <div className="v10-ev-group-label">{group} ({entities.length})</div>
          {entities.map(e => {
            const { icon } = entityMeta(e);
            return (
              <button
                key={e.uri}
                className={`v10-ev-item ${selectedUri === e.uri ? 'selected' : ''}`}
                onClick={() => onSelect(e.uri)}
              >
                <span className="v10-ev-item-icon">{icon}</span>
                <span className="v10-ev-item-label">{e.label}</span>
                <TrustBadge level={e.trustLevel} />
                <span className="v10-ev-item-links">{e.connections.length}</span>
              </button>
            );
          })}
        </div>
      ))}
      {typeGroups.length === 0 && (
        <div className="v10-tl-empty">No matching entities.</div>
      )}
    </div>
  );
}

// ─── Graph View (full graph, preserved from before) ──────────

function GraphView({ memory, nodeColors, onNodeClick }: {
  memory: ReturnType<typeof useMemoryEntities>;
  nodeColors: Record<string, string>;
  onNodeClick: (node: any) => void;
}) {
  const graphOptions = useMemo(() => ({
    labelMode: 'humanized' as const,
    renderer: '2d' as const,
    labels: {
      predicates: [
        'http://schema.org/name',
        'http://www.w3.org/2000/01/rdf-schema#label',
        'http://purl.org/dc/terms/title',
        'http://schema.org/text',
      ],
    },
    style: {
      nodeColors,
      defaultNodeColor: TRUST_COLORS.working,
      defaultEdgeColor: '#334155',
      edgeWidth: 0.7,
    },
    hexagon: { baseSize: 4, minSize: 3, maxSize: 6, scaleWithDegree: true },
    focus: { maxNodes: 3000, hops: 999 },
  }), [nodeColors]);

  return (
    <div className="v10-gv-container">
      <Suspense fallback={<div className="v10-me-graph-loading">Loading graph...</div>}>
        <RdfGraph
          data={memory.graphTriples}
          format="triples"
          options={graphOptions}
          style={{ width: '100%', height: '100%' }}
          onNodeClick={onNodeClick}
          initialFit
        />
      </Suspense>
      <div className="v10-me-graph-legend">
        <span className="v10-me-legend-item">
          <span className="v10-me-legend-dot" style={{ background: TRUST_COLORS.verified }} /> Verified
        </span>
        <span className="v10-me-legend-item">
          <span className="v10-me-legend-dot" style={{ background: TRUST_COLORS.shared }} /> Shared
        </span>
        <span className="v10-me-legend-item">
          <span className="v10-me-legend-dot" style={{ background: TRUST_COLORS.working }} /> Draft
        </span>
      </div>
    </div>
  );
}

// ─── Drill-down panel (2-hop focused graph + rich card) ──────

function DrilldownPanel({ entity, allEntities, allTriples, nodeColors, onNavigate, onClose, contextGraphId }: {
  entity: MemoryEntity;
  allEntities: Map<string, MemoryEntity>;
  allTriples: Triple[];
  nodeColors: Record<string, string>;
  onNavigate: (uri: string) => void;
  onClose: () => void;
  contextGraphId: string;
}) {
  const { icon, type } = entityMeta(entity);
  const desc = getDescription(entity);

  const hoodTriples = useMemo(
    () => neighborhoodTriples(entity.uri, allTriples, 2),
    [entity.uri, allTriples]
  );

  const hoodOptions = useMemo(() => ({
    labelMode: 'humanized' as const,
    renderer: '2d' as const,
    labels: { predicates: ['http://schema.org/name', 'http://www.w3.org/2000/01/rdf-schema#label'] },
    style: {
      nodeColors,
      defaultNodeColor: TRUST_COLORS.working,
      defaultEdgeColor: '#475569',
      edgeWidth: 1.0,
    },
    hexagon: { baseSize: 5, minSize: 3, maxSize: 8, scaleWithDegree: true },
    focus: { maxNodes: 500, hops: 999 },
    autoFitDisabled: true,
  }), [nodeColors]);

  const incoming = useMemo(() => {
    const result: Array<{ pred: string; entity: MemoryEntity }> = [];
    for (const [, other] of allEntities) {
      for (const conn of other.connections) {
        if (conn.targetUri === entity.uri) {
          result.push({ pred: shortPred(conn.predicate), entity: other });
        }
      }
    }
    return result;
  }, [entity.uri, allEntities]);

  // 'Mentioned in' — conversation turns that reference this entity
  const mentionedIn = useMemo(() => {
    const turns: Array<{ entity: MemoryEntity; date: string | null }> = [];
    for (const [, other] of allEntities) {
      const isConvTurn = other.types.some(t => t.includes('ConversationTurn'));
      if (!isConvTurn) continue;
      const mentions = other.connections.some(c =>
        c.targetUri === entity.uri && c.predicate === 'http://schema.org/mentions'
      );
      if (mentions) {
        turns.push({ entity: other, date: getDate(other) });
      }
    }
    turns.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return turns;
  }, [entity.uri, allEntities]);

  // 'Source' — source file link
  const sourceFile = useMemo(() => {
    const sf = entity.properties.get('http://dkg.io/ontology/sourceFile');
    return sf?.[0] ?? null;
  }, [entity]);

  // 'Similar' — vector-similar entities (fetched from API)
  const [similar, setSimilar] = useState<Array<{ entityUri: string; label: string | null; similarity: number }>>([]);
  useEffect(() => {
    const label = entity.label;
    if (!label || !contextGraphId) return;
    let cancelled = false;
    const token = typeof window !== 'undefined' ? (window as any).__DKG_TOKEN__ : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch('/api/memory/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: label, contextGraphId, limit: 5, memoryLayers: ['swm', 'vm'] }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled || !data.results) return;
        setSimilar(
          data.results
            .filter((r: any) => r.entityUri !== entity.uri)
            .slice(0, 5)
            .map((r: any) => ({ entityUri: r.entityUri, label: r.label, similarity: r.similarity }))
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [entity.uri, entity.label, contextGraphId]);

  return (
    <div className="v10-dd-panel">
      <div className="v10-dd-header">
        <button className="v10-dd-back" onClick={onClose}>← Back</button>
      </div>

      <div className="v10-dd-graph">
        <Suspense fallback={<div className="v10-me-graph-loading">Loading...</div>}>
          <RdfGraph
            data={hoodTriples}
            format="triples"
            options={hoodOptions}
            style={{ width: '100%', height: '100%' }}
            onNodeClick={(n: any) => n?.id && n.id !== entity.uri && onNavigate(n.id)}
            initialFit
          />
        </Suspense>
        <div className="v10-dd-graph-info">
          {hoodTriples.length} facts in neighborhood
        </div>
      </div>

      <div className="v10-dd-card">
        <div className="v10-dd-card-header">
          <span className="v10-dd-icon">{icon}</span>
          <div>
            <h2 className="v10-dd-title">{entity.label}</h2>
            <div className="v10-dd-type-row">
              <span className="v10-dd-type">{type}</span>
              <TrustBadge level={entity.trustLevel} showLabel />
            </div>
          </div>
        </div>

        {desc && <p className="v10-dd-desc">{desc}</p>}

        <div className="v10-dd-uri mono">{entity.uri}</div>

        {/* Source file link */}
        {sourceFile && (
          <div className="v10-dd-section">
            <h4 className="v10-dd-section-title">Source</h4>
            <a className="v10-dd-source-link" href={`/api/file/${encodeURIComponent(sourceFile.replace('urn:dkg:file:', ''))}`} target="_blank" rel="noreferrer">
              View source file
            </a>
          </div>
        )}

        {entity.properties.size > 0 && (
          <div className="v10-dd-section">
            <h4 className="v10-dd-section-title">Properties</h4>
            {[...entity.properties].map(([pred, vals]) => (
              <div key={pred} className="v10-dd-prop">
                <span className="v10-dd-prop-key">{shortPred(pred)}</span>
                <span className="v10-dd-prop-val">{vals.join(', ')}</span>
              </div>
            ))}
          </div>
        )}

        {entity.connections.length > 0 && (
          <div className="v10-dd-section">
            <h4 className="v10-dd-section-title">Links to ({entity.connections.length})</h4>
            {entity.connections.map((conn, i) => (
              <button key={i} className="v10-dd-conn" onClick={() => onNavigate(conn.targetUri)}>
                <span className="v10-dd-conn-pred">{shortPred(conn.predicate)}</span>
                <span className="v10-dd-conn-arrow">→</span>
                <span className="v10-dd-conn-target">{conn.targetLabel}</span>
              </button>
            ))}
          </div>
        )}

        {incoming.length > 0 && (
          <div className="v10-dd-section">
            <h4 className="v10-dd-section-title">Referenced by ({incoming.length})</h4>
            {incoming.map((inc, i) => (
              <button key={i} className="v10-dd-conn" onClick={() => onNavigate(inc.entity.uri)}>
                <span className="v10-dd-conn-target">{inc.entity.label}</span>
                <span className="v10-dd-conn-arrow">→</span>
                <span className="v10-dd-conn-pred">{inc.pred}</span>
              </button>
            ))}
          </div>
        )}

        {/* Mentioned in — conversation turns */}
        {mentionedIn.length > 0 && (
          <div className="v10-dd-section">
            <h4 className="v10-dd-section-title">Mentioned in ({mentionedIn.length} turns)</h4>
            {mentionedIn.map((m, i) => (
              <button key={i} className="v10-dd-conn" onClick={() => onNavigate(m.entity.uri)}>
                <span className="v10-dd-conn-target">{m.entity.label}</span>
                {m.date && <span className="v10-dd-conn-date">{m.date}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Similar — vector proximity */}
        {similar.length > 0 && (
          <div className="v10-dd-section">
            <h4 className="v10-dd-section-title">Similar</h4>
            {similar.map((s, i) => {
              const target = allEntities.get(s.entityUri);
              return (
                <button key={i} className="v10-dd-conn" onClick={() => onNavigate(s.entityUri)}>
                  <span className="v10-dd-conn-target">{target?.label ?? s.label ?? s.entityUri}</span>
                  {s.similarity != null && (
                    <span className="v10-dd-conn-sim">{Math.round(s.similarity * 100)}%</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Search helper ───────────────────────────────────────────

function matchesSearch(e: MemoryEntity, q: string): boolean {
  const lower = q.toLowerCase();
  if (e.label.toLowerCase().includes(lower)) return true;
  if (e.uri.toLowerCase().includes(lower)) return true;
  for (const t of e.types) if (shortType(t).toLowerCase().includes(lower)) return true;
  for (const [, vals] of e.properties) {
    for (const v of vals) if (v.toLowerCase().includes(lower)) return true;
  }
  for (const c of e.connections) if (c.targetLabel.toLowerCase().includes(lower)) return true;
  return false;
}

// ─── Main ProjectView ────────────────────────────────────────

export function ProjectView({ contextGraphId }: ProjectViewProps) {
  const { data: cgData } = useFetch(api.fetchContextGraphs, [], 30_000);
  const [showImport, setShowImport] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>('conversation');
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const cg = useMemo(
    () => cgData?.contextGraphs?.find((c: any) => c.id === contextGraphId),
    [cgData, contextGraphId]
  );

  const memory = useMemoryEntities(contextGraphId);

  const selectedEntity = useMemo(
    () => selectedUri ? memory.entities.get(selectedUri) ?? null : null,
    [selectedUri, memory.entities]
  );

  const nodeColors = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const [uri, entity] of memory.entities) {
      colors[uri] = TRUST_COLORS[entity.trustLevel];
    }
    return colors;
  }, [memory.entities]);

  const handleSelect = useCallback((uri: string) => {
    setSelectedUri(uri);
  }, []);

  const handleNavigate = useCallback((uri: string) => {
    setSelectedUri(uri);
  }, []);

  const handleNodeClick = useCallback((node: any) => {
    if (node?.id) setSelectedUri(node.id);
  }, []);

  if (!cg) {
    return (
      <div className="v10-view-placeholder">
        <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Loading context graph...</p>
      </div>
    );
  }

  const hasData = memory.entityList.length > 0;

  return (
    <div className="v10-memory-explorer">
      {/* ── Header ── */}
      <div className="v10-me-header">
        <div className="v10-me-header-left">
          <div className="v10-me-project-dot" />
          <div>
            <h1 className="v10-me-title">{cg.name || cg.id}</h1>
            <div className="v10-me-meta">
              <span>{memory.counts.total} entities</span>
              <span className="v10-me-meta-sep">·</span>
              <span>{memory.graphTriples.length} facts</span>
            </div>
          </div>
        </div>
        <div className="v10-me-header-actions">
          <button className="v10-me-action-btn" onClick={() => setShowImport(true)}>↑ Import</button>
          <button className="v10-me-action-btn" onClick={memory.refresh}>↻</button>
        </div>
      </div>

      <TrustSummaryBar counts={memory.counts} />

      {/* ── Search + Tab bar ── */}
      {hasData && (
        <div className="v10-me-toolbar">
          <div className="v10-me-tabs">
            {(['conversation', 'timeline', 'graph', 'entities'] as ViewTab[]).map(tab => (
              <button
                key={tab}
                className={`v10-me-tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => { setActiveTab(tab); setSelectedUri(null); }}
              >
                {tab === 'conversation' ? '💬 Conversation' : tab === 'timeline' ? '◷ Timeline' : tab === 'graph' ? '⬡ Graph' : '☰ Entities'}
              </button>
            ))}
          </div>
          <input
            className="v10-me-search"
            type="text"
            placeholder="Search memory..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      )}

      {memory.loading && (
        <div className="v10-me-loading"><div className="v10-me-loading-text">Loading memory...</div></div>
      )}
      {memory.error && (
        <div className="v10-me-error">Error: {memory.error}</div>
      )}

      {/* ── Drilldown overlay ── */}
      {!memory.loading && hasData && selectedEntity && (
        <DrilldownPanel
          entity={selectedEntity}
          allEntities={memory.entities}
          allTriples={memory.graphTriples}
          nodeColors={nodeColors}
          onNavigate={handleNavigate}
          onClose={() => setSelectedUri(null)}
          contextGraphId={contextGraphId}
        />
      )}

      {/* ── Tab content ── */}
      {!memory.loading && hasData && !selectedEntity && (
        <>
          {activeTab === 'conversation' && (
            <ConversationView memory={memory} search={search} onSelect={handleSelect} />
          )}
          {activeTab === 'timeline' && (
            <TimelineView memory={memory} search={search} onSelect={handleSelect} />
          )}
          {activeTab === 'graph' && (
            <GraphView memory={memory} nodeColors={nodeColors} onNodeClick={handleNodeClick} />
          )}
          {activeTab === 'entities' && (
            <EntitiesView memory={memory} search={search} onSelect={handleSelect} selectedUri={selectedUri} />
          )}
        </>
      )}

      {/* ── Empty state ── */}
      {!memory.loading && !hasData && (
        <div className="v10-me-empty">
          <div className="v10-me-empty-icon">⬡</div>
          <h2 className="v10-me-empty-title">No knowledge yet</h2>
          <p className="v10-me-empty-desc">
            Import files, chat with your agent, or connect an integration to start building this project's memory.
          </p>
          <button className="v10-modal-btn primary" onClick={() => setShowImport(true)}>↑ Import Files</button>
        </div>
      )}

      <ImportFilesModal
        open={showImport}
        onClose={() => setShowImport(false)}
        contextGraphId={cg.id}
        contextGraphName={cg.name}
      />
    </div>
  );
}
