import React, { useState, useCallback, useEffect } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { useFetch, formatTime, shortId } from '../hooks.js';
import {
  executeQuery, fetchParanets, fetchQueryHistory, fetchSavedQueries,
  createSavedQuery, deleteSavedQuery, publishTriples,
} from '../api.js';
import { RdfGraph, useRdfGraph } from '@dkg/graph-viz/react';

export function ExplorerPage() {
  return (
    <div>
      <h1 className="page-title">Knowledge Explorer</h1>
      <div className="tab-group">
        <NavLink to="/explorer" end className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}>Graph</NavLink>
        <NavLink to="/explorer/sparql" className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}>SPARQL</NavLink>
        <NavLink to="/explorer/paranets" className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}>Paranets</NavLink>
        <NavLink to="/explorer/publish" className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}>Publish</NavLink>
        <NavLink to="/explorer/history" className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}>History</NavLink>
        <NavLink to="/explorer/saved" className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}>Saved</NavLink>
      </div>
      <Routes>
        <Route path="/" element={<GraphTab />} />
        <Route path="/sparql" element={<SparqlTab />} />
        <Route path="/paranets" element={<ParanetsTab />} />
        <Route path="/publish" element={<PublishTab />} />
        <Route path="/history" element={<HistoryTab />} />
        <Route path="/saved" element={<SavedTab />} />
      </Routes>
    </div>
  );
}

const GRAPH_LIMITS = [1000, 5000, 10000, 25000, 50000] as const;

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

function isResourceObject(value: string): boolean {
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('urn:') ||
    value.startsWith('_:') ||
    (value.startsWith('<') && value.endsWith('>'))
  );
}

/**
 * Convert quads into triples so that every triple appears in the graph.
 * Literal objects become synthetic nodes (_:lit_0, _:lit_1, ...) with an
 * rdfs:label triple so the value is shown on the node.
 */
function triplesWithLiteralsAsNodes(
  quads: Array<{ subject: string; predicate: string; object: string }>,
): Array<{ subject: string; predicate: string; object: string }> {
  const out: Array<{ subject: string; predicate: string; object: string }> = [];
  let litIndex = 0;
  for (const q of quads) {
    const obj = q.object;
    if (isResourceObject(obj)) {
      out.push({ subject: q.subject, predicate: q.predicate, object: obj });
    } else {
      const litId = `_:lit_${litIndex++}`;
      out.push({ subject: q.subject, predicate: q.predicate, object: litId });
      out.push({ subject: litId, predicate: RDFS_LABEL, object: obj });
    }
  }
  return out;
}

/** Calls zoomToFit after the graph has loaded so one or few nodes are framed correctly. */
function GraphZoomToFit() {
  const { viz } = useRdfGraph();
  useEffect(() => {
    if (!viz) return;
    const t = setTimeout(() => {
      try {
        viz.zoomToFit(40, 400);
      } catch {
        // ignore
      }
    }, 800);
    return () => clearTimeout(t);
  }, [viz]);
  return null;
}

function GraphTab() {
  const [triples, setTriples] = useState<Array<{ subject: string; predicate: string; object: string }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(10000);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Query default graph + all named graphs (DKG stores data in paranet named graphs)
      const sparql = `CONSTRUCT { ?s ?p ?o } WHERE { { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } } } LIMIT ${limit}`;
      const res = await executeQuery(sparql);
      const raw = res?.result;
      const quads = raw?.quads;
      if (quads && Array.isArray(quads) && quads.length > 0) {
        const raw = quads.map((q: { subject: string; predicate: string; object: string }) => ({
          subject: q.subject,
          predicate: q.predicate,
          object: q.object,
        }));
        setTriples(triplesWithLiteralsAsNodes(raw));
      } else {
        setTriples([]);
      }
    } catch (err: any) {
      setError(err.message);
      setTriples(null);
    } finally {
      setLoading(false);
    }
  }, [limit, refreshKey]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <span className="card-title" style={{ marginBottom: 0 }}>Full knowledge graph</span>
        <select
          className="input"
          style={{ width: 'auto', minWidth: 100 }}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        >
          {GRAPH_LIMITS.map((n) => (
            <option key={n} value={n}>Limit {n}</option>
          ))}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {triples && !loading && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {triples.length} triples (all shown; literals as nodes)
          </span>
        )}
      </div>
      {error && (
        <div style={{ padding: 16, color: 'var(--error)' }}>{error}</div>
      )}
      {loading && !triples && (
        <div className="loading" style={{ minHeight: 400 }}>Loading graph…</div>
      )}
      {triples && triples.length === 0 && !loading && (
        <div className="empty-state" style={{ minHeight: 400 }}>No triples in the store</div>
      )}
      {triples && triples.length > 0 && (
        <div style={{ height: 600, minHeight: 400, background: 'var(--bg-input)' }}>
          <RdfGraph
            data={triples}
            format="triples"
            options={{
              labelMode: 'humanized',
              renderer: '2d',
              hexagon: { baseSize: 3, minSize: 2, maxSize: 5, scaleWithDegree: true },
            }}
            style={{ width: '100%', height: '100%' }}
            onNodeClick={(node) => console.log('Node:', node)}
          >
            <GraphZoomToFit />
          </RdfGraph>
        </div>
      )}
    </div>
  );
}

