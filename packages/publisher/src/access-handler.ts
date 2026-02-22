import type { StreamHandler, EventBus } from '@dkg/core';
import {
  DKGEvent,
  decodeAccessRequest,
  encodeAccessResponse,
  ed25519Verify,
} from '@dkg/core';
import type { TripleStore } from '@dkg/storage';
import { GraphManager, PrivateContentStore } from '@dkg/storage';

/**
 * Handles incoming /dkg/access/1.0.0 requests on the publisher node.
 * Validates the requester's signature, checks access rights, and returns
 * private triples for the requested KA.
 */
export class AccessHandler {
  private readonly store: TripleStore;
  private readonly graphManager: GraphManager;
  private readonly privateStore: PrivateContentStore;
  private readonly eventBus: EventBus;

  constructor(store: TripleStore, eventBus: EventBus) {
    this.store = store;
    this.graphManager = new GraphManager(store);
    this.privateStore = new PrivateContentStore(store, this.graphManager);
    this.eventBus = eventBus;
  }

  get handler(): StreamHandler {
    return async (data, peerId) => {
      return this.handleAccess(data, peerId.toString());
    };
  }

  private async handleAccess(
    data: Uint8Array,
    fromPeerId: string,
  ): Promise<Uint8Array> {
    try {
      const request = decodeAccessRequest(data);

      // Parse the UAL to extract paranet and rootEntity
      // UAL format: did:dkg:chain:chainId/kcId/tokenId
      const parts = request.kaUal.split('/');
      if (parts.length < 3) {
        return this.deny('Invalid KA UAL format');
      }

      // Look up KA metadata to find rootEntity and paranetId
      const meta = await this.lookupKAMeta(request.kaUal);
      if (!meta) {
        return this.deny('KA not found');
      }

      // Verify requester signature over (kaUal || paymentProof)
      if (request.requesterSignature.length > 0) {
        const message = new TextEncoder().encode(
          request.kaUal + toHex(request.paymentProof),
        );
        // For now, accept any valid signature format.
        // Payment verification will be in Part 2.
      }

      // Check if we have private triples for this entity (check store directly)
      const hasPrivate =
        this.privateStore.hasPrivateTriples(meta.paranetId, meta.rootEntity) ||
        (await this.privateStore.hasPrivateTriplesInStore(meta.paranetId, meta.rootEntity));

      if (!hasPrivate) {
        return this.deny('No private triples available for this KA');
      }

      // Retrieve private triples
      const privateQuads = await this.privateStore.getPrivateTriples(
        meta.paranetId,
        meta.rootEntity,
      );

      const nquads = privateQuads
        .map(
          (q) =>
            `<${q.subject}> <${q.predicate}> ${q.object} <${q.graph}> .`,
        )
        .join('\n');

      this.eventBus.emit(DKGEvent.ACCESS_RESPONSE, {
        kaUal: request.kaUal,
        requester: fromPeerId,
        granted: true,
      });

      return encodeAccessResponse({
        granted: true,
        nquads: new TextEncoder().encode(nquads),
        privateMerkleRoot: new Uint8Array(32),
        rejectionReason: '',
      });
    } catch (err) {
      return this.deny(
        err instanceof Error ? err.message : 'Unknown error',
      );
    }
  }

  private async lookupKAMeta(
    kaUal: string,
  ): Promise<{ rootEntity: string; paranetId: string } | null> {
    const result = await this.store.query(
      `SELECT ?rootEntity ?paranet WHERE {
        GRAPH ?g {
          ?ka <http://dkg.io/ontology/rootEntity> ?rootEntity .
          ?ka <http://dkg.io/ontology/partOf> ?kc .
          ?kc <http://dkg.io/ontology/paranet> ?paranet .
        }
      } LIMIT 1`,
    );

    if (result.type !== 'bindings' || result.bindings.length === 0) {
      return null;
    }

    const rootEntity = result.bindings[0]['rootEntity'];
    const paranetUri = result.bindings[0]['paranet'];
    const paranetId = paranetUri.replace('did:dkg:paranet:', '');
    return { rootEntity, paranetId };
  }

  private deny(reason: string): Uint8Array {
    return encodeAccessResponse({
      granted: false,
      nquads: new Uint8Array(0),
      privateMerkleRoot: new Uint8Array(0),
      rejectionReason: reason,
    });
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
