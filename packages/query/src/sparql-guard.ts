/**
 * SPARQL query safety guard.
 *
 * The DKG controls writes exclusively via the publish/update protocol.
 * All user-facing SPARQL must be read-only (SELECT, CONSTRUCT, ASK, DESCRIBE).
 * This module rejects any SPARQL that attempts mutation operations.
 */

import type { Quad } from '@origintrail-official/dkg-storage';
import { stripLiteralsAndComments } from './sparql-utils.js';
import type { QueryResult } from './query-engine.js';

const MUTATING_KEYWORDS = [
  'INSERT',
  'DELETE',
  'LOAD',
  'CLEAR',
  'DROP',
  'CREATE',
  'COPY',
  'MOVE',
  'ADD',
] as const;

const MUTATING_PATTERN = new RegExp(
  `\\b(${MUTATING_KEYWORDS.join('|')})\\b`,
  'i',
);

// Matches the query form keyword after optional PREFIX/BASE preamble
const READ_ONLY_FORMS = /^\s*(?:(?:PREFIX|BASE)\s+[^\n]*\n\s*)*(SELECT|CONSTRUCT|ASK|DESCRIBE)\b/i;

/** SPARQL query form — enough to shape a `QueryResult` correctly. */
export type SparqlQueryForm = 'SELECT' | 'CONSTRUCT' | 'ASK' | 'DESCRIBE' | 'UNKNOWN';

/**
 * PR #229 bot review round 17 (r17-2): classify a read-only SPARQL
 * query so callers can produce a result shape that MATCHES what the
 * query engine would return for a successful-but-empty execution of
 * the same form:
 *
 *   - SELECT  → `{ bindings: [] }`
 *   - ASK     → `{ bindings: [{ result: 'false' }] }` (the `dkg-query-engine`
 *               convention: ASK results surface through bindings so
 *               callers don't need a separate branch)
 *   - CONSTRUCT / DESCRIBE → `{ bindings: [], quads: [] }`
 *   - UNKNOWN → `{ bindings: [] }` (safe default; unreachable from
 *               inside `DKGAgent.query` because `validateReadOnlySparql`
 *               rejects anything that doesn't match a known form)
 *
 * This lets fail-closed branches (WM cross-agent auth denial, private-CG
 * leak guard, quota exceed, ...) emit a result indistinguishable from
 * an empty legitimate response, without breaking downstream callers
 * that branch on the presence of `quads`.
 */
export function detectSparqlQueryForm(sparql: string): SparqlQueryForm {
  const stripped = stripLiteralsAndComments(sparql);
  const m = READ_ONLY_FORMS.exec(stripped);
  if (!m) return 'UNKNOWN';
  const kw = m[1].toUpperCase();
  if (kw === 'SELECT' || kw === 'CONSTRUCT' || kw === 'ASK' || kw === 'DESCRIBE') {
    return kw;
  }
  return 'UNKNOWN';
}

/**
 * Shape of an empty `QueryResult`.
 *
 * Structural alias deliberately expressed with the `unknown`/`never`
 * quad element type so this module stays dependency-free of
 * `@origintrail-official/dkg-query`'s `Quad`. Callers treat the
 * returned object as a plain `QueryResult` — the `quads` array is
 * always `[]`.
 */
export interface EmptyQueryResultShape {
  bindings: Array<Record<string, string>>;
  quads?: unknown[];
}

/**
 * Build a shape-matched empty `QueryResult` for a given SPARQL form.
 *
 * Keep this logic colocated with `detectSparqlQueryForm` (same file)
 * so the shape contract is visibly enforced in one place — any future
 * change to `QueryResult` in `@origintrail-official/dkg-query` must
 * update both together.
 *
 * Returns a FRESH object on every call, so callers can safely mutate
 * it (append bindings on a subsequent fallthrough, e.g.) without
 * worrying about cross-call aliasing.
 */
export function emptyResultForForm(form: SparqlQueryForm): EmptyQueryResultShape {
  if (form === 'CONSTRUCT' || form === 'DESCRIBE') {
    return { bindings: [], quads: [] };
  }
  if (form === 'ASK') {
    return { bindings: [{ result: 'false' }] };
  }
  return { bindings: [] };
}

export interface SparqlGuardResult {
  safe: boolean;
  reason?: string;
}

/**
 * Validates that a SPARQL query is read-only.
 * Returns `{ safe: true }` for SELECT/CONSTRUCT/ASK/DESCRIBE.
 * Returns `{ safe: false, reason }` for anything that could mutate data.
 */
export function validateReadOnlySparql(sparql: string): SparqlGuardResult {
  const stripped = stripLiteralsAndComments(sparql);

  if (!READ_ONLY_FORMS.test(stripped)) {
    return {
      safe: false,
      reason: `Query must start with SELECT, CONSTRUCT, ASK, or DESCRIBE. ` +
        `Mutations must go through the publish/update protocol.`,
    };
  }

  const match = MUTATING_PATTERN.exec(stripped);
  if (match) {
    return {
      safe: false,
      reason: `Query contains mutating keyword "${match[1]}". ` +
        `Use the publish() or update() API to modify data.`,
    };
  }

  return { safe: true };
}

export type SparqlForm = 'SELECT' | 'CONSTRUCT' | 'ASK' | 'DESCRIBE';

/**
 * Classify the query form of a SPARQL string. Used by engines that need to
 * short-circuit a query (e.g. "no graphs resolved") while still returning a
 * result shape that matches the requested form — `QueryResult.bindings: []`
 * is not a valid ASK response (ASK must return a boolean binding) and is not
 * a valid CONSTRUCT/DESCRIBE response either (those must carry `quads: []`).
 */
export function classifySparqlForm(sparql: string): SparqlForm {
  const stripped = stripLiteralsAndComments(sparql);
  const match = READ_ONLY_FORMS.exec(stripped);
  const form = (match?.[1] ?? 'SELECT').toUpperCase();
  if (form === 'ASK' || form === 'CONSTRUCT' || form === 'DESCRIBE') {
    return form;
  }
  return 'SELECT';
}

/**
 * Produce an empty `QueryResult` that matches the requested query form.
 * Centralising this keeps every "nothing to query" short-circuit
 * (access-denied synthetic response, zero-graph resolution, etc.) aligned
 * on a single well-typed contract instead of returning `{ bindings: [] }`
 * for every form.
 */
export function emptyQueryResultForKind(sparql: string): QueryResult {
  const form = classifySparqlForm(sparql);
  if (form === 'ASK') {
    return { bindings: [{ result: 'false' }] };
  }
  if (form === 'CONSTRUCT' || form === 'DESCRIBE') {
    return { bindings: [], quads: [] as Quad[] };
  }
  return { bindings: [] };
}

