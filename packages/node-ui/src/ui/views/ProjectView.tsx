import React, { useMemo, useState } from 'react';
import { useFetch } from '../hooks.js';
import { api } from '../api-wrapper.js';
import { useTabsStore } from '../stores/tabs.js';
import { ImportFilesModal } from '../components/Modals/ImportFilesModal.js';

interface ProjectViewProps {
  contextGraphId: string;
}

export function ProjectView({ contextGraphId }: ProjectViewProps) {
  const { data: cgData } = useFetch(api.fetchContextGraphs, [], 30_000);
  const { openTab } = useTabsStore();
  const [showImport, setShowImport] = useState(false);

  const cg = useMemo(
    () => cgData?.contextGraphs?.find((c: any) => c.id === contextGraphId),
    [cgData, contextGraphId]
  );

  if (!cg) {
    return (
      <div className="v10-view-placeholder">
        <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
          Loading context graph...
        </p>
      </div>
    );
  }

  const assetCount = cg.assetCount ?? cg.assets ?? 0;
  const agentCount = cg.agentCount ?? cg.agents ?? 0;

  return (
    <div className="v10-project-view">
      <div className="v10-pv-header">
        <div className="v10-pv-project-dot" />
        <div>
          <h1 className="v10-pv-title">{cg.name || cg.id}</h1>
          {cg.description && <p className="v10-pv-desc">{cg.description}</p>}
          <div className="v10-pv-meta">
            <span className="v10-pv-meta-item">{assetCount} assets</span>
            <span className="v10-pv-meta-sep">·</span>
            <span className="v10-pv-meta-item">{agentCount} agents</span>
            <span className="v10-pv-meta-sep">·</span>
            <span className="v10-pv-meta-item mono" style={{ fontSize: 10 }}>{cg.id}</span>
          </div>
        </div>
      </div>

      <div className="v10-pv-actions" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className="v10-modal-btn primary"
          style={{ height: 32, padding: '0 14px', fontSize: 12 }}
          onClick={() => setShowImport(true)}
        >
          ↑ Import Files to Working Memory
        </button>
      </div>

      <div className="v10-pv-layers">
        <LayerCard
          label="Working Memory"
          dotColor="var(--layer-working)"
          icon="◇"
          description="Agent drafts and scratch data. Private, fast, local."
          onOpen={() => openTab({ id: `wm:${cg.id}`, label: `WM · ${cg.name || cg.id.slice(0,12)}`, closable: true })}
        />
        <LayerCard
          label="Shared Working Memory"
          dotColor="var(--layer-shared)"
          icon="◈"
          description="Proposed knowledge shared with collaborators. TTL-bounded."
          onOpen={() => openTab({ id: `swm:${cg.id}`, label: `SWM · ${cg.name || cg.id.slice(0,12)}`, closable: true })}
        />
        <LayerCard
          label="Verified Memory"
          dotColor="var(--layer-verified)"
          icon="◉"
          description="Endorsed and published knowledge. On-chain, permanent."
          onOpen={() => openTab({ id: `vm:${cg.id}`, label: `VM · ${cg.name || cg.id.slice(0,12)}`, closable: true })}
        />
      </div>

      <ImportFilesModal
        open={showImport}
        onClose={() => setShowImport(false)}
        contextGraphId={cg.id}
        contextGraphName={cg.name}
      />
    </div>
  );
}

function LayerCard({ label, dotColor, icon, description, onOpen }: {
  label: string;
  dotColor: string;
  icon: string;
  description: string;
  onOpen: () => void;
}) {
  return (
    <button className="v10-layer-card" onClick={onOpen}>
      <div className="v10-layer-card-header">
        <span className="v10-layer-card-icon" style={{ color: dotColor }}>{icon}</span>
        <span className="v10-layer-card-label">{label}</span>
        <span className="v10-layer-card-arrow">→</span>
      </div>
      <p className="v10-layer-card-desc">{description}</p>
    </button>
  );
}
