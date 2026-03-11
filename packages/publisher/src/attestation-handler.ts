import type { TripleStore, Quad } from '@dkg/storage';
import {
  decodeAttestationRequest,
  encodePublishAck,
  Logger,
  createOperationContext,
  type StreamHandler,
} from '@dkg/core';
import { computeFlatCollectionRoot } from './merkle.js';
import { computePublicByteSize } from './public-payload.js';
import { TentativePublishStore, type TentativePublishRecord } from './tentative-publish-store.js';

const SKOLEM_INFIX = '/.well-known/genid/';

function protoToBigInt(val: number | { low: number; high: number; unsigned: boolean }): bigint {
  if (typeof val === 'number') return BigInt(val);
  return (BigInt(val.high >>> 0) << 32n) | BigInt(val.low >>> 0);
}

export interface AttestationHandlerOptions {
  tentativeStore: TentativePublishStore;
  getIdentityId: () => bigint;
  signReceiverAttestation: (merkleRoot: Uint8Array, publicByteSize: bigint) => Promise<{ r: Uint8Array; vs: Uint8Array }>;
}

export class AttestationHandler {
  private readonly store: TripleStore;
  private readonly tentativeStore: TentativePublishStore;
  private readonly getIdentityId: () => bigint;
  private readonly signReceiverAttestation: (merkleRoot: Uint8Array, publicByteSize: bigint) => Promise<{ r: Uint8Array; vs: Uint8Array }>;
  private readonly log = new Logger('AttestationHandler');

  constructor(store: TripleStore, options: AttestationHandlerOptions) {
    this.store = store;
    this.tentativeStore = options.tentativeStore;
    this.getIdentityId = options.getIdentityId;
    this.signReceiverAttestation = options.signReceiverAttestation;
  }

  get handler(): StreamHandler {
    return async (data) => this.handle(data);
  }

  async handle(data: Uint8Array): Promise<Uint8Array> {
    let ctx = createOperationContext('publish');
    try {
      const request = decodeAttestationRequest(data);
      ctx = createOperationContext('publish', request.operationId);

      const merkleRoot = new Uint8Array(request.merkleRoot);
      const publicByteSize = protoToBigInt(request.publicByteSize);
      const tentative = this.tentativeStore.findForAttestation({
        operationId: request.operationId,
        merkleRoot,
        publisherAddress: request.publisherAddress,
        publicByteSize,
      });

      if (!tentative) {
        return this.rejectAck(merkleRoot, publicByteSize, 'tentative publish not found');
      }

      const publicQuads = await this.loadTentativePublicQuads(tentative);
      const computedMerkleRoot = computeFlatCollectionRoot(
        publicQuads,
        tentative.kaRecords.map((record) => ({
          rootEntity: record.rootEntity,
          privateMerkleRoot: record.privateMerkleRoot,
        })),
      );
      const computedPublicByteSize = computePublicByteSize(publicQuads);

      if (!buffersEqual(computedMerkleRoot, merkleRoot)) {
        return this.rejectAck(merkleRoot, publicByteSize, 'merkle root mismatch');
      }
      if (computedPublicByteSize !== publicByteSize) {
        return this.rejectAck(merkleRoot, publicByteSize, 'public byte size mismatch');
      }

      const identityId = this.getIdentityId();
      if (identityId <= 0n) {
        return this.rejectAck(merkleRoot, publicByteSize, 'identity not ready');
      }

      const signature = await this.signReceiverAttestation(merkleRoot, publicByteSize);
      if (signature.r.length === 0 || signature.vs.length === 0) {
        return this.rejectAck(merkleRoot, publicByteSize, 'signer not ready');
      }

      return encodePublishAck({
        merkleRoot,
        identityId: Number(identityId),
        signatureR: signature.r,
        signatureVs: signature.vs,
        accepted: true,
        rejectionReason: '',
        publicByteSize: Number(publicByteSize),
      });
    } catch (err) {
      this.log.warn(ctx, `Attestation failed: ${err instanceof Error ? err.message : String(err)}`);
      return this.rejectAck(new Uint8Array(32), 0n, err instanceof Error ? err.message : 'unknown error');
    }
  }

  private async loadTentativePublicQuads(record: TentativePublishRecord): Promise<Quad[]> {
    const values = record.kaRecords.map((ka) => `<${ka.rootEntity}>`).join(' ');
    const result = await this.store.query(
      `CONSTRUCT { ?s ?p ?o } WHERE {
        GRAPH <${record.dataGraph}> {
          VALUES ?root { ${values} }
          ?s ?p ?o .
          FILTER(
            ?s = ?root
            || STRSTARTS(STR(?s), CONCAT(STR(?root), "${SKOLEM_INFIX}"))
          )
        }
      }`,
    );

    return result.type === 'quads'
      ? result.quads.map((quad) => ({ ...quad, graph: '' }))
      : [];
  }

  private rejectAck(merkleRoot: Uint8Array, publicByteSize: bigint, reason: string): Uint8Array {
    return encodePublishAck({
      merkleRoot,
      identityId: 0,
      signatureR: new Uint8Array(0),
      signatureVs: new Uint8Array(0),
      accepted: false,
      rejectionReason: reason,
      publicByteSize: Number(publicByteSize),
    });
  }
}

function buffersEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
