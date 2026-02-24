import { describe, it, expect } from 'vitest';
import { LabelResolver } from '../src/core/label-resolver.js';
import { PrefixManager } from '../src/core/prefix-manager.js';
import type { GraphNode } from '../src/core/types.js';

function makeNode(id: string, properties?: Record<string, string>): GraphNode {
  const props = new Map<string, Array<{ value: string }>>();
  if (properties) {
    for (const [k, v] of Object.entries(properties)) {
      props.set(k, [{ value: v }]);
    }
  }
  return {
    id,
    types: [],
    label: id,
    properties: props,
    imageUrl: null,
    metadata: new Map(),
    degree: 0,
    isBoundary: false,
  };
}

describe('LabelResolver', () => {
  const pm = new PrefixManager();

  describe('humanized mode', () => {
    const resolver = new LabelResolver('humanized', pm);

    it('resolves rdfs:label as display label', () => {
      const node = makeNode('https://example.org/alice', {
        'http://www.w3.org/2000/01/rdf-schema#label': 'Alice Wonderland',
      });
      expect(resolver.resolveNodeLabel(node)).toBe('Alice Wonderland');
    });

    it('resolves schema:name as display label', () => {
      const node = makeNode('https://example.org/alice', {
        'https://schema.org/name': 'Alice',
      });
      expect(resolver.resolveNodeLabel(node)).toBe('Alice');
    });

    it('falls back to humanized URI local name', () => {
      const node = makeNode('https://example.org/SocialMediaPosting');
      expect(resolver.resolveNodeLabel(node)).toBe('social media posting');
    });

    it('humanizes camelCase predicates', () => {
      expect(resolver.resolveUri('https://schema.org/dateCreated')).toBe('date created');
    });

    it('humanizes PascalCase', () => {
      expect(resolver.resolveUri('https://schema.org/SocialMediaPosting')).toBe('social media posting');
    });
  });

  describe('strict mode', () => {
    const resolver = new LabelResolver('strict', pm);

    it('uses prefixed form for known namespaces', () => {
      const node = makeNode('https://schema.org/Person');
      expect(resolver.resolveNodeLabel(node)).toBe('schema:Person');
    });

    it('uses local name for unknown namespaces', () => {
      const node = makeNode('https://unknown.example.org/Foo');
      expect(resolver.resolveNodeLabel(node)).toBe('Foo');
    });

    it('still prefers explicit rdfs:label', () => {
      const node = makeNode('https://schema.org/Person', {
        'http://www.w3.org/2000/01/rdf-schema#label': 'A Person',
      });
      expect(resolver.resolveNodeLabel(node)).toBe('A Person');
    });
  });

  describe('label priority', () => {
    it('rdfs:label takes priority over schema:name', () => {
      const resolver = new LabelResolver('humanized', pm);
      const node = makeNode('https://example.org/x', {
        'http://www.w3.org/2000/01/rdf-schema#label': 'RDFS Label',
        'https://schema.org/name': 'Schema Name',
      });
      expect(resolver.resolveNodeLabel(node)).toBe('RDFS Label');
    });
  });
});
