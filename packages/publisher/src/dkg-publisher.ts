import type { Quad, TripleStore } from '@dkg/storage';
import type { ChainAdapter } from '@dkg/chain';
import type { EventBus } from '@dkg/core';
import { DKGEvent, ed25519Sign, type Ed25519Keypair } from '@dkg/core';
import { GraphManager, PrivateContentStore } from '@dkg/storage';
import type { Publisher, PublishOptions, PublishResult, KAManifestEntry } from './publisher.js';
import { autoPartition } from './auto-partition.js';
import { skolemize } from './skolemize.js';
import { computePublicRoot, computePrivateRoot, computeKARoot, computeKCRoot } from './merkle.js';
import { validatePublishRequest } from './validation.js';
import { generateKCMetadata, type KAMetadata } from './metadata.js';

export interface DKGPublisherConfig {
  store: TripleStore;
  chain: ChainAdapter;
  eventBus: EventBus;
  keypair: Ed25519Keypair;
}

export class DKGPublisher implements Publisher {
  private readonly store: TripleStore;
  private readonly chain: ChainAdapter;
  private readonly eventBus: EventBus;
  private readonly keypair: Ed25519Keypair;
  private readonly graphManager: GraphManager;
  private readonly privateStore: PrivateContentStore;
  private readonly ownedEntities = new Map<string, Set<string>>();

  constructor(config: DKGPublisherConfig) {
    this.store = config.store;
    this.chain = config.chain;
    this.eventBus = config.eventBus;
    this.keypair = config.keypair;
    this.graphManager = new GraphManager(config.store);
    this.privateStore = new PrivateContentStore(config.store, this.graphManager);
  }

  async publish(options: PublishOptions): Promise<PublishResult> {
    const { paranetId, quads, privateQuads = [] } = options;
    await this.graphManager.ensureParanet(paranetId);

    // Auto-partition public quads into KAs
    const kaMap = autoPartition(quads);

    // Build manifest entries with merkle roots
    const kaRoots: Uint8Array[] = [];
    const manifestEntries: KAManifestEntry[] = [];
    const kaMetadata: KAMetadata[] = [];

    let tokenCounter = 1n;
    for (const [rootEntity, publicQuads] of kaMap) {
      // Find private quads for this entity
      const entityPrivateQuads = privateQuads.filter(
        (q) => q.subject === rootEntity || q.subject.startsWith(rootEntity + '/.well-known/genid/'),
      );

      const pubRoot = computePublicRoot(publicQuads);
      const privRoot =
        entityPrivateQuads.length > 0
          ? computePrivateRoot(entityPrivateQuads)
          : undefined;

      const kaRoot = computeKARoot(pubRoot, privRoot);
      kaRoots.push(kaRoot);

      const entry: KAManifestEntry = {
        tokenId: tokenCounter,
        rootEntity,
        privateMerkleRoot: privRoot,
        privateTripleCount: entityPrivateQuads.length,
      };
      manifestEntries.push(entry);

      kaMetadata.push({
        rootEntity,
        kcUal: '', // filled after chain commit
        tokenId: tokenCounter,
        publicTripleCount: publicQuads.length,
        privateTripleCount: entityPrivateQuads.length,
        privateMerkleRoot: privRoot,
      });

      tokenCounter++;
    }

    // Validate against skolemized quads (not raw input)
    const allSkolemizedQuads = [...kaMap.values()].flat();
    const existing = this.ownedEntities.get(paranetId) ?? new Set();
    const validation = validatePublishRequest(allSkolemizedQuads, manifestEntries, paranetId, existing);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
    }

    // Compute KC-level merkle root
    const kcMerkleRoot = computeKCRoot(kaRoots);

    // Sign the merkle root
    const signature = await ed25519Sign(kcMerkleRoot, this.keypair.secretKey);

    // Commit to chain (mock in off-chain mode)
    const txResult = await this.chain.createKnowledgeCollection({
      merkleRoot: kcMerkleRoot,
      knowledgeAssetsCount: manifestEntries.length,
      signatures: [
        {
          identityId: 1n,
          r: signature.slice(0, 32),
          vs: signature.slice(32),
        },
      ],
    });

    if (!txResult.success) {
      throw new Error('Chain transaction failed');
    }

    const kcId = BigInt(txResult.blockNumber);
    const ual = `did:dkg:${this.chain.chainId}/${kcId}`;

