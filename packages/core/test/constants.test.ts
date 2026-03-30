import { describe, it, expect } from 'vitest';
import {
  paranetPublishTopic,
  paranetWorkspaceTopic,
  paranetAppTopic,
  paranetDataGraphUri,
  paranetSessionsTopic,
  paranetFinalizationTopic,
} from '../src/constants.js';
import { createOperationContext } from '../src/logger.js';

describe('paranet topic helpers', () => {
  it('paranetPublishTopic returns correct format', () => {
    expect(paranetPublishTopic('testing')).toBe('dkg/paranet/testing/publish');
  });

  it('paranetWorkspaceTopic returns correct format', () => {
    expect(paranetWorkspaceTopic('testing')).toBe('dkg/paranet/testing/workspace');
  });

  it('paranetAppTopic returns correct format', () => {
    expect(paranetAppTopic('origin-trail-game')).toBe('dkg/paranet/origin-trail-game/app');
    expect(paranetAppTopic('testing')).toBe('dkg/paranet/testing/app');
  });

  it('paranetDataGraphUri returns correct format', () => {
    expect(paranetDataGraphUri('agents')).toBe('did:dkg:paranet:agents');
  });

  it('paranetSessionsTopic returns correct format', () => {
    expect(paranetSessionsTopic('testing')).toBe('dkg/paranet/testing/sessions');
  });

  it('paranetFinalizationTopic returns correct format', () => {
    expect(paranetFinalizationTopic('testing')).toBe('dkg/paranet/testing/finalization');
  });

  it('handles empty string paranet ID', () => {
    expect(paranetPublishTopic('')).toBe('dkg/paranet//publish');
    expect(paranetDataGraphUri('')).toBe('did:dkg:paranet:');
  });

  it('preserves paranet IDs with special characters', () => {
    expect(paranetPublishTopic('my-paranet')).toBe('dkg/paranet/my-paranet/publish');
    expect(paranetPublishTopic('paranet_v2')).toBe('dkg/paranet/paranet_v2/publish');
  });

  it('does not sanitize slashes in paranet IDs (caller responsibility)', () => {
    const result = paranetPublishTopic('a/b');
    expect(result).toBe('dkg/paranet/a/b/publish');
  });
});

describe('createOperationContext', () => {
  it('generates a unique operationId', () => {
    const ctx = createOperationContext('publish');
    expect(ctx.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx.operationName).toBe('publish');
    expect(ctx.sourceOperationId).toBeUndefined();
  });

  it('accepts a sourceOperationId for cross-node correlation', () => {
    const sourceId = '550e8400-e29b-41d4-a716-446655440000';
    const ctx = createOperationContext('gossip', sourceId);
    expect(ctx.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx.operationId).not.toBe(sourceId);
    expect(ctx.sourceOperationId).toBe(sourceId);
  });
});
