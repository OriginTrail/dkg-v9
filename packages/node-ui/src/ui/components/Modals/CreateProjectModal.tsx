import React, { useState } from 'react';
import { createContextGraph, fetchContextGraphs } from '../../api.js';
import { useProjectsStore } from '../../stores/projects.js';
import { useTabsStore } from '../../stores/tabs.js';
import { useJourneyStore } from '../../stores/journey.js';

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateProjectModal({ open, onClose }: CreateProjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [access, setAccess] = useState<'curated' | 'public'>('curated');
  const [publishPolicy, setPublishPolicy] = useState<'curator-only' | 'open'>('curator-only');
  const [ontology, setOntology] = useState<'agent' | 'upload' | 'community'>('agent');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [quorum, setQuorum] = useState('off');
  const [swmTtl, setSwmTtl] = useState('7d');
  const [swmCap, setSwmCap] = useState('100k');
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { setContextGraphs, contextGraphs, setActiveProject } = useProjectsStore();
  const { openTab } = useTabsStore();
  const { setStage, stage } = useJourneyStore();

  if (!open) return null;

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setCreating(true);
    setError(null);
    setProgress('Registering project on the network…');

    const cgId = `cg:${slugify(trimmedName)}-${Date.now().toString(36)}`;

    try {
      const slowTimer = setTimeout(() => setProgress('On-chain registration in progress — this can take up to 30s…'), 5000);

      const result = await createContextGraph(cgId, trimmedName, description.trim() || undefined);
      clearTimeout(slowTimer);

      setProgress('Refreshing project list…');
      const { contextGraphs: freshList } = await fetchContextGraphs();
      setContextGraphs(freshList ?? []);

      setActiveProject(result.created);
      openTab({ id: `project:${result.created}`, label: trimmedName, closable: true });
      if (stage < 2) setStage(2);

      setName('');
      setDescription('');
      setProgress('');
      onClose();
    } catch (err: any) {
      const msg = err?.message || 'Failed to create project';
      if (msg.includes('already exists') || msg.includes('409')) {
        setError('A project with this ID already exists. Try a different name.');
      } else if (msg.includes('taking longer')) {
        setError(msg);
      } else {
        setError(msg);
      }
      setProgress('');
    } finally {
      setCreating(false);
    }
  };

  const isFirstProject = contextGraphs.length === 0;

  return (
    <div className="v10-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="v10-modal-box">
        <div className="v10-modal-header">
          <div className="v10-modal-title">Create New Project</div>
          <div className="v10-modal-subtitle">
            A project gives your agent structured memory — a place to draft, share, and publish knowledge.
          </div>
        </div>

        <div className="v10-modal-body">
          {error && (
            <div className="v10-modal-error">
              {error}
            </div>
          )}

          {isFirstProject && (
            <div className="v10-modal-tip">
              <div className="v10-modal-tip-title">First project tip</div>
              This is your agent's first memory space. Consider importing any existing knowledge
              your agent has — notes, documents, conversation logs — so it can build on what it already knows.
            </div>
          )}

          <div className="v10-form-group">
            <label className="v10-form-label">Project Name</label>
            <input
              className="v10-form-input"
              type="text"
              placeholder="e.g. Pharma Drug Interactions"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="v10-form-group">
            <label className="v10-form-label">Description</label>
            <textarea
              className="v10-form-textarea"
              placeholder="What should your agent remember? Describe the domain, goals, or context..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="v10-form-divider" />

          <div className="v10-form-group">
            <label className="v10-form-label">Access</label>
            <div className="v10-form-radio-group">
              <label className="v10-form-radio">
                <input type="radio" checked={access === 'curated'} onChange={() => setAccess('curated')} />
                Curated — only invited collaborators can view
              </label>
              <label className="v10-form-radio">
                <input type="radio" checked={access === 'public'} onChange={() => setAccess('public')} />
                Public — anyone can view
              </label>
            </div>
          </div>

          <div className="v10-form-group">
            <label className="v10-form-label">Publish Policy</label>
            <div className="v10-form-radio-group">
              <label className="v10-form-radio">
                <input type="radio" checked={publishPolicy === 'curator-only'} onChange={() => setPublishPolicy('curator-only')} />
                Curator only — only the curator can publish to Verified Memory
              </label>
              <label className="v10-form-radio">
                <input type="radio" checked={publishPolicy === 'open'} onChange={() => setPublishPolicy('open')} />
                Open — any collaborator can publish to Verified Memory
              </label>
            </div>
          </div>

          <div className="v10-form-group">
            <label className="v10-form-label">Ontology</label>
            <div className="v10-form-radio-group">
              <label className="v10-form-radio">
                <input type="radio" checked={ontology === 'agent'} onChange={() => setOntology('agent')} />
                Let agent decide — your agent will choose the best vocabulary
              </label>
              <div className="v10-form-radio-desc">
                Your agent will query community ontologies and select the most relevant one.
              </div>
              <label className="v10-form-radio">
                <input type="radio" checked={ontology === 'upload'} onChange={() => setOntology('upload')} />
                Upload an ontology file (.ttl, .owl, .rdf)
              </label>
              <label className="v10-form-radio">
                <input type="radio" checked={ontology === 'community'} onChange={() => setOntology('community')} />
                Choose from community ontologies
              </label>
            </div>
          </div>

          <div className="v10-form-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
            <span className={`v10-form-adv-chevron ${showAdvanced ? 'open' : ''}`}>▸</span>
            <span>Advanced settings</span>
          </div>

          {showAdvanced && (
            <div className="v10-form-advanced-body">
              <div className="v10-form-group">
                <label className="v10-form-label">Consensus Quorum</label>
                <select className="v10-form-select" value={quorum} onChange={(e) => setQuorum(e.target.value)}>
                  <option value="off">Off — no consensus verification required</option>
                  <option value="2of3">2 of 3 — lightweight consensus</option>
                  <option value="3of5">3 of 5 — standard consensus (recommended for teams)</option>
                  <option value="custom">Custom — set your own M of N</option>
                </select>
              </div>
              <div className="v10-form-group">
                <label className="v10-form-label">SWM TTL</label>
                <select className="v10-form-select" value={swmTtl} onChange={(e) => setSwmTtl(e.target.value)}>
                  <option value="7d">7 days (default)</option>
                  <option value="1h">1 hour</option>
                  <option value="1d">1 day</option>
                  <option value="30d">30 days</option>
                </select>
              </div>
              <div className="v10-form-group" style={{ marginBottom: 0 }}>
                <label className="v10-form-label">SWM Size Cap</label>
                <select className="v10-form-select" value={swmCap} onChange={(e) => setSwmCap(e.target.value)}>
                  <option value="100k">100K triples (default)</option>
                  <option value="10k">10K triples</option>
                  <option value="1m">1M triples</option>
                </select>
              </div>
            </div>
          )}

          <div className="v10-layer-preview">
            <div className="v10-layer-preview-title">Layer Activation</div>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              ┌─ Verified Memory ── activates on first publish (requires TRAC)<br />
              ├─ Shared Memory ──── activates on first share (free)<br />
              └─ Working Memory ─── created immediately (local, free)
            </span>
          </div>
        </div>

        <div className="v10-modal-footer">
          <button className="v10-modal-btn" onClick={onClose}>Cancel</button>
          <button
            className="v10-modal-btn primary"
            onClick={handleCreate}
            disabled={!name.trim() || creating}
          >
            {creating ? progress || 'Creating…' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
