import protobuf from 'protobufjs';

const { Type, Field } = protobuf;

export const AttestationRequestSchema = new Type('AttestationRequest')
  .add(new Field('operationId', 1, 'string'))
  .add(new Field('paranetId', 2, 'string'))
  .add(new Field('publisherAddress', 3, 'string'))
  .add(new Field('merkleRoot', 4, 'bytes'))
  .add(new Field('publicByteSize', 5, 'uint64'));

type Long = { low: number; high: number; unsigned: boolean };

export interface AttestationRequestMsg {
  operationId: string;
  paranetId: string;
  publisherAddress: string;
  merkleRoot: Uint8Array;
  publicByteSize: number | Long;
}

export function encodeAttestationRequest(msg: AttestationRequestMsg): Uint8Array {
  return AttestationRequestSchema.encode(
    AttestationRequestSchema.create(msg),
  ).finish();
}

export function decodeAttestationRequest(buf: Uint8Array): AttestationRequestMsg {
  return AttestationRequestSchema.decode(buf) as unknown as AttestationRequestMsg;
}
