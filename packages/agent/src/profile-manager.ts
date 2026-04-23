import type { Publisher, PublishOptions, PublishResult } from '@origintrail-official/dkg-publisher';
import type { TripleStore } from '@origintrail-official/dkg-storage';
import { paranetDataGraphUri } from '@origintrail-official/dkg-core';
import {
  buildAgentProfile,
  canonicalAgentDidSubject,
  AGENT_REGISTRY_CONTEXT_GRAPH,
  type AgentProfileConfig,
} from './profile.js';

/**
 * Manages publishing and updating agent profiles as Knowledge Assets
 * in the Agent Registry context graph.
 */
export class ProfileManager {
  private readonly publisher: Publisher;
  private readonly store: TripleStore;
  private currentKcId: bigint | null = null;
  /**
   * Root entity URI used by the most recent publish. Persisted across
   * republishes so an upgraded node cleans up the previous subject
   * (e.g. a legacy `did:dkg:agent:<peerId>` profile) alongside the new
   * one, rather than leaving orphan triples in the data graph.
   */
  private lastRootEntity: string | null = null;

  constructor(publisher: Publisher, store: TripleStore) {
    this.publisher = publisher;
    this.store = store;
  }

  async publishProfile(config: AgentProfileConfig): Promise<PublishResult> {
    const { quads, rootEntity } = buildAgentProfile(config);

    // A-12 review: upgraded nodes that previously published
    // `did:dkg:agent:<peerId>` must drop the legacy subject alongside
    // the new EVM-form subject, otherwise discovery returns the same
    // node twice and the local data graph no longer matches the
    // updated manifest. We clean up three possible prior roots:
    //   1. the remembered `lastRootEntity` (most precise — covers the
    //      "user rotated their wallet address" case);
    //   2. the legacy peer-id-form subject (always present on nodes
    //      that published under v9/v10-rc before A-12);
    //   3. the address-form subject for the current wallet (handles
    //      the case where the address shape stayed the same but the
    //      casing or payload changed between publishes).
    const dataGraph = paranetDataGraphUri(AGENT_REGISTRY_CONTEXT_GRAPH);
    const prefixesToClean = new Set<string>();
    if (this.lastRootEntity) prefixesToClean.add(this.lastRootEntity);
    prefixesToClean.add(`did:dkg:agent:${config.peerId}`);
    if (config.agentAddress) {
      prefixesToClean.add(
        `did:dkg:agent:${canonicalAgentDidSubject(config.agentAddress)}`,
      );
    }
    prefixesToClean.add(rootEntity);
    for (const prefix of prefixesToClean) {
      await this.store.deleteBySubjectPrefix(dataGraph, prefix);
    }

    const options: PublishOptions = {
      contextGraphId: AGENT_REGISTRY_CONTEXT_GRAPH,
      quads,
    };

    if (this.currentKcId) {
      const result = await this.publisher.update(this.currentKcId, options);
      this.currentKcId = result.kcId;
      this.lastRootEntity = rootEntity;
      return result;
    }

    const result = await this.publisher.publish(options);
    this.currentKcId = result.kcId;
    this.lastRootEntity = rootEntity;
    return result;
  }

  get profileKcId(): bigint | null {
    return this.currentKcId;
  }
}
