import { useState, useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store';
import * as api from '../api';
import { OP_COLORS, type OperationType } from '../types';
import { CHAIN_NODE_ID } from './NetworkGraph';

type Tab = 'setup' | 'simulate' | 'workspace' | 'publish' | 'query' | 'chat' | 'access' | 'stake' | 'fairswap' | 'conviction' | 'logs';

const MANUAL_TABS: { id: Tab; label: string; op: OperationType }[] = [
  { id: 'setup', label: 'Setup', op: 'connect' },
  { id: 'workspace', label: 'Workspace', op: 'workspace' },
  { id: 'publish', label: 'Publish', op: 'publish' },
  { id: 'query', label: 'Query', op: 'query' },
  { id: 'chat', label: 'Chat', op: 'chat' },
  { id: 'access', label: 'Access', op: 'access' },
  { id: 'stake', label: 'Stake', op: 'stake' },
  { id: 'conviction', label: 'Conviction', op: 'conviction' },
  { id: 'fairswap', label: 'FairSwap', op: 'fairswap' },
  { id: 'logs', label: 'Logs', op: 'connect' },
];

const SIM_TAB: { id: Tab; label: string; op: OperationType } = { id: 'simulate', label: 'Simulate', op: 'connect' };

export function ControlPanel() {
  const { state, dispatch, addOperation, completeOperation } = useStore();
  const [activeTab, setActiveTab] = useState<Tab>('publish');

  return (
    <div className="control-panel">
      <div className="panel-header">
        <span className="panel-title">Controls</span>
      </div>

      <div className="node-selector">
        <label>Active Node</label>
        <div className="node-pills">
          {state.nodes.map((n) => (
            <button
              key={n.id}
              className={`node-pill ${n.id === state.selectedNode ? 'active' : ''} ${n.online ? 'online' : 'offline'}`}
              onClick={() => dispatch({ type: 'SELECT_NODE', id: n.id })}
            >
              N{n.id}
            </button>
          ))}
        </div>
      </div>

      <div className="tab-bar">
        {MANUAL_TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
            style={activeTab === t.id ? { borderColor: OP_COLORS[t.op] } : undefined}
            onClick={() => setActiveTab(t.id)}
          >
            <span className="tab-dot" style={{ background: OP_COLORS[t.op] }} />
            {t.label}
          </button>
        ))}
        <div className="tab-bar-divider" />
        <button
          className={`tab-btn tab-btn-sim ${activeTab === SIM_TAB.id ? 'active' : ''}`}
          style={activeTab === SIM_TAB.id ? { borderColor: '#f59e0b' } : undefined}
          onClick={() => setActiveTab(SIM_TAB.id)}
        >
          <span className="tab-dot" style={{ background: '#f59e0b' }} />
          {SIM_TAB.label}
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'setup' && <SetupTab />}
        {activeTab === 'simulate' && <SimulateTab />}
        {activeTab === 'workspace' && <WorkspaceTab />}
        {activeTab === 'publish' && <PublishTab />}
        {activeTab === 'query' && <QueryTab />}
        {activeTab === 'chat' && <ChatTab />}
        {activeTab === 'access' && <AccessTab />}
        {activeTab === 'stake' && <StakeTab />}
        {activeTab === 'conviction' && <ConvictionTab />}
        {activeTab === 'fairswap' && <FairSwapTab />}
        {activeTab === 'logs' && <LogsTab />}
      </div>
    </div>
  );
}

function useParanets() {
  const { state } = useStore();
  const [paranets, setParanets] = useState<string[]>([]);

  useEffect(() => {
    const firstOnline = state.nodes.find((n) => n.online);
    if (!firstOnline) return;
    api.fetchParanets(firstOnline.id).then((r) => {
      setParanets(r.paranets.map((p) => p.id || p.name));
    }).catch(() => {});
  }, [state.nodes]);

  return paranets;
}

