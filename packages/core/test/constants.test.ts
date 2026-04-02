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

describe('paranet topic helpers (V10 — deprecated aliases use context-graph prefix)', () => {
  it('paranetPublishTopic returns V10 finalization topic', () => {
    expect(paranetPublishTopic('testing')).toBe('dkg/context-graph/testing/finalization');
  });

  it('paranetWorkspaceTopic returns V10 workspace topic', () => {
    expect(paranetWorkspaceTopic('testing')).toBe('dkg/context-graph/testing/workspace');
  });

  it('paranetAppTopic returns V10 app topic', () => {
    expect(paranetAppTopic('origin-trail-game')).toBe('dkg/context-graph/origin-trail-game/app');
    expect(paranetAppTopic('testing')).toBe('dkg/context-graph/testing/app');
  });

  it('paranetDataGraphUri returns V10 data URI', () => {
    expect(paranetDataGraphUri('agents')).toBe('did:dkg:context-graph:agents');
  });

  it('paranetSessionsTopic returns V10 sessions topic', () => {
    expect(paranetSessionsTopic('testing')).toBe('dkg/context-graph/testing/sessions');
  });

  it('paranetFinalizationTopic returns V10 finalization topic', () => {
    expect(paranetFinalizationTopic('testing')).toBe('dkg/context-graph/testing/finalization');
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
