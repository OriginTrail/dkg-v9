import { describe, it, expect } from 'vitest';
import {
  contextGraphSubGraphUri,
  contextGraphSubGraphMetaUri,
  validateSubGraphName,
} from '../src/constants.js';

describe('sub-graph URI helpers', () => {
  const cgId = 'dkg-v10-dev';

  it('contextGraphSubGraphUri produces correct URI', () => {
    expect(contextGraphSubGraphUri(cgId, 'code')).toBe(
      'did:dkg:context-graph:dkg-v10-dev/code',
    );
  });

  it('contextGraphSubGraphMetaUri produces correct URI', () => {
    expect(contextGraphSubGraphMetaUri(cgId, 'code')).toBe(
      'did:dkg:context-graph:dkg-v10-dev/code/_meta',
    );
  });

  it('different sub-graph names produce different URIs', () => {
    const code = contextGraphSubGraphUri(cgId, 'code');
    const decisions = contextGraphSubGraphUri(cgId, 'decisions');
    expect(code).not.toBe(decisions);
  });
});

describe('validateSubGraphName', () => {
  it('accepts valid names', () => {
    expect(validateSubGraphName('code').valid).toBe(true);
    expect(validateSubGraphName('decisions').valid).toBe(true);
    expect(validateSubGraphName('game-state').valid).toBe(true);
    expect(validateSubGraphName('tasks').valid).toBe(true);
    expect(validateSubGraphName('v2-sessions').valid).toBe(true);
  });

  it('rejects empty name', () => {
    const result = validateSubGraphName('');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('empty');
  });

  it('rejects underscore-prefixed names (reserved for protocol)', () => {
    const result = validateSubGraphName('_meta');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('reserved');

    expect(validateSubGraphName('_shared_memory').valid).toBe(false);
    expect(validateSubGraphName('_private').valid).toBe(false);
  });

  it('rejects names containing slashes', () => {
    const result = validateSubGraphName('code/sub');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('/');
  });

  it('rejects names with IRI-unsafe characters', () => {
    expect(validateSubGraphName('code stuff').valid).toBe(false);
    expect(validateSubGraphName('code<>').valid).toBe(false);
    expect(validateSubGraphName('code"name').valid).toBe(false);
  });

  it('rejects reserved path segments', () => {
    expect(validateSubGraphName('context').valid).toBe(false);
    expect(validateSubGraphName('draft').valid).toBe(false);
  });
});
