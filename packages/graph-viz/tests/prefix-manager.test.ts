import { describe, it, expect } from 'vitest';
import { PrefixManager } from '../src/core/prefix-manager.js';

describe('PrefixManager', () => {
  it('compacts well-known URIs', () => {
    const pm = new PrefixManager();
    expect(pm.compact('https://schema.org/Person')).toBe('schema:Person');
    expect(pm.compact('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toBe('rdf:type');
    expect(pm.compact('http://xmlns.com/foaf/0.1/name')).toBe('foaf:name');
  });

  it('returns null for unknown namespaces', () => {
    const pm = new PrefixManager();
    expect(pm.compact('https://unknown.example.org/Foo')).toBeNull();
  });

  it('expands prefixed terms', () => {
    const pm = new PrefixManager();
    expect(pm.expand('schema:Person')).toBe('https://schema.org/Person');
    expect(pm.expand('rdf:type')).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
  });

  it('returns input unchanged for full URIs', () => {
    const pm = new PrefixManager();
    expect(pm.expand('https://schema.org/Person')).toBe('https://schema.org/Person');
  });

  it('returns input unchanged for unknown prefixes', () => {
    const pm = new PrefixManager();
    expect(pm.expand('foo:bar')).toBe('foo:bar');
  });

  it('accepts user-defined prefixes', () => {
    const pm = new PrefixManager({ guardian: 'https://guardiankg.org/vocab/' });
    expect(pm.compact('https://guardiankg.org/vocab/riskScore')).toBe('guardian:riskScore');
    expect(pm.expand('guardian:riskScore')).toBe('https://guardiankg.org/vocab/riskScore');
  });

  it('user prefixes override well-known ones', () => {
    const pm = new PrefixManager({ schema: 'https://custom-schema.org/' });
    expect(pm.expand('schema:Foo')).toBe('https://custom-schema.org/Foo');
  });

  it('extracts local name from URI', () => {
    expect(PrefixManager.localName('https://schema.org/Person')).toBe('Person');
    expect(PrefixManager.localName('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toBe('type');
    expect(PrefixManager.localName('plain')).toBe('plain');
  });

  it('addPrefixes merges new prefixes', () => {
    const pm = new PrefixManager();
    pm.addPrefixes({ ex: 'https://example.org/' });
    expect(pm.expand('ex:thing')).toBe('https://example.org/thing');
    // Well-known still works
    expect(pm.expand('schema:Person')).toBe('https://schema.org/Person');
  });
});
