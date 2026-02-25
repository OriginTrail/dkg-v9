import type { Quad, TripleStore } from '@dkg/storage';
import type { ChainAdapter, OnChainPublishResult } from '@dkg/chain';
import type { EventBus, OperationContext } from '@dkg/core';
import { DKGEvent, ed25519Sign, Logger, createOperationContext, sha256, MerkleTree, type Ed25519Keypair } from '@dkg/core';
import { GraphManager, PrivateContentStore } from '@dkg/storage';
import type { Publisher, PublishOptions, PublishResult, KAManifestEntry } from './publisher.js';
import { autoPartition } from './auto-partition.js';
import { skolemize } from './skolemize.js';
import { computeTripleHash, computePublicRoot, computePrivateRoot, computeKARoot, computeKCRoot } from './merkle.js';
import { validatePublishRequest } from './validation.js';
import {
  generateTentativeMetadata,
  generateConfirmedFullMetadata,
  type KAMetadata,
} from './metadata.js';
import { ethers } from 'ethers';

export interface DKGPublisherConfig {
  store: TripleStore;
  chain: ChainAdapter;
  eventBus: EventBus;
  keypair: Ed25519Keypair;
  publisherNodeIdentityId?: bigint;
  publisherAddress?: string;
  /** EVM private key for signing publish requests (hex string with 0x prefix) */
  publisherPrivateKey?: string;
}

export class DKGPublisher implements Publisher {
  private readonly store: TripleStore;
  private readonly chain: ChainAdapter;
  private readonly eventBus: EventBus;
  private readonly keypair: Ed25519Keypair;
  private readonly graphManager: GraphManager;
  private readonly privateStore: PrivateContentStore;
  private readonly ownedEntities = new Map<string, Set<string>>();
  private readonly publisherNodeIdentityId: bigint;
  private readonly publisherAddress: string;
  private readonly publisherWallet?: ethers.Wallet;
  private readonly log = new Logger('DKGPublisher');

  constructor(config: DKGPublisherConfig) {
    this.store = config.store;
    this.chain = config.chain;
    this.eventBus = config.eventBus;
    this.keypair = config.keypair;
    this.publisherNodeIdentityId = config.publisherNodeIdentityId ?? 1n;

    if (config.publisherPrivateKey) {
      this.publisherWallet = new ethers.Wallet(config.publisherPrivateKey);
      this.publisherAddress = this.publisherWallet.address;
    } else {
      this.publisherAddress = config.publisherAddress ?? '0x' + '0'.repeat(40);
    }

    this.graphManager = new GraphManager(config.store);
    this.privateStore = new PrivateContentStore(config.store, this.graphManager);
  }

  async publish(options: PublishOptions): Promise<PublishResult> {
    const { paranetId, quads, privateQuads = [], operationCtx, entityProofs = false } = options;
    const ctx: OperationContext = operationCtx ?? createOperationContext('publish');

    this.log.info(ctx, `Preparing publish: ${quads.length} public triples, ${privateQuads.length} private (entityProofs=${entityProofs})`);
    await this.graphManager.ensureParanet(paranetId);

    const kaMap = autoPartition(quads);

    const manifestEntries: KAManifestEntry[] = [];
    const kaMetadata: KAMetadata[] = [];

    // Step 1: Compute privateMerkleRoot over ALL private triples
    let privateMerkleRoot: Uint8Array | undefined;
    if (privateQuads.length > 0) {
      privateMerkleRoot = computePrivateRoot(privateQuads);
    }

    // Step 2: Build manifest entries (needed regardless of merkle mode)
    let tokenCounter = 1n;
    for (const [rootEntity, publicQuads] of kaMap) {
      const entityPrivateQuads = privateQuads.filter(
        (q) => q.subject === rootEntity || q.subject.startsWith(rootEntity + '/.well-known/genid/'),
      );

      manifestEntries.push({
        tokenId: tokenCounter,
        rootEntity,
        privateMerkleRoot: entityPrivateQuads.length > 0
          ? computePrivateRoot(entityPrivateQuads)
          : undefined,
        privateTripleCount: entityPrivateQuads.length,
      });

      kaMetadata.push({
        rootEntity,
        kcUal: '',
        tokenId: tokenCounter,
        publicTripleCount: publicQuads.length,
        privateTripleCount: entityPrivateQuads.length,
        privateMerkleRoot: entityPrivateQuads.length > 0
          ? computePrivateRoot(entityPrivateQuads)
          : undefined,
      });

      tokenCounter++;
    }

    const allSkolemizedQuads = [...kaMap.values()].flat();
    const existing = this.ownedEntities.get(paranetId) ?? new Set();
    const validation = validatePublishRequest(allSkolemizedQuads, manifestEntries, paranetId, existing);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
    }

    // Step 3: Compute kcMerkleRoot using the two-level scheme
    let kcMerkleRoot: Uint8Array;
    const allPublicHashes = allSkolemizedQuads.map(computeTripleHash);

    if (privateMerkleRoot) {
      // Anchor privateMerkleRoot as a synthetic public triple hash
      const syntheticTripleHash = computeTripleHash({
        subject: `urn:dkg:kc`,
        predicate: 'http://dkg.io/ontology/privateContentRoot',
        object: `"0x${Buffer.from(privateMerkleRoot).toString('hex')}"`,
        graph: '',
      });
      allPublicHashes.push(syntheticTripleHash);
    }