    // Store skolemized public quads in the data graph
    const dataGraph = this.graphManager.dataGraphUri(paranetId);
    const normalizedQuads = allSkolemizedQuads.map((q) => ({ ...q, graph: dataGraph }));
    await this.store.insert(normalizedQuads);

    // Store private quads (publisher-only)
    for (const [rootEntity, publicQuads] of kaMap) {
      const entityPrivateQuads = privateQuads.filter(
        (q) => q.subject === rootEntity || q.subject.startsWith(rootEntity + '/.well-known/genid/'),
      );
      if (entityPrivateQuads.length > 0) {
        await this.privateStore.storePrivateTriples(paranetId, rootEntity, entityPrivateQuads);
      }
    }

    // Generate and store metadata
    for (const km of kaMetadata) {
      km.kcUal = ual;
    }
    const metadataQuads = generateKCMetadata(
      {
        ual,
        paranetId,
        merkleRoot: kcMerkleRoot,
        kaCount: manifestEntries.length,
        publisherPeerId: '',
        timestamp: new Date(),
      },
      kaMetadata,
    );
    await this.store.insert(metadataQuads);

    // Track owned entities for exclusivity
    if (!this.ownedEntities.has(paranetId)) {
      this.ownedEntities.set(paranetId, new Set());
    }
    for (const e of manifestEntries) {
      this.ownedEntities.get(paranetId)!.add(e.rootEntity);
    }

    const result: PublishResult = {
      kcId,
      merkleRoot: kcMerkleRoot,
      kaManifest: manifestEntries,
    };

    this.eventBus.emit(DKGEvent.KC_PUBLISHED, result);
    return result;
  }

  async update(kcId: bigint, options: PublishOptions): Promise<PublishResult> {
    // For updates: the root entities must already be owned by this publisher
    // Delete old triples, re-publish new ones
    const { paranetId, quads, privateQuads = [] } = options;
    const dataGraph = this.graphManager.dataGraphUri(paranetId);

    // Build new KA map
    const kaMap = autoPartition(quads);
    const kaRoots: Uint8Array[] = [];
    const manifestEntries: KAManifestEntry[] = [];

    let tokenCounter = 1n;
    for (const [rootEntity, publicQuads] of kaMap) {
      // Delete old triples for this entity
      await this.store.deleteBySubjectPrefix(dataGraph, rootEntity);
      await this.privateStore.deletePrivateTriples(paranetId, rootEntity);

      const entityPrivateQuads = privateQuads.filter(
        (q) => q.subject === rootEntity || q.subject.startsWith(rootEntity + '/.well-known/genid/'),
      );

      const pubRoot = computePublicRoot(publicQuads);
      const privRoot = entityPrivateQuads.length > 0 ? computePrivateRoot(entityPrivateQuads) : undefined;

      kaRoots.push(computeKARoot(pubRoot, privRoot));
      manifestEntries.push({
        tokenId: tokenCounter++,
        rootEntity,
        privateMerkleRoot: privRoot,
        privateTripleCount: entityPrivateQuads.length,
      });

      // Insert new public quads
      const normalized = publicQuads.map((q) => ({ ...q, graph: dataGraph }));
      await this.store.insert(normalized);

      // Insert new private quads
      if (entityPrivateQuads.length > 0) {
        await this.privateStore.storePrivateTriples(paranetId, rootEntity, entityPrivateQuads);
      }
    }

    const kcMerkleRoot = computeKCRoot(kaRoots);
    const signature = await ed25519Sign(kcMerkleRoot, this.keypair.secretKey);

    await this.chain.updateKnowledgeCollection({
      kcId,
      newMerkleRoot: kcMerkleRoot,
      signatures: [
        {
          identityId: 1n,
          r: signature.slice(0, 32),
          vs: signature.slice(32),
        },
      ],
    });

    const result: PublishResult = {
      kcId,
      merkleRoot: kcMerkleRoot,
      kaManifest: manifestEntries,
    };

    this.eventBus.emit(DKGEvent.KA_UPDATED, result);
    return result;
  }

  autoPartition(quads: Quad[]): KAManifestEntry[] {
    const kaMap = autoPartition(quads);
    let tokenId = 1n;
    return [...kaMap.keys()].map((rootEntity) => ({
      tokenId: tokenId++,
      rootEntity,
    }));
  }

  skolemize(rootEntity: string, quads: Quad[]): Quad[] {
    return skolemize(rootEntity, quads);
  }
}
