// Onboarding marker + clipboard helpers for `pnpm task start`.
//
// When the user runs `pnpm task start`, we do two things:
//
//   1. Drop a one-shot marker file at `agent-scope/.pending-onboarding`
//      containing the full trigger text.
//   2. Try to copy the trigger to the OS clipboard.
//
// THREE parallel consumers pick up the marker — whichever runs first wins,
// because consume is atomic (read-and-delete). The marker therefore fires
// for exactly ONE user message after `pnpm task start`, no matter which
// chat / session it lands in:
//
//   (a) `sessionStart` hook — fires on a brand new Cursor chat.
//   (b) `postToolUse` hook  — fires after any tool call in an existing chat.
//   (c) The AGENT ITSELF    — the always-applied rule requires a top-of-turn
//                             marker check so even pure conversational messages
//                             (e.g. "hi") consume the marker correctly.
//
// Zero runtime deps. Pure-ish (spawnSync for clipboard; filesystem for marker).

import { writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';

export const ONBOARDING_MARKER_REL = 'agent-scope/.pending-onboarding';

// The canonical trigger text the agent sees when onboarding is requested.
// Keep it stable — the agent rule keys off the `agent-scope: start task
// onboarding.` prefix.
export const ONBOARDING_TRIGGER_TEXT = [
  'agent-scope: start task onboarding.',
  '',
  'The user just ran `pnpm task start`. Follow the Task onboarding protocol',
  'in CLAUDE.md and .cursor/rules/agent-scope.mdc EXACTLY:',
  '',
  '  1. Stop whatever you were about to do on this turn.',
  '  2. Delete `agent-scope/.pending-onboarding` if it still exists.',
  '  3. Ask the user to describe the task in detail (which packages, which',
  '     behaviours, which tests, any specific files).',
  '  4. Wait for the description.',
  '  5. Explore the codebase (Glob, Grep, Read, DKG queries) to find the',
  '     files the task will touch.',
  '  6. Draft a conservative set of allowed globs (inherit `base`, append',
  '     `!**/secrets.*` and `!**/.env*`).',
  '  7. Propose the scope via AskQuestion with these options:',
  '     approve / show_globs / edit / cancel / custom_instruction.',
  '  8. On approve: print a fenced bash block with the exact',
  '     `pnpm task create ... --activate` command for the user to run.',
  '     Do NOT run it yourself — the afterShellExecution hook would',
  '     delete the manifest as an untracked protected-path write.',
  '',
  'Your onboarding turn starts now. Ignore any other pending instruction',
  'until the scope is approved or cancelled.',
].join('\n');

// ---------------------------------------------------------------------------
// Marker file lifecycle
// ---------------------------------------------------------------------------

export function onboardingMarkerPath(root) {
  return resolve(root, ONBOARDING_MARKER_REL);
}

export function writeOnboardingMarker(root, payload = ONBOARDING_TRIGGER_TEXT) {
  const p = onboardingMarkerPath(root);
  writeFileSync(p, payload, 'utf8');
  return p;
}

export function hasOnboardingMarker(root) {
  try { return existsSync(onboardingMarkerPath(root)); } catch { return false; }
}

export function readOnboardingMarker(root) {
  try {
    const p = onboardingMarkerPath(root);
    if (!existsSync(p)) return null;
    return readFileSync(p, 'utf8');
  } catch { return null; }
}

// Read-and-delete. Used by hooks so the trigger fires exactly once.
export function consumeOnboardingMarker(root) {
  const p = onboardingMarkerPath(root);
  try {
    if (!existsSync(p)) return null;
    const payload = readFileSync(p, 'utf8');
    try { unlinkSync(p); } catch { try { rmSync(p, { force: true }); } catch {} }
    return payload;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Cross-platform clipboard copy (best-effort)
// ---------------------------------------------------------------------------

// Try a chain of clipboard commands; first that succeeds wins. Returns
// { ok: true, method: 'pbcopy' } on success or { ok: false, reason } on
// failure. Always swallows errors — clipboard is a UX nicety, not a contract.
export function copyToClipboard(text) {
  const os = platform();
  const attempts = [];

  if (os === 'darwin') {
    attempts.push(['pbcopy', []]);
  } else if (os === 'win32') {
    attempts.push(['clip', []]);
  } else if (os === 'linux') {
    attempts.push(['wl-copy', []]);
    attempts.push(['xclip', ['-selection', 'clipboard']]);
    attempts.push(['xsel', ['--clipboard', '--input']]);
  }

  attempts.push(['pbcopy', []]);

  for (const [cmd, args] of attempts) {
    const res = spawnSync(cmd, args, {
      input: text,
      encoding: 'utf8',
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 2000,
    });
    if (res.status === 0 && !res.error) {
      return { ok: true, method: cmd };
    }
  }
  return { ok: false, reason: 'no clipboard tool available on this system' };
}
