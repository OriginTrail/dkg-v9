import React, { useState } from 'react';

const AGENTS = [
  { name: 'Agent-Finance', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  { name: 'Agent-Legal', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  { name: 'Agent-Network', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  { name: 'Agent-Research', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  { name: 'Agent-Audit', color: '#f472b6', bg: 'rgba(244,114,182,0.12)' },
  { name: 'Human:0x7a3f', color: '#22d3ee', bg: 'rgba(34,211,238,0.12)' },
];

const GRAPH_NODES = [
  { id: 1, label: 'Entity-X Corp', agent: 'Agent-Finance', x: 320, y: 180, r: 28, verified: true },
  { id: 2, label: 'SEC Filing #4892', agent: 'Agent-Legal', x: 520, y: 120, r: 22, verified: true },
  { id: 3, label: 'Officer: J. Smith', agent: 'Agent-Network', x: 420, y: 300, r: 24, verified: true },
  { id: 4, label: 'Risk Score: HIGH', agent: 'Agent-Finance', x: 180, y: 260, r: 20, verified: true },
  { id: 5, label: 'Lawsuit #CIV-2026', agent: 'Agent-Legal', x: 600, y: 280, r: 22, verified: false },
  { id: 6, label: 'Shell Co. Alpha', agent: 'Agent-Network', x: 240, y: 100, r: 18, verified: true },
  { id: 7, label: 'Transaction Flow', agent: 'Agent-Audit', x: 500, y: 400, r: 20, verified: true },
  { id: 8, label: 'Whistleblower Tip', agent: 'Human:0x7a3f', x: 140, y: 380, r: 18, verified: true },
];

const GRAPH_EDGES = [[1,2],[1,3],[1,4],[2,5],[3,5],[3,7],[1,6],[6,4],[7,8],[4,8]];

const DATES = ['2026-03-04', '2026-03-03', '2026-03-02'];

const rnd = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const getAgent = (name: string) => AGENTS.find(a => a.name === name) || AGENTS[0];

const ShieldIcon = ({ color = 'var(--green)', size = 10 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <polyline points="9 12 11 14 15 10"/>
  </svg>
);

function AgentBadge({ name, compact = true }: { name: string; compact?: boolean }) {
  const a = getAgent(name);
  return (
    <span className="agent-badge" style={{ color: a.color, background: a.bg, border: `1px solid ${a.color}22`, fontSize: compact ? 10 : 11, padding: compact ? '2px 8px' : '3px 10px' }}>
      <span className="agent-dot" style={{ background: a.color }} />{name}
    </span>
  );
}

function VerifyBadge({ verified }: { verified: boolean }) {
  return (
    <span className={`verify-badge ${verified ? 'verified' : 'pending'}`}>
      <ShieldIcon color={verified ? 'var(--green)' : 'var(--amber)'} />
      {verified ? 'VERIFIED' : 'PENDING'}
    </span>
  );
}

const ACTION_COLORS: Record<string, string> = { publish: 'var(--green)', query: 'var(--blue)', update: 'var(--amber)', verify: 'var(--purple)' };

// Graph View
function GraphView() {
  const [selected, setSelected] = useState<number | null>(null);
  const sel = selected !== null ? GRAPH_NODES.find(n => n.id === selected) : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: sel ? '1fr 360px' : '1fr', gap: 16 }}>
      <div className="card graph-canvas">
        <div className="graph-grid" />
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {GRAPH_EDGES.map(([a, b]) => {
            const na = GRAPH_NODES.find(n => n.id === a)!;
            const nb = GRAPH_NODES.find(n => n.id === b)!;
            return <line key={`${a}-${b}`} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} stroke="var(--border)" strokeWidth="1" opacity="0.7" />;
          })}
        </svg>
        {GRAPH_NODES.map(node => {
          const ag = getAgent(node.agent);
          const isSel = selected === node.id;
          return (
            <div
              key={node.id}
              className="graph-node"
              onClick={() => setSelected(isSel ? null : node.id)}
              style={{
                left: node.x - node.r, top: node.y - node.r,
                width: node.r * 2, height: node.r * 2,
                background: isSel ? `${ag.color}33` : ag.bg,
                border: `2px solid ${isSel ? ag.color : `${ag.color}44`}`,
                boxShadow: isSel ? `0 0 24px ${ag.color}33` : undefined,
              }}
            >
              <span className="graph-node-label" style={{ top: node.r * 2 + 6 }}>{node.label}</span>
              {node.verified && (
                <span style={{ position: 'absolute', top: -4, right: -4 }}>
                  <ShieldIcon color="var(--green)" />
                </span>
              )}
            </div>
          );
        })}
        <div className="graph-legend">
          {AGENTS.map(a => (
            <span key={a.name} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--text-dim)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.color, display: 'inline-block' }} />
              {a.name}
            </span>
          ))}
        </div>
      </div>

      {sel && (
        <div className="prov-panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Provenance Inspector</span>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{sel.label}</div>
            <VerifyBadge verified={sel.verified} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="prov-field-label">Publisher</div>
            <AgentBadge name={sel.agent} compact={false} />
          </div>
          {[
            { label: 'UAL', value: `did:dkg:base:0x4f8b…/${Math.floor(Math.random() * 999999)}/1` },
            { label: 'Content Hash', value: '0x7f3a8b2e9c1d4f6a…' },
            { label: 'Merkle Root', value: '0xb2e9f1c3d7a4e8b2…' },
            { label: 'Block Number', value: '#4,219,847' },
            { label: 'Timestamp', value: '2026-03-04T13:47:12Z' },
          ].map(f => (
            <div key={f.label}>
              <div className="prov-field-label">{f.label}</div>
              <div className="prov-field-value">{f.value}</div>
            </div>
          ))}
          <div style={{ marginTop: 16 }}>
            <div className="prov-field-label" style={{ marginBottom: 8 }}>Context Oracle — Corroborating Sources</div>
            {['Agent-Finance', 'Agent-Audit', 'Human:0x7a3f'].map(s => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <AgentBadge name={s} /> <ShieldIcon color="var(--green)" size={10} />
              </div>
            ))}
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--green-dim)', border: '1px solid rgba(74,222,128,0.13)', fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>
              Trust Score: HIGH — 3 independent sources
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Timeline View
function TimelineView() {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Decision trace — chronological view of all Knowledge Assets, filterable by agent and time</div>
      {DATES.map(date => (
        <div key={date} style={{ marginBottom: 24 }}>
          <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 10, letterSpacing: '0.05em' }}>{date}</div>
          {[0,1,2,3].map(i => {
            const ag = rnd(AGENTS);
            const action = rnd(['publish','query','update','verify']);
            const node = GRAPH_NODES[i % GRAPH_NODES.length];
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderLeft: `2px solid ${ag.color}33`, marginBottom: 4, marginLeft: 8 }}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', width: 48 }}>{`${String(8 + i * 3).padStart(2,'0')}:47`}</span>
                <AgentBadge name={ag.name} />
                <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: ACTION_COLORS[action] }}>{action.toUpperCase()}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>{node.label}</span>
                <VerifyBadge verified={Math.random() > 0.15} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// SPARQL View
function SparqlView() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <span style={{ fontSize: 12, fontWeight: 700 }}>SPARQL Query</span>
          <button className="btn-primary" style={{ fontSize: 11, padding: '5px 14px' }}>▶ Execute</button>
        </div>
        <pre className="sparql-editor">
          <span style={{color:'var(--purple)'}}>PREFIX</span>{' '}
          <span style={{color:'var(--amber)'}}>v:</span>{' '}
          <span style={{color:'var(--text-muted)'}}>{'<https://myapp.ai/vocab#>'}</span>{'\n\n'}
          <span style={{color:'var(--purple)'}}>SELECT</span>{' '}
          <span style={{color:'var(--blue)'}}>?person ?company ?caseNum</span>{'\n'}
          <span style={{color:'var(--purple)'}}>WHERE</span>{' {'}{'\n'}
          {'  '}<span style={{color:'var(--blue)'}}>?person</span>{' '}
          <span style={{color:'var(--amber)'}}>v:officerOf</span>{' '}
          <span style={{color:'var(--blue)'}}>?company</span>{' .'}{'\n'}
          {'  '}<span style={{color:'var(--blue)'}}>?company</span>{' '}
          <span style={{color:'var(--amber)'}}>v:flaggedBy</span>{' '}
          <span style={{color:'var(--green)'}}>{'<did:dkg:agent:finance>'}</span>{' .'}{'\n'}
          {'  '}<span style={{color:'var(--blue)'}}>?person</span>{' '}
          <span style={{color:'var(--amber)'}}>v:namedIn</span>{' '}
          <span style={{color:'var(--blue)'}}>?proceeding</span>{' .'}{'\n'}
          {'  '}<span style={{color:'var(--blue)'}}>?proceeding</span>{' '}
          <span style={{color:'var(--amber)'}}>v:caseNumber</span>{' '}
          <span style={{color:'var(--blue)'}}>?caseNum</span>{' .'}{'\n'}
          {'}'}
        </pre>
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-dim)' }}>
          Example: Cross-agent investigation — find officers of flagged companies in legal proceedings
        </div>
      </div>
      <div className="card">
        <div className="card-header">
          <span style={{ fontSize: 12, fontWeight: 700 }}>Results</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>3 rows · 47ms</span>
        </div>
        <div className="sparql-results-row" style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <span>?person</span><span>?company</span><span>?caseNum</span>
        </div>
        {[['J. Smith','Entity-X Corp','CIV-2026-4892'],['M. Chen','Shell Co. Alpha','CIV-2026-3301'],['R. Novak','Entity-X Corp','CIV-2025-8877']].map(row => (
          <div className="sparql-results-row" key={row[0]}>
            {row.map((c, j) => <span key={j} style={j === 0 ? { color: 'var(--blue)' } : {}}>{c}</span>)}
          </div>
        ))}
        <div style={{ padding: '12px 18px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
          <strong style={{ color: 'var(--text)' }}>Cross-agent insight:</strong> Agent-Finance flagged the companies. Agent-Legal found the lawsuits. Agent-Network mapped the officers. No single agent knew J. Smith was the link — but the graph did.
        </div>
      </div>
    </div>
  );
}

type Mode = 'graph' | 'timeline' | 'sparql';

export function ExplorerPage() {
  const [mode, setMode] = useState<Mode>('graph');

  return (
    <div className="page-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 className="page-title">Memory Explorer</h2>
          <p className="page-subtitle">Browse, query, and verify Knowledge Assets across all connected paranets</p>
        </div>
        <div className="mode-tabs">
          {(['graph','timeline','sparql'] as Mode[]).map(m => (
            <button key={m} className={`mode-tab${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>{m}</button>
          ))}
        </div>
      </div>

      {mode === 'graph' && <GraphView />}
      {mode === 'timeline' && <TimelineView />}
      {mode === 'sparql' && <SparqlView />}
    </div>
  );
}
