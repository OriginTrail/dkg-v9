/**
 * Entry script that runs INSIDE the worker_threads worker. The host
 * (`WorkerThreadProofBuilder` in `proof-worker.ts`) sends one task at
 * a time on `parentPort`; this script builds the V10 proof material
 * via `buildV10ProofMaterial` and sends the result back.
 *
 * Errors are flattened to a serializable shape so the host can
 * reconstruct named error classes via `error.name`.
 */
import { parentPort } from 'node:worker_threads';
import {
  buildV10ProofMaterial,
  V10ProofRootMismatchError,
  V10ProofLeafCountMismatchError,
  V10ProofChunkOutOfRangeError,
  type V10MerkleCommitment,
} from '@origintrail-official/dkg-core';

interface BuildRequest {
  /** Monotonic id; echoed in the response so the host can correlate. */
  taskId: number;
  /** Leaves transferred as ArrayBuffer-backed Uint8Array[]. */
  leaves: Uint8Array[];
  chunkId: number;
  expected: V10MerkleCommitment;
}

interface BuildResponse {
  taskId: number;
  ok: true;
  leaf: Uint8Array;
  proof: Uint8Array[];
  merkleRoot: Uint8Array;
  leafCount: number;
}

interface BuildError {
  taskId: number;
  ok: false;
  errorName:
    | 'V10ProofRootMismatchError'
    | 'V10ProofLeafCountMismatchError'
    | 'V10ProofChunkOutOfRangeError'
    | 'Error';
  message: string;
}

if (!parentPort) {
  throw new Error('proof-worker-entry must run inside a worker_threads worker');
}

parentPort.on('message', (msg: BuildRequest) => {
  try {
    const material = buildV10ProofMaterial(msg.leaves, msg.chunkId, msg.expected);
    const response: BuildResponse = {
      taskId: msg.taskId,
      ok: true,
      leaf: material.leaf,
      proof: material.proof,
      merkleRoot: material.merkleRoot,
      leafCount: material.leafCount,
    };
    parentPort!.postMessage(response);
  } catch (err) {
    let errorName: BuildError['errorName'] = 'Error';
    if (err instanceof V10ProofRootMismatchError) errorName = 'V10ProofRootMismatchError';
    else if (err instanceof V10ProofLeafCountMismatchError) errorName = 'V10ProofLeafCountMismatchError';
    else if (err instanceof V10ProofChunkOutOfRangeError) errorName = 'V10ProofChunkOutOfRangeError';
    const response: BuildError = {
      taskId: msg.taskId,
      ok: false,
      errorName,
      message: err instanceof Error ? err.message : String(err),
    };
    parentPort!.postMessage(response);
  }
});
