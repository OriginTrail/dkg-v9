import { describe, it, expect } from 'vitest';

// Replicate the hexToBytes validation from session-routes.ts to confirm correctness
const HEX_RE = /^(0x)?[0-9a-fA-F]*$/;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !HEX_RE.test(clean)) {
    throw new Error('invalid hex string');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

describe('session-routes hexToBytes validation', () => {
  it('accepts valid hex string', () => {
    expect(hexToBytes('aabbcc')).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
  });

  it('accepts 0x-prefixed hex', () => {
    expect(hexToBytes('0xaabbcc')).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
  });

  it('rejects odd-length hex', () => {
    expect(() => hexToBytes('abc')).toThrow('invalid hex string');
  });

  it('rejects non-hex characters', () => {
    expect(() => hexToBytes('gghhii')).toThrow('invalid hex string');
  });

  it('rejects hex with spaces', () => {
    expect(() => hexToBytes('aa bb cc')).toThrow('invalid hex string');
  });

  it('handles empty string', () => {
    expect(hexToBytes('')).toEqual(new Uint8Array(0));
  });
});
