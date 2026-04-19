/**
 * WireWorkspacePanel — the post-create / post-join wire-up step.
 *
 * Reused by both CreateProjectModal (curator side, after manifest +
 * ontology publish) and JoinProjectModal (joiner side, after subscribe
 * + catchup). Both produce the same outcome: a workspace directory
 * containing the manifest's templated files (`.cursor/`, `.dkg/`,
 * `AGENTS.md`, optional `~/.claude/settings.json`) so the operator
 * can open the directory in Cursor and start collaborating.
 *
 * Three states: input → previewed → installed. The operator must
 * preview before installing — this is the trust-building step that
 * shows exactly which files will land where, and surfaces the
 * installer's safety guards (e.g. "this will overwrite an existing
 * .cursor/mcp.json" warnings).
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  planProjectManifestInstall,
  installProjectManifest,
  type PlanInstallResult,
  type InstallResult,
} from '../../lib/projectManifest.js';

interface WireWorkspacePanelProps {
  /** Context graph ID — used to call /api/context-graph/{id}/manifest/* . */
  contextGraphId: string;
  /** Display name for the project — drives the default workspace path. */
  projectName?: string;
  /** Default agent slug (e.g. "cursor-laptop"). Operator can override. */
  defaultAgentSlug?: string;
  /** Called when the operator finishes installing or skips. */
  onDone: () => void;
  /** Called when the operator clicks Cancel before doing anything. */
  onCancel?: () => void;
  /** Tone variant — "create" pitches it as "wire your own workspace", "join" pitches it as "wire the project locally". */
  variant: 'create' | 'join';
}

const WORKSPACE_PARENT_KEY = 'dkg.wireWorkspace.parentDir';

function defaultParentDir(): string {
  // localStorage remembers the operator's preferred parent dir from
  // the previous wire flow. First run defaults to ~/code (a common
  // convention; operator can edit before installing).
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(WORKSPACE_PARENT_KEY);
    if (stored) return stored;
  }
  return '~/code';
}

