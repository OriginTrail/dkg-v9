import React, { useState, useCallback, useEffect } from 'react';
import { executeQuery, fetchBranches } from '../api.js';
import { GraphCanvas } from '../components/GraphCanvas.js';
import { useRepo, repoKey } from '../context/RepoContext.js';

export function GraphExplorerPage() {
  const { selectedRepo } = useRepo();
  const [tab, setTab] = useState<'visual' | 'sparql'>('visual');
  const [sparql, setSparql] = useState(
    'CONSTRUCT { ?s ?p ?o } WHERE { ?s a <https://ontology.dkg.io/ghcode#PullRequest> ; ?p ?o } LIMIT 200'
  );
  const [includeWorkspace, setIncludeWorkspace] = useState(true);
  const [triples, setTriples] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Branch selector state
  const [branches, setBranches] = useState<Array<{ name: string; protected: boolean }>>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [branchesLoading, setBranchesLoading] = useState(false);

  const scopedRepo = selectedRepo ? repoKey(selectedRepo) : undefined;

  // Load branches when repo changes
  useEffect(() => {
    if (!selectedRepo) {
      setBranches([]);
      return;
    }
    setBranchesLoading(true);
    fetchBranches(selectedRepo.owner, selectedRepo.repo)
      .then(result => {
        setBranches(result.branches ?? []);
      })
      .catch(() => {
        setBranches([]);
      })
      .finally(() => setBranchesLoading(false));
  }, [selectedRepo?.owner, selectedRepo?.repo]);

  const runQuery = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await executeQuery(sparql, scopedRepo, includeWorkspace);
      const data = result?.result;
      if (data?.triples) {
        setTriples(data.triples);
      } else if (data?.bindings) {
        setTriples(data.bindings);
      } else {
        setTriples([]);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sparql, scopedRepo, includeWorkspace]);

  return (
    <div className="page">
      <h2 className="page-title">Graph Explorer</h2>

      {selectedRepo && (
        <div className="scope-banner">
          Scoped to <strong className="mono">{repoKey(selectedRepo)}</strong>
          {selectedRepo.paranetId && (
            <span className="text-muted" style={{ marginLeft: 8 }}>
              paranet: {selectedRepo.paranetId}
            </span>
          )}
        </div>
      )}

      {/* Branch Selector */}
      {selectedRepo && (
        <div className="input-row" style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            Branch:
          </label>
          <select
            className="repo-select"
            style={{ minWidth: 200 }}
            value={selectedBranch}
            onChange={e => setSelectedBranch(e.target.value)}
            disabled={branchesLoading}
          >
            <option value="">All branches</option>
            {branches.map(b => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
          </select>
          <span className="text-muted" style={{ marginTop: 0 }}>
            Select a branch to filter the knowledge graph to entities on that branch
          </span>
        </div>
      )}

      <div className="explorer-tabs">
        <button
          className={`btn btn-small ${tab === 'visual' ? '' : 'btn-secondary'}`}
          onClick={() => setTab('visual')}
        >
          Visual Graph
        </button>
        <button
          className={`btn btn-small ${tab === 'sparql' ? '' : 'btn-secondary'}`}
          onClick={() => setTab('sparql')}
        >
          SPARQL Query
        </button>
      </div>

      {tab === 'visual' && (
        <GraphCanvas repo={scopedRepo} branch={selectedBranch || undefined} />
      )}

      {tab === 'sparql' && (
        <>
          <div className="query-panel">
            <textarea
              className="query-input"
              rows={4}
              value={sparql}
              onChange={e => setSparql(e.target.value)}
              placeholder="Enter SPARQL query..."
            />
            <div className="input-row">
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Repo: {scopedRepo ?? 'all'}
              </span>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={includeWorkspace}
                  onChange={e => setIncludeWorkspace(e.target.checked)}
                />
                Include workspace data
              </label>
              <button className="btn" onClick={runQuery} disabled={loading}>
                {loading ? 'Running...' : 'Execute'}
              </button>
            </div>
          </div>

          {error && <div className="error-banner">{error}</div>}

          {triples.length > 0 && (
            <div className="section">
              <h3>{triples.length} result{triples.length !== 1 ? 's' : ''}</h3>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(triples[0]).map(k => <th key={k}>{k}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {triples.slice(0, 100).map((row: any, i: number) => (
                      <tr key={i}>
                        {Object.values(row).map((v: any, j: number) => (
                          <td key={j} className="mono truncate">{String(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {triples.length > 100 && <p className="text-muted">Showing first 100 of {triples.length} results</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