const TEMPLATES: Record<string, string> = {
  'All triples (limit 100)': 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100',
  'All agents': `SELECT ?name ?peerId WHERE {
  ?agent <urn:dkg:agentName> ?name ;
         <urn:dkg:peerId> ?peerId .
}`,
  'KCs in a paranet': `SELECT ?kc ?status WHERE {
  GRAPH ?meta {
    ?kc a <urn:dkg:KC> ;
        <urn:dkg:status> ?status .
  }
} LIMIT 50`,
  'Count triples per graph': `SELECT ?g (COUNT(*) AS ?count) WHERE {
  GRAPH ?g { ?s ?p ?o }
} GROUP BY ?g ORDER BY DESC(?count)`,
};

function SparqlTab() {
  const [sparql, setSparql] = useState(TEMPLATES['All triples (limit 100)']);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'json' | 'graph'>('table');
  const [execTime, setExecTime] = useState<number | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const res = await executeQuery(sparql);
      const duration = Math.round(performance.now() - start);
      setExecTime(duration);
      const raw = res.result;
      setResult(raw?.bindings ?? raw);
    } catch (err: any) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [sparql]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  }, [run]);

  return (
    <div>
      <div className="toolbar">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="input"
            style={{ width: 'auto', minWidth: 200 }}
            onChange={(e) => { if (e.target.value) setSparql(e.target.value); }}
            defaultValue=""
          >
            <option value="" disabled>Templates...</option>
            {Object.entries(TEMPLATES).map(([name, q]) => (
              <option key={name} value={q}>{name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {execTime != null && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{execTime}ms</span>}
          <button className="btn btn-primary" onClick={run} disabled={loading}>
            {loading ? 'Running...' : 'Run Query'}
          </button>
        </div>
      </div>

      <textarea
        className="sparql-editor"
        value={sparql}
        onChange={(e) => setSparql(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={8}
        placeholder="Enter SPARQL query... (Ctrl+Enter to run)"
        spellCheck={false}
      />

      {error && (
        <div className="card" style={{ borderColor: 'var(--error)', marginTop: 12 }}>
          <div style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>{error}</div>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div className="result-tabs">
            <button className={`result-tab ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>Table</button>
            <button className={`result-tab ${viewMode === 'graph' ? 'active' : ''}`} onClick={() => setViewMode('graph')}>Graph</button>
            <button className={`result-tab ${viewMode === 'json' ? 'active' : ''}`} onClick={() => setViewMode('json')}>JSON</button>
          </div>

          {viewMode === 'table' && <ResultTable result={result} />}
          {viewMode === 'graph' && <ResultGraph result={result} />}
          {viewMode === 'json' && <div className="json-view">{JSON.stringify(result, null, 2)}</div>}
        </div>
      )}
    </div>
  );
}

function ResultTable({ result }: { result: any }) {
  if (!Array.isArray(result) || result.length === 0) {
    return <div className="empty-state">No results</div>;
  }

  const columns = Object.keys(result[0]);

  return (
    <div className="card" style={{ padding: 0, overflow: 'auto' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
        {result.length} result{result.length !== 1 ? 's' : ''}
      </div>
      <table className="data-table">
        <thead>
          <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {result.map((row: any, i: number) => (
            <tr key={i}>
              {columns.map(c => (
                <td key={c} className="mono" style={{ fontSize: 12 }}>
                  {typeof row[c] === 'string' && row[c].length > 80
                    ? <span title={row[c]}>{row[c].slice(0, 80)}...</span>
                    : String(row[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultGraph({ result }: { result: any }) {
  if (!Array.isArray(result) || result.length === 0) {
    return <div className="graph-container">No data to visualize</div>;
  }

  const hasTripleShape = result[0] && ('s' in result[0]) && ('p' in result[0]) && ('o' in result[0]);
  if (!hasTripleShape) {
    return <div className="graph-container">Graph view requires SELECT ?s ?p ?o queries</div>;
  }

  const nodesMap = new Map<string, { id: string; label: string; type: string }>();
  const edges: Array<{ source: string; target: string; label: string }> = [];

  for (const row of result) {
    const s = String(row.s);
    const p = String(row.p);
    const o = String(row.o);

    if (!nodesMap.has(s)) {
      nodesMap.set(s, { id: s, label: shortLabel(s), type: 'resource' });
    }

    const isLiteral = !o.startsWith('http') && !o.startsWith('urn:');
    if (!isLiteral) {
      if (!nodesMap.has(o)) {
        nodesMap.set(o, { id: o, label: shortLabel(o), type: 'resource' });
      }
      edges.push({ source: s, target: o, label: shortLabel(p) });
    } else {
      const litId = `${s}__${p}__lit`;
      nodesMap.set(litId, { id: litId, label: o.length > 30 ? o.slice(0, 30) + '...' : o, type: 'literal' });
      edges.push({ source: s, target: litId, label: shortLabel(p) });
    }
  }

  const nodes = Array.from(nodesMap.values());
  const nodeRadius = 6;
  const width = 800;
  const height = 400;

  // Simple circular layout (force layout would require a library)
  const positions = nodes.map((_, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const r = Math.min(width, height) * 0.35;
    return {
      x: width / 2 + r * Math.cos(angle),
      y: height / 2 + r * Math.sin(angle),
    };
  });

  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));

  return (
    <div className="card" style={{ overflow: 'auto' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        {nodes.length} nodes, {edges.length} edges
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ background: 'var(--bg-input)', borderRadius: 'var(--radius)' }}>
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill="#6b7280" />
          </marker>
        </defs>

        {edges.map((e, i) => {
          const si = nodeIndex.get(e.source);
          const ti = nodeIndex.get(e.target);
          if (si == null || ti == null) return null;
          const s = positions[si];
          const t = positions[ti];
          const mx = (s.x + t.x) / 2;
          const my = (s.y + t.y) / 2;
          return (
            <g key={i}>
              <line x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke="#374151" strokeWidth={1} markerEnd="url(#arrowhead)" />
              <text x={mx} y={my - 4} textAnchor="middle" fontSize={8} fill="#6b7280">{e.label}</text>
            </g>
          );
        })}

        {nodes.map((n, i) => {
          const p = positions[i];
          const fill = n.type === 'literal' ? '#f59e0b' : '#3b82f6';
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={nodeRadius} fill={fill} />
              <text x={p.x} y={p.y + nodeRadius + 12} textAnchor="middle" fontSize={9} fill="#e5e7eb">{n.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ParanetsTab() {
  const { data } = useFetch(fetchParanets, [], 30_000);
  const paranets = data?.paranets ?? [];
  const navigate = useNavigate();

  return (
    <div>
      {paranets.length === 0 ? (
        <div className="empty-state">No paranets found</div>
      ) : (
        <div className="paranet-list">
          {paranets.map((p: any) => (
            <div key={p.id} className="paranet-card" onClick={() => {
              navigate('/explorer');
              // Auto-fill a query for this paranet's KCs
            }}>
              <h3>{p.name}</h3>
              <p>{p.description || p.uri}</p>
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                {p.isSystem && <span className="badge badge-info" style={{ marginRight: 4 }}>system</span>}
                <span className="mono">{shortId(p.id, 16)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PublishTab() {
  const { data: paranetData } = useFetch(fetchParanets, [], 30_000);
  const paranets = paranetData?.paranets?.filter((p: any) => !p.isSystem) ?? [];

  const [paranetId, setParanetId] = useState('');
  const [turtleInput, setTurtleInput] = useState(
`@prefix ex: <http://example.org/> .

ex:Alice ex:knows ex:Bob .
ex:Alice ex:name "Alice" .
ex:Bob ex:name "Bob" .`
  );
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const publish = async () => {
    if (!paranetId) { setError('Select a paranet'); return; }
    setLoading(true);
    setError(null);
    try {
      const quads = parseTurtleToQuads(turtleInput);
      if (quads.length === 0) { setError('No valid triples parsed'); setLoading(false); return; }
      const res = await publishTriples(paranetId, quads);
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="card-title">Publish Triples</div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Paranet</label>
          <select className="input" value={paranetId} onChange={(e) => setParanetId(e.target.value)}>
            <option value="">Select paranet...</option>
            {paranets.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name} ({shortId(p.id)})</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Triples (Turtle format)</label>
          <textarea
            className="sparql-editor"
            value={turtleInput}
            onChange={(e) => setTurtleInput(e.target.value)}
            rows={10}
            placeholder="Enter triples in Turtle format..."
            spellCheck={false}
          />
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={publish} disabled={loading}>
            {loading ? 'Publishing...' : 'Publish'}
          </button>
          {error && <span style={{ color: 'var(--error)', fontSize: 13 }}>{error}</span>}
        </div>

        {result && (
          <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-input)', borderRadius: 'var(--radius)' }}>
            <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 4 }}>Published successfully</div>
            <div className="json-view" style={{ maxHeight: 200 }}>{JSON.stringify(result, null, 2)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryTab() {
  const { data } = useFetch(() => fetchQueryHistory(50), [], 10_000);
  const history = data?.history ?? [];
  const navigate = useNavigate();

  return (
    <div>
      {history.length === 0 ? (
        <div className="empty-state">No query history yet</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Query</th>
                <th>Duration</th>
                <th>Results</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h: any) => (
                <tr key={h.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/explorer')}>
                  <td>{formatTime(h.ts)}</td>
                  <td className="mono" style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                    {h.sparql}
                  </td>
                  <td>{h.duration_ms != null ? `${h.duration_ms}ms` : '—'}</td>
                  <td>{h.result_count ?? '—'}</td>
                  <td>{h.error ? <span className="badge badge-error">error</span> : <span className="badge badge-success">ok</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SavedTab() {
  const { data, refresh } = useFetch(fetchSavedQueries, []);
  const queries = data?.queries ?? [];
  const [name, setName] = useState('');
  const [sparql, setSparql] = useState('');

  const save = async () => {
    if (!name || !sparql) return;
    await createSavedQuery({ name, sparql });
    setName('');
    setSparql('');
    refresh();
  };

  const remove = async (id: number) => {
    await deleteSavedQuery(id);
    refresh();
  };

  return (
    <div>
      <div className="card">
        <div className="card-title">Save a Query</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input className="input" placeholder="Query name" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 300 }} />
          <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
        </div>
        <textarea className="sparql-editor" value={sparql} onChange={(e) => setSparql(e.target.value)} rows={4} placeholder="SPARQL..." spellCheck={false} />
      </div>

      {queries.length === 0 ? (
        <div className="empty-state">No saved queries</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Query</th>
                <th>Saved</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {queries.map((q: any) => (
                <tr key={q.id}>
                  <td style={{ fontWeight: 600 }}>{q.name}</td>
                  <td className="mono" style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                    {q.sparql}
                  </td>
                  <td>{formatTime(q.created_at)}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(q.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Utility ---

function shortLabel(uri: string): string {
  if (uri.includes('#')) return uri.split('#').pop()!;
  const parts = uri.split('/');
  return parts[parts.length - 1] || uri;
}

/**
 * Minimalist Turtle → quads parser for the publish form.
 * Handles simple triples with prefixes. Not a full Turtle parser.
 */
function parseTurtleToQuads(input: string): Array<{ subject: string; predicate: string; object: string; graph: string }> {
  const quads: Array<{ subject: string; predicate: string; object: string; graph: string }> = [];
  const prefixes: Record<string, string> = {};

  const lines = input.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  for (const line of lines) {
    const prefixMatch = line.match(/^@prefix\s+(\w*):?\s+<([^>]+)>\s*\.?\s*$/);
    if (prefixMatch) {
      prefixes[prefixMatch[1]] = prefixMatch[2];
      continue;
    }

    // Simple triple: subject predicate object .
    const tripleMatch = line.match(/^(\S+)\s+(\S+)\s+(.+?)\s*\.\s*$/);
    if (!tripleMatch) continue;

    const [, s, p, o] = tripleMatch;
    quads.push({
      subject: expandPrefixed(s, prefixes),
      predicate: expandPrefixed(p, prefixes),
      object: o.startsWith('"') ? o.replace(/^"|"$/g, '') : expandPrefixed(o, prefixes),
      graph: '',
    });
  }

  return quads;
}

function expandPrefixed(term: string, prefixes: Record<string, string>): string {
  if (term.startsWith('<') && term.endsWith('>')) return term.slice(1, -1);
  const colonIdx = term.indexOf(':');
  if (colonIdx > 0) {
    const prefix = term.slice(0, colonIdx);
    if (prefixes[prefix]) return prefixes[prefix] + term.slice(colonIdx + 1);
  }
  return term;
}
