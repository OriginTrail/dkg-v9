// `pnpm task check-agent` — verify agent-scope is wired up correctly for
// each supported agent on this machine. Pure data; presentation is in
// agent-scope/bin/task.mjs.
//
// This is the post-`git pull` sanity command. Coworkers run it, see a
// per-agent green/yellow/red, and know what (if anything) they need to do.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// One descriptor per agent. Each .check() returns { status, details } where
// status is 'ok' | 'warn' | 'missing' | 'partial'. Soft-rule-only agents
// always return 'partial' to make it clear they have no hard enforcement.
//
//   ok       → fully wired up; hard enforcement on
//   partial  → instruction file present; agent must self-enforce
//   warn     → wired up but something is questionable (e.g. hook not +x)
//   missing  → not configured at all
//
// We never return 'fail' because a missing agent is the normal state for
// users who don't use that agent. The CLI only exits non-zero if the
// active task can't be loaded.

export function detectAgents(root) {
  return [
    cursorAgent(root),
    claudeCodeAgent(root),
    codexAgent(root),
    geminiAgent(root),
    legacyAgent(root),
  ];
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

function cursorAgent(root) {
  const out = {
    name: 'Cursor',
    enforcement: 'hard hooks',
    status: 'missing',
    details: [],
    setup: [],
  };

  const settings = resolve(root, '.cursor/hooks.json');
  const rule     = resolve(root, '.cursor/rules/agent-scope.mdc');
  const hooksDir = resolve(root, '.cursor/hooks');

  if (!existsSync(settings)) {
    out.details.push('  ✗ .cursor/hooks.json not found');
    out.setup.push('  • Pull the latest commit — .cursor/hooks.json should be tracked.');
    return out;
  }

  out.status = 'ok';
  out.details.push('  ✓ .cursor/hooks.json present');

  const requiredHooks = [
    'session-start.mjs',
    'scope-guard.mjs',
    'shell-precheck.mjs',
    'shell-diff-check.mjs',
    'post-tool-use.mjs',
  ];
  for (const f of requiredHooks) {
    const p = resolve(hooksDir, f);
    if (!existsSync(p)) {
      out.details.push(`  ✗ .cursor/hooks/${f} missing`);
      out.status = 'warn';
      out.setup.push(`  • Pull the latest commit — .cursor/hooks/${f} should be tracked.`);
      continue;
    }
    if (!isExecutable(p)) {
      out.details.push(`  ! .cursor/hooks/${f} not executable`);
      out.status = 'warn';
      out.setup.push(`  • Run: chmod +x .cursor/hooks/${f}`);
      continue;
    }
    out.details.push(`  ✓ .cursor/hooks/${f} executable`);
  }

  if (existsSync(rule)) out.details.push('  ✓ .cursor/rules/agent-scope.mdc present');
  else {
    out.details.push('  ! .cursor/rules/agent-scope.mdc missing — agent will lack onboarding protocol');
    out.status = out.status === 'ok' ? 'warn' : out.status;
    out.setup.push('  • Pull the latest commit — .cursor/rules/agent-scope.mdc should be tracked.');
  }

  if (out.status === 'ok') {
    out.setup.push('  Nothing to do. Cursor will load hooks automatically next time you open the repo.');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

function claudeCodeAgent(root) {
  const out = {
    name: 'Claude Code',
    enforcement: 'hard hooks',
    status: 'missing',
    details: [],
    setup: [],
  };

  const settings = resolve(root, '.claude/settings.json');
  const claudeMd = resolve(root, 'CLAUDE.md');
  const hooksDir = resolve(root, '.claude/hooks');

  if (!existsSync(settings)) {
    out.details.push('  ✗ .claude/settings.json not found');
    out.setup.push('  • Pull the latest commit — .claude/settings.json should be tracked.');
    return out;
  }

  out.status = 'ok';
  out.details.push('  ✓ .claude/settings.json present');

  const requiredHooks = [
    'session-start.mjs',
    'scope-guard.mjs',
    'shell-precheck.mjs',
    'shell-diff-check.mjs',
    'post-tool-use.mjs',
    'user-prompt-submit.mjs',
  ];
  for (const f of requiredHooks) {
    const p = resolve(hooksDir, f);
    if (!existsSync(p)) {
      out.details.push(`  ✗ .claude/hooks/${f} missing`);
      out.status = 'warn';
      out.setup.push(`  • Pull the latest commit — .claude/hooks/${f} should be tracked.`);
      continue;
    }
    if (!isExecutable(p)) {
      out.details.push(`  ! .claude/hooks/${f} not executable`);
      out.status = 'warn';
      out.setup.push(`  • Run: chmod +x .claude/hooks/${f}`);
      continue;
    }
    out.details.push(`  ✓ .claude/hooks/${f} executable`);
  }

  if (existsSync(claudeMd)) out.details.push('  ✓ CLAUDE.md present');
  else {
    out.details.push('  ! CLAUDE.md missing — agent will lack onboarding protocol');
    out.status = out.status === 'ok' ? 'warn' : out.status;
  }

  if (out.status === 'ok') {
    out.setup.push('  Nothing to do for hooks. Claude Code will load .claude/settings.json automatically.');
    out.setup.push('  First-run note: Claude Code will prompt you to TRUST the project hooks the first');
    out.setup.push('  time you open this repo. Approve them — that\'s how the enforcement attaches.');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Codex CLI (OpenAI)
// ---------------------------------------------------------------------------

function codexAgent(root) {
  const out = {
    name: 'Codex CLI',
    enforcement: 'soft (no hook system available)',
    status: 'missing',
    details: [],
    setup: [],
  };

  const agentsMd = resolve(root, 'AGENTS.md');
  if (!existsSync(agentsMd)) {
    out.details.push('  ✗ AGENTS.md not found');
    out.setup.push('  • Pull the latest commit — AGENTS.md should be tracked.');
    return out;
  }

  out.status = 'partial';
  out.details.push('  ✓ AGENTS.md present (Codex CLI reads this on every session)');
  out.details.push('  ! No hook system available in Codex CLI — agent self-enforces only.');
  out.details.push('  ! Hard blocks (preventing protected-file writes) DO NOT apply here.');
  out.setup.push('  Nothing to install. Codex CLI will read AGENTS.md automatically.');
  out.setup.push('  Caveat: rule compliance is by convention, not by enforcement.');
  return out;
}

// ---------------------------------------------------------------------------
// Gemini CLI
// ---------------------------------------------------------------------------

function geminiAgent(root) {
  const out = {
    name: 'Gemini CLI',
    enforcement: 'soft (no hook system available)',
    status: 'missing',
    details: [],
    setup: [],
  };

  const geminiMd = resolve(root, 'GEMINI.md');
  if (!existsSync(geminiMd)) {
    out.details.push('  ✗ GEMINI.md not found');
    out.setup.push('  • Pull the latest commit — GEMINI.md should be tracked.');
    return out;
  }

  out.status = 'partial';
  out.details.push('  ✓ GEMINI.md present');
  out.details.push('  ! No hook system available — Gemini self-enforces only.');
  out.setup.push('  Nothing to install. Gemini CLI will read GEMINI.md automatically.');
  return out;
}

// ---------------------------------------------------------------------------
// Legacy / generic VS Code AI extensions (Continue, Cline, etc.)
// ---------------------------------------------------------------------------

function legacyAgent(root) {
  const out = {
    name: 'Continue / Cline / older Cursor',
    enforcement: 'soft (varies by extension)',
    status: 'missing',
    details: [],
    setup: [],
  };

  const cursorrules = resolve(root, '.cursorrules');
  if (!existsSync(cursorrules)) {
    out.details.push('  ✗ .cursorrules not found');
    out.setup.push('  • Pull the latest commit — .cursorrules should be tracked.');
    return out;
  }

  out.status = 'partial';
  out.details.push('  ✓ .cursorrules present (legacy fallback rule file)');
  out.details.push('  ! Coverage varies by extension; treat as best-effort soft enforcement.');
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isExecutable(p) {
  try {
    const m = statSync(p).mode;
    // owner / group / other execute bits
    return Boolean(m & 0o111);
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Aggregate

export function statusGlyph(s) {
  switch (s) {
    case 'ok':      return '[✓ active]';
    case 'partial': return '[~ soft]';
    case 'warn':    return '[! check]';
    case 'missing': return '[· not set up]';
    default:        return '[?]';
  }
}

export function summary(results) {
  const counts = { ok: 0, partial: 0, warn: 0, missing: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}