    if (entityProofs) {
      // Per-entity kaRoots → Merkle tree
      const kaRoots: Uint8Array[] = [];
      for (const [rootEntity, publicQuads] of kaMap) {
        const pubRoot = computePublicRoot(publicQuads);
        kaRoots.push(pubRoot ?? new Uint8Array(32));
      }
      kcMerkleRoot = computeKCRoot(kaRoots);
      this.log.info(ctx, `Computed kcMerkleRoot (entityProofs) for ${kaRoots.length} KAs`);
    } else {
      // Flat hash over all public triples + synthetic anchor
      const tree = new MerkleTree(allPublicHashes);
      kcMerkleRoot = tree.root;
      this.log.info(ctx, `Computed kcMerkleRoot (flat) over ${allPublicHashes.length} triple hashes`);
    }
    const signature = await ed25519Sign(kcMerkleRoot, this.keypair.secretKey);

    const kaCount = manifestEntries.length;

    const dataGraph = this.graphManager.dataGraphUri(paranetId);
    const normalizedQuads = allSkolemizedQuads.map((q) => ({ ...q, graph: dataGraph }));

    // Store synthetic triple anchoring privateMerkleRoot in the data graph
    if (privateMerkleRoot) {
      normalizedQuads.push({
        subject: 'urn:dkg:kc',
        predicate: 'http://dkg.io/ontology/privateContentRoot',
        object: `"0x${Buffer.from(privateMerkleRoot).toString('hex')}"`,
        graph: dataGraph,
      });
    }

    this.log.info(ctx, `Storing ${normalizedQuads.length} triples in local store`);
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

    // Track owned entities
    if (!this.ownedEntities.has(paranetId)) {
      this.ownedEntities.set(paranetId, new Set());
    }
    for (const e of manifestEntries) {
      this.ownedEntities.get(paranetId)!.add(e.rootEntity);
    }

    let onChainResult: OnChainPublishResult | undefined;
    let status: 'tentative' | 'confirmed' = 'tentative';
    let ual: string;

    this.log.info(ctx, `Submitting on-chain publish tx (${kaCount} KAs)`);
    try {
      onChainResult = await this.chain.publishKnowledgeAssets({
        kaCount,
        publisherNodeIdentityId: this.publisherNodeIdentityId,
        merkleRoot: kcMerkleRoot,
        publicByteSize: BigInt(allSkolemizedQuads.length * 100),
        epochs: 1,
        tokenAmount: 0n,
        publisherSignature: {
          r: signature.slice(0, 32),
          vs: signature.slice(32),
        },
        receiverSignatures: [
          {
            identityId: this.publisherNodeIdentityId,
            r: signature.slice(0, 32),
            vs: signature.slice(32),
          },
        ],
      });

      // V9 UAL: did:dkg:{chainId}/{publisherAddress}/{firstKAId}
      ual = `did:dkg:${this.chain.chainId}/${onChainResult.publisherAddress}/${onChainResult.startKAId}`;

      // Confirmed only: full KC/KA metadata + status "confirmed" + chain provenance (no tentative triple)
      for (const km of kaMetadata) {
        km.kcUal = ual;
      }
      const confirmedQuads = generateConfirmedFullMetadata(
        {
          ual,
          paranetId,
          merkleRoot: kcMerkleRoot,
          kaCount,
          publisherPeerId: '',
          timestamp: new Date(),
        },
        kaMetadata,
        {
          txHash: onChainResult.txHash,
          blockNumber: onChainResult.blockNumber,
          blockTimestamp: onChainResult.blockTimestamp,
          publisherAddress: onChainResult.publisherAddress,
          batchId: onChainResult.batchId,
          chainId: this.chain.chainId,
        },
      );
      await this.store.insert(confirmedQuads);
      status = 'confirmed';
      this.log.info(ctx, `On-chain confirmed: UAL=${ual} batchId=${onChainResult.batchId} tx=${onChainResult.txHash}`);
    } catch (err) {
      this.log.warn(ctx, `On-chain tx failed, storing as tentative: ${err instanceof Error ? err.message : String(err)}`);
      ual = `did:dkg:${this.chain.chainId}/${this.publisherAddress}/0`;

      for (const km of kaMetadata) {
        km.kcUal = ual;
      }
      const tentativeQuads = generateTentativeMetadata(
        {
          ual,
          paranetId,
          merkleRoot: kcMerkleRoot,
          kaCount,
          publisherPeerId: '',
          timestamp: new Date(),
        },
        kaMetadata,
      );
      await this.store.insert(tentativeQuads);
    }

    const result: PublishResult = {
      kcId: onChainResult?.batchId ?? 0n,
      merkleRoot: kcMerkleRoot,
      kaManifest: manifestEntries,
      status,
      onChainResult,
    };

    this.eventBus.emit(DKGEvent.KC_PUBLISHED, result);
    return result;
  }

  async update(kcId: bigint, options: PublishOptions): Promise<PublishResult> {
    const { paranetId, quads, privateQuads = [], operationCtx } = options;
    const ctx: OperationContext = operationCtx ?? createOperationContext('publish');
    this.log.info(ctx, `Updating kcId=${kcId} with ${quads.length} triples`);
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
      status: 'confirmed',
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
