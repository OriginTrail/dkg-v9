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
  publisherIdentityId?: bigint;
}

export class DKGPublisher implements Publisher {
  private readonly store: TripleStore;
  private readonly chain: ChainAdapter;
  private readonly eventBus: EventBus;
  private readonly keypair: Ed25519Keypair;
  private readonly graphManager: GraphManager;
  private readonly privateStore: PrivateContentStore;
  private readonly ownedEntities = new Map<string, Set<string>>();
  private publisherIdentityId: bigint;

  constructor(config: DKGPublisherConfig) {
    this.store = config.store;
    this.chain = config.chain;
    this.eventBus = config.eventBus;
    this.keypair = config.keypair;
    this.publisherIdentityId = config.publisherIdentityId ?? 1n;
    this.graphManager = new GraphManager(config.store);
    this.privateStore = new PrivateContentStore(config.store, this.graphManager);
  }

  async publish(options: PublishOptions): Promise<PublishResult> {
    const { paranetId, quads, privateQuads = [] } = options;
    await this.graphManager.ensureParanet(paranetId);

    const kaMap = autoPartition(quads);

    const kaRoots: Uint8Array[] = [];
    const manifestEntries: KAManifestEntry[] = [];
    const kaMetadata: KAMetadata[] = [];

    let tokenCounter = 1n;
    for (const [rootEntity, publicQuads] of kaMap) {
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
        kcUal: '',
        tokenId: tokenCounter,
        publicTripleCount: publicQuads.length,
        privateTripleCount: entityPrivateQuads.length,
        privateMerkleRoot: privRoot,
      });

      tokenCounter++;
    }

    const allSkolemizedQuads = [...kaMap.values()].flat();
    const existing = this.ownedEntities.get(paranetId) ?? new Set();
    const validation = validatePublishRequest(allSkolemizedQuads, manifestEntries, paranetId, existing);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
    }

    const kcMerkleRoot = computeKCRoot(kaRoots);
    const signature = await ed25519Sign(kcMerkleRoot, this.keypair.secretKey);

    // Reserve UAL range and batch-mint via V9 flow
    const kaCount = manifestEntries.length;
    const range = await this.chain.reserveUALRange(this.publisherIdentityId, kaCount);

    const mintResult = await this.chain.batchMintKnowledgeAssets({
      publisherIdentityId: this.publisherIdentityId,
      merkleRoot: kcMerkleRoot,
      startKAId: range.startId,
      endKAId: range.endId,
      publicByteSize: BigInt(allSkolemizedQuads.length * 100), // estimate
      epochs: 1,
      tokenAmount: 0n, // mock adapter doesn't validate
      publisherSignature: {
        r: signature.slice(0, 32),
        vs: signature.slice(32),
      },
      receiverSignatures: [
        {
          identityId: this.publisherIdentityId,
          r: signature.slice(0, 32),
          vs: signature.slice(32),
        },
      ],
    });

    if (!mintResult.success) {
      throw new Error('Chain transaction failed');
    }

    const batchId = mintResult.batchId;
    // V9 UAL: did:dkg:{chainId}/{publisherIdentityId}/{firstKAId}
    const ual = `did:dkg:${this.chain.chainId}/${this.publisherIdentityId}/${range.startId}`;

    // Store skolemized public quads
    const dataGraph = this.graphManager.dataGraphUri(paranetId);
    const normalizedQuads = allSkolemizedQuads.map((q) => ({ ...q, graph: dataGraph }));
    await this.store.insert(normalizedQuads);

    // Store private quads
    for (const [rootEntity] of kaMap) {
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

    // Track owned entities
    if (!this.ownedEntities.has(paranetId)) {
      this.ownedEntities.set(paranetId, new Set());
    }
    for (const e of manifestEntries) {
      this.ownedEntities.get(paranetId)!.add(e.rootEntity);
    }

    const result: PublishResult = {
      kcId: batchId,
      merkleRoot: kcMerkleRoot,
      kaManifest: manifestEntries,
    };

    this.eventBus.emit(DKGEvent.KC_PUBLISHED, result);
    return result;
  }

  async update(kcId: bigint, options: PublishOptions): Promise<PublishResult> {
    const { paranetId, quads, privateQuads = [] } = options;
    const dataGraph = this.graphManager.dataGraphUri(paranetId);

    const kaMap = autoPartition(quads);
    const kaRoots: Uint8Array[] = [];
    const manifestEntries: KAManifestEntry[] = [];

    let tokenCounter = 1n;
    for (const [rootEntity, publicQuads] of kaMap) {
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

      const normalized = publicQuads.map((q) => ({ ...q, graph: dataGraph }));
      await this.store.insert(normalized);

      if (entityPrivateQuads.length > 0) {
        await this.privateStore.storePrivateTriples(paranetId, rootEntity, entityPrivateQuads);
      }
    }

    const kcMerkleRoot = computeKCRoot(kaRoots);

    // V9 update: submit new merkle root for existing batch
    const allSkolemizedQuads = [...kaMap.values()].flat();
    await this.chain.updateKnowledgeAssets({
      batchId: kcId,
      newMerkleRoot: kcMerkleRoot,
      newPublicByteSize: BigInt(allSkolemizedQuads.length * 100),
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
