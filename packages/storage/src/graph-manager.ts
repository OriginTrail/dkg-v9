import type { TripleStore } from './triple-store.js';
import {
  paranetDataGraphUri,
  paranetMetaGraphUri,
} from '@dkg/core';

export class GraphManager {
  private readonly store: TripleStore;

  constructor(store: TripleStore) {
    this.store = store;
  }

  dataGraphUri(paranetId: string): string {
    return paranetDataGraphUri(paranetId);
  }

  metaGraphUri(paranetId: string): string {
    return paranetMetaGraphUri(paranetId);
  }

  async ensureParanet(paranetId: string): Promise<void> {
    await this.store.createGraph(this.dataGraphUri(paranetId));
    await this.store.createGraph(this.metaGraphUri(paranetId));
  }

  async listParanets(): Promise<string[]> {
    const graphs = await this.store.listGraphs();
    const paranets = new Set<string>();
    const prefix = 'did:dkg:paranet:';
    for (const g of graphs) {
      if (g.startsWith(prefix)) {
        const rest = g.slice(prefix.length);
        const id = rest.endsWith('/_meta')
          ? rest.slice(0, -6)
          : rest;
        paranets.add(id);
      }
    }
    return [...paranets];
  }

  async hasParanet(paranetId: string): Promise<boolean> {
    return this.store.hasGraph(this.dataGraphUri(paranetId));
  }

  async dropParanet(paranetId: string): Promise<void> {
    await this.store.dropGraph(this.dataGraphUri(paranetId));
    await this.store.dropGraph(this.metaGraphUri(paranetId));
  }
}
