// Append-only JSONL audit log + optional webhook sink.
// Safe to call from any hook; failure is silent (audit loss > blocking work).

import {
  appendFileSync, mkdirSync, existsSync, statSync, renameSync, readdirSync, unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';

// Roll over at 5MB and keep up to MAX_ROTATIONS old files.
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROTATIONS = 5;

function rotateIfNeeded(file) {
  try {
    if (!existsSync(file)) return;
    const { size } = statSync(file);
    if (size < MAX_BYTES) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    renameSync(file, `${file}.${ts}`);
    pruneOldRotations(file);
  } catch { /* noop */ }
}

function pruneOldRotations(file) {
  try {
    const dir = resolve(file, '..');
    const base = file.split('/').pop();
    const rotations = readdirSync(dir)
      .filter(f => f.startsWith(base + '.'))
      .map(f => ({ f, full: resolve(dir, f) }))
      .sort((a, b) => a.f.localeCompare(b.f));
    while (rotations.length > MAX_ROTATIONS) {
      const { full } = rotations.shift();
      unlinkSync(full);
    }
  } catch { /* noop */ }
}

function writeLine(root, bucket, record) {
  try {
    const dir = resolve(root, 'agent-scope/logs');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${bucket}.jsonl`);
    rotateIfNeeded(file);
    const line = JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n';
    appendFileSync(file, line, 'utf8');
  } catch { /* never let logging break the hook */ }
}

export function logDenial(root, record) {
  writeLine(root, 'denials', record);
  postWebhook('denial', record);
}

export function logDecision(root, record) {
  writeLine(root, 'decisions', record);
}

// ---------------------------------------------------------------------------
// Optional webhook sink. Activated when AGENT_SCOPE_WEBHOOK is set to an
// http(s) URL. POSTs the event as JSON (fire-and-forget, 1500 ms timeout).
// The receiver can forward into the DKG, Slack, a log aggregator, etc.
// ---------------------------------------------------------------------------

function postWebhook(event, record) {
  const url = process.env.AGENT_SCOPE_WEBHOOK;
  if (!url || !/^https?:\/\//.test(url)) return;
  if (typeof globalThis.fetch !== 'function') return; // Node < 18

  const body = JSON.stringify({
    event,
    repo: process.env.AGENT_SCOPE_REPO || null,
    host: process.env.HOSTNAME || null,
    user: process.env.USER || null,
    ts: new Date().toISOString(),
    ...record,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    globalThis.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    }).then(() => clearTimeout(timeout)).catch(() => clearTimeout(timeout));
  } catch { /* noop */ }
}
