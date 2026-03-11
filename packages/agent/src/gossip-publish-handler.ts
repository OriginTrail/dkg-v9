import {
  decodePublishRequest, SYSTEM_PARANETS, DKG_ONTOLOGY,
  Logger, createOperationContext,
} from '@dkg/core';
import { GraphManager, type TripleStore, type Quad } from '@dkg/storage';
import {
  computeFlatCollectionRoot, computePublicByteSize, autoPartition,
  generateTentativeMetadata, TentativePublishStore,
  validatePublishRequest,
  type KAMetadata,
} from '@dkg/publisher';

export interface GossipPublishHandlerCallbacks {
  paranetExists: (id: string) => Promise<boolean>;
  subscribeToParanet: (id: string) => void;
}

export class GossipPublishHandler {
  private readonly store: TripleStore;
  private readonly tentativeStore: TentativePublishStore;
  private readonly subscribedParanets: Map<string, any>;
  private readonly callbacks: GossipPublishHandlerCallbacks;
  private readonly log = new Logger('GossipPublishHandler');

  constructor(
    store: TripleStore,
    tentativeStore: TentativePublishStore,
    subscribedParanets: Map<string, any>,
    callbacks: GossipPublishHandlerCallbacks,
  ) {
    this.store = store;
    this.tentativeStore = tentativeStore;
    this.subscribedParanets = subscribedParanets;
    this.callbacks = callbacks;
  }

