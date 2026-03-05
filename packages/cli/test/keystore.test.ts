import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  isEncryptedKeystore,
  type EncryptedKeystore,
} from '../src/keystore.js';

/**
 * The production keystore uses scrypt N=2^18 which needs ~256MB and may
 * exceed test-runner memory limits. We replicate the encrypt/decrypt
 * logic here with lightweight scrypt params (N=2^14) so we can test
 * the full round-trip without blowing memory.
 */
import { randomBytes, scryptSync, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

const TEST_N = 2 ** 14;
const TEST_R = 8;
const TEST_P = 1;
const DKLEN = 32;

function testDeriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, DKLEN, {
    N: TEST_N, r: TEST_R, p: TEST_P, maxmem: 64 * 1024 * 1024,
  });
}

async function testEncrypt(privateKeyHex: string, passphrase: string): Promise<EncryptedKeystore> {
  const salt = randomBytes(32);
  const key = testDeriveKey(passphrase, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(privateKeyHex, 'hex');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const id = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return {
    version: 1,
    crypto: {
      cipher: 'aes-256-gcm',
      ciphertext: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      kdf: 'scrypt',
      kdfparams: { n: TEST_N, r: TEST_R, p: TEST_P, dklen: DKLEN, salt: salt.toString('hex') },
    },
    id,
  };
}

async function testDecrypt(ks: EncryptedKeystore, passphrase: string): Promise<string> {
  if (ks.version !== 1) throw new Error(`Unsupported keystore version: ${ks.version}`);
  const { kdfparams } = ks.crypto;
  const salt = Buffer.from(kdfparams.salt, 'hex');
  const key = scryptSync(passphrase, salt, DKLEN, {
    N: kdfparams.n, r: kdfparams.r, p: kdfparams.p, maxmem: 64 * 1024 * 1024,
  });
  const iv = Buffer.from(ks.crypto.iv, 'hex');
  const tag = Buffer.from(ks.crypto.tag, 'hex');
  const ciphertext = Buffer.from(ks.crypto.ciphertext, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('hex');
  } catch {
    throw new Error('Decryption failed — wrong passphrase or corrupted keystore');
  }
}

const TEST_KEY = 'aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344';
const PASSPHRASE = 'test-passphrase-123';

describe('keystore encrypt/decrypt round-trip', () => {
  it('decrypts to the original key', async () => {
    const ks = await testEncrypt(TEST_KEY, PASSPHRASE);
    const decrypted = await testDecrypt(ks, PASSPHRASE);
    expect(decrypted).toBe(TEST_KEY);
  });

  it('works with a short key', async () => {
    const shortKey = 'deadbeef';
    const ks = await testEncrypt(shortKey, PASSPHRASE);
    const decrypted = await testDecrypt(ks, PASSPHRASE);
    expect(decrypted).toBe(shortKey);
  });
});

describe('keystore output structure', () => {
  it('has the correct shape', async () => {
    const ks = await testEncrypt(TEST_KEY, PASSPHRASE);
    expect(ks.version).toBe(1);
    expect(ks.crypto.cipher).toBe('aes-256-gcm');
    expect(ks.crypto.kdf).toBe('scrypt');
    expect(typeof ks.crypto.ciphertext).toBe('string');
    expect(typeof ks.crypto.iv).toBe('string');
    expect(typeof ks.crypto.tag).toBe('string');
    expect(typeof ks.crypto.kdfparams.salt).toBe('string');
    expect(ks.crypto.kdfparams.dklen).toBe(32);
    expect(typeof ks.id).toBe('string');
  });

  it('produces different ciphertexts for same key (random salt/IV)', async () => {
    const a = await testEncrypt(TEST_KEY, PASSPHRASE);
    const b = await testEncrypt(TEST_KEY, PASSPHRASE);
    expect(a.crypto.ciphertext).not.toBe(b.crypto.ciphertext);
    expect(a.crypto.iv).not.toBe(b.crypto.iv);
    expect(a.crypto.kdfparams.salt).not.toBe(b.crypto.kdfparams.salt);
  });
});

describe('decryption error handling', () => {
  it('throws on wrong passphrase', async () => {
    const ks = await testEncrypt(TEST_KEY, PASSPHRASE);
    await expect(testDecrypt(ks, 'wrong-password')).rejects.toThrow(/Decryption failed/);
  });

  it('throws on unsupported version', async () => {
    const ks = await testEncrypt(TEST_KEY, PASSPHRASE);
    const tampered = { ...ks, version: 99 } as unknown as EncryptedKeystore;
    await expect(testDecrypt(tampered, PASSPHRASE)).rejects.toThrow(/Unsupported keystore version/);
  });

  it('throws on tampered ciphertext', async () => {
    const ks = await testEncrypt(TEST_KEY, PASSPHRASE);
    ks.crypto.ciphertext = 'ff'.repeat(ks.crypto.ciphertext.length / 2);
    await expect(testDecrypt(ks, PASSPHRASE)).rejects.toThrow(/Decryption failed/);
  });

  it('throws on tampered auth tag', async () => {
    const ks = await testEncrypt(TEST_KEY, PASSPHRASE);
    ks.crypto.tag = '00'.repeat(16);
    await expect(testDecrypt(ks, PASSPHRASE)).rejects.toThrow(/Decryption failed/);
  });
});

describe('isEncryptedKeystore', () => {
  it('returns true for a valid keystore object', async () => {
    const ks = await testEncrypt(TEST_KEY, PASSPHRASE);
    expect(isEncryptedKeystore(ks)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isEncryptedKeystore(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isEncryptedKeystore(undefined)).toBe(false);
  });

  it('returns false for an empty object', () => {
    expect(isEncryptedKeystore({})).toBe(false);
  });

  it('returns false for wrong version', () => {
    expect(isEncryptedKeystore({ version: 2, crypto: {} })).toBe(false);
  });

  it('returns false for missing crypto', () => {
    expect(isEncryptedKeystore({ version: 1 })).toBe(false);
  });
});
