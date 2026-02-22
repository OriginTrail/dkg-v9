import type { ProtocolRouter } from '@dkg/core';
import {
  PROTOCOL_ACCESS,
  encodeAccessRequest,
  decodeAccessResponse,
  ed25519Sign,
  type Ed25519Keypair,
} from '@dkg/core';
import type { Quad } from '@dkg/storage';
import { computePrivateRoot } from './merkle.js';

export interface AccessResult {
  granted: boolean;
  quads: Quad[];
  rejectionReason?: string;
}

/**
 * Client-side access protocol for requesting private triples from a publisher node.
 */
export class AccessClient {
  private readonly router: ProtocolRouter;
  private readonly keypair: Ed25519Keypair;
  private readonly peerId: string;

  constructor(router: ProtocolRouter, keypair: Ed25519Keypair, peerId: string) {
    this.router = router;
    this.keypair = keypair;
    this.peerId = peerId;
  }

  async requestAccess(
    publisherPeerId: string,
    kaUal: string,
    paymentProof: Uint8Array = new Uint8Array(0),
  ): Promise<AccessResult> {
    const message = new TextEncoder().encode(
      kaUal + toHex(paymentProof),
    );
    const signature = await ed25519Sign(message, this.keypair.secretKey);

    const requestData = encodeAccessRequest({
      kaUal,
      requesterPeerId: this.peerId,
      paymentProof,
      requesterSignature: signature,
    });

    const responseData = await this.router.send(
      publisherPeerId,
      PROTOCOL_ACCESS,
      requestData,
    );

    const response = decodeAccessResponse(responseData);

    if (!response.granted) {
      return {
        granted: false,
        quads: [],
        rejectionReason: response.rejectionReason,
      };
    }

    // Parse returned N-Quads
    const nquadsStr = new TextDecoder().decode(response.nquads);
    const quads = parseSimpleNQuads(nquadsStr);

    // Optionally verify merkle root against meta graph
    // (deferred to when we have the private merkle root from meta)

    return { granted: true, quads };
  }
}

function parseSimpleNQuads(text: string): Quad[] {
  const quads: Quad[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(
      /^<([^>]+)>\s+<([^>]+)>\s+(".*?"(?:@\S+|\^\^<[^>]+>)?|<[^>]+>|_:\S+)\s+(?:<([^>]+)>\s+)?\.$/,
    );
    if (match) {
      quads.push({
        subject: match[1],
        predicate: match[2],
        object: match[3].startsWith('<') ? match[3].slice(1, -1) : match[3],
        graph: match[4] ?? '',
      });
    }
  }
  return quads;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
