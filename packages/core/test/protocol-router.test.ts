import { describe, it, expect } from 'vitest';
import { isRecoverableSendError, DEFAULT_SEND_TIMEOUT_MS } from '../src/protocol-router.js';

describe('ProtocolRouter', () => {
  describe('isRecoverableSendError', () => {
    it('returns true for protocol selection / negotiation errors (relay sync)', () => {
      expect(isRecoverableSendError(new Error('Protocol selection failed - could not negotiate /dkg/sync/1.0.0'))).toBe(true);
      expect(isRecoverableSendError(new Error('could not negotiate /dkg/sync/1.0.0'))).toBe(true);
    });

    it('returns true for connection/stream errors', () => {
      expect(isRecoverableSendError(new Error('stream returned in closed state'))).toBe(true);
      expect(isRecoverableSendError(new Error('ECONNRESET'))).toBe(true);
      expect(isRecoverableSendError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isRecoverableSendError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isRecoverableSendError(new Error('EPIPE'))).toBe(true);
      expect(isRecoverableSendError(new Error('The operation was aborted'))).toBe(true);
      expect(isRecoverableSendError(new Error('no valid addresses'))).toBe(true);
    });

    it('returns false for non-recoverable errors', () => {
      expect(isRecoverableSendError(new Error('Read limit exceeded'))).toBe(false);
      expect(isRecoverableSendError(new Error('handler error'))).toBe(false);
      expect(isRecoverableSendError(new Error('Invalid payload'))).toBe(false);
    });

    it('handles non-Error values', () => {
      expect(isRecoverableSendError('protocol selection failed')).toBe(true);
      expect(isRecoverableSendError(null)).toBe(false);
    });
  });

  describe('DEFAULT_SEND_TIMEOUT_MS', () => {
    it('is 20 seconds for relay/sync tolerance', () => {
      expect(DEFAULT_SEND_TIMEOUT_MS).toBe(20_000);
    });
  });
});