function projectSlug(name: string | undefined, contextGraphId: string): string {
  // The CG ID is `<address>/<slug>`; pick the slug part for a
  // human-friendly directory name. Fall back to a slugified project name.
  const parts = contextGraphId.split('/');
  const tail = parts[parts.length - 1] ?? '';
  if (tail) return tail;
  return (name ?? 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function expandTilde(p: string): string {
  // The browser can't expand ~ at the OS level, but the daemon will
  // refuse a path that doesn't start with / or a drive letter. We do
  // a best-effort expansion using HOME-equivalent placeholder text;
  // operators on macOS / Linux nearly always have $HOME = /Users/<name>
  // or /home/<name>, but the only safe assumption is that the user
  // edits the path themselves. We replace ~ with a literal `~/...`
  // and mark a warning if the path still starts with ~ when the
  // operator tries to install.
  return p;
}

export function WireWorkspacePanel({
  contextGraphId,
  projectName,
  defaultAgentSlug,
  onDone,
  onCancel,
  variant,
}: WireWorkspacePanelProps) {
  const slug = useMemo(() => projectSlug(projectName, contextGraphId), [projectName, contextGraphId]);
  const [workspaceRoot, setWorkspaceRoot] = useState(`${defaultParentDir()}/${slug}`);
  const [agentSlug, setAgentSlug] = useState(defaultAgentSlug ?? 'cursor-laptop');
  const [skipClaude, setSkipClaude] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planResult, setPlanResult] = useState<PlanInstallResult | null>(null);
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);

  useEffect(() => {
    setWorkspaceRoot(`${defaultParentDir()}/${slug}`);
  }, [slug]);

  function rememberParentDir(p: string) {
    const trimmed = p.trim();
    const lastSlash = trimmed.lastIndexOf('/');
    if (lastSlash > 0 && typeof window !== 'undefined') {
      window.localStorage.setItem(WORKSPACE_PARENT_KEY, trimmed.slice(0, lastSlash));
    }
  }

  async function handlePreview() {
    setBusy(true);
    setError(null);
    try {
      const expanded = expandTilde(workspaceRoot.trim());
      if (expanded.startsWith('~')) {
        throw new Error(
          'Workspace path starts with `~` — the daemon needs an absolute path. ' +
          'Replace `~` with your home directory (e.g. /Users/you/code/' + slug + ').',
        );
      }
      const result = await planProjectManifestInstall(contextGraphId, {
        workspaceRoot: expanded,
        agentSlug: agentSlug.trim(),
        skipClaude,
      });
      setPlanResult(result);
      rememberParentDir(expanded);
    } catch (err: any) {
      setError(err?.message || 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleInstall() {
    setBusy(true);
    setError(null);
    try {
      const expanded = expandTilde(workspaceRoot.trim());
      const result = await installProjectManifest(contextGraphId, {
        workspaceRoot: expanded,
        agentSlug: agentSlug.trim(),
        skipClaude,
      });
      setInstallResult(result);
    } catch (err: any) {
      setError(err?.message || 'Install failed');
    } finally {
      setBusy(false);
    }
  }

  // ── Installed state — success card ──
  if (installResult) {
    return (
      <div>
        <div style={{
          padding: '12px 14px', borderRadius: 8, marginBottom: 14, fontSize: 12,
          background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.25)',
          color: 'var(--accent-green)',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Workspace wired.</div>
          Open <code style={{ fontFamily: 'var(--font-mono)' }}>{workspaceRoot}</code> in Cursor.
          On the first chat turn, your agent will see the project ontology
          {variant === 'join' ? ', tasks, and decisions' : ' you publish via dkg_add_task'}.
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
          Files written:
        </div>
        <pre style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', maxHeight: 200, overflow: 'auto',
          padding: 10, borderRadius: 6, background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)', margin: 0,
        }}>
          {installResult.written.map((w) => `${w.action.padEnd(9)} ${w.absPath} (${w.bytesWritten.toLocaleString()} bytes)`).join('\n')}
          {installResult.warnings.length ? '\n\nWarnings:\n' + installResult.warnings.map((w) => `  - ${w}`).join('\n') : ''}
        </pre>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="v10-modal-btn primary" onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }

  // ── Previewed state — show the diff + install button ──
  if (planResult) {
    return (
      <div>
        {error && <div className="v10-modal-error" style={{ marginBottom: 12 }}>{error}</div>}

        <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--text-secondary)' }}>
          Review the install plan below. Files are written only when you click Install.
        </div>

        <pre style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', maxHeight: 320, overflow: 'auto',
          padding: 12, borderRadius: 6, background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)', margin: 0, whiteSpace: 'pre-wrap',
        }}>
          {planResult.markdown}
        </pre>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, gap: 10 }}>
          <button
            className="v10-modal-btn"
            onClick={() => { setPlanResult(null); setError(null); }}
            disabled={busy}
          >
            ← Back
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="v10-modal-btn" onClick={onDone} disabled={busy}>Skip for now</button>
            <button
              className="v10-modal-btn primary"
              onClick={handleInstall}
              disabled={busy}
            >
              {busy ? 'Installing…' : 'Install'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Input state — collect workspace path / agent slug / skip-claude ──
  return (
    <div>
      <div style={{
        padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 12,
        background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)',
        color: 'var(--accent-primary, #3b82f6)',
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {variant === 'create' ? 'Wire your local workspace' : 'Wire this project locally'}
        </div>
        {variant === 'create'
          ? 'Choose a directory for the new project. The daemon will populate it with the Cursor wiring (rule, hooks, AGENTS.md, .dkg/config.yaml) so you can open it in Cursor and start populating the plan.'
          : 'Choose a local directory for this project. The daemon will populate it with everything Cursor needs to participate. You will then open the folder in Cursor on this machine to collaborate.'}
      </div>

      {error && <div className="v10-modal-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="v10-form-group">
        <label className="v10-form-label">Workspace path</label>
        <input
          className="v10-form-input"
          type="text"
          value={workspaceRoot}
          onChange={(e) => setWorkspaceRoot(e.target.value)}
          placeholder="/Users/you/code/tic-tac-toe"
          spellCheck={false}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
          Absolute path. Created if it doesn't exist. The daemon writes only inside this dir
          (plus optionally <code>~/.claude/settings.json</code> if you opt in below).
        </div>
      </div>

      <div className="v10-form-group">
        <label className="v10-form-label">Agent slug for this machine</label>
        <input
          className="v10-form-input"
          type="text"
          value={agentSlug}
          onChange={(e) => setAgentSlug(e.target.value)}
          placeholder="cursor-laptop"
          spellCheck={false}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
          Drives <code>urn:dkg:agent:&lt;slug&gt;</code> attribution on every chat turn from this Cursor.
          Pick something descriptive like <code>cursor-branarakic-laptop1</code>.
        </div>
      </div>

      <div className="v10-form-group">
        <label className="v10-form-radio" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <input
            type="checkbox"
            checked={skipClaude}
            onChange={(e) => setSkipClaude(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            Skip Claude Code wiring
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
              Recommended unless you actively use Claude Code. Leaving this checked means
              the install won't touch <code>~/.claude/settings.json</code>.
            </div>
          </span>
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, gap: 10 }}>
        {onCancel
          ? <button className="v10-modal-btn" onClick={onCancel} disabled={busy}>Cancel</button>
          : <button className="v10-modal-btn" onClick={onDone} disabled={busy}>Skip for now</button>}
        <button
          className="v10-modal-btn primary"
          onClick={handlePreview}
          disabled={busy || !workspaceRoot.trim() || !agentSlug.trim()}
        >
          {busy ? 'Loading preview…' : 'Preview install'}
        </button>
      </div>
    </div>
  );
}
