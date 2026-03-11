import protobuf from 'protobufjs';

const { Type, Field } = protobuf;

export const FinalizationMessageSchema = new Type('FinalizationMessage')
  .add(new Field('ual', 1, 'string'))
  .add(new Field('paranetId', 2, 'string'))
  .add(new Field('kcMerkleRoot', 3, 'bytes'))
  .add(new Field('txHash', 4, 'string'))
  .add(new Field('blockNumber', 5, 'uint64'))
  .add(new Field('batchId', 6, 'uint64'))
  .add(new Field('startKAId', 7, 'uint64'))
  .add(new Field('endKAId', 8, 'uint64'))
  .add(new Field('publisherAddress', 9, 'string'))
  .add(new Field('rootEntities', 10, 'string', 'repeated'))
  .add(new Field('timestampMs', 11, 'uint64'))
  .add(new Field('operationId', 12, 'string'))
  .add(new Field('contextGraphId', 13, 'string'));

type Long = { low: number; high: number; unsigned: boolean };

export interface FinalizationMessageMsg {
  ual: string;
  paranetId: string;
  kcMerkleRoot: Uint8Array;
  txHash: string;
  blockNumber: number | Long;
  batchId: number | Long;
  startKAId: number | Long;
  endKAId: number | Long;
  publisherAddress: string;
  rootEntities: string[];
  timestampMs: number | Long;
  /** Originator's operation ID for cross-node log correlation. */
  operationId?: string;
  /** When set, the enshrine targeted a context graph instead of the paranet data graph. */
  contextGraphId?: string;
}

export function encodeFinalizationMessage(msg: FinalizationMessageMsg): Uint8Array {
  const ts = typeof msg.timestampMs === 'object' ? msg.timestampMs : msg.timestampMs;
  return FinalizationMessageSchema.encode(
    FinalizationMessageSchema.create({ ...msg, timestampMs: ts }),
  ).finish();
}

export function decodeFinalizationMessage(buf: Uint8Array): FinalizationMessageMsg {
  return FinalizationMessageSchema.decode(buf) as unknown as FinalizationMessageMsg;
}
