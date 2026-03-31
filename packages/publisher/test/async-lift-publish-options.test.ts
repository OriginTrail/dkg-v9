import { describe, expect, it } from 'vitest';
import { mapLiftRequestToPublishOptions, type LiftPublishMappingInput } from '../src/index.js';

describe('mapLiftRequestToPublishOptions', () => {
  function baseInput(): LiftPublishMappingInput {
    return {
      request: {
        workspaceId: 'ws-1',
        workspaceOperationId: 'op-1',
        roots: ['urn:local:/rihana'],
        paranetId: 'music-social',
        namespace: 'aloha',
        scope: 'person-profile',
        transitionType: 'CREATE',
        authority: { type: 'owner', proofRef: 'proof:owner:1' },
      },
      validation: {
        authorityProofRef: 'proof:owner:1',
        priorVersion: undefined,
      },
      resolved: {
        quads: [
          {
            subject: 'did:dkg:music-social:rihana',
            predicate: 'http://schema.org/name',
            object: '"Rihana"',
            graph: 'did:dkg:paranet:music-social/_data',
          },
        ],
      },
    };
  }

  it('maps validated lift inputs onto canonical publish options', () => {
    const options = mapLiftRequestToPublishOptions({
      ...baseInput(),
      resolved: {
        ...baseInput().resolved,
        publisherPeerId: '12D3KooWPublisher',
        targetGraphUri: 'did:dkg:paranet:music-social/_data',
        targetMetaGraphUri: 'did:dkg:paranet:music-social/_meta',
        entityProofs: true,
      },
    });

    expect(options.paranetId).toBe('music-social');
    expect(options.publisherPeerId).toBe('12D3KooWPublisher');
    expect(options.accessPolicy).toBe('public');
    expect(options.entityProofs).toBe(true);
    expect(options.targetGraphUri).toBe('did:dkg:paranet:music-social/_data');
    expect(options.targetMetaGraphUri).toBe('did:dkg:paranet:music-social/_meta');
  });

  it('defaults to ownerOnly when private quads are present', () => {
    const options = mapLiftRequestToPublishOptions({
      ...baseInput(),
      resolved: {
        ...baseInput().resolved,
        publisherPeerId: '12D3KooWPublisher',
        privateQuads: [
          {
            subject: 'did:dkg:music-social:rihana',
            predicate: 'http://schema.org/secret',
            object: '"top-secret"',
            graph: 'did:dkg:paranet:music-social/_private',
          },
        ],
      },
    });

    expect(options.accessPolicy).toBe('ownerOnly');
    expect(options.privateQuads).toHaveLength(1);
  });

  it('normalizes allowList peers and forwards explicit access policy', () => {
    const options = mapLiftRequestToPublishOptions({
      ...baseInput(),
      resolved: {
        ...baseInput().resolved,
        publisherPeerId: '12D3KooWPublisher',
        accessPolicy: 'allowList',
        allowedPeers: [' peer-a ', 'peer-b', 'peer-a'],
      },
    });

    expect(options.accessPolicy).toBe('allowList');
    expect(options.allowedPeers).toEqual(['peer-a', 'peer-b']);
  });

  it('requires publisherPeerId for non-public access', () => {
    expect(() =>
      mapLiftRequestToPublishOptions({
        ...baseInput(),
        resolved: {
          ...baseInput().resolved,
          accessPolicy: 'ownerOnly',
        },
      }),
    ).toThrow('Lift publish mapping requires publisherPeerId when accessPolicy is ownerOnly');
  });

  it('rejects allowList without allowed peers', () => {
    expect(() =>
      mapLiftRequestToPublishOptions({
        ...baseInput(),
        resolved: {
          ...baseInput().resolved,
          publisherPeerId: '12D3KooWPublisher',
          accessPolicy: 'allowList',
        },
      }),
    ).toThrow('Lift publish mapping requires non-empty allowedPeers for allowList access');
  });

  it('rejects allowed peers without allowList access', () => {
    expect(() =>
      mapLiftRequestToPublishOptions({
        ...baseInput(),
        resolved: {
          ...baseInput().resolved,
          allowedPeers: ['peer-a'],
        },
      }),
    ).toThrow('Lift publish mapping only allows allowedPeers when accessPolicy is allowList');
  });

  it('requires a validated authority proof ref even though it is not forwarded into PublishOptions', () => {
    expect(() =>
      mapLiftRequestToPublishOptions({
        ...baseInput(),
        validation: {
          authorityProofRef: '   ',
          priorVersion: undefined,
        },
      }),
    ).toThrow('Lift publish mapping requires a non-empty authorityProofRef');
  });

  it('requires validation priorVersion to match the request priorVersion', () => {
    expect(() =>
      mapLiftRequestToPublishOptions({
        ...baseInput(),
        request: {
          ...baseInput().request,
          priorVersion: 'did:dkg:mock:31337/0xabc/7',
        },
        validation: {
          authorityProofRef: 'proof:owner:1',
          priorVersion: 'did:dkg:mock:31337/0xdef/8',
        },
      }),
    ).toThrow('Lift publish mapping requires validation.priorVersion to match request.priorVersion');
  });
});
