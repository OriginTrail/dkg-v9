import type { Quad } from '@dkg/storage';

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const DKG = 'http://dkg.io/ontology/';
const PROV = 'http://www.w3.org/ns/prov#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface KCMetadata {
  ual: string;
  paranetId: string;
  merkleRoot: Uint8Array;
  kaCount: number;
  publisherPeerId: string;
  timestamp: Date;
}

export interface KAMetadata {
  rootEntity: string;
  kcUal: string;
  tokenId: bigint;
  publicTripleCount: number;
  privateTripleCount: number;
  privateMerkleRoot?: Uint8Array;
}

/**
 * Generate RDF metadata triples for a Knowledge Collection.
 * These go into the paranet's meta graph.
 */
export function generateKCMetadata(
  meta: KCMetadata,
  kaEntries: KAMetadata[],
): Quad[] {
  const metaGraph = `did:dkg:paranet:${meta.paranetId}/_meta`;
  const quads: Quad[] = [];

  // KC metadata
  quads.push(
    mq(meta.ual, `${RDF}type`, `${DKG}KnowledgeCollection`, metaGraph),
    mq(meta.ual, `${DKG}merkleRoot`, lit(toHex(meta.merkleRoot)), metaGraph),
    mq(meta.ual, `${DKG}kaCount`, intLit(meta.kaCount), metaGraph),
    mq(
      meta.ual,
      `${PROV}wasAttributedTo`,
      lit(meta.publisherPeerId || 'unknown'),
      metaGraph,
    ),
    mq(
      meta.ual,
      `${DKG}publishedAt`,
      dateLit(meta.timestamp),
      metaGraph,
    ),
    mq(meta.ual, `${DKG}paranet`, `did:dkg:paranet:${meta.paranetId}`, metaGraph),
  );

  // KA metadata
  for (const ka of kaEntries) {
    const kaUri = `${ka.kcUal}/${ka.tokenId}`;
    quads.push(
      mq(kaUri, `${RDF}type`, `${DKG}KnowledgeAsset`, metaGraph),
      mq(kaUri, `${DKG}rootEntity`, ka.rootEntity, metaGraph),
      mq(kaUri, `${DKG}partOf`, ka.kcUal, metaGraph),
      mq(kaUri, `${DKG}tokenId`, intLit(Number(ka.tokenId)), metaGraph),
      mq(
        kaUri,
        `${DKG}publicTripleCount`,
        intLit(ka.publicTripleCount),
        metaGraph,
      ),
    );

    if (ka.privateTripleCount > 0) {
      quads.push(
        mq(
          kaUri,
          `${DKG}privateTripleCount`,
          intLit(ka.privateTripleCount),
          metaGraph,
        ),
      );
      if (ka.privateMerkleRoot) {
        quads.push(
          mq(
            kaUri,
            `${DKG}privateMerkleRoot`,
            lit(toHex(ka.privateMerkleRoot)),
            metaGraph,
          ),
        );
      }
    }
  }

  return quads;
}

function mq(s: string, p: string, o: string, g: string): Quad {
  return { subject: s, predicate: p, object: o, graph: g };
}

function lit(val: string): string {
  return `"${val}"`;
}

function intLit(val: number): string {
  return `"${val}"^^<${XSD}integer>`;
}

function dateLit(d: Date): string {
  return `"${d.toISOString()}"^^<${XSD}dateTime>`;
}
