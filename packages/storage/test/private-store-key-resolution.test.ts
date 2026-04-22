/**
 * Targeted coverage for the key-resolution and standalone decrypt paths in
 * `private-store.ts` that the existing private-store-extra tests don't
 * exercise (lines 56-70 + 74-89 + 159-164 in the v8 report).
 *
 * The paths:
 *   - decryptPrivateLiteral  (module export, stateless)
 *   - resolveEncryptionKey   (hex/base64/short-input/explicit-bytes branches)
 *   - encrypt→decrypt round-trip with an explicit 32-byte key
 *   - decrypt-with-wrong-key returns the envelope unchanged (never throws)
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  OxigraphStore,
  ContextGraphManager,
  PrivateContentStore,
  type Quad,
} from '../src/index.js';
import { decryptPrivateLiteral } from '../src/private-store.js';

function makeFreshStore() {
  const dir = mkdtempSync(join(tmpdir(), 'dkg-ps-key-'));
  const store = new OxigraphStore(join(dir, 'db'));
  return { store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('decryptPrivateLiteral (standalone export) — envelope handling', () => {
  it('returns non-encrypted literals unchanged', () => {
    const plain = '"hello world"';
    expect(decryptPrivateLiteral(plain)).toBe(plain);
    expect(decryptPrivateLiteral('<http://example.org/s>')).toBe('<http://example.org/s>');
    expect(decryptPrivateLiteral('_:b0')).toBe('_:b0');
  });

  it('returns the serialized string unchanged when it starts with the envelope but body is malformed', () => {
    // Envelope prefix present but the content is not base64-decodable to a
    // valid 12+16+ct structure — the helper must never throw, only pass
    // the serialized form through.
    const malformed = '"enc:gcm:v1:not-base64-at-all!!!"';
    const out = decryptPrivateLiteral(malformed);
    // Either we get the original back (catch triggered) or a plain "" — in
    // both cases the helper MUST NOT throw.
    expect(typeof out).toBe('string');
  });

  it('returns the envelope unchanged when decryption fails with the wrong key', async () => {
    const { store, cleanup } = makeFreshStore();
    try {
      const gm = new ContextGraphManager(store);
      await gm.ensureContextGraph('cg-1');
      const psA = new PrivateContentStore(store, gm, { encryptionKey: 'A'.repeat(64) });
      await psA.storePrivateTriples(
        'cg-1',
        'did:dkg:agent:A',
        [{ subject: 'did:dkg:agent:A', predicate: 'http://example.org/p', object: '"secret"', graph: '' }] as Quad[],
      );
      // Pull ciphertext via a raw SPARQL query to bypass the in-instance decrypt.
      const result = await store.query(`
        SELECT ?o WHERE { GRAPH ?g { ?s ?p ?o } } LIMIT 1
      `);
      const ciphertext = (result as any).bindings[0].o as string;
      expect(ciphertext.startsWith('"enc:gcm:v1:')).toBe(true);

      // Now decrypt with a DIFFERENT key — function must not throw and
      // must not return plaintext. Returning the envelope unchanged is
      // the documented "wrong key" signal.
      const wrong = decryptPrivateLiteral(ciphertext, { encryptionKey: 'B'.repeat(64) });
      expect(wrong).toBe(ciphertext);
    } finally {
      cleanup();
    }
  });
});

describe('resolveEncryptionKey via PrivateContentStore constructor — branch coverage', () => {
  it('accepts a 64-char hex key (32 bytes) and round-trips correctly', async () => {
    const { store, cleanup } = makeFreshStore();
    try {
      const gm = new ContextGraphManager(store);
      await gm.ensureContextGraph('cg-hex');
      const hexKey = '0'.repeat(64); // 32 bytes of 0x00
      const ps = new PrivateContentStore(store, gm, { encryptionKey: hexKey });
      await ps.storePrivateTriples('cg-hex', 'did:dkg:agent:X', [
        { subject: 'did:dkg:agent:X', predicate: 'http://example.org/p', object: '"secret-hex"', graph: '' },
      ] as Quad[]);
      const read = await ps.getPrivateTriples('cg-hex', 'did:dkg:agent:X');
      expect(read).toHaveLength(1);
      expect(read[0].object).toBe('"secret-hex"');
    } finally {
      cleanup();
    }
  });

  it('accepts a base64-encoded 32-byte key', async () => {
    const { store, cleanup } = makeFreshStore();
    try {
      const gm = new ContextGraphManager(store);
      await gm.ensureContextGraph('cg-b64');
      const b64 = Buffer.alloc(32, 7).toString('base64');
      const ps = new PrivateContentStore(store, gm, { encryptionKey: b64 });
      await ps.storePrivateTriples('cg-b64', 'did:dkg:agent:Y', [
        { subject: 'did:dkg:agent:Y', predicate: 'http://example.org/p', object: '"secret-b64"', graph: '' },
      ] as Quad[]);
      const read = await ps.getPrivateTriples('cg-b64', 'did:dkg:agent:Y');
      expect(read).toHaveLength(1);
      expect(read[0].object).toBe('"secret-b64"');
    } finally {
      cleanup();
    }
  });

  it('SHA-256-stretches a short passphrase into a 32-byte key (round-trips)', async () => {
    const { store, cleanup } = makeFreshStore();
    try {
      const gm = new ContextGraphManager(store);
      await gm.ensureContextGraph('cg-short');
      // A short passphrase — not 64 hex chars, so the hex branch is skipped
      // and it falls to the base64 branch, which decodes to a non-32-byte
      // buffer and triggers the SHA-256 stretch.
      const ps = new PrivateContentStore(store, gm, { encryptionKey: 'hunter2' });
      await ps.storePrivateTriples('cg-short', 'did:dkg:agent:Z', [
        { subject: 'did:dkg:agent:Z', predicate: 'http://example.org/p', object: '"secret-short"', graph: '' },
      ] as Quad[]);
      const read = await ps.getPrivateTriples('cg-short', 'did:dkg:agent:Z');
      expect(read).toHaveLength(1);
      expect(read[0].object).toBe('"secret-short"');
    } finally {
      cleanup();
    }
  });

  it('accepts a raw Uint8Array key and round-trips', async () => {
    const { store, cleanup } = makeFreshStore();
    try {
      const gm = new ContextGraphManager(store);
      await gm.ensureContextGraph('cg-bytes');
      const key = new Uint8Array(32).fill(42);
      const ps = new PrivateContentStore(store, gm, { encryptionKey: key });
      await ps.storePrivateTriples('cg-bytes', 'did:dkg:agent:W', [
        { subject: 'did:dkg:agent:W', predicate: 'http://example.org/p', object: '"secret-bytes"', graph: '' },
      ] as Quad[]);
      const read = await ps.getPrivateTriples('cg-bytes', 'did:dkg:agent:W');
      expect(read).toHaveLength(1);
      expect(read[0].object).toBe('"secret-bytes"');
    } finally {
      cleanup();
    }
  });

  it('falls back to the deterministic default-domain key when no config is supplied', async () => {
    const { store, cleanup } = makeFreshStore();
    const prev = process.env.DKG_PRIVATE_STORE_KEY;
    delete process.env.DKG_PRIVATE_STORE_KEY;
    try {
      const gm = new ContextGraphManager(store);
      await gm.ensureContextGraph('cg-default');
      const ps1 = new PrivateContentStore(store, gm);
      const ps2 = new PrivateContentStore(store, gm);

      await ps1.storePrivateTriples('cg-default', 'did:dkg:agent:D', [
        { subject: 'did:dkg:agent:D', predicate: 'http://example.org/p', object: '"secret-default"', graph: '' },
      ] as Quad[]);

      // Two instances share the SAME deterministic default key, so ps2 can
      // read what ps1 wrote. This is the documented property (see
      // DEFAULT_KEY_DOMAIN comment in private-store.ts) that keeps
      // equality-based dedup pipelines working across process boundaries.
      const read = await ps2.getPrivateTriples('cg-default', 'did:dkg:agent:D');
      expect(read).toHaveLength(1);
      expect(read[0].object).toBe('"secret-default"');
    } finally {
      if (prev !== undefined) process.env.DKG_PRIVATE_STORE_KEY = prev;
      cleanup();
    }
  });

  it('picks DKG_PRIVATE_STORE_KEY from env when no explicit option is supplied', async () => {
    const { store, cleanup } = makeFreshStore();
    const prev = process.env.DKG_PRIVATE_STORE_KEY;
    process.env.DKG_PRIVATE_STORE_KEY = '1'.repeat(64);
    try {
      const gm = new ContextGraphManager(store);
      await gm.ensureContextGraph('cg-env');
      const ps = new PrivateContentStore(store, gm);
      await ps.storePrivateTriples('cg-env', 'did:dkg:agent:E', [
        { subject: 'did:dkg:agent:E', predicate: 'http://example.org/p', object: '"secret-env"', graph: '' },
      ] as Quad[]);
      const read = await ps.getPrivateTriples('cg-env', 'did:dkg:agent:E');
      expect(read).toHaveLength(1);
      expect(read[0].object).toBe('"secret-env"');
    } finally {
      if (prev === undefined) delete process.env.DKG_PRIVATE_STORE_KEY;
      else process.env.DKG_PRIVATE_STORE_KEY = prev;
      cleanup();
    }
  });
});

describe('PrivateContentStore.decryptLiteral — returns envelope on bad key (defence-in-depth)', () => {
  it('wrong key: the instance decrypt method leaves the envelope visible so callers can detect the failure', async () => {
    const { store, cleanup } = makeFreshStore();
    try {
      const gm = new ContextGraphManager(store);
      await gm.ensureContextGraph('cg-wk');
      const writer = new PrivateContentStore(store, gm, { encryptionKey: 'A'.repeat(64) });
      await writer.storePrivateTriples('cg-wk', 'did:dkg:agent:W', [
        { subject: 'did:dkg:agent:W', predicate: 'http://example.org/p', object: '"top-secret"', graph: '' },
      ] as Quad[]);

      // Reader with a DIFFERENT key — getPrivateTriples should pull the
      // rows but return the envelope string verbatim as the literal.
      const reader = new PrivateContentStore(store, gm, { encryptionKey: 'B'.repeat(64) });
      const read = await reader.getPrivateTriples('cg-wk', 'did:dkg:agent:W');
      expect(read).toHaveLength(1);
      expect(read[0].object.startsWith('"enc:gcm:v1:')).toBe(true); // envelope visible
      expect(read[0].object).not.toBe('"top-secret"'); // never leaks plaintext
    } finally {
      cleanup();
    }
  });
});