function SetupTab() {
  const { state, addOperation, completeOperation, addTimelineStep } = useStore();
  const [paranetId, setParanetId] = useState('devnet-test');
  const [paranetName, setParanetName] = useState('Devnet Test Paranet');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityResult, setIdentityResult] = useState('');
  const paranets = useParanets();

  const identityStatus = state.nodes.map(n => ({
    id: n.id,
    online: n.online,
    hasIdentity: n.status?.hasIdentity ?? false,
    identityId: n.status?.identityId ?? '0',
  }));

  const doEnsureAllIdentities = useCallback(async () => {
    setIdentityBusy(true);
    setIdentityResult('');
    const lines: string[] = [];
    for (const node of state.nodes) {
      if (!node.online) {
        lines.push(`N${node.id}: offline, skipped`);
        continue;
      }
      try {
        addTimelineStep(node.id, 'connect', 'identity', 'Creating on-chain identity', { status: 'start' });
        const res = await api.ensureIdentity(node.id);
        if (res.hasIdentity) {
          lines.push(`N${node.id}: identity=${res.identityId}`);
          addTimelineStep(node.id, 'connect', 'identity', `Identity #${res.identityId} ready`, { status: 'done' });
        } else {
          lines.push(`N${node.id}: failed — ${res.error || 'unknown'}`);
          addTimelineStep(node.id, 'connect', 'identity', `Identity failed`, { status: 'error' });
        }
      } catch (e: any) {
        lines.push(`N${node.id}: ${e.message}`);
      }
    }
    setIdentityResult(lines.join('\n'));
    setIdentityBusy(false);
  }, [state.nodes, addTimelineStep]);

  const doQuickSetup = useCallback(async () => {
    setBusy(true);
    setResult('');
    const lines: string[] = [];

    const firstOnline = state.nodes.find((n) => n.online);
    if (!firstOnline) {
      setResult('Error: No nodes online. Start the devnet first.');
      setBusy(false);
      return;
    }

    const opId = addOperation('connect', firstOnline.id, `quick setup: create & subscribe "${paranetId}"`);

    try {
      // Step 1: Ensure identities on all online nodes
      addTimelineStep(firstOnline.id, 'connect', 'setup', 'Quick Setup: ensuring identities', { status: 'start' });
      for (const node of state.nodes) {
        if (!node.online) continue;
        try {
          addTimelineStep(node.id, 'connect', 'identity', 'Registering on-chain identity');
          await api.ensureIdentity(node.id);
          addTimelineStep(node.id, 'connect', 'identity', 'Identity ready', { status: 'done' });
          lines.push(`N${node.id}: identity ensured`);
        } catch (e: any) {
          lines.push(`N${node.id}: identity error: ${e.message}`);
        }
      }

      // Step 2: Create paranet
      addTimelineStep(firstOnline.id, 'connect', 'paranet', `Creating paranet "${paranetId}"`);
      try {
        await api.createParanet(firstOnline.id, paranetId, paranetName);
        lines.push(`Created paranet "${paranetId}" on Node ${firstOnline.id}`);
      } catch (e: any) {
        if (e.message?.includes('exists') || e.message?.includes('already')) {
          lines.push(`Paranet "${paranetId}" already exists`);
        } else {
          lines.push(`Create paranet: ${e.message}`);
        }
      }

      // Step 3: Subscribe all
      for (const node of state.nodes) {
        if (!node.online) {
          lines.push(`Node ${node.id}: offline, skipped`);
          continue;
        }
        try {
          addTimelineStep(node.id, 'connect', 'subscribe', `Subscribing to "${paranetId}"`);
          await api.subscribeParanet(node.id, paranetId);
          lines.push(`Node ${node.id}: subscribed`);
        } catch (e: any) {
          lines.push(`Node ${node.id}: ${e.message}`);
        }
      }

      completeOperation(opId, 'success', `${paranetId} ready`);
      addTimelineStep(firstOnline.id, 'connect', 'setup', 'Quick Setup complete', { status: 'done' });
      setResult(lines.join('\n'));
    } catch (e: any) {
      completeOperation(opId, 'error', e.message);
      setResult(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [paranetId, paranetName, state.nodes, addOperation, completeOperation, addTimelineStep]);

  const doCreateParanet = useCallback(async () => {
    setBusy(true);
    setResult('');
    const opId = addOperation('connect', state.selectedNode, `create paranet "${paranetId}"`);
    try {
      const res = await api.createParanet(state.selectedNode, paranetId, paranetName);
      completeOperation(opId, 'success', res.uri);
      setResult(`Created: ${res.uri}`);
    } catch (e: any) {
      completeOperation(opId, 'error', e.message);
      setResult(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [paranetId, paranetName, state.selectedNode, addOperation, completeOperation]);

  const doSubscribeAll = useCallback(async () => {
    setBusy(true);
    setResult('');
    const lines: string[] = [];
    for (const node of state.nodes) {
      if (!node.online) {
        lines.push(`Node ${node.id}: offline, skipped`);
        continue;
      }
      try {
        await api.subscribeParanet(node.id, paranetId);
        lines.push(`Node ${node.id}: subscribed to "${paranetId}"`);
      } catch (e: any) {
        lines.push(`Node ${node.id}: ${e.message}`);
      }
    }
    setResult(lines.join('\n'));
    setBusy(false);
  }, [paranetId, state.nodes]);

  return (
    <div className="tab-form">
      <div className="setup-section">
        <div className="setup-section-title">Quick Setup</div>
        <p className="setup-hint">
          Creates identities, paranet, and subscribes all nodes. Run this once after starting the devnet.
        </p>
        <button className="btn btn-primary btn-wide" disabled={busy} onClick={doQuickSetup}>
          {busy ? 'Setting up...' : 'Initialize Devnet'}
        </button>
      </div>

      <div className="setup-divider" />

      {/* ─── Identity Status ─── */}
      <div className="setup-section">
        <div className="setup-section-title">On-Chain Identity</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {identityStatus.map(n => (
            <div
              key={n.id}
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 4,
                background: !n.online ? 'rgba(100,100,100,0.2)' : n.hasIdentity ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                color: !n.online ? '#64748b' : n.hasIdentity ? '#10b981' : '#ef4444',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              N{n.id}: {!n.online ? 'offline' : n.hasIdentity ? `ID ${n.identityId}` : 'no identity'}
            </div>
          ))}
        </div>
        <button className="btn btn-secondary btn-wide" disabled={identityBusy} onClick={doEnsureAllIdentities}>
          {identityBusy ? 'Registering...' : 'Register All Identities'}
        </button>
        {identityResult && <pre className="result-box code" style={{ fontSize: 11, marginTop: 6 }}>{identityResult}</pre>}
      </div>

      <div className="setup-divider" />

      <div className="setup-section">
        <div className="setup-section-title">Paranet Management</div>
        {paranets.length > 0 && (
          <div className="paranet-list">
            <label>Existing Paranets</label>
            {paranets.map((p) => (
              <div key={p} className="paranet-item">{p}</div>
            ))}
          </div>
        )}
        <div className="form-group">
          <label>Paranet ID</label>
          <input value={paranetId} onChange={(e) => setParanetId(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Paranet Name</label>
          <input value={paranetName} onChange={(e) => setParanetName(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" disabled={busy} onClick={doCreateParanet}>
            Create
          </button>
          <button className="btn btn-secondary" disabled={busy} onClick={doSubscribeAll}>
            Subscribe All Nodes
          </button>
        </div>
      </div>

      {result && <pre className="result-box code">{result}</pre>}
    </div>
  );
}

type SimOp = 'publish' | 'workspace' | 'query' | 'chat';

const SIM_OPS: { id: SimOp; label: string }[] = [
  { id: 'publish', label: 'Publish' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'query', label: 'Query' },
  { id: 'chat', label: 'Chat' },
];

interface SimStats {
  total: number;
  completed: number;
  errors: number;
  startedAt: number;
  finishedAt?: number;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rndId(): string {
  return Math.random().toString(36).slice(2, 8);
}

let simCounter = 0;

function SimulateTab() {
  const { state, dispatch, addBroadcast, addOperation, completeOperation } = useStore();
  const [simName, setSimName] = useState(() => `Simulation #${++simCounter}`);
  const [opCount, setOpCount] = useState(500);
  const [opsPerSec, setOpsPerSec] = useState(10);
  const [concurrency, setConcurrency] = useState(10);
  const [kasPerPublish, setKasPerPublish] = useState(1);
  const [paranet, setParanet] = useState('devnet-test');
  const [enabledOps, setEnabledOps] = useState<Set<SimOp>>(new Set(['publish', 'workspace', 'query', 'chat']));
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<SimStats | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const paranets = useParanets();

  const toggleOp = useCallback((op: SimOp) => {
    setEnabledOps((prev) => {
      const next = new Set(prev);
      if (next.has(op)) {
        if (next.size > 1) next.delete(op);
      } else {
        next.add(op);
      }
      return next;
    });
  }, []);

  const runSimulation = useCallback(async () => {
    const ops = Array.from(enabledOps);
    const simId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    dispatch({
      type: 'START_SIMULATION',
      id: simId,
      name: simName || `Simulation #${simCounter}`,
      config: { opCount, opsPerSec, concurrency, kasPerPublish, paranet, enabledOps: ops },
    });

    const simStats: SimStats = { total: opCount, completed: 0, errors: 0, startedAt: Date.now() };
    setStats({ ...simStats });
    setRunning(true);

    try {
      const res = await fetch('/sim/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: simName, opCount, opsPerSec, concurrency, kasPerPublish, paranet, enabledOps: ops }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        simStats.errors = 1;
        simStats.finishedAt = Date.now();
        setStats({ ...simStats });
        setRunning(false);
        dispatch({ type: 'STOP_SIMULATION' });
        return;
      }
    } catch {
      setRunning(false);
      dispatch({ type: 'STOP_SIMULATION' });
      return;
    }

    const es = new EventSource('/sim/events');
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);

        if (event.type === 'op') {
          if (simStats.finishedAt) return; // ignore late op events after done
          const opType = event.opType as string;
          const nodeId = event.nodeId as number;
          const isBroadcast = opType === 'publish' || opType === 'workspace';
          const opId = isBroadcast
            ? addBroadcast(opType as any, nodeId, `sim ${opType}`)
            : addOperation(opType as any, nodeId, `sim ${opType}`);
          completeOperation(opId, event.success ? 'success' : 'error', event.detail);
          dispatch({ type: 'RECORD_OP', opType, success: event.success, durationMs: event.durationMs, phases: event.phases });
          simStats.completed++;
          if (!event.success) simStats.errors++;
          setStats({ ...simStats });
        }

        if (event.type === 'status') {
          if (simStats.finishedAt) return;
          simStats.completed = event.completed;
          simStats.errors = event.errors;
          setStats({ ...simStats });
        }

        if (event.type === 'done') {
          simStats.completed = event.completed;
          simStats.errors = event.errors;
          simStats.finishedAt = Date.now();
          setStats({ ...simStats });
          es.close();
          eventSourceRef.current = null;
          setRunning(false);
          dispatch({ type: 'STOP_SIMULATION' });
          setSimName(`Simulation #${++simCounter}`);
        }

        if (event.type === 'error') {
          simStats.errors++;
          setStats({ ...simStats });
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      if (running) {
        simStats.finishedAt = Date.now();
        setStats({ ...simStats });
        setRunning(false);
        dispatch({ type: 'STOP_SIMULATION' });
      }
    };
  }, [opCount, opsPerSec, concurrency, paranet, enabledOps, simName, kasPerPublish, addBroadcast, addOperation, completeOperation, dispatch]);

  const stopSimulation = useCallback(async () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    await fetch('/sim/stop', { method: 'POST' }).catch(() => {});
    dispatch({ type: 'STOP_SIMULATION' });
    setRunning(false);
  }, [dispatch]);

  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => forceUpdate((n) => n + 1), 250);
    return () => clearInterval(iv);
  }, [running]);

  const elapsed = stats
    ? ((stats.finishedAt ?? Date.now()) - stats.startedAt) / 1000
    : 0;
  const actualOps = stats ? (stats.completed + stats.errors) : 0; // total finished (success + fail)
  const pct = stats ? Math.min(100, Math.round((actualOps / stats.total) * 100)) : 0;

  return (
    <div className="tab-form">
      <div className="setup-hint">
        Run automated operations across all online nodes. Operations execute server-side (no browser bottleneck) and stream results here for visualization.
      </div>

      <div className="form-group">
        <label>Simulation Name</label>
        <input value={simName} onChange={(e) => setSimName(e.target.value)} disabled={running}
          placeholder="Name this simulation run" />
      </div>

      <div className="form-group">
        <label>Paranet</label>
        {paranets.length > 0 ? (
          <select value={paranet} onChange={(e) => setParanet(e.target.value)} disabled={running}>
            {paranets.map((p) => <option key={p} value={p}>{p}</option>)}
            {!paranets.includes(paranet) && <option value={paranet}>{paranet}</option>}
          </select>
        ) : (
          <input value={paranet} onChange={(e) => setParanet(e.target.value)} disabled={running} />
        )}
      </div>

      <div className="form-group">
        <label>Operations</label>
        <div className="graph-target-pills">
          {SIM_OPS.map(({ id, label }) => (
            <button
              key={id}
              className={`target-pill ${enabledOps.has(id) ? 'active' : ''}`}
              style={enabledOps.has(id) ? { background: OP_COLORS[id] } : undefined}
              onClick={() => toggleOp(id)}
              disabled={running}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="sim-params">
        <div className="form-group">
          <label>Total Ops</label>
          <input type="number" min={1} max={100000} value={opCount}
            onChange={(e) => setOpCount(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} />
        </div>
        <div className="form-group">
          <label>Ops/sec</label>
          <input type="number" min={0.5} max={1000} step={0.5} value={opsPerSec}
            onChange={(e) => setOpsPerSec(Math.max(0.5, parseFloat(e.target.value) || 1))} disabled={running} />
        </div>
        <div className="form-group">
          <label>Concurrency</label>
          <input type="number" min={1} max={200} value={concurrency}
            onChange={(e) => setConcurrency(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} />
        </div>
        <div className="form-group">
          <label>KAs per Publish</label>
          <input type="number" min={1} max={100} value={kasPerPublish}
            onChange={(e) => setKasPerPublish(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} />
        </div>
      </div>

      <button
        className={`btn ${running ? 'btn-danger' : 'btn-primary'} btn-wide`}
        onClick={running ? stopSimulation : runSimulation}
      >
        {running ? 'Stop Simulation' : 'Play Simulation'}
      </button>

      {stats && (
        <div className="sim-stats">
          <div className="sim-progress-bar">
            <div
              className="sim-progress-fill"
              style={{ width: `${pct}%`, background: running ? OP_COLORS.connect : (stats.errors > 0 ? '#f59e0b' : '#10b981') }}
            />
          </div>
          <div className="sim-stats-grid">
            <div className="sim-stat">
              <span className="sim-stat-value">{stats.completed}/{stats.total}</span>
              <span className="sim-stat-label">succeeded</span>
            </div>
            <div className="sim-stat">
              <span className="sim-stat-value" style={{ color: stats.errors > 0 ? '#ef4444' : undefined }}>
                {stats.errors}
              </span>
              <span className="sim-stat-label">errors</span>
            </div>
            <div className="sim-stat">
              <span className="sim-stat-value">{elapsed > 0 ? (actualOps / elapsed).toFixed(1) : '0'}</span>
              <span className="sim-stat-label">ops/sec</span>
            </div>
            <div className="sim-stat">
              <span className="sim-stat-value">{elapsed.toFixed(1)}s</span>
              <span className="sim-stat-label">elapsed</span>
            </div>
          </div>
          {stats.finishedAt && (
            <div className="sim-summary">
              Simulation complete: {stats.completed} succeeded, {stats.errors} failed in {elapsed.toFixed(1)}s
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WorkspaceTab() {
  const { state, addBroadcast, completeOperation, addTimelineStep, addChainAnimation } = useStore();
  const paranets = useParanets();
  const [paranet, setParanet] = useState('devnet-test');
  const [subject, setSubject] = useState('did:dkg:entity:ws-001');
  const [predicate, setPredicate] = useState('http://schema.org/name');
  const [object, setObject] = useState('Workspace Draft');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [wsContents, setWsContents] = useState('');

  // Context graph state
  const [enshrineMode, setEnshrineMode] = useState<'paranet' | 'contextGraph'>('paranet');
  const [contextGraphId, setContextGraphId] = useState('');
  const [participantIds, setParticipantIds] = useState('1, 2');
  const [requiredSigs, setRequiredSigs] = useState(1);
  const [createCtxResult, setCreateCtxResult] = useState('');

  const fmtObj = (v: string) =>
    v.startsWith('http') || v.startsWith('did:') || v.startsWith('urn:') ? v : `"${v}"`;

  const doWrite = useCallback(async () => {
    setBusy(true);
    setResult('');
    const graph = paranet.startsWith('did:') ? paranet : `did:dkg:paranet:${paranet}`;
    const quads = [{ subject, predicate, object: fmtObj(object), graph }];
    const opId = addBroadcast('workspace', state.selectedNode, 'workspace write');
    addTimelineStep(state.selectedNode, 'workspace', 'write', 'Writing quads to workspace', { status: 'start' });
    try {
      const res = await api.writeToWorkspace(state.selectedNode, paranet, quads);
      addTimelineStep(state.selectedNode, 'workspace', 'store', 'Quads stored in workspace');
      completeOperation(opId, 'success', res.workspaceOperationId);

      const peers = state.nodes.filter(n => n.id !== state.selectedNode && n.online);
      addTimelineStep(state.selectedNode, 'workspace', 'gossip', 'Broadcasting via GossipSub', { status: 'done' });
      peers.forEach((n, i) => {
        setTimeout(() => {
          addTimelineStep(n.id, 'workspace', 'receive', `Workspace sync from N${state.selectedNode}`);
        }, 300 + i * 250);
        setTimeout(() => {
          addTimelineStep(n.id, 'workspace', 'store', 'Stored in local workspace', { status: 'done' });
        }, 800 + i * 250);
      });

      setResult(`Written to workspace.\nOperation: ${res.workspaceOperationId}`);
    } catch (e: any) {
      completeOperation(opId, 'error', e.message);
      addTimelineStep(state.selectedNode, 'workspace', 'error', e.message, { status: 'error' });
      setResult(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [subject, predicate, object, paranet, state.selectedNode, state.nodes, addBroadcast, completeOperation, addTimelineStep]);

  const doQueryWorkspace = useCallback(async () => {
    setBusy(true);
    setWsContents('');
    const sparql = `SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 50`;
    try {
      const res = await api.queryNode(state.selectedNode, sparql, paranet, {
        graphSuffix: '_workspace',
      });
      setWsContents(JSON.stringify(res.result, null, 2));
    } catch (e: any) {
      setWsContents(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [paranet, state.selectedNode]);

  const doEnshrine = useCallback(async () => {
    setBusy(true);
    setResult('');
    const isCtx = enshrineMode === 'contextGraph' && contextGraphId.trim();
    const label = isCtx ? `enshrine → context graph ${contextGraphId}` : 'enshrine → paranet';
    const opType = isCtx ? 'contextGraph' as OperationType : 'publish' as OperationType;
    const opId = addBroadcast(opType, state.selectedNode, label);

    addTimelineStep(state.selectedNode, opType, 'start', 'Collecting workspace triples', { status: 'start' });
    addTimelineStep(state.selectedNode, opType, 'merkle', 'Computing merkle root');
    try {
      addTimelineStep(state.selectedNode, opType, 'chain-tx', 'Submitting chain tx...');
      addChainAnimation(state.selectedNode, opType, 'toChain');
      addTimelineStep(CHAIN_NODE_ID, opType, 'tx-pending', `Tx from N${state.selectedNode}`, { status: 'start' });
      const res = await api.enshrineFromWorkspace(
        state.selectedNode,
        paranet,
        'all',
        true,
        isCtx ? contextGraphId.trim() : undefined,
      );
      addChainAnimation(state.selectedNode, opType, 'fromChain');
      addTimelineStep(CHAIN_NODE_ID, opType, 'confirmed', `KC ${res.kcId} mined`, { status: 'done' });
      addTimelineStep(state.selectedNode, opType, 'confirmed', `On-chain confirmed: KC ${res.kcId}`);

      const peers = state.nodes.filter(n => n.id !== state.selectedNode && n.online);
      peers.forEach((n, i) => {
        setTimeout(() => {
          addTimelineStep(state.selectedNode, opType, 'gossip', `Finalization → N${n.id}`, { targetNodeId: n.id });
          addTimelineStep(n.id, opType, 'receive', `Finalization from N${state.selectedNode}`);
        }, 200 + i * 300);
      });

      peers.forEach((n, i) => {
        setTimeout(() => {
          addChainAnimation(n.id, opType, 'toChain');
          addTimelineStep(n.id, opType, 'verify', 'Verifying on-chain proof');
          addTimelineStep(CHAIN_NODE_ID, opType, 'read', `N${n.id} reading proof`, { status: 'progress' });
        }, 800 + i * 400);
        setTimeout(() => {
          addChainAnimation(n.id, opType, 'fromChain');
          addTimelineStep(n.id, opType, 'finalize', 'Verified & promoted to graph', { status: 'done' });
        }, 1600 + i * 400);
      });

      completeOperation(opId, 'success', `KC: ${res.kcId}`);
      setResult(
        `Enshrined to ${isCtx ? `context graph ${contextGraphId}` : 'paranet data graph'}.\n` +
        `KC: ${res.kcId}\nStatus: ${res.status}\nKAs: ${res.kas?.length ?? 0}` +
        (res.txHash ? `\nTx: ${res.txHash}` : ''),
      );
    } catch (e: any) {
      completeOperation(opId, 'error', e.message);
      addTimelineStep(state.selectedNode, opType, 'error', e.message, { status: 'error' });
      setResult(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [paranet, enshrineMode, contextGraphId, state.selectedNode, state.nodes, addBroadcast, completeOperation, addTimelineStep]);

  const doCreateContextGraph = useCallback(async () => {
    setBusy(true);
    setCreateCtxResult('');
    try {
      const ids = participantIds.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      if (ids.length === 0) throw new Error('Provide at least one participant identity ID');
      const res = await api.createContextGraph(state.selectedNode, ids, requiredSigs);
      setContextGraphId(res.contextGraphId);
      setCreateCtxResult(`Context graph created: ID = ${res.contextGraphId}`);
    } catch (e: any) {
      setCreateCtxResult(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [participantIds, requiredSigs, state.selectedNode]);

  const paranetSelect = paranets.length > 0 ? (
    <select value={paranet} onChange={(e) => setParanet(e.target.value)}>
      {paranets.map((p) => <option key={p} value={p}>{p}</option>)}
      {!paranets.includes(paranet) && <option value={paranet}>{paranet}</option>}
    </select>
  ) : (
    <input value={paranet} onChange={(e) => setParanet(e.target.value)} />
  );

  return (
    <div className="tab-form">
      <div className="setup-hint">
        Workspace-first publishing: write drafts (free), then enshrine to paranet or a context graph with on-chain finality.
      </div>

      <div className="form-group">
        <label>Paranet</label>
        {paranetSelect}
      </div>

      {/* ─── Step 1: Write to Workspace ─── */}
      <div className="setup-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ background: OP_COLORS.workspace, width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }} />
        Step 1 — Write to Workspace
      </div>
      <div className="form-group"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
      <div className="form-group"><label>Predicate</label><input value={predicate} onChange={(e) => setPredicate(e.target.value)} /></div>
      <div className="form-group"><label>Object</label><input value={object} onChange={(e) => setObject(e.target.value)} /></div>
      <button className="btn btn-primary btn-wide" disabled={busy} onClick={doWrite}>
        {busy ? 'Writing...' : 'Write to Workspace (Free)'}
      </button>

      <div className="setup-divider" />

      {/* ─── Workspace contents ─── */}
      <div className="setup-section-title">Workspace Contents</div>
      <button className="btn btn-secondary btn-wide" disabled={busy} onClick={doQueryWorkspace}>
        Query Workspace
      </button>
      {wsContents && <pre className="result-box code" style={{ maxHeight: 150 }}>{wsContents}</pre>}

      <div className="setup-divider" />

      {/* ─── Step 2: Enshrine ─── */}
      <div className="setup-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ background: OP_COLORS.publish, width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }} />
        Step 2 — Enshrine (On-Chain Finality)
      </div>

      <div className="form-group">
        <label>Target</label>
        <div className="graph-target-pills">
          <button
            className={`target-pill ${enshrineMode === 'paranet' ? 'active' : ''}`}
            style={enshrineMode === 'paranet' ? { background: OP_COLORS.publish } : undefined}
            onClick={() => setEnshrineMode('paranet')}
          >
            Paranet Data Graph
          </button>
          <button
            className={`target-pill ${enshrineMode === 'contextGraph' ? 'active' : ''}`}
            style={enshrineMode === 'contextGraph' ? { background: OP_COLORS.contextGraph } : undefined}
            onClick={() => setEnshrineMode('contextGraph')}
          >
            Context Graph
          </button>
        </div>
      </div>

      {enshrineMode === 'contextGraph' && (
        <>
          <div className="form-group">
            <label>Context Graph ID</label>
            <input
              value={contextGraphId}
              onChange={(e) => setContextGraphId(e.target.value)}
              placeholder="Enter ID or create one below"
            />
          </div>
          <details style={{ marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, opacity: 0.7 }}>Create new context graph...</summary>
            <div style={{ padding: '8px 0 0' }}>
              <div className="form-group">
                <label>Participant Identity IDs (comma-separated)</label>
                <input value={participantIds} onChange={(e) => setParticipantIds(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Required Signatures (M of N)</label>
                <input type="number" min={0} value={requiredSigs} onChange={(e) => setRequiredSigs(parseInt(e.target.value) || 0)} />
              </div>
              <button className="btn btn-secondary btn-wide" disabled={busy} onClick={doCreateContextGraph}>
                {busy ? 'Creating...' : 'Create Context Graph On-Chain'}
              </button>
              {createCtxResult && <div className="result-box" style={{ marginTop: 6, fontSize: 12 }}>{createCtxResult}</div>}
            </div>
          </details>
        </>
      )}

      <p className="setup-hint">
        {enshrineMode === 'paranet'
          ? 'Publishes all workspace content to the paranet data graph with on-chain finality.'
          : 'Publishes workspace content to a bounded context graph (M/N signature-gated subgraph).'}
      </p>
      <button className="btn btn-primary btn-wide" disabled={busy} onClick={doEnshrine}>
        {busy
          ? 'Enshrining...'
          : enshrineMode === 'contextGraph'
            ? `Enshrine to Context Graph${contextGraphId ? ` #${contextGraphId}` : ''}`
            : 'Enshrine All to Paranet'}
      </button>

      {result && <pre className="result-box code">{result}</pre>}
    </div>
  );
}

function PublishTab() {
  const { state, addBroadcast, completeOperation, addTimelineStep, addChainAnimation } = useStore();
  const paranets = useParanets();
  const [subject, setSubject] = useState('did:dkg:entity:001');
  const [predicate, setPredicate] = useState('http://schema.org/name');
  const [object, setObject] = useState('Test Entity');
  const [privateObj, setPrivateObj] = useState('');
  const [paranet, setParanet] = useState('devnet-test');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const doPublish = useCallback(async () => {
    setBusy(true);
    setResult('');
    const graph = paranet.startsWith('did:') ? paranet : `did:dkg:paranet:${paranet}`;
    const fmtObj = (v: string) =>
      v.startsWith('http') || v.startsWith('did:') || v.startsWith('urn:') ? v : `"${v}"`;
    const quads = [{ subject, predicate, object: fmtObj(object), graph }];
    const privQuads =
      privateObj.trim()
        ? [{ subject, predicate: 'http://schema.org/secret', object: fmtObj(privateObj), graph }]
        : undefined;

    const label = privQuads ? 'publish (private)' : 'publish';
    const opId = addBroadcast('publish', state.selectedNode, label);

    addTimelineStep(state.selectedNode, 'publish', 'prepare', 'Preparing knowledge asset', { status: 'start' });
    addTimelineStep(state.selectedNode, 'publish', 'merkle', 'Computing merkle proofs');
    try {
      addTimelineStep(state.selectedNode, 'publish', 'chain-tx', 'Submitting chain tx...');
      addChainAnimation(state.selectedNode, 'publish', 'toChain');
      addTimelineStep(CHAIN_NODE_ID, 'publish', 'tx-pending', `Tx from N${state.selectedNode}`, { status: 'start' });
      const res = await api.publishKA(state.selectedNode, paranet, quads, privQuads);
      addChainAnimation(state.selectedNode, 'publish', 'fromChain');
      addTimelineStep(CHAIN_NODE_ID, 'publish', 'confirmed', `KC ${res.kcId} mined`, { status: 'done' });
      addTimelineStep(state.selectedNode, 'publish', 'confirmed', `On-chain confirmed: KC ${res.kcId}`);

      const peers = state.nodes.filter(n => n.id !== state.selectedNode && n.online);
      peers.forEach((n, i) => {
        setTimeout(() => {
          addTimelineStep(state.selectedNode, 'publish', 'gossip', `Broadcasting → N${n.id}`, { targetNodeId: n.id });
          addTimelineStep(n.id, 'publish', 'receive', `Receiving from N${state.selectedNode}`);
        }, 200 + i * 300);
      });

      peers.forEach((n, i) => {
        setTimeout(() => {
          addChainAnimation(n.id, 'publish', 'toChain');
          addTimelineStep(n.id, 'publish', 'verify', 'Verifying on-chain proof');
          addTimelineStep(CHAIN_NODE_ID, 'publish', 'read', `N${n.id} reading proof`, { status: 'progress' });
        }, 800 + i * 400);
        setTimeout(() => {
          addChainAnimation(n.id, 'publish', 'fromChain');
          addTimelineStep(n.id, 'publish', 'finalize', 'Verified & promoted to graph', { status: 'done' });
        }, 1600 + i * 400);
      });

      completeOperation(opId, 'success', `KC: ${res.kcId}`);
      setResult(`KC: ${res.kcId} | Status: ${res.status} | KAs: ${res.kas?.length ?? 0}`);
    } catch (e: any) {
      completeOperation(opId, 'error', e.message);
      addTimelineStep(state.selectedNode, 'publish', 'error', e.message, { status: 'error' });
      setResult(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [subject, predicate, object, privateObj, paranet, state.selectedNode, state.nodes, addBroadcast, completeOperation, addTimelineStep]);

  return (
    <div className="tab-form">
      <div className="form-group">
        <label>Paranet</label>
        {paranets.length > 0 ? (
          <select value={paranet} onChange={(e) => setParanet(e.target.value)}>
            {paranets.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
            {!paranets.includes(paranet) && (
              <option value={paranet}>{paranet} (custom)</option>
            )}
          </select>
        ) : (
          <input value={paranet} onChange={(e) => setParanet(e.target.value)} />
        )}
      </div>
      <div className="form-group">
        <label>Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="form-group">
        <label>Predicate</label>
        <input value={predicate} onChange={(e) => setPredicate(e.target.value)} />
      </div>
      <div className="form-group">
        <label>Object</label>
        <input value={object} onChange={(e) => setObject(e.target.value)} />
      </div>
      <div className="form-group">
        <label>Private Data (optional)</label>
        <input
          value={privateObj}
          onChange={(e) => setPrivateObj(e.target.value)}
          placeholder="Leave empty for public-only"
        />
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={doPublish}>
        {busy ? 'Publishing...' : 'Publish Knowledge Asset'}
      </button>
      {result && <div className="result-box">{result}</div>}
    </div>
  );
}

function QueryTab() {
  const { state, addOperation, completeOperation } = useStore();
  const paranets = useParanets();
  const [sparql, setSparql] = useState('SELECT * WHERE { ?s ?p ?o } LIMIT 10');
  const [paranet, setParanet] = useState('devnet-test');
  const [graphTarget, setGraphTarget] = useState<'published' | 'workspace' | 'both'>('published');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const doQuery = useCallback(async () => {
    setBusy(true);
    setResult('');
    const targetLabel = graphTarget === 'workspace' ? 'workspace' : graphTarget === 'both' ? 'published+workspace' : 'published';
    const opId = addOperation('query', state.selectedNode, `query (${targetLabel})`);
    try {
      const opts = graphTarget === 'workspace'
        ? { graphSuffix: '_workspace' as const }
        : graphTarget === 'both'
          ? { includeWorkspace: true }
          : undefined;
      const res = await api.queryNode(state.selectedNode, sparql, paranet || undefined, opts);
      const json = JSON.stringify(res.result, null, 2);
      completeOperation(opId, 'success', `${json.length} chars`);
      setResult(json);
    } catch (e: any) {
      completeOperation(opId, 'error', e.message);
      setResult(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [sparql, paranet, graphTarget, state.selectedNode, addOperation, completeOperation]);

  return (
    <div className="tab-form">
      <div className="form-group">
        <label>Paranet</label>
        {paranets.length > 0 ? (
          <select value={paranet} onChange={(e) => setParanet(e.target.value)}>
            {paranets.map((p) => <option key={p} value={p}>{p}</option>)}
            {!paranets.includes(paranet) && <option value={paranet}>{paranet}</option>}
          </select>
        ) : (
          <input value={paranet} onChange={(e) => setParanet(e.target.value)} />
        )}
      </div>
      <div className="form-group">
        <label>Query Target</label>
        <div className="graph-target-pills">
          {([
            ['published', 'Published'],
            ['workspace', 'Workspace'],
            ['both', 'Both'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              className={`target-pill ${graphTarget === value ? 'active' : ''}`}
              onClick={() => setGraphTarget(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label>SPARQL</label>
        <textarea
          rows={4}
          value={sparql}
          onChange={(e) => setSparql(e.target.value)}
          spellCheck={false}
        />
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={doQuery}>
        {busy ? 'Querying...' : 'Execute Query'}
      </button>
      {result && <pre className="result-box code">{result}</pre>}
    </div>
  );
}

function ChatTab() {
  const { state, addOperation, completeOperation } = useStore();
  const [targetNode, setTargetNode] = useState(2);
  const [text, setText] = useState('Hello from the simulator!');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const doChat = useCallback(async () => {
    const target = state.nodes.find((n) => n.id === targetNode);
    if (!target?.status?.peerId) {
      setResult('Error: Target node not online or peerId unknown');
      return;
    }
    setBusy(true);
    setResult('');
    const opId = addOperation('chat', state.selectedNode, `"${text.slice(0, 30)}"`, targetNode);
    try {
      const res = await api.sendChat(state.selectedNode, target.status.peerId, text);
      if (res.delivered) {
        completeOperation(opId, 'success', 'delivered');
        setResult('Message delivered');
      } else {
        completeOperation(opId, 'error', res.error || 'not delivered');
        setResult(`Not delivered: ${res.error || 'unknown'}`);
      }
    } catch (e: any) {
      completeOperation(opId, 'error', e.message);
      setResult(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [targetNode, text, state.selectedNode, state.nodes, addOperation, completeOperation]);

  return (
    <div className="tab-form">
      <div className="form-group">
        <label>To Node</label>
        <div className="node-pills">
          {state.nodes
            .filter((n) => n.id !== state.selectedNode)
            .map((n) => (
              <button
                key={n.id}
                className={`node-pill ${n.id === targetNode ? 'active' : ''} ${n.online ? 'online' : 'offline'}`}
                onClick={() => setTargetNode(n.id)}
              >
                N{n.id}
              </button>
            ))}
        </div>
      </div>
      <div className="form-group">
        <label>Message</label>
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={doChat}>
        {busy ? 'Sending...' : 'Send Message'}
      </button>
      {result && <div className="result-box">{result}</div>}
    </div>
  );
}

function AccessTab() {
  const { state, addOperation, completeOperation } = useStore();
  const [publisherNode, setPublisherNode] = useState(1);
  const [ual, setUal] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const doAccess = useCallback(async () => {
    const publisher = state.nodes.find((n) => n.id === publisherNode);
    if (!publisher?.status?.peerId) {
      setResult('Error: Publisher node not online');
      return;
    }
    setBusy(true);
    setResult('');
    const opId = addOperation('access', state.selectedNode, `request KA access`, publisherNode);
    try {
      const res = await api.queryRemote(state.selectedNode, publisher.status.peerId, {
        lookupType: 'ual',
        ual,
      });
      completeOperation(opId, 'success', `status: ${res.status}`);
      setResult(JSON.stringify(res, null, 2));
    } catch (e: any) {
      completeOperation(opId, 'error', e.message);
      setResult(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [publisherNode, ual, state.selectedNode, state.nodes, addOperation, completeOperation]);

  return (
    <div className="tab-form">
      <div className="form-group">
        <label>Publisher Node</label>
        <div className="node-pills">
          {state.nodes
            .filter((n) => n.id !== state.selectedNode)
            .map((n) => (
              <button
                key={n.id}
                className={`node-pill ${n.id === publisherNode ? 'active' : ''} ${n.online ? 'online' : 'offline'}`}
                onClick={() => setPublisherNode(n.id)}
              >
                N{n.id}
              </button>
            ))}
        </div>
      </div>
      <div className="form-group">
        <label>Knowledge Asset UAL</label>
        <input
          value={ual}
          onChange={(e) => setUal(e.target.value)}
          placeholder="did:dkg:..."
        />
      </div>
      <button className="btn btn-primary" disabled={busy || !ual} onClick={doAccess}>
        {busy ? 'Requesting...' : 'Request Private Access'}
      </button>
      {result && <pre className="result-box code">{result}</pre>}
    </div>
  );
}

function StakeTab() {
  const { state, addOperation, completeOperation } = useStore();
  const [amount, setAmount] = useState('1000');
  const [lockEpochs, setLockEpochs] = useState('12');
  const [result, setResult] = useState('');

  const calcMultiplier = useCallback(() => {
    const n = parseInt(lockEpochs) || 0;
    if (n <= 1) return '1.000';
    const K = 2;
    const H = 365;
    const m = 1 + (K * (n - 1)) / (7 * (n - 1) + H);
    return Math.min(3.0, m).toFixed(3);
  }, [lockEpochs]);

  const doStake = useCallback(async () => {
    const opId = addOperation('stake', state.selectedNode, `stake ${amount} TRAC (${lockEpochs} epochs)`);
    try {
      setResult(
        `Staking ${amount} TRAC with ${lockEpochs} epoch lock...\n` +
        `Conviction multiplier: ${calcMultiplier()}x\n` +
        `Effective weight: ${(parseFloat(amount) * parseFloat(calcMultiplier())).toFixed(2)} TRAC\n\n` +
        `Note: Chain operations require the devnet Hardhat chain to be running.\n` +
        `Use the node's wallet endpoint to check balances.`,
      );
      completeOperation(opId, 'success', `${amount} TRAC × ${calcMultiplier()}`);
    } catch (e: any) {
      completeOperation(opId, 'error', e.message);
      setResult(`Error: ${e.message}`);
    }
  }, [amount, lockEpochs, state.selectedNode, addOperation, completeOperation, calcMultiplier]);

  return (
    <div className="tab-form">
      <div className="form-group">
        <label>Amount (TRAC)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="form-group">
        <label>Lock Epochs</label>
        <input type="number" value={lockEpochs} onChange={(e) => setLockEpochs(e.target.value)} />
      </div>
      <div className="conviction-preview">
        <div className="metric">
          <span className="metric-label">Conviction Multiplier</span>
          <span className="metric-value" style={{ color: OP_COLORS.stake }}>
            {calcMultiplier()}x
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Effective Weight</span>
          <span className="metric-value">
            {(parseFloat(amount || '0') * parseFloat(calcMultiplier())).toFixed(2)} TRAC
          </span>
        </div>
      </div>
      <button className="btn btn-primary" onClick={doStake}>
        Stake with Conviction Lock
      </button>
      {result && <pre className="result-box code">{result}</pre>}
    </div>
  );
}

function ConvictionTab() {
  const { state, addOperation, completeOperation } = useStore();
  const [deposit, setDeposit] = useState('5000');
  const [lockEpochs, setLockEpochs] = useState('52');
  const [baseCost, setBaseCost] = useState('100');
  const [result, setResult] = useState('');

  const calcDiscount = useCallback(() => {
    const n = parseInt(lockEpochs) || 0;
    const depositVal = parseFloat(deposit) || 0;
    if (n <= 0 || depositVal <= 0) return 0;
    const C_HALF = 10000;
    const MAX_DISCOUNT = 5000;
    const discount = Math.floor((MAX_DISCOUNT * depositVal * n) / (depositVal * n + C_HALF));
    return discount;
  }, [lockEpochs, deposit]);

  const discountedCost = useCallback(() => {
    const base = parseFloat(baseCost) || 0;
    const discountBps = calcDiscount();
    return (base * (10000 - discountBps)) / 10000;
  }, [baseCost, calcDiscount]);

  const doCreate = useCallback(async () => {
    const opId = addOperation('conviction', state.selectedNode, `create conviction account`);
    try {
      const disc = calcDiscount();
      setResult(
        `Creating Conviction Account...\n` +
        `Deposit: ${deposit} TRAC\n` +
        `Lock: ${lockEpochs} epochs\n` +
        `Discount: ${(disc / 100).toFixed(2)}%\n` +
        `Publishing cost of ${baseCost} TRAC → ${discountedCost().toFixed(2)} TRAC\n\n` +
        `Note: Chain operations require the devnet Hardhat chain to be running.`,
      );
      completeOperation(opId, 'success', `${(disc / 100).toFixed(1)}% discount`);
    } catch (e: any) {
      completeOperation(opId, 'error', e.message);
      setResult(`Error: ${e.message}`);
    }
  }, [deposit, lockEpochs, baseCost, state.selectedNode, addOperation, completeOperation, calcDiscount, discountedCost]);

  return (
    <div className="tab-form">
      <div className="form-group">
        <label>Deposit (TRAC)</label>
        <input type="number" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
      </div>
      <div className="form-group">
        <label>Lock Epochs</label>
        <input type="number" value={lockEpochs} onChange={(e) => setLockEpochs(e.target.value)} />
      </div>
      <div className="form-group">
        <label>Base Publish Cost (TRAC)</label>
        <input type="number" value={baseCost} onChange={(e) => setBaseCost(e.target.value)} />
      </div>
      <div className="conviction-preview">
        <div className="metric">
          <span className="metric-label">Discount</span>
          <span className="metric-value" style={{ color: OP_COLORS.conviction }}>
            {(calcDiscount() / 100).toFixed(2)}%
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Discounted Cost</span>
          <span className="metric-value">
            {discountedCost().toFixed(2)} TRAC
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Savings</span>
          <span className="metric-value" style={{ color: '#10b981' }}>
            {(parseFloat(baseCost || '0') - discountedCost()).toFixed(2)} TRAC
          </span>
        </div>
      </div>
      <button className="btn btn-primary" onClick={doCreate}>
        Create Conviction Account
      </button>
      {result && <pre className="result-box code">{result}</pre>}
    </div>
  );
}

function LogsTab() {
  const { state } = useStore();
  const [logs, setLogs] = useState<string[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [logLevel, setLogLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const logEndRef = useRef<HTMLDivElement>(null);
  const fileSizeRef = useRef(0);

  const fetchLatest = useCallback(async () => {
    try {
      const res = await api.fetchLogs(state.selectedNode, 300, 0);
      setLogs(res.lines);
      fileSizeRef.current = res.fileSize;
    } catch {
      setLogs(['Error fetching logs']);
    }
  }, [state.selectedNode]);

  useEffect(() => {
    fetchLatest();
  }, [fetchLatest]);

  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(async () => {
      try {
        const res = await api.fetchLogs(state.selectedNode, 300, 0);
        setLogs(res.lines);
        fileSizeRef.current = res.fileSize;
      } catch { /* ignore polling errors */ }
    }, 2000);
    return () => clearInterval(iv);
  }, [autoRefresh, state.selectedNode]);

  useEffect(() => {
    if (autoRefresh) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoRefresh]);

  const filtered = logs.filter((line) => {
    if (filterText && !line.toLowerCase().includes(filterText.toLowerCase())) return false;
    if (logLevel === 'error' && !line.includes('[ERROR]') && !line.includes('Error') && !line.includes('FAIL')) return false;
    if (logLevel === 'warn' && !line.includes('[WARN]') && !line.includes('WARNING') && !line.includes('[ERROR]') && !line.includes('Error')) return false;
    return true;
  });

  const colorize = (line: string) => {
    if (line.includes('[ERROR]') || line.includes('Error') || line.includes('FAIL')) return '#ef4444';
    if (line.includes('[WARN]') || line.includes('WARNING')) return '#f59e0b';
    if (line.includes('publish') || line.includes('enshrine') || line.includes('Publish')) return '#10b981';
    if (line.includes('workspace') || line.includes('Workspace')) return '#f97316';
    if (line.includes('query') || line.includes('Query')) return '#3b82f6';
    if (line.includes('gossip') || line.includes('Gossip') || line.includes('Finalization')) return '#a855f7';
    return undefined;
  };

  return (
    <div className="tab-form" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter logs..."
          style={{ flex: 1 }}
        />
        <select value={logLevel} onChange={(e) => setLogLevel(e.target.value as any)} style={{ width: 80 }}>
          <option value="all">All</option>
          <option value="info">Info+</option>
          <option value="warn">Warn+</option>
          <option value="error">Errors</option>
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto-refresh
        </label>
        <span style={{ opacity: 0.5 }}>
          Node {state.selectedNode} &middot; {filtered.length} lines
        </span>
        <button
          className="btn btn-secondary"
          style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }}
          onClick={fetchLatest}
        >
          Refresh
        </button>
      </div>

      <div
        className="logs-container"
        style={{
          flex: 1,
          minHeight: 300,
          maxHeight: 500,
          overflow: 'auto',
          background: '#0d1117',
          borderRadius: 6,
          padding: '8px 10px',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11,
          lineHeight: 1.5,
          color: '#c9d1d9',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ opacity: 0.4, textAlign: 'center', paddingTop: 40 }}>No logs yet</div>
        ) : (
          filtered.map((line, i) => (
            <div key={i} style={{ color: colorize(line) }}>
              {line}
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

function FairSwapTab() {
  const { state, addOperation, completeOperation } = useStore();
  const [sellerNode, setSellerNode] = useState(1);
  const [kaId, setKaId] = useState('1');
  const [price, setPrice] = useState('50');
  const [result, setResult] = useState('');

  const doInitiate = useCallback(async () => {
    const opId = addOperation('fairswap', state.selectedNode, `initiate purchase KA #${kaId}`, sellerNode);
    try {
      setResult(
        `FairSwap Purchase Flow:\n\n` +
        `1. Buyer (Node ${state.selectedNode}) initiates purchase of KA #${kaId}\n` +
        `   Price: ${price} TRAC → escrow\n` +
        `   Protocol fee: ${(parseFloat(price) * 0.025).toFixed(2)} TRAC (2.5%)\n\n` +
        `2. Seller (Node ${sellerNode}) fulfills with encrypted data\n` +
        `   → encryptedDataRoot submitted on-chain\n\n` +
        `3. Seller reveals decryption key\n` +
        `   → key submitted on-chain\n\n` +
        `4. Buyer verifies data\n` +
        `   → If valid: seller claims payment\n` +
        `   → If invalid: buyer disputes with merkle proof\n\n` +
        `Note: Chain operations require the devnet Hardhat chain to be running.`,
      );
      completeOperation(opId, 'success', `${price} TRAC escrowed`);
    } catch (e: any) {
      completeOperation(opId, 'error', e.message);
      setResult(`Error: ${e.message}`);
    }
  }, [sellerNode, kaId, price, state.selectedNode, addOperation, completeOperation]);

  return (
    <div className="tab-form">
      <div className="form-group">
        <label>Seller Node</label>
        <div className="node-pills">
          {state.nodes
            .filter((n) => n.id !== state.selectedNode)
            .map((n) => (
              <button
                key={n.id}
                className={`node-pill ${n.id === sellerNode ? 'active' : ''} ${n.online ? 'online' : 'offline'}`}
                onClick={() => setSellerNode(n.id)}
              >
                N{n.id}
              </button>
            ))}
        </div>
      </div>
      <div className="form-group">
        <label>Knowledge Asset ID</label>
        <input value={kaId} onChange={(e) => setKaId(e.target.value)} />
      </div>
      <div className="form-group">
        <label>Price (TRAC)</label>
        <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <div className="conviction-preview">
        <div className="metric">
          <span className="metric-label">Escrow Amount</span>
          <span className="metric-value" style={{ color: OP_COLORS.fairswap }}>
            {price} TRAC
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Protocol Fee (2.5%)</span>
          <span className="metric-value">
            {(parseFloat(price || '0') * 0.025).toFixed(2)} TRAC
          </span>
        </div>
      </div>
      <button className="btn btn-primary" onClick={doInitiate}>
        Initiate Purchase
      </button>
      {result && <pre className="result-box code">{result}</pre>}
    </div>
  );
}
