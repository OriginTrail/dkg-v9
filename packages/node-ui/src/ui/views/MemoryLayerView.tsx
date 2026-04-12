import React, { useState, useMemo } from 'react';
import { useFetch } from '../hooks.js';
import { executeQuery } from '../api.js';

type MemoryLayer = 'wm' | 'swm' | 'vm';

const LAYER_META: Record<MemoryLayer, { label: string; color: string; icon: string; description: string }> = {
  wm: { label: 'Working Memory', color: 'var(--layer-working)', icon: '◇', description: 'Private agent drafts. Fast local storage.' },
  swm: { label: 'Shared Working Memory', color: 'var(--layer-shared)', icon: '◈', description: 'Shared proposals with collaborators. TTL-bounded.' },
  vm: { label: 'Verified Memory', color: 'var(--layer-verified)', icon: '◉', description: 'Endorsed, published, on-chain knowledge.' },
};

interface MemoryLayerViewProps {
  layer: MemoryLayer;
  contextGraphId: string;
}

export function MemoryLayerView({ layer, contextGraphId }: MemoryLayerViewProps) {
  const meta = LAYER_META[layer];
  const [customQuery, setCustomQuery] = useState('');

  const defaultSparql = useMemo(() => {
    if (layer === 'wm') {
      return `SELECT ?s ?p ?o WHERE { { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } } } LIMIT 200`;
    }
    return `SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 50`;
  }, [layer]);

  const sparql = customQuery || defaultSparql;

  const graphSuffix = layer === 'swm' ? '_shared_memory' as const : undefined;
  const includeShared = layer === 'swm';

  const { data, loading, error, refresh } = useFetch(
    () => executeQuery(sparql, contextGraphId, includeShared, graphSuffix),
    [sparql, contextGraphId, layer],
    0
  );

  const results = data?.result?.bindings ?? data?.results?.bindings ?? [];

  return (
    <div className="v10-memory-layer-view">
      <div className="v10-mlv-header">
        <span className="v10-mlv-icon" style={{ color: meta.color }}>{meta.icon}</span>
        <div>
          <h2 className="v10-mlv-title">{meta.label}</h2>
          <p className="v10-mlv-desc">{meta.description}</p>
        </div>
      </div>

      <div className="v10-mlv-query-bar">
        <input
          type="text"
          className="v10-mlv-query-input"
          placeholder="Custom SPARQL query..."
          value={customQuery}
          onChange={(e) => setCustomQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') refresh(); }}
        />
        <button className="v10-mlv-run-btn" onClick={refresh}>
          Run
        </button>
      </div>

      {loading && <p className="v10-mlv-status">Loading...</p>}
      {error && <p className="v10-mlv-status" style={{ color: 'var(--accent-red)' }}>Error: {error}</p>}

      {!loading && results.length === 0 && (
        <div className="v10-mlv-empty">
          <p>No triples found in {meta.label.toLowerCase()}.</p>
          <p style={{ fontSize: 11, marginTop: 4 }}>
            {layer === 'wm' && 'Chat with your agent to generate working memory.'}
            {layer === 'swm' && 'Publish from working memory to share with collaborators.'}
            {layer === 'vm' && 'Endorse shared memory to create verified knowledge.'}
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="v10-mlv-table-wrap">
          <table className="v10-mlv-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Predicate</th>
                <th>Object</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row: any, i: number) => (
                <tr key={i}>
                  <td className="v10-mlv-cell">{shorten(row.s?.value)}</td>
                  <td className="v10-mlv-cell">{shorten(row.p?.value)}</td>
                  <td className="v10-mlv-cell">{shorten(row.o?.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function shorten(uri?: string): string {
  if (!uri) return '—';
  const hash = uri.lastIndexOf('#');
  const slash = uri.lastIndexOf('/');
  const cut = Math.max(hash, slash);
  return cut >= 0 ? uri.slice(cut + 1) : uri;
}
