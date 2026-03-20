import { createHash } from 'node:crypto';
import yaml from 'js-yaml';

export type CclFactTuple = [string, ...unknown[]];

export interface CclCanonicalPolicy {
  policy?: string;
  version?: string;
  rules?: Array<{
    name: string;
    params?: string[];
    all?: CclCondition[];
  }>;
  decisions?: Array<{
    name: string;
    params?: string[];
    all?: CclCondition[];
  }>;
}

export type CclCondition =
  | { atom: { pred: string; args?: unknown[] } }
  | { exists: { where?: CclCondition[] } }
  | { not_exists: { where?: CclCondition[] } }
  | { count_distinct: { vars?: string[]; where?: CclCondition[]; op: string; value: number } };

export interface CclEvaluationResult {
  derived: Record<string, unknown[][]>;
  decisions: Record<string, unknown[][]>;
}

type Binding = Record<string, unknown>;

function isVar(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('$');
}

function normalizeVarName(value: string): string {
  return value.startsWith('$') ? value : `$${value}`;
}

function tupleKey(tuple: unknown[]): string {
  return JSON.stringify(tuple);
}

function compareTuples(left: unknown[], right: unknown[]): number {
  return tupleKey(left).localeCompare(tupleKey(right));
}

export function parseCclPolicy(content: string): CclCanonicalPolicy {
  const parsed = yaml.load(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('CCL policy must be a YAML object');
  }
  return parsed as CclCanonicalPolicy;
}

export function hashCclFacts(facts: CclFactTuple[]): string {
  const normalized = facts.map(tuple => [...tuple]).sort(compareTuples);
  return `sha256:${createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`;
}

export class CclEvaluator {
  private readonly policy: CclCanonicalPolicy;
  private readonly relations = new Map<string, Map<string, unknown[]>>();

  constructor(policy: CclCanonicalPolicy, facts: CclFactTuple[]) {
    this.policy = policy;
    for (const row of facts) {
      const [pred, ...args] = row;
      this.getRelation(pred).set(tupleKey(args), args);
    }
  }

  run(): CclEvaluationResult {
    this.deriveFixpoint();
    const decisions = this.evaluateDecisions();
    const derived: Record<string, unknown[][]> = {};
    for (const rule of this.policy.rules ?? []) {
      derived[rule.name] = this.sortedTuples(this.getRelation(rule.name));
    }
    return { derived, decisions };
  }

  private deriveFixpoint(): void {
    const rules = this.policy.rules ?? [];
    for (let round = 0; round < 64; round += 1) {
      let changed = false;
      for (const rule of rules) {
        const relation = this.getRelation(rule.name);
        const before = relation.size;
        for (const tuple of this.evaluateRule(rule)) {
          relation.set(tupleKey(tuple), tuple);
        }
        if (relation.size !== before) changed = true;
      }
      if (!changed) return;
    }
    throw new Error('CCL fixpoint did not converge');
  }

  private evaluateRule(rule: NonNullable<CclCanonicalPolicy['rules']>[number]): unknown[][] {
    const params = (rule.params ?? []).map(normalizeVarName);
    const tuples = new Map<string, unknown[]>();
    for (const binding of this.evaluateConditions(rule.all ?? [], [{}])) {
      const head = params.map(param => binding[param]);
      tuples.set(tupleKey(head), head);
    }
    return [...tuples.values()].sort(compareTuples);
  }

  private evaluateDecisions(): Record<string, unknown[][]> {
    const decisions: Record<string, unknown[][]> = {};
    for (const decision of this.policy.decisions ?? []) {
      const params = (decision.params ?? []).map(normalizeVarName);
      const tuples = new Map<string, unknown[]>();
      for (const binding of this.evaluateConditions(decision.all ?? [], [{}])) {
        const head = params.map(param => binding[param]);
        tuples.set(tupleKey(head), head);
      }
      decisions[decision.name] = [...tuples.values()].sort(compareTuples);
    }
    return decisions;
  }

  private evaluateConditions(conditions: CclCondition[], bindings: Binding[]): Binding[] {
    let current = bindings;
    for (const condition of conditions) {
      const next: Binding[] = [];
      for (const binding of current) {
        next.push(...this.evaluateCondition(condition, binding));
      }
      current = next;
      if (current.length === 0) break;
    }
    return current;
  }

  private evaluateCondition(condition: CclCondition, binding: Binding): Binding[] {
    if ('atom' in condition) {
      return this.matchAtom(condition.atom.pred, condition.atom.args ?? [], binding);
    }
    if ('exists' in condition) {
      const matches = this.evaluateConditions(condition.exists.where ?? [], [{ ...binding }]);
      return matches.length > 0 ? [binding] : [];
    }
    if ('not_exists' in condition) {
      const matches = this.evaluateConditions(condition.not_exists.where ?? [], [{ ...binding }]);
      return matches.length === 0 ? [binding] : [];
    }
    if ('count_distinct' in condition) {
      const vars = (condition.count_distinct.vars ?? []).map(normalizeVarName);
      const matches = this.evaluateConditions(condition.count_distinct.where ?? [], [{ ...binding }]);
      const projection = new Set(matches.map(match => tupleKey(vars.map(variable => match[variable]))));
      return compareInts(projection.size, condition.count_distinct.op, Number(condition.count_distinct.value)) ? [binding] : [];
    }
    throw new Error(`Unsupported CCL condition: ${JSON.stringify(condition)}`);
  }

  private matchAtom(pred: string, args: unknown[], binding: Binding): Binding[] {
    const out: Binding[] = [];
    for (const tuple of this.sortedTuples(this.getRelation(pred))) {
      if (tuple.length !== args.length) continue;
      const candidate: Binding = { ...binding };
      let ok = true;
      for (let i = 0; i < args.length; i += 1) {
        const term = args[i];
        const value = tuple[i];
        if (isVar(term)) {
          if (Object.hasOwn(candidate, term)) {
            if (candidate[term] !== value) {
              ok = false;
              break;
            }
          } else {
            candidate[term] = value;
          }
        } else if (term !== value) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(candidate);
    }
    return out;
  }

  private getRelation(pred: string): Map<string, unknown[]> {
    let relation = this.relations.get(pred);
    if (!relation) {
      relation = new Map<string, unknown[]>();
      this.relations.set(pred, relation);
    }
    return relation;
  }

  private sortedTuples(relation: Map<string, unknown[]>): unknown[][] {
    return [...relation.values()].map(tuple => [...tuple]).sort(compareTuples);
  }
}

function compareInts(left: number, op: string, right: number): boolean {
  switch (op) {
    case '>=': return left >= right;
    case '>': return left > right;
    case '==': return left === right;
    case '<=': return left <= right;
    case '<': return left < right;
    default: throw new Error(`Unsupported CCL comparison operator: ${op}`);
  }
}
