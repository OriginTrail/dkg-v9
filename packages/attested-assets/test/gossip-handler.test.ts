import { describe, it, expect } from 'vitest';
import { paranetSessionsTopic, sessionTopic } from '../src/gossip-handler.js';

describe('gossip topic helpers', () => {
  it('paranetSessionsTopic follows convention', () => {
    expect(paranetSessionsTopic('oregon-trail')).toBe('dkg/paranet/oregon-trail/sessions');
  });

  it('sessionTopic includes session id', () => {
    expect(sessionTopic('oregon-trail', 'session-123')).toBe(
      'dkg/paranet/oregon-trail/sessions/session-123',
    );
  });

  it('handles special characters in ids', () => {
    expect(paranetSessionsTopic('my-paranet')).toBe('dkg/paranet/my-paranet/sessions');
    expect(sessionTopic('p1', 's-with-dashes')).toBe('dkg/paranet/p1/sessions/s-with-dashes');
  });
});
