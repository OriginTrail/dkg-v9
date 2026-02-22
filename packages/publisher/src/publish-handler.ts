import type { TripleStore, Quad } from '@dkg/storage';
import { GraphManager } from '@dkg/storage';
import type { EventBus, StreamHandler } from '@dkg/core';
import {
  DKGEvent,
  decodePublishRequest,
  encodePublishAck,
  type PublishRequestMsg,
} from '@dkg/core';
import { validatePublishRequest } from './validation.js';
import { computeTripleHash, computePublicRoot, computeKCRoot, computeKARoot } from './merkle.js';
import { generateKCMetadata, type KAMetadata } from './metadata.js';

/**
 * Handles incoming /dkg/publish/1.0.0 protocol messages on the receiving node.
 * Validates the request, stores public triples, and returns an ack.
 */
export class PublishHandler {
  private readonly store: TripleStore;
  private readonly graphManager: GraphManager;
  private readonly eventBus: EventBus;
  private readonly ownedEntities = new Map<string, Set<string>>();

  constructor(store: TripleStore, eventBus: EventBus) {
    this.store = store;
    this.graphManager = new GraphManager(store);
    this.eventBus = eventBus;
  }

  get handler(): StreamHandler {
    return async (data, peerId) => {
      return this.handlePublish(data, peerId.toString());
    };
  }

  private async handlePublish(
    data: Uint8Array,
    fromPeerId: string,
  ): Promise<Uint8Array> {
    try {
      const request = decodePublishRequest(data);
      const paranetId = request.paranetId;
      await this.graphManager.ensureParanet(paranetId);

      // Decode N-Quads
      const nquadsStr = new TextDecoder().decode(request.nquads);
      const quads = parseSimpleNQuads(nquadsStr);

      // Build manifest for validation
      const manifest = request.kas.map((ka) => ({
        tokenId: BigInt(typeof ka.tokenId === 'number' ? ka.tokenId : 0),
        rootEntity: ka.rootEntity,
        privateTripleCount: ka.privateTripleCount,
      }));

      const existing = this.ownedEntities.get(paranetId) ?? new Set();
      const validation = validatePublishRequest(quads, manifest, paranetId, existing);

      if (!validation.valid) {
        return encodePublishAck({
          merkleRoot: new Uint8Array(32),
          identityId: 0,
          signatureR: new Uint8Array(0),
          signatureVs: new Uint8Array(0),
          accepted: false,
          rejectionReason: validation.errors.join('; '),
        });
      }

      // Store public triples
      const dataGraph = this.graphManager.dataGraphUri(paranetId);
      const normalized = quads.map((q) => ({ ...q, graph: dataGraph }));
      await this.store.insert(normalized);

      // Generate metadata
      const kaMetadata: KAMetadata[] = manifest.map((m, i) => ({
        rootEntity: m.rootEntity,
        kcUal: request.ual,
        tokenId: m.tokenId,
        publicTripleCount: quads.filter(
          (q) =>
            q.subject === m.rootEntity ||
            q.subject.startsWith(m.rootEntity + '/.well-known/genid/'),
        ).length,
        privateTripleCount: m.privateTripleCount ?? 0,
        privateMerkleRoot: request.kas[i].privateMerkleRoot?.length
          ? new Uint8Array(request.kas[i].privateMerkleRoot)
          : undefined,
      }));

      const metadataQuads = generateKCMetadata(
        {
          ual: request.ual,
          paranetId,
          merkleRoot: new Uint8Array(32),
          kaCount: manifest.length,
          publisherPeerId: fromPeerId,
          timestamp: new Date(),
        },
        kaMetadata,
      );
      await this.store.insert(metadataQuads);

      // Track entities
      if (!this.ownedEntities.has(paranetId)) {
        this.ownedEntities.set(paranetId, new Set());
      }
      for (const m of manifest) {
        this.ownedEntities.get(paranetId)!.add(m.rootEntity);
      }

      this.eventBus.emit(DKGEvent.KC_PUBLISHED, {
        ual: request.ual,
        from: fromPeerId,
      });

      return encodePublishAck({
        merkleRoot: new Uint8Array(32),
        identityId: 0,
        signatureR: new Uint8Array(0),
        signatureVs: new Uint8Array(0),
        accepted: true,
        rejectionReason: '',
      });
    } catch (err) {
      return encodePublishAck({
        merkleRoot: new Uint8Array(32),
        identityId: 0,
        signatureR: new Uint8Array(0),
        signatureVs: new Uint8Array(0),
        accepted: false,
        rejectionReason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
}

/**
 * Minimal N-Quads line parser for incoming publish data.
 * Each line: <s> <p> <o> <g> . or <s> <p> "literal" <g> .
 */
function parseSimpleNQuads(text: string): Quad[] {
  const quads: Quad[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Remove trailing " ."
    const body = trimmed.endsWith(' .') ? trimmed.slice(0, -2).trim() : trimmed;
    const parts = splitNQuadLine(body);
    if (parts.length >= 3) {
      quads.push({
        subject: stripAngleBrackets(parts[0]),
        predicate: stripAngleBrackets(parts[1]),
        object: parts[2].startsWith('"') ? parts[2] : stripAngleBrackets(parts[2]),
        graph: parts[3] ? stripAngleBrackets(parts[3]) : '',
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
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === '"') {
          j++;
          // Check for language tag or datatype
          if (line[j] === '@') {
            while (j < line.length && line[j] !== ' ') j++;
          } else if (line[j] === '^' && line[j + 1] === '^') {
            j += 2;
            if (line[j] === '<') {
              const end = line.indexOf('>', j);
              j = end + 1;
            }
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
    } else {
      break;
    }
  }
  return parts;
}

function stripAngleBrackets(s: string): string {
  if (s.startsWith('<') && s.endsWith('>')) return s.slice(1, -1);
  return s;
}
