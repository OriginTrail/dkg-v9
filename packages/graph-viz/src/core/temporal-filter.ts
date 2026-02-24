import type { GraphNode } from './types.js';
import type { GraphModel } from './graph-model.js';

/**
 * Configuration for temporal filtering.
 */
export interface TemporalConfig {
  /** Enable the temporal timeline. Default: false */
  enabled: boolean;
  /** Property short names to scan for dates (checked across known namespaces).
   *  Default: ['dateCreated'] */
  dateProperties?: string[];
  /** Whether to show nodes that have no date property. Default: true */
  showUndated?: boolean;
  /** Auto-play speed in ms per step. Default: 200 */
  playSpeed?: number;
  /** Step granularity for playback. Default: 'day' */
  stepSize?: 'hour' | 'day' | 'week' | 'month';
}

const KNOWN_DATE_NAMESPACES = [
  'https://schema.org/',
  'http://schema.org/',
  'https://guardiankg.org/vocab/',
  'https://umanitek.ai/dkg/vocab/',
  'http://umanitek.ai/dkg/vocab/',
  'http://www.w3.org/ns/prov#',
];

/**
 * Temporal filter: scans nodes for date properties, manages a progressive
 * time cursor, and returns the set of node IDs visible up to that cursor.
 *
 * Usage:
 *   filter.scan(model);
 *   filter.setCursor(someDate);
 *   const visible = filter.getVisibleNodeIds(); // nodes with date <= cursor
 */
export class TemporalFilter {
  private _nodeDates = new Map<string, Date>();
  private _dateRange: [Date, Date] | null = null;
  private _cursor: Date | null = null;
  private _dateProperties: string[];
  private _showUndated: boolean;

  constructor(config?: Partial<TemporalConfig>) {
    this._dateProperties = config?.dateProperties ?? ['dateCreated'];
    this._showUndated = config?.showUndated ?? true;
  }

  /** Scan all nodes in the model for date properties. Call after data ingestion. */
  scan(model: GraphModel): void {
    this._nodeDates.clear();

    let earliest: Date | null = null;
    let latest: Date | null = null;

    for (const [id, node] of model.nodes) {
      const date = this._extractDate(node);
      if (date) {
        this._nodeDates.set(id, date);
        if (!earliest || date < earliest) earliest = date;
        if (!latest || date > latest) latest = date;
      }
    }

    if (earliest && latest) {
      this._dateRange = [earliest, latest];
      // Default cursor: show everything
      this._cursor = latest;
    } else {
      this._dateRange = null;
      this._cursor = null;
    }
  }

  /** Get the global date range [earliest, latest], or null if no dates found. */
  get dateRange(): [Date, Date] | null {
    return this._dateRange;
  }

  /** Get the current cursor position. */
  get cursor(): Date | null {
    return this._cursor;
  }

  /** Number of nodes that have a date assigned. */
  get datedNodeCount(): number {
    return this._nodeDates.size;
  }

  /** Whether to show nodes without date properties. */
  get showUndated(): boolean {
    return this._showUndated;
  }

  set showUndated(value: boolean) {
    this._showUndated = value;
  }

  /** Set the cursor (cutoff date). Nodes with date <= cursor are visible. */
  setCursor(date: Date): void {
    this._cursor = date;
  }

  /** Get the date for a specific node, or null if undated. */
  getNodeDate(nodeId: string): Date | null {
    return this._nodeDates.get(nodeId) ?? null;
  }

  /**
   * Get the set of node IDs visible at the current cursor position.
   * - Dated nodes: visible if date <= cursor
   * - Undated nodes: visible if showUndated is true
   *
   * If no date range was found (no dated nodes), returns null
   * (meaning: don't filter, show everything).
   */
  getVisibleNodeIds(allNodeIds: Iterable<string>): Set<string> | null {
    if (!this._dateRange || !this._cursor) return null;

    const visible = new Set<string>();
    const cursor = this._cursor.getTime();

    for (const id of allNodeIds) {
      const date = this._nodeDates.get(id);
      if (date) {
        if (date.getTime() <= cursor) {
          visible.add(id);
        }
      } else if (this._showUndated) {
        visible.add(id);
      }
    }

    return visible;
  }

  /**
   * Compute histogram buckets for the date distribution.
   * Returns an array of { date: Date, count: number } entries.
   */
  computeHistogram(bucketCount: number = 50): Array<{ date: Date; count: number }> {
    if (!this._dateRange) return [];

    const [earliest, latest] = this._dateRange;
    const range = latest.getTime() - earliest.getTime();
    if (range <= 0) return [{ date: earliest, count: this._nodeDates.size }];

    const bucketSize = range / bucketCount;
    const buckets: Array<{ date: Date; count: number }> = [];

    for (let i = 0; i < bucketCount; i++) {
      buckets.push({
        date: new Date(earliest.getTime() + i * bucketSize),
        count: 0,
      });
    }

    for (const date of this._nodeDates.values()) {
      const idx = Math.min(
        Math.floor((date.getTime() - earliest.getTime()) / bucketSize),
        bucketCount - 1
      );
      buckets[idx].count++;
    }

    return buckets;
  }

  /** Extract the earliest date from a node's properties across known namespaces. */
  private _extractDate(node: GraphNode): Date | null {
    let earliest: Date | null = null;

    for (const shortName of this._dateProperties) {
      for (const ns of KNOWN_DATE_NAMESPACES) {
        const vals = node.properties?.get(ns + shortName);
        if (vals && vals.length > 0) {
          const d = new Date(vals[0].value);
          if (!isNaN(d.getTime())) {
            if (!earliest || d < earliest) earliest = d;
          }
        }
      }
    }

    return earliest;
  }
}