  async handlePublishMessage(data: Uint8Array, paranetId: string): Promise<void> {
    let ctx = createOperationContext('gossip');
    try {
      const request = decodePublishRequest(data);
      if (request.operationId) {
        ctx = createOperationContext('gossip', request.operationId);
      }

      if (!request.paranetId) {
        request.paranetId = paranetId;
      } else if (request.paranetId !== paranetId) {
        this.log.warn(ctx, `Gossip: request paranetId "${request.paranetId}" does not match topic paranetId "${paranetId}", ignoring`);
        return;
      }

      const nquadsStr = new TextDecoder().decode(request.nquads);
      const quads = parseSimpleNQuads(nquadsStr);

      if (quads.length === 0 && !request.ual) {
        this.log.warn(ctx, 'Gossip: empty broadcast with no UAL, ignoring');
        return;
      }

      const graphManager = new GraphManager(this.store);
      await graphManager.ensureParanet(request.paranetId);
      const dataGraph = graphManager.dataGraphUri(request.paranetId);
      let normalized = quads.map(q => ({ ...q, graph: dataGraph }));

      // When receiving ontology-topic broadcasts, skip paranet definition
      // triples for paranets we already have locally. This prevents duplicate
      // creator/timestamp triples when multiple nodes create the same paranet
      // during simultaneous startup.
      // Also auto-subscribe to any newly discovered paranets.
      if (request.paranetId === SYSTEM_PARANETS.ONTOLOGY) {
        const paranetPrefix = 'did:dkg:paranet:';
        const incomingParanetUris = new Set(
          normalized
            .filter(q => q.predicate === DKG_ONTOLOGY.RDF_TYPE && q.object === DKG_ONTOLOGY.DKG_PARANET)
            .map(q => q.subject),
        );
        if (incomingParanetUris.size > 0) {
          const duplicateUris = new Set<string>();
          const newParanetIds: string[] = [];
          for (const uri of incomingParanetUris) {
            const id = uri.startsWith(paranetPrefix) ? uri.slice(paranetPrefix.length) : null;
            if (!id) continue;
            if (await this.callbacks.paranetExists(id)) {
              duplicateUris.add(uri);
            } else if (id !== SYSTEM_PARANETS.AGENTS && id !== SYSTEM_PARANETS.ONTOLOGY) {
              newParanetIds.push(id);
            }
          }
          if (duplicateUris.size > 0) {
            const activityUris = new Set(
              normalized
                .filter(q => duplicateUris.has(q.subject) && q.predicate === DKG_ONTOLOGY.PROV_GENERATED_BY)
                .map(q => q.object),
            );
            normalized = normalized.filter(q => !duplicateUris.has(q.subject) && !activityUris.has(q.subject));
          }

          for (const newId of newParanetIds) {
            const nameQuad = normalized.find(q =>
              q.subject === `${paranetPrefix}${newId}` && q.predicate === DKG_ONTOLOGY.SCHEMA_NAME,
            );
            const name = nameQuad ? stripLiteral(nameQuad.object) : newId;
            this.subscribedParanets.set(newId, {
              name,
              subscribed: true,
              synced: true,
              onChainId: this.subscribedParanets.get(newId)?.onChainId,
            });
            this.callbacks.subscribeToParanet(newId);
            this.log.info(ctx, `Discovered paranet "${name}" (${newId}) via gossip — auto-subscribed`);
          }
        }
      }

      // Structural validation (I-002): reject malformed gossip before inserting.
      // Only applies to real publishes with a manifest — ontology/paranet
      // broadcasts (no UAL or no KAs) bypass validation.
      let isReplay = false;
      if (request.ual && request.kas?.length > 0) {
        const manifest = request.kas.map(ka => ({
          tokenId: 0n,
          rootEntity: ka.rootEntity,
          privateTripleCount: ka.privateTripleCount ?? 0,
        }));

        const rootEntities = manifest.map(m => m.rootEntity).filter(isSafeIri);
        if (rootEntities.length === 0) {
          this.log.warn(ctx, `Gossip structural validation rejected publish ${request.ual}: no valid root entities`);
          return;
        }
        const sparql = `SELECT DISTINCT ?s WHERE { GRAPH <${dataGraph}> { ?s ?p ?o } VALUES ?s { ${rootEntities.map(e => `<${e}>`).join(' ')} } }`;
        const result = await this.store.query(sparql);
        const existingEntities = new Set<string>(
          result.type === 'bindings'
            ? (result.bindings as Array<Record<string, string>>).map((binding) => binding['s']).filter(Boolean)
            : [],
        );

        const validation = validatePublishRequest(normalized, manifest, request.paranetId, existingEntities);
        if (!validation.valid) {
          const allRule4 = validation.errors.every(e => e.startsWith('Rule 4'));
          if (!allRule4) {
            this.log.warn(ctx, `Gossip structural validation rejected publish ${request.ual}: ${validation.errors.join('; ')}`);
            return;
          }
          this.log.info(ctx, `Gossip replay detected for ${request.ual}, skipping data insert but running verification`);
          isReplay = true;
        }
      }

      if (normalized.length > 0 && !isReplay) {
        await this.store.insert(normalized);
      }

      if (request.ual && request.operationId && request.kas?.length > 0) {
        // Use sequential ordinals (1, 2, 3...) instead of trusting wire tokenIds.
        // The publisher assigns ordinals 1..N; a malformed manifest with arbitrary
        // tokenIds would corrupt canonical KA ID calculation during confirmation.
        const kaMetadata: KAMetadata[] = request.kas.map((ka, index) => {
          const rootEntity = ka.rootEntity;
          const entityQuads = normalized.filter((quad) =>
            quad.subject === rootEntity || quad.subject.startsWith(rootEntity + '/.well-known/genid/'),
          );
          const privateMerkleRoot = ka.privateMerkleRoot?.length
            ? new Uint8Array(ka.privateMerkleRoot)
            : undefined;
          return {
            rootEntity,
            kcUal: request.ual,
            tokenId: BigInt(index + 1),
            publicTripleCount: entityQuads.length,
            privateTripleCount: ka.privateTripleCount ?? 0,
            privateMerkleRoot,
          };
        });
        const merkleRoot = computeFlatCollectionRoot(
          normalized.map((quad) => ({ ...quad, graph: '' })),
          kaMetadata.map((ka) => ({
            rootEntity: ka.rootEntity,
            privateMerkleRoot: ka.privateMerkleRoot,
          })),
        );
        const publicByteSize = computePublicByteSize(normalized.map((quad) => ({ ...quad, graph: '' })));

        await this.store.insert(generateTentativeMetadata(
          {
            ual: request.ual,
            paranetId: request.paranetId,
            merkleRoot,
            kaCount: kaMetadata.length,
            publisherPeerId: request.publisherAddress || 'unknown',
            timestamp: new Date(),
          },
          kaMetadata,
        ));

        await this.tentativeStore.register({
          operationId: request.operationId,
          tentativeUal: request.ual,
          paranetId: request.paranetId,
          publisherAddress: request.publisherAddress || '',
          merkleRoot,
          publicByteSize,
          createdAt: Date.now(),
          dataGraph,
          metaGraph: graphManager.metaGraphUri(request.paranetId),
          publisherPeerId: request.publisherAddress || 'unknown',
          kaRecords: kaMetadata.map((ka) => ({
            ordinal: Number(ka.tokenId),
            rootEntity: ka.rootEntity,
            privateTripleCount: ka.privateTripleCount,
            privateMerkleRoot: ka.privateMerkleRoot,
          })),
        });

        this.log.info(ctx, `Gossip publish ${request.ual} stored tentatively for attestation and chain-poller confirmation`);
      }
    } catch (err) {
      this.log.warn(ctx, `Gossip: failed to process publish broadcast: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function parseSimpleNQuads(text: string): Quad[] {
  const quads: Quad[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const body = trimmed.endsWith(' .') ? trimmed.slice(0, -2).trim() : trimmed;
    const parts = splitNQuadLine(body);
    if (parts.length >= 3) {
      quads.push({
        subject: strip(parts[0]),
        predicate: strip(parts[1]),
        object: parts[2].startsWith('"') ? parts[2] : strip(parts[2]),
        graph: parts[3] ? strip(parts[3]) : '',
      });
    }
  }
  return quads;
}

function splitNQuadLine(line: string): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && line[i] === ' ') i++;
    if (i >= line.length) break;
    if (line[i] === '<') {
      const end = line.indexOf('>', i);
      if (end === -1) break;
      parts.push(line.slice(i, end + 1));
      i = end + 1;
    } else if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === '"') {
          j++;
          if (line[j] === '@') { while (j < line.length && line[j] !== ' ') j++; }
          else if (line[j] === '^' && line[j + 1] === '^') {
            j += 2;
            if (line[j] === '<') { const end = line.indexOf('>', j); j = end + 1; }
          }
          break;
        }
        j++;
      }
      parts.push(line.slice(i, j));
      i = j;
    } else if (line[i] === '_') {
      let j = i;
      while (j < line.length && line[j] !== ' ') j++;
      parts.push(line.slice(i, j));
      i = j;
    } else break;
  }
  return parts;
}

function strip(s: string): string {
  if (s.startsWith('<') && s.endsWith('>')) return s.slice(1, -1);
  return s;
}

function isSafeIri(value: string): boolean {
  if (!value) return false;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>"{}|\\^`]*$/.test(value);
}

function stripLiteral(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  const match = s.match(/^"(.*)"(\^\^.*|@.*)?$/);
  if (match) return match[1];
  return s;
}
